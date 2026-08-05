import test from "node:test";
import assert from "node:assert/strict";

import {
  demands, schedule, hastert, ownSideBacks, chairThreat, SLOTS,
} from "../src/speaker.js";
import { createHouseCareer } from "../src/house.js";

/**
 * What a Speaker actually does.
 *
 * The chair was winnable and losable before this and the job in between was
 * unchanged: you were elected by the whole House, you could be vacated by it,
 * and then you sat there receiving a calendar like every other member. The
 * premise of the mode is "leadership schedules the floor and you vote on what
 * arrives", and the Speaker is the person that sentence is about.
 *
 * The power is almost entirely negative, which is the thing worth modelling. A
 * bill that does not get a rule does not get a vote, cannot be debated and
 * cannot be amended by anybody. Nothing in this chamber happens because the
 * Speaker wanted it; a great deal fails to happen because the Speaker did not.
 */

const speaker = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "Dale Fairweather", party: "Democrat",
    startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat", district: "OH-6",
  }),
  congress: { houseD: 240, houseR: 195, senateD: 52, senateR: 48 },
  rank: "speaker",
  leadership: 80,
  bloc: 65,
  seat: { district: "OH-6", state: "OH", stateName: "Ohio", lean: -12, axis: -0.13, seniority: 7 },
  ...o,
});

const bills = [
  { id: "a", title: "Universal Coverage Act", axis: -0.55, domain: "health", brief: "b" },
  { id: "b", title: "Growth and Investment Act", axis: 0.45, domain: "economy", brief: "b" },
  { id: "c", title: "Continuing Appropriations Act", axis: 0, domain: "economy", brief: "b" },
];

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

test("everything on a Speaker's desk has somebody behind it", () => {
  const out = demands(speaker(), bills);
  assert.equal(out.length, 3);
  for (const r of out) {
    assert.ok(r.wanted.length > 3, "a bill nobody is asking for is not a request");
    assert.ok(r.note.length > 20, "and the screen has to say what refusing costs");
    assert.equal(typeof r.ownSide, "boolean");
  }
});

test("a funding bill is not a request, it is a deadline", () => {
  const funding = demands(speaker(), bills).find((r) => r.id === "c");
  assert.equal(funding.mustPass, true);
  assert.match(funding.note, /government stops/);
});

test("there are always more requests than slots, which is the job", () => {
  assert.ok(SLOTS < bills.length);
});

// ---------------------------------------------------------------------------
// Saying no
// ---------------------------------------------------------------------------

test("what you schedule reaches the floor and what you do not leaves a grievance", () => {
  const s = speaker();
  const out = schedule(s, demands(s, bills), ["a"]);

  assert.deepEqual(out.bills.map((b) => b.id), ["a"]);
  assert.equal(out.refused.length, 2);
  assert.ok(Object.values(s.grievance || {}).some((n) => n > 0),
    "somebody asked and did not get it");
});

test("scheduling a wing's bill settles what they were owed", () => {
  const s = speaker();
  const requests = demands(s, bills);
  const wing = requests.find((r) => r.wing)?.wing;
  if (!wing) return;

  s.grievance = { [wing]: 4 };
  schedule(s, requests, [requests.find((r) => r.wing === wing).id]);
  assert.equal(s.grievance[wing], 0, "bringing it up is how the debt is paid");
});

test("a restive wing counts a refusal twice, because they are counting", () => {
  const s = speaker();
  const requests = demands(s, bills);
  const restive = requests.find((r) => r.restive);
  if (!restive) return;

  schedule(s, requests, []);
  assert.equal(s.grievance[restive.wing], 2);
});

/**
 * The one refusal a Speaker cannot absorb. A funding bill that is not brought
 * up is a government that stops, and everybody in the country knows exactly one
 * person decided that.
 */
test("refusing to schedule the funding bill stops the government", () => {
  const s = speaker();
  const before = { leadership: s.leadership, approval: s.approval };
  schedule(s, demands(s, bills), ["a", "b"]);

  assert.equal(s.shutdown, 1);
  assert.ok(s.leadership < before.leadership);
  assert.ok(s.approval < before.approval);
});

test("nothing is charged for a bill you did schedule", () => {
  const s = speaker();
  schedule(s, demands(s, bills), ["c", "a"]);
  assert.equal(s.shutdown, undefined);
});

// ---------------------------------------------------------------------------
// The majority of the majority
// ---------------------------------------------------------------------------

/**
 * The informal rule that has ended more speakerships than any formal one. A
 * Speaker who puts a bill on the floor that most of their own members oppose,
 * and passes it with the minority's votes, has done the one thing a caucus
 * genuinely does not forgive.
 */
test("the game knows whether your own caucus is behind a bill", () => {
  const s = speaker();
  assert.equal(ownSideBacks(s, bills[0]), true, "a Democratic caucus backs universal coverage");
  assert.equal(ownSideBacks(s, bills[1]), false, "and does not back a tax cut");
});

test("passing a bill your own side opposed is what costs you the chair", () => {
  const s = speaker();
  const before = { leadership: s.leadership, bloc: s.bloc };
  const [request] = demands(s, [bills[1]]);
  const out = hastert(s, request, true);

  assert.ok(out, "this is the thing that is supposed to be expensive");
  assert.equal(s.betrayals, 1);
  assert.ok(s.leadership < before.leadership);
  assert.ok(s.bloc < before.bloc);
  assert.match(out.note, /other party's votes/);
});

test("and nothing is charged for passing what your caucus wanted", () => {
  const s = speaker();
  const [request] = demands(s, [bills[0]]);
  assert.equal(hastert(s, request, true), null);
  assert.equal(s.betrayals, undefined);
});

test("nor for a bill that failed, whoever opposed it", () => {
  const s = speaker();
  const [request] = demands(s, [bills[1]]);
  assert.equal(hastert(s, request, false), null);
});

// ---------------------------------------------------------------------------
// Which is what the motion to vacate is made of
// ---------------------------------------------------------------------------

test("grievances and betrayals are what actually threaten the chair", () => {
  const clean = speaker();
  const hated = speaker({ grievance: { freedom: 4, progressive: 3 }, betrayals: 2 });

  assert.ok(chairThreat(hated).at > chairThreat(clean).at,
    "a Speaker who has told everybody no is a Speaker being counted");
  assert.ok(chairThreat(hated).reasons.some((r) => /told no/.test(r)));
  assert.ok(chairThreat(hated).reasons.some((r) => /other party's votes/.test(r)));
});

test("a shutdown is remembered against you", () => {
  const clean = speaker();
  const closed = speaker({ shutdown: 1 });
  assert.ok(chairThreat(closed).at > chairThreat(clean).at);
  assert.ok(chairThreat(closed).reasons.some((r) => /funding lapse/.test(r)));
});

test("one refusal is not a grievance, and three is", () => {
  const once = speaker({ grievance: { freedom: 1 } });
  const thrice = speaker({ grievance: { freedom: 3 } });
  assert.equal(chairThreat(once).at, chairThreat(speaker()).at, "everybody gets told no sometimes");
  assert.ok(chairThreat(thrice).at > chairThreat(once).at);
});
