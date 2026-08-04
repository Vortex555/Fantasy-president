import test from "node:test";
import assert from "node:assert/strict";

import {
  doCasework, resetCasework, requestEarmark, canEarmark, resetEarmarks,
  MAX_CASEWORK, EARMARK_COST,
} from "../src/district.js";
import { createHouseCareer } from "../src/house.js";

/**
 * The half of the job nobody writes a story about.
 *
 * Everything the mode could do happened in Washington. A member's district
 * existed only as a number that judged them — approval moved when they voted and
 * could not be worked on directly — which leaves out what congressional offices
 * actually spend most of their staff time on.
 *
 * Its cost is the honest one: time in the district is time not in the building,
 * and a member who is always home is not in the room when favours are handed
 * out. So it trades standing with your caucus for standing with the people who
 * re-elect you, which is the mode's founding tension finally available as
 * something you *do* rather than only a consequence of how you voted.
 */

const member = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "M", party: "Republican", startYear: 2025,
    ideology: "Traditional Conservative", district: "WV-2", events: "classic", ...o,
  }),
  capital: 30,
});

test("casework buys standing at home and spends it in the building", () => {
  const state = member();
  const out = doCasework(state, 2);
  assert.ok(!out.rejected, out.note);
  assert.ok(out.state.approval > state.approval);
  assert.ok(out.state.leadership < state.leadership,
    "a member who is always home is not in the room when the favours are handed out");
  assert.match(out.note, /\w/, "a number with no story attached is a number");
});

test("more days home is more of both", () => {
  const light = doCasework(member(), 1);
  const heavy = doCasework(member(), MAX_CASEWORK);
  assert.ok(heavy.gain > light.gain);
  assert.ok(heavy.cost > light.cost);
});

test("three days a week is the ceiling however hard you push", () => {
  const out = doCasework(member(), 99);
  assert.ok(out.gain <= doCasework(member(), MAX_CASEWORK).gain);
});

test("it digs a member out of trouble and does not make a safe one untouchable", () => {
  const struggling = doCasework({ ...member(), approval: 34 }, 2).gain;
  const comfortable = doCasework({ ...member(), approval: 82 }, 2).gain;
  assert.ok(struggling > comfortable,
    "a district that already loves you has fewer people left needing help");
});

test("the queue is not infinite and neither are your staff", () => {
  const once = doCasework(member(), 1).state;
  assert.ok(doCasework(once, 1).rejected);
  assert.ok(!doCasework(resetCasework(once), 1).rejected);
});

// ---------------------------------------------------------------------------
// Money for the district
// ---------------------------------------------------------------------------

test("only members near the money can get a project", () => {
  assert.equal(canEarmark({ committee: "veterans", rank: "member" }), false);
  assert.equal(canEarmark({ committee: "appropriations", rank: "member" }), true);
  assert.equal(canEarmark({ committee: "veterans", rank: "chair" }), true,
    "a gavel is its own kind of proximity");
});

test("a project costs favours and buys more than a month of casework", () => {
  const state = { ...member(), committee: "appropriations" };
  const out = requestEarmark(state);
  assert.ok(!out.rejected, out.note);
  assert.equal(out.state.capital, 30 - EARMARK_COST);
  assert.ok(out.gain > doCasework(state, MAX_CASEWORK).gain);
  assert.equal(out.state.earmarks.length, 1);
});

test("one per Congress, because asking twice is how members stop getting one", () => {
  const first = requestEarmark({ ...member(), committee: "appropriations" }).state;
  assert.ok(requestEarmark(first).rejected);
  assert.ok(!requestEarmark(resetEarmarks(first)).rejected);
});

test("and it cannot be had on credit", () => {
  const broke = { ...member(), committee: "appropriations", capital: 1 };
  assert.ok(requestEarmark(broke).rejected);
});
