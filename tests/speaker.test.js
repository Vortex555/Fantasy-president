import test from "node:test";
import assert from "node:assert/strict";

import {
  candidacy, nomination, holdouts, openRace, concede, takeBallot, ballot, settle,
  chairThreat, tickChair, conceded, HOUSE_SEATS, MAX_BALLOTS,
} from "../src/speaker.js";
import { createHouseCareer } from "../src/house.js";
import { rankOf, couldLead } from "../src/committees.js";
import { vacateCount } from "../src/procedure.js";

/**
 * Electing a Speaker.
 *
 * The chair used to be handed out by arithmetic: clear a seniority bar, clear a
 * standing bar, hold the majority, and `rankOf` made you Speaker between one
 * Congress and the next without a vote being taken. Nobody has ever become
 * Speaker that way.
 *
 * It is the only officer of the House named in the Constitution, it is filled
 * by the whole chamber on the record by name, and the number that matters is
 * not a majority of your caucus but an absolute majority of everybody voting.
 * A caucus of 240 can nominate you unanimously and five of its members can keep
 * you out of the chair for a fortnight, because five is all it takes.
 */

const member = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "Dale Fairweather", party: "Democrat",
    startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat", district: "OH-6",
  }),
  congress: { houseD: 240, houseR: 195, senateD: 52, senateR: 48 },
  ...o,
});

/** Somebody their caucus would actually nominate. */
const contender = (o = {}) => member({
  leadership: 92, capital: 40, bloc: 70,
  ...o,
  seat: { ...member().seat, seniority: 7, ...(o.seat || {}) },
});

// ---------------------------------------------------------------------------
// Whether you are even in the running
// ---------------------------------------------------------------------------

test("a freshman is not considered, and is told why", () => {
  const out = candidacy(member({ leadership: 95 }));
  assert.equal(out.can, false);
  assert.match(out.reason, /freshman|terms/);
});

test("nor is a member the caucus does not rate", () => {
  const out = candidacy(member({ seat: { ...member().seat, seniority: 8 }, leadership: 40 }));
  assert.equal(out.can, false);
  assert.match(out.reason, /40/);
});

test("nor anybody in the minority, however senior", () => {
  const out = candidacy(contender({ congress: { houseD: 195, houseR: 240, senateD: 48, senateR: 52 } }));
  assert.equal(out.can, false);
  assert.match(out.reason, /minority/);
});

test("a senior member of the majority whose caucus rates them is a candidate", () => {
  assert.equal(candidacy(contender()).can, true);
  assert.equal(couldLead(contender()), true);
  assert.notEqual(rankOf(contender()), "speaker", "which is not the same as being Speaker");
});

// ---------------------------------------------------------------------------
// The room behind the closed door
// ---------------------------------------------------------------------------

test("the caucus nomination is a majority of the caucus, and it has a rival in it", () => {
  const out = nomination(contender());
  assert.equal(out.seats, 240);
  assert.equal(out.needed, 121);
  assert.equal(out.won, out.votes >= out.needed);
  assert.ok(out.rival.length > 3, "losing has to have a name attached to it");
});

test("standing with the caucus is most of what wins the room", () => {
  const liked = nomination(contender({ leadership: 95 })).votes;
  const tolerated = nomination(contender({ leadership: 60 })).votes;
  assert.ok(liked > tolerated + 20, `${liked} vs ${tolerated}`);
});

// ---------------------------------------------------------------------------
// The floor, which is a different number
// ---------------------------------------------------------------------------

/**
 * Excluding the nominee's own wing gave a candidate whose caucus has exactly
 * one restive bloc an election with nobody in the way, which is not an
 * election. It is also wrong about how these go: the people who kept McCarthy
 * from the chair included members he had counted as his own. Being one of them
 * is a discount, not an exemption.
 */
test("the holdouts are organised, from your own side, and want things in writing", () => {
  const out = holdouts(contender());
  assert.ok(out.length, "somebody always holds out");
  for (const h of out) {
    assert.ok(h.holding >= 1 && h.holding <= h.seats);
    assert.ok(h.wants.label.length > 8);
    assert.ok(h.wants.cost.length > 20, `${h.id} does not say what it costs later`);
  }
});

test("a ballot needs an absolute majority of everybody voting, not of your caucus", () => {
  const s = contender();
  const race = openRace(s);
  const first = ballot(s, race);

  assert.equal(first.needed, Math.floor(HOUSE_SEATS / 2) + 1, "218 when all 435 vote");
  assert.ok(first.needed > Math.floor(240 / 2) + 1,
    "the number that matters is not the one that nominated you");
  assert.equal(first.votes, 240 - first.held);
});

