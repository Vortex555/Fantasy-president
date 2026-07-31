import test from "node:test";
import assert from "node:assert/strict";

import {
  convictionView, integrityDelta, describeConviction, baseTurnout, primaryThreat,
  convictionWeight, INTEGRITY_START,
} from "../src/conviction.js";
import {
  buildCoalition, foundingBlocs, billReaction, coalitionStanding, coalitionTurnout,
} from "../src/coalition.js";
import { createHouseCareer, castVote, runReelection, floorBills, advanceHouseMonth } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";
import { historicalHouseVerdict } from "../src/houseVerdict.js";
import { mockIdeologyFit } from "../src/gameEngine.js";

/**
 * The ideology chosen at character creation used to decide starting approval,
 * which way you amended bills, and one line in a prompt. It did not decide
 * anything about how you were expected to vote: `partyLine` reads the caucus
 * anchor and `districtView` reads the seat axis, and neither had ever read
 * yours. A Progressive Firebrand and a Blue Dog Moderate in the same seat faced
 * identical pressure on every bill in the game.
 */

const who = (o = {}) => ({
  office: "house", presidentName: "Dale Fairweather", party: "Democrat",
  startYear: 2025, district: "OH-6", events: "classic",
  ideology: "Social Democrat", ideologyAxis: -0.6, ...o,
});

const firebrand = () => who({ ideology: "Progressive Firebrand", ideologyAxis: -0.7 });
const bluedog = () => who({ ideology: "Blue Dog Moderate", ideologyAxis: -0.12 });
const house = (sc = who(), o = {}) => ({ ...createHouseCareer(sc), ...o });

const taxCut = { id: "tax_cuts", title: "Growth and Investment Act", axis: 0.45, domain: "economy" };

// ---------------------------------------------------------------------------
// The third stance
// ---------------------------------------------------------------------------

test("your own convictions are now a stance on every bill", () => {
  const v = convictionView(house(), taxCut);
  assert.ok(["yes", "no"].includes(v.position));
  assert.ok(v.intensity >= 5 && v.intensity <= 100);
  assert.equal(v.ideology, "Social Democrat");
});

test("two members of the same party in the same seat now differ", () => {
  const bill = { id: null, title: "A Bill", axis: -0.65, domain: "economy" };
  const hot = convictionView(house(firebrand()), bill);
  const cool = convictionView(house(bluedog()), bill);

  assert.equal(hot.position, "yes", "a hard-left bill is what a firebrand came for");
  assert.equal(cool.position, "no", "and is not what a Blue Dog signed up to");
});

test("a fringe believer feels it harder than a mainstream one", () => {
  assert.ok(convictionWeight({ party: "Democrat", ideology: "Democratic Socialist" })
    >= convictionWeight({ party: "Democrat", ideology: "Liberal Mainstream" }));
});

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

test("betraying yourself costs more than keeping faith earns", () => {
  const s = house(firebrand());
  const v = convictionView(s, taxCut);
  const kept = integrityDelta(v, v.position, s);
  const broken = integrityDelta(v, v.position === "yes" ? "no" : "yes", s);

  assert.ok(kept > 0 && broken < 0);
  // Emergent rather than tuned: from a start of 68, zero is further away than a
  // hundred is, so a betrayal always moves the number further than a kept vote.
  assert.ok(Math.abs(broken) > kept * 1.5, `${broken} against ${kept}`);
});

/**
 * The property the accumulator could not have. Integrity used to creep upward on
 * every easy vote, so a full term left a purist on 83 and an opportunist on 78 —
 * a meter measuring nothing. A proportion cannot be farmed.
 */
test("integrity cannot be farmed with votes you did not care about", () => {
  let s = house(firebrand());
  // Fifty votes exactly at this member's own position, all trivially easy.
  const easy = { id: null, title: "Easy", axis: -0.7, domain: "economy" };
  for (let i = 0; i < 50; i++) {
    const out = castVote({ ...s, voteLog: [] }, { ...easy, id: `e${i}` }, "yes");
    s = out.state;
  }
  const farmed = s.integrity;

  // Now one genuinely hard betrayal.
  const after = castVote({ ...s, voteLog: [] }, taxCut, "yes").state.integrity;
  assert.ok(after < farmed, "the hard vote still moves it");
  assert.ok(farmed <= 100);
});

