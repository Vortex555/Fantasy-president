import test from "node:test";
import assert from "node:assert/strict";

import {
  STATE_COMMITTEES, stateCommitteeById, referral, assignSeats, chairOf,
  hearingOdds, throughCommittee, chairDecision,
} from "../src/stateCommittees.js";
import { createStatehouseCareer } from "../src/statehouse.js";

/**
 * Where a state bill actually dies.
 *
 * In Congress a committee is a filter and a platform. In a state legislature it
 * is an execution chamber: most bills introduced in most states never get a
 * hearing at all, and never getting a hearing is not a defeat that appears
 * anywhere — no roll call, no recorded position, no press release. The chair
 * does not schedule it, the session ends, and the bill is dead with nobody's
 * name on the killing.
 */

const member = (code = "WV", o = {}) => ({
  ...createStatehouseCareer({
    presidentName: "Daniel Tolpa", party: "Republican", ideology: "Groyper",
    ideologyAxis: 0.9, startYear: 2025, seatState: code,
  }),
  ...o,
});

const bill = (o = {}) => ({
  id: "b1", title: "A Bill", axis: 0.4, domain: "economy", cost: 0, brief: "x", ...o,
});

// ---------------------------------------------------------------------------
// The rooms
// ---------------------------------------------------------------------------

test("a state legislature has fewer and broader committees than Congress", () => {
  assert.ok(STATE_COMMITTEES.length <= 12, "a small chamber cannot staff twenty rooms");
  for (const c of STATE_COMMITTEES) {
    assert.ok(c.remit.length > 30, `${c.id} does not say what it is for`);
    assert.ok(c.domains.length >= 1);
  }
  assert.ok(stateCommitteeById("st_approps"), "the budget room exists and comes first");
});

test("a bill that costs real money goes to Appropriations whatever it is about", () => {
  assert.equal(referral(bill({ cost: 60, domain: "health" })).id, "st_approps",
    "a chamber that must balance refers on the number before the topic");
  assert.equal(referral(bill({ cost: 2, domain: "health" })).id, "st_health");
  assert.equal(referral(bill({ cost: 0, domain: "justice" })).id, "st_judiciary");
});

// ---------------------------------------------------------------------------
// Where you sit
// ---------------------------------------------------------------------------

test("a state legislator sits in three or four rooms, not one", () => {
  const seats = assignSeats(member("WV"));
  assert.ok(seats.length >= 3, `${seats.length} is a congressional workload, not a state one`);
  assert.equal(new Set(seats).size, seats.length);
  assert.ok(!seats.includes("st_rules"), "Rules belongs to the Speaker");
});

test("a huge chamber spreads the work thinner", () => {
  // Four hundred members do not each need four committees.
  assert.ok(assignSeats(member("NH")).length < assignSeats(member("DE")).length);
});

test("the assignment is stable, and standing buys better rooms", () => {
  const s = member("WV");
  assert.deepEqual(assignSeats(s), assignSeats(s));

  const junior = assignSeats(member("WV", { leadership: 30 }));
  const senior = assignSeats(member("WV", { leadership: 92, seat: { ...member("WV").seat, seniority: 8 } }));
  const best = (ids) => Math.max(...ids.map((id) => stateCommitteeById(id).prestige));
  assert.ok(best(senior) >= best(junior));
});

/**
 * Congressional chairs went by seniority for most of a century. State house
 * chairs are appointed by the Speaker personally and removed the same way,
 * which makes a chairmanship a statement about your standing and nothing else.
 */
test("a gavel is the Speaker's gift, not a reward for turning up", () => {
  const newcomer = member("WV", { leadership: 90, seat: { ...member("WV").seat, seniority: 1 } });
  const timeServer = member("WV", { leadership: 40, seat: { ...member("WV").seat, seniority: 9 } });
  const trusted = member("WV", { leadership: 88, seat: { ...member("WV").seat, seniority: 5 } });

  assert.equal(chairOf({ ...newcomer, committees: assignSeats(newcomer) }), null);
  assert.equal(chairOf({ ...timeServer, committees: assignSeats(timeServer) }), null,
    "years alone buy nothing here");
  assert.ok(chairOf({ ...trusted, committees: assignSeats(trusted) }));
});

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

