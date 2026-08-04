import test from "node:test";
import assert from "node:assert/strict";

import {
  FACTIONS, factionFor, factionOf, factionById, factionRoll, ownBloc,
  factionLine, blocDelta, describeBloc, BLOC_START,
} from "../src/factions.js";
import { traitFor, signatureBonus, SIGNATURE_BONUS } from "../src/conviction.js";
import { evaluateLadder } from "../src/committees.js";
import { IDEOLOGIES } from "../public/js/data/ideologies.js";
import { createHouseCareer, castVote, sponsorBill } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";
import { createGame } from "../src/gameEngine.js";
import { convictionView } from "../src/conviction.js";
import { rollCall, CONSENSUS } from "../src/bills.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

/**
 * A chamber held two organised bodies — the majority and the minority — and 435
 * members carrying ideologies that grouped them into nothing. The forty most
 * left-wing Democrats were forty individuals with similar opinions rather than
 * the thing they actually are: a bloc with a chair, a number and a price.
 */

const member = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Democrat", startYear: 2025,
  ideology: "Progressive Firebrand", ideologyAxis: -0.7, district: "OH-6", events: "classic", ...o,
});

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

test("every ideology in the game lands in a bloc", () => {
  const orphans = [];
  for (const [party, list] of Object.entries(IDEOLOGIES)) {
    for (const i of list) if (!factionFor(party, i.value)) orphans.push(`${party}/${i.value}`);
  }
  assert.deepEqual(orphans, [], "an ideology with no caucus has nowhere to sit");
});

test("membership follows politics, not party alone", () => {
  assert.equal(factionFor("Democrat", "Progressive Firebrand").id, "progressive");
  assert.equal(factionFor("Democrat", "Blue Dog Moderate").id, "blue_dog");
  assert.equal(factionFor("Republican", "Christian Nationalist").id, "freedom");
  assert.equal(factionFor("Republican", "Moderate Republican").id, "main_street");
});

test("the cross-pressured cases are placed by hand, because an axis cannot see them", () => {
  // Economically left, culturally at home with the faith bloc.
  assert.equal(factionFor("Democrat", "Religious Left").id, "labor_caucus");
  assert.equal(factionFor("Republican", "Paleoconservative").id, "freedom");
});

test("an independent is seated with whichever bloc is nearest, as with committees", () => {
  assert.ok(factionFor("Independent", "Communist"));
  assert.ok(factionFor("Independent", "Monarchist"));
});

test("a new ideology lands somewhere sensible without anybody filing it", () => {
  // Membership is an axis band precisely so the roster can grow.
  assert.equal(factionFor("Democrat", "Municipal Progressive").id, "progressive");
  assert.equal(factionFor("Republican", "Suburban Republican").id, "main_street");
});

// ---------------------------------------------------------------------------
// The bloc in the chamber
// ---------------------------------------------------------------------------

test("the chamber sorts into blocs, read from the actual roster", () => {
  const roll = factionRoll(member());
  assert.ok(roll.length >= 4, "a legislature has more than two organised bodies");
  const total = roll.reduce((sum, f) => sum + f.members, 0);
  assert.equal(total, 435, `every member sits somewhere, got ${total}`);
});

test("a senator's blocs are counted in the Senate, not the House", () => {
  const s = createSenateCareer({ office: "senate", presidentName: "M", party: "Democrat",
    startYear: 2025, ideology: "Progressive Firebrand", ideologyAxis: -0.7, seatState: "OH" });
  const total = factionRoll(s).reduce((sum, f) => sum + f.members, 0);
  assert.equal(total, 100);
});

test("your own bloc knows its size and whether it can deny a majority", () => {
  const b = ownBloc(member());
  assert.ok(b.members > 0);
  assert.ok(b.share > 0 && b.share < 100);
  assert.equal(typeof b.canDenyMajority, "boolean");
});

test("a radicalised chamber changes which bloc is largest", () => {
  const normal = factionRoll(member());
  const radical = factionRoll(member({ radicals: true }));
  assert.notDeepEqual(
    normal.map((f) => f.id).slice(0, 3),
    radical.map((f) => f.id).slice(0, 3),
    "the fringe should reorganise the room",
  );
});