test("holdouts are what keeps a nominee out of the chair", () => {
  const s = contender();
  const race = openRace(s);
  if (race.holdouts.length) {
    const withThem = ballot(s, { ...race, holdouts: race.holdouts.map((h) => ({ ...h, conceded: true })) });
    const without = ballot(s, race);
    assert.ok(withThem.votes > without.votes);
  }
});

test("conceding buys their votes back, permanently, at a price", () => {
  const s = contender();
  const race = openRace(s);
  const bloc = race.holdouts[0];
  const out = concede(s, race, bloc.id);

  assert.equal(out.rejected, undefined);
  assert.equal(out.race.conceded.length, 1);
  assert.ok(ballot(s, out.race).votes > ballot(s, race).votes);
  assert.equal(concede(s, out.race, bloc.id).rejected, true, "there is no conceding twice");
});

test("the chamber's patience runs out, and then somebody else is Speaker", () => {
  const s = contender();
  let race = openRace(s);
  // Never concede anything, and keep going.
  for (let i = 0; i < MAX_BALLOTS + 2 && !race.done; i += 1) race = takeBallot(s, race).race;

  assert.equal(race.done, true);
  assert.ok(race.ballots <= MAX_BALLOTS);
});

// ---------------------------------------------------------------------------
// What it costs to have won
// ---------------------------------------------------------------------------

test("winning makes you Speaker and writes the concessions into the rules", () => {
  const s = contender();
  const race = { ...openRace(s), won: true, ballots: 6, conceded: [{ id: "vacate_one", label: "x", cost: "y" }] };
  const next = structuredClone(s);
  const out = settle(next, race);

  assert.equal(out.won, true);
  assert.equal(next.rank, "speaker");
  assert.equal(next.committee, "rules", "the Speaker runs Rules");
  assert.equal(conceded(next, "vacate_one"), true);
  assert.match(out.note, /6th ballot/);
});

test("a long election costs standing even when you win it", () => {
  const quick = structuredClone(contender());
  const grim = structuredClone(contender());
  settle(quick, { ...openRace(quick), won: true, ballots: 1, conceded: [] });
  settle(grim, { ...openRace(grim), won: true, ballots: 15, conceded: [] });

  assert.ok(quick.leadership > grim.leadership,
    "every ballot after the fourth was a day the House did nothing, on camera");
});

test("losing it is public, and the record says to whom", () => {
  const s = structuredClone(contender());
  const out = settle(s, { ...openRace(s), won: false, ballots: 11 });

  assert.equal(out.won, false);
  assert.notEqual(s.rank, "speaker");
  assert.equal(s.speakerLost.ballots, 11);
  assert.ok(s.speakerLost.to.length > 3);
});

// ---------------------------------------------------------------------------
// Holding it
// ---------------------------------------------------------------------------

/**
 * The concession that ended a speakership. A single member being able to file
 * the motion is what made the chair unholdable in the 118th Congress, and it is
 * in here at exactly that price rather than as a modifier.
 */
test("the chair you conceded for is the chair you cannot keep", () => {
  const clean = { ...contender(), rank: "speaker", concessions: [] };
  const bought = { ...contender(), rank: "speaker", concessions: ["vacate_one"] };

  assert.ok(chairThreat(bought).at > chairThreat(clean).at * 3);
  assert.ok(chairThreat(bought).reasons.some((r) => /single member/i.test(r)));
});

test("a member who is not Speaker is not under threat of being vacated", () => {
  assert.equal(chairThreat(contender()).at, 0);
  assert.equal(chairThreat({ ...contender(), rank: "speaker", office: "senate" }).at, 0,
    "and the Senate has no Speaker to vacate");
});

test("a motion that carries takes the chair and the concessions with it", () => {
  const s = { ...contender(), rank: "speaker", concessions: ["vacate_one"], month: 5 };
  const carried = { ...vacateCount(s, 0), passes: true, yes: 220, total: 435, threshold: 218 };
  const filed = tickChair(s, carried);

  if (filed) {
    assert.equal(s.rank, "chair");
    assert.ok(s.vacancy > 0, "and the House has no Speaker until it can agree on one");
    assert.deepEqual(s.concessions, [], "somebody else will be making their own promises");
  }
});

test("the same month is the same month, because a career is not a slot machine", () => {
  const a = { ...contender(), rank: "speaker", concessions: ["vacate_one"], month: 7 };
  const b = structuredClone(a);
  const count = vacateCount(a, 0);
  assert.equal(Boolean(tickChair(a, count)), Boolean(tickChair(b, count)));
});

test("your own wing holds out too, for less", () => {
  const board = holdouts(contender());
  const own = board.find((h) => h.own);
  if (own) {
    const share = own.holding / own.seats;
    const others = board.filter((h) => !h.own).map((h) => h.holding / h.seats);
    for (const rate of others) {
      assert.ok(share < rate, "you have more purchase in your own room, and not total purchase");
    }
  }
});