test("a career of betrayals lands low, and one of conviction lands high", () => {
  const bills = [-0.7, 0.45, -0.6, 0.5, -0.65, 0.4, -0.55, 0.55]
    .map((axis, i) => ({ id: `b${i}`, title: `B${i}`, axis, domain: "economy" }));

  const run = (chooser) => {
    let s = house(firebrand());
    for (const b of bills) {
      const v = convictionView(s, b);
      s = castVote({ ...s, voteLog: [] }, b, chooser(v)).state;
    }
    return s.integrity;
  };

  const staunch = run((v) => v.position);
  const traitor = run((v) => (v.position === "yes" ? "no" : "yes"));
  assert.ok(staunch > 80, `a purist should read high, got ${staunch}`);
  assert.ok(traitor < 30, `a fraud should read low, got ${traitor}`);
});

test("ducking a vote you care about is its own small betrayal", () => {
  const v = convictionView(house(firebrand()), taxCut);
  assert.ok(integrityDelta(v, "abstain") < 0);
});

test("the same vote costs a firebrand much more than a moderate", () => {
  const hot = castVote(house(firebrand()), taxCut, "yes");
  const cool = castVote(house(bluedog()), taxCut, "yes");
  assert.ok(hot.result.conviction.delta < cool.result.conviction.delta,
    `${hot.result.conviction.delta} vs ${cool.result.conviction.delta}`);
});

test("a career starts with the benefit of the doubt and moves from there", () => {
  const s = house();
  assert.equal(s.integrity, INTEGRITY_START);
  const out = castVote(s, taxCut, "yes");
  assert.notEqual(out.state.integrity, INTEGRITY_START);
});

test("only the betrayals are narrated", () => {
  const v = convictionView(house(firebrand()), taxCut);
  assert.equal(describeConviction(v, v.position, 2), null, "doing the obvious thing is not news");
  assert.ok(describeConviction(v, v.position === "yes" ? "no" : "yes", -6));
});

test("a senator gets the same three numbers", () => {
  const s = createSenateCareer(who({ office: "senate", seatState: "OH" }));
  assert.equal(s.integrity, INTEGRITY_START);
  assert.ok(s.coalition);
});

// ---------------------------------------------------------------------------
// What it is worth on election night
// ---------------------------------------------------------------------------

test("your own base turning out is worth real points, bounded", () => {
  assert.ok(baseTurnout({ integrity: 100 }) > 0);
  assert.ok(baseTurnout({ integrity: 10 }) < 0);
  assert.ok(Math.abs(baseTurnout({ integrity: 0 })) <= 8, "never the only thing that matters");
  assert.equal(baseTurnout({ integrity: INTEGRITY_START }), 0, "the starting value is neutral");
});

test("a member nobody can read draws a primary from their own side", () => {
  assert.equal(primaryThreat({ integrity: 70 }), null);
  assert.equal(primaryThreat({ integrity: 40 }).severity, "gathering");
  assert.equal(primaryThreat({ integrity: 20 }).severity, "serious");
});

test("re-election now counts whether your own side showed up", () => {
  const strong = runReelection(house(who(), { integrity: 95 }));
  const hollow = runReelection(house(who(), { integrity: 12 }));
  assert.ok(strong.margin > hollow.margin, `${strong.margin} vs ${hollow.margin}`);
  assert.ok(typeof strong.base === "number");
  assert.ok(hollow.primary, "and warns about the primary");
});

// ---------------------------------------------------------------------------
// The coalition your ideology brings
// ---------------------------------------------------------------------------

test("an ideology arrives with allies and enemies, not a blank slate", () => {
  const c = buildCoalition({ party: "Democrat", ideology: "Progressive Firebrand" });
  assert.ok(c.labor > 60, "labour is with a firebrand");
  assert.ok(c.wall_street < 40, "and Wall Street is not");

  const third = buildCoalition({ party: "Democrat", ideology: "Third Way" });
  assert.ok(third.wall_street > 60 && third.labor < 40, "the exact opposite, from the same party");
});

test("only the blocs an ideology actually has a relationship with are tracked", () => {
  const blocs = foundingBlocs({ party: "Democrat", ideology: "Third Way" }).map((b) => b.id);
  assert.ok(blocs.includes("wall_street"));
  assert.ok(!blocs.includes("pentagon"), "Third Way has no stated relationship with the Pentagon");
});