// ---------------------------------------------------------------------------
// The fourth voice
// ---------------------------------------------------------------------------

test("a bill gets a fourth stance, and it is not the party's", () => {
  const s = member();
  const bill = { id: "budget_deal", title: "Bipartisan Budget", axis: 0.18, domain: "economy" };
  const bloc = factionLine(s, bill);
  assert.ok(["yes", "no"].includes(bloc.position));
  assert.ok(bloc.intensity >= 5 && bloc.intensity <= 100);
  assert.match(bloc.name, /Caucus|Coalition|Partnership|Committee/);
});

test("a bloc is more disciplined than a party, so it takes a position harder", () => {
  const freedom = factionById("freedom");
  const mainStreet = factionById("main_street");
  assert.ok(freedom.discipline > mainStreet.discipline,
    "the caucus organised to say no holds together better than the governing wing");
});

test("crossing your own bloc costs more than crossing leadership", () => {
  const s = member();
  const bill = { id: "budget_deal", title: "Bipartisan Budget", axis: 0.18, domain: "economy" };
  const bloc = factionLine(s, bill);
  const against = blocDelta(bloc, bloc.position === "yes" ? "no" : "yes");
  const withThem = blocDelta(bloc, bloc.position);
  assert.ok(against < 0 && withThem > 0);
  assert.ok(Math.abs(against) > withThem * 1.5,
    "a bloc of forty does not forgive the way a caucus of two hundred does");
});

test("the vote reports what the bloc made of it", () => {
  const s = member();
  const bill = { id: "budget_deal", title: "Bipartisan Budget", axis: 0.18, domain: "economy" };
  const bloc = factionLine(s, bill);
  const out = castVote(s, bill, bloc.position === "yes" ? "no" : "yes");

  assert.ok(out.result.bloc, "the bloc is a voice on every result");
  assert.ok(out.result.bloc.delta < 0);
  assert.ok(out.result.bloc.note, "and it says something when you cross it");
  assert.ok(out.state.bloc < BLOC_START);
});

test("ducking a vote your bloc was counting still costs", () => {
  const s = member();
  const bloc = factionLine(s, { axis: 0.5, domain: "economy" });
  assert.ok(blocDelta(bloc, "abstain") < 0);
});

// ---------------------------------------------------------------------------
// What an ideology lets you do
// ---------------------------------------------------------------------------

test("every ideology carries a signature, authored or derived", () => {
  let missing = 0;
  for (const [party, list] of Object.entries(IDEOLOGIES)) {
    for (const i of list) if (!traitFor(party, i.value)) missing++;
  }
  // Only the handful with no bloc effects at all have nothing to derive from.
  assert.ok(missing <= 3, `${missing} ideologies with no signature`);
});

test("the authored ones are distinct where two ideologies share a position", () => {
  // A Syndicalist and a Degrowth Advocate both sit near -0.9 and used to be the
  // same object mechanically.
  const a = traitFor("Democrat", "Syndicalist");
  const b = traitFor("Democrat", "Degrowth Advocate");
  assert.notEqual(a.strength, b.strength);
});

test("filing on your own subject is markedly easier than filing outside it", () => {
  const s = { ...member(), rank: "chair", leadership: 75 };
  s.seat = { ...s.seat, seniority: 4 };
  const own = sponsorBill({ ...s, sponsored: [] }, { title: "A", axis: -0.5, domain: "social" });
  const other = sponsorBill({ ...s, sponsored: [] }, { title: "A", axis: -0.5, domain: "security" });
  assert.ok(own.result.odds > other.result.odds, `${own.result.odds}% vs ${other.result.odds}%`);
});

test("the signature bonus is real and bounded", () => {
  const sc = { party: "Democrat", ideology: "Consumer Advocate" };
  assert.equal(signatureBonus(sc, "economy"), SIGNATURE_BONUS);
  assert.equal(signatureBonus(sc, "security"), 0);
});

// ---------------------------------------------------------------------------
// The presidency
// ---------------------------------------------------------------------------

test("a president comes out of a faction too", () => {
  const s = createGame({ presidentName: "A", party: "Democrat", startYear: 2025,
    ideology: "Progressive Firebrand", ideologyAxis: -0.7, era: "Modern", startApproval: 52 });
  assert.equal(s.faction, "progressive");
});