test("most bills never get a hearing, which is the whole institution", () => {
  const s = member("WV");
  const read = hearingOdds(s, bill({ domain: "social" }));
  assert.ok(read.odds < 0.6, `${read.odds} is far too generous for a state legislature`);
  assert.ok(read.committee.id);
});

test("sitting in the room helps, and chairing it decides", () => {
  const s = member("WV");
  const target = bill({ domain: "economy", cost: 0 });
  const room = referral(target).id;

  const outside = hearingOdds({ ...s, committees: [] }, target);
  const inside = hearingOdds({ ...s, committees: [room] }, target);
  const chair = hearingOdds(
    { ...s, committees: [room], leadership: 90, seat: { ...s.seat, seniority: 6 } }, target);

  assert.ok(inside.odds > outside.odds);
  assert.ok(chair.odds > inside.odds);
  assert.equal(chair.chair, true);
});

test("a chamber already in deficit is hardest on the bills that cost it money", () => {
  const s = member("WV", { budget: -80 });
  const rich = hearingOdds(s, bill({ cost: 60 }));
  const free = hearingOdds(s, bill({ cost: 0 }));
  assert.ok(free.odds > rich.odds);
});

test("what the committees did happens to you, except in your own room", () => {
  const s = member("WV", { leadership: 90, seat: { ...member("WV").seat, seniority: 6 } });
  s.committees = assignSeats(s);
  const chaired = chairOf(s);
  const mine = STATE_COMMITTEES.find((c) => c.id === chaired);

  const docket = [bill({ id: "x", domain: mine.domains[0], cost: 0 }), bill({ id: "y", domain: "justice" })];
  const out = throughCommittee(s, docket);

  assert.equal(out.heard.length + out.buried.length, 2, "every bill is disposed of one way or the other");
  const held = out.heard.find((b) => b.awaiting);
  if (held) assert.equal(held.yours, true, "your own room waits for you rather than rolling dice");
});

// ---------------------------------------------------------------------------
// The decision, which leaves no record
// ---------------------------------------------------------------------------

test("a chair hears a bill and it reaches the floor", () => {
  const s = member("WV", { leadership: 90, seat: { ...member("WV").seat, seniority: 6 } });
  s.committees = assignSeats(s);
  const room = chairOf(s);
  const out = chairDecision(s, { id: "x", title: "A Bill", axis: 0.4, committee: room }, true);

  assert.equal(out.heard, true);
  assert.equal(s.committeeLog.at(-1).action, "heard");
});

test("and leaving it in the drawer costs nothing anybody can point at", () => {
  const s = member("WV", { leadership: 90, seat: { ...member("WV").seat, seniority: 6 } });
  s.committees = assignSeats(s);
  const room = chairOf(s);
  // A bill the member's own caucus did not want: no roll call, no cost, no trace.
  const out = chairDecision(s, { id: "x", title: "A Bill", axis: -0.6, committee: room }, false);

  assert.equal(out.heard, false);
  assert.equal(s.leadership, 90, "nobody in your caucus wanted it, so nobody minds");
  assert.equal(s.committeeLog.at(-1).action, "drawer");
  assert.match(out.note, /no vote, no record/);
});

test("but burying what your own side wanted is noticed by exactly them", () => {
  const s = member("WV", { leadership: 90, seat: { ...member("WV").seat, seniority: 6 } });
  s.committees = assignSeats(s);
  const room = chairOf(s);
  chairDecision(s, { id: "x", title: "A Bill", axis: 0.7, committee: room }, false);

  assert.ok(s.leadership < 90);
});

test("a member who does not chair the room cannot touch it", () => {
  const s = member("WV");
  s.committees = ["st_health"];
  const out = chairDecision(s, { id: "x", title: "A Bill", axis: 0.4, committee: "st_judiciary" }, false);
  assert.equal(out.rejected, true);
});