test("a bill's reaction follows each bloc's own politics", () => {
  const left = billReaction({ id: null, axis: -0.8 });
  assert.ok(left.labor > 0 && left.wall_street < 0);
  const right = billReaction({ id: null, axis: 0.8 });
  assert.ok(right.labor < 0 && right.wall_street > 0);
  assert.deepEqual(billReaction({ id: null, axis: 0.02 }), {}, "nobody has feelings about a centrist bill");
});

test("a hand-written bill uses the reaction a human wrote for it", () => {
  const r = billReaction({ id: "universal_care", axis: -0.55 });
  assert.equal(r.labor, 12);
});

test("voting against your own coalition costs you with them either way", () => {
  const s = house(firebrand());
  const before = s.coalition.labor;
  // A hard-right bill; voting for it is a betrayal of labour whether it carries.
  const out = castVote(s, { id: null, title: "X", axis: 0.7, domain: "economy" }, "yes");
  assert.ok(out.state.coalition.labor < before);
});

test("standing is judged against the coalition you started with, not against fifty", () => {
  // A Third Way Democrat is not supposed to have organised labour and must not
  // be marked down for never having had it.
  const s = house(who({ ideology: "Third Way", ideologyAxis: -0.2 }));
  const standing = coalitionStanding(s);
  assert.ok(standing);
  assert.ok(standing.rows.every((r) => r.change === 0), "day one is even with day one");
  assert.equal(standing.mood, "committed");
});

test("a lost coalition costs votes and a kept one earns them", () => {
  const s = house(firebrand());
  const kept = coalitionTurnout(s);
  const lost = coalitionTurnout({ ...s, coalition: { ...s.coalition, labor: 5, civil_rights: 5, greens: 5 } });
  assert.ok(kept > lost);
});

// ---------------------------------------------------------------------------
// The record finally answers the question
// ---------------------------------------------------------------------------

test("the verdict says whether you stood for anything", () => {
  const base = house(firebrand(), {
    voteLog: Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, title: "A", axis: -0.5, vote: "yes", month: i + 1, term: 1, passed: true })),
  });
  const staunch = historicalHouseVerdict({ ...base, integrity: 92 });
  const hollow = historicalHouseVerdict({ ...base, integrity: 15 });

  assert.ok(staunch.score > hollow.score, `${staunch.score} vs ${hollow.score}`);
  assert.equal(staunch.integrity, 92);
  assert.ok(staunch.findings.some((f) => /Progressive Firebrand/.test(f.text)));
  assert.ok(hollow.findings.some((f) => /nobody could say what you were for/i.test(f.text)));
});

test("conviction is not automatically a virtue in the record", () => {
  // Held every line, passed nothing, rose nowhere. The record should say so.
  const purist = historicalHouseVerdict(house(firebrand(), {
    integrity: 95, rank: "member", sponsored: [],
    voteLog: Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, title: "A", axis: -0.9, vote: "no", month: i + 1, term: 1, passed: false })),
  }));
  assert.ok(purist.findings.some((f) => /cost you the influence/i.test(f.text)));
});

// ---------------------------------------------------------------------------
// The presidency is held to it too
// ---------------------------------------------------------------------------

test("the offline engine reads a policy against the politics it was elected on", () => {
  const soc = { scenario: { ideologyAxis: -0.6 } };
  const lib = { scenario: { ideologyAxis: 0.6 } };
  const left = "expand universal public healthcare funded by a wealth tax";

  assert.ok(mockIdeologyFit(soc, left) > 1, "a social democrat doing social democracy");
  assert.ok(mockIdeologyFit(lib, left) < -1, "a libertarian doing the same thing");
  assert.equal(mockIdeologyFit(soc, "convene a working group"), 0, "no content, no judgement");
  assert.equal(mockIdeologyFit({ scenario: {} }, left), 0, "and no stated ideology, no judgement");
});

// ---------------------------------------------------------------------------
// Old saves
// ---------------------------------------------------------------------------

test("a career predating all this still plays and still rolls forward", () => {
  const legacy = house();
  delete legacy.integrity;
  delete legacy.coalition;

  const out = castVote(legacy, taxCut, "yes");
  assert.ok(typeof out.state.integrity === "number", "it starts from the default");
  const { state } = advanceHouseMonth(out.state);
  assert.equal(state.month, 2);
  assert.equal(coalitionStanding(legacy), null, "and a missing coalition is simply absent");
});