test("an old save with no bloc standing still votes", () => {
  const s = member();
  delete s.bloc;
  const out = castVote(s, { id: "b", title: "A", axis: -0.4, domain: "economy" }, "yes");
  assert.ok(typeof out.state.bloc === "number");
});

// ---------------------------------------------------------------------------
// The contemporary radicals
// ---------------------------------------------------------------------------

test("every radical ideology carries a real stability cost", () => {
  // A fringe position that costs nothing is not a fringe position.
  for (const [party, list] of Object.entries(IDEOLOGIES)) {
    for (const i of list.filter((x) => x.fringe)) {
      const fx = i.fx || {};
      const harm = (fx.stability || 0) + (fx.approval || 0);
      assert.ok(harm < 0, `${party}/${i.value} is fringe and costs nothing`);
    }
  }
});

test("the new radicals sort into the caucuses at their end of the room", () => {
  assert.equal(factionFor("Republican", "Groyper").id, "freedom");
  assert.equal(factionFor("Republican", "Techno-Monarchist").id, "freedom");
  assert.equal(factionFor("Democrat", "Marxist–Leninist").id, "progressive");
  assert.equal(factionFor("Democrat", "Abolitionist Left").id, "progressive");
});

test("a radicalised chamber is genuinely a different legislature", () => {
  const normal = factionRoll(member());
  const radical = factionRoll(member({ radicals: true }));

  const centre = (roll) => roll.filter((f) => ["new_democrat", "main_street", "study_committee"].includes(f.id))
    .reduce((sum, f) => sum + f.members, 0);
  const wings = (roll) => roll.filter((f) => ["progressive", "freedom"].includes(f.id))
    .reduce((sum, f) => sum + f.members, 0);

  assert.ok(wings(radical) > wings(normal) * 2, "the wings should swell");
  assert.ok(centre(radical) < centre(normal), "and the centre should collapse");
});

test("a radicalised chamber can still pass consensus legislation, and little else", () => {
  // Difficult, not broken. A polarised legislature passes what nobody can be
  // seen voting against and almost nothing else.
  const s = member({ radicals: true });
  const bench = buildCongress(s, STATES).house;
  assert.ok(!rollCall(bench, 0.15, { consensus: CONSENSUS.bipartisan }).passed,
    "even a bipartisan bill should struggle");
  assert.ok(rollCall(bench, 0.1, { consensus: CONSENSUS.unanimous }).passed,
    "but a memorial resolution still carries");
});

test("holding a radical position is felt harder on every vote", () => {
  // convictionWeight is 1.7 for a fringe ideology, so betraying one costs more.
  const radical = member({ ideology: "Marxist–Leninist", ideologyAxis: -0.95 });
  const mainstream = member({ ideology: "Liberal Mainstream", ideologyAxis: -0.35 });
  const bill = { id: "tax_cuts", title: "Growth Act", axis: 0.45, domain: "economy" };
  assert.ok(convictionView(radical, bill).intensity > convictionView(mainstream, bill).intensity);
});

// ---------------------------------------------------------------------------
// Every politics climbs the same ladder
//
// The Groyper used to carry `wrecker: true`, which closed the committee ladder
// to it outright — no room, no gavel, no promotion, however long it served, and
// a leadership standing of twelve to start. That was an honest statement of what
// the movement is and a poor one of what a game is: the ideology was left with
// no verbs but its vote, while bury, amend, the whip count and any realistic
// chance of a hearing were all gated behind a rank it could never hold.
//
// Removed until the mode has something for an insurgent to *do*. The tests that
// pinned the old behaviour are replaced by their opposites, so nobody
// reintroduces it by accident.
// ---------------------------------------------------------------------------

const insurgent = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Republican", startYear: 2025,
  ideology: "Groyper", ideologyAxis: 0.95, district: "OH-6", events: "classic", ...o,
});
const orthodox = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Republican", startYear: 2025,
  ideology: "Christian Nationalist", ideologyAxis: 0.9, district: "OH-6", events: "classic", ...o,
});

test("the generic entry is gone and the specific one replaced it", () => {
  const names = IDEOLOGIES.Republican.map((i) => i.value);
  assert.ok(!names.includes("Online Nationalist"));
  assert.ok(names.includes("Groyper"));
});

test("no ideology starts at war with its own leadership", () => {
  assert.ok(insurgent().leadership > 40, "it used to open at twelve and never recover");
  assert.ok(orthodox().leadership > 40);
});

test("every ideology is seated on a committee", () => {
  assert.ok(insurgent().committee, "no room at all was the other half of the block");
  assert.ok(orthodox().committee);
});

test("the same seniority and standing promote anybody", () => {
  const climb = (member) => {
    const decorated = { ...member, leadership: 90 };
    decorated.seat = { ...decorated.seat, seniority: 9 };
    return evaluateLadder(decorated).state.rank;
  };
  assert.notEqual(climb(insurgent()), "member",
    "nine terms and ninety with the caucus used to end where it began");
  assert.equal(climb(insurgent()), climb(orthodox()),
    "two ideologies with the same record reach the same rung");
});

test("nothing in the data closes the ladder to a politics any more", () => {
  for (const [party, list] of Object.entries(IDEOLOGIES)) {
    for (const i of list) {
      assert.equal(i.wrecker, undefined, `${party}/${i.value} still carries the flag`);
    }
  }
});

test("it still sits in the caucus nearest its politics", () => {
  assert.equal(factionFor("Republican", "Groyper").id, "freedom");
});

// ---------------------------------------------------------------------------
// Size, which is the only reason a bloc is worth anything
// ---------------------------------------------------------------------------

/**
 * A faction's entire power is that it can withhold enough votes to matter, so a
 * bloc sized wrong is a bloc that does not exist. This went unnoticed for real:
 * the Freedom Caucus band was [0.72, 1] and the mainstream Republican bench tops
 * out at 0.70, so outside a radicalised chamber the caucus organised to deny a
 * Speaker his majority stood at seven seats and could deny him nothing.
 *
 * Ranges rather than numbers, and checked across seeds and chamber splits,
 * because the roster is drawn at random around each party's anchor.
 */
test("every bloc is big enough to be worth whipping and small enough not to be the party", () => {
  const SANE = {
    progressive: [18, 60], labor_caucus: [40, 85], new_democrat: [70, 130], blue_dog: [12, 40],
    main_street: [18, 60], study_committee: [90, 165], liberty: [18, 50], freedom: [18, 55],
  };
  const splits = [
    { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
    { houseD: 240, houseR: 195, senateD: 53, senateR: 47 },
    { houseD: 190, houseR: 245, senateD: 44, senateR: 56 },
  ];

  for (const rosterSeed of ["demo", "a2", "b7", "zz", "q9", "m4"]) {
    for (const congress of splits) {
      const roll = factionRoll({ rosterSeed, congress, scenario: { party: "Republican" } });
      for (const [id, [lo, hi]] of Object.entries(SANE)) {
        const row = roll.find((f) => f.id === id);
        assert.ok(row, `${id} has no members at all in ${rosterSeed}`);
        assert.ok(row.members >= lo && row.members <= hi,
          `${id} came out at ${row.members} seats (want ${lo}-${hi}) — seed ${rosterSeed}`);
      }
    }
  }
});

test("the hardliners can actually deny a majority, which is the whole point of them", () => {
  const state = {
    rosterSeed: "demo",
    congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
    scenario: { party: "Republican", ideology: "Groyper", ideologyAxis: 0.95, ideologyLiberty: 0.5 },
    office: "house",
  };
  const mine = ownBloc(state);
  assert.equal(mine.id, "freedom");
  assert.ok(mine.canDenyMajority,
    "a Freedom Caucus that cannot cost leadership a vote is scenery");
});

test("the Liberty Caucus is held together by state power, not by the spectrum", () => {
  // The case the band could not express: a third of the spectrum apart on money,
  // next to each other on what the state may do.
  for (const name of ["Techno-Libertarian", "Libertarian Conservative", "Constitutionalist"]) {
    assert.equal(factionFor("Republican", name).id, "liberty", name);
  }
  assert.equal(factionFor("Republican", "Law & Order Conservative").id, "study_committee",
    "mandatory minimums do not belong in the bloc organised around the Constitution");
});
