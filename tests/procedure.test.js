import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCHARGE_THRESHOLD, shelvedBills, petitionCeiling, launchPetition,
  signPetition, advancePetition, PETITION_COST, PETITION_DRAG,
} from "../src/procedure.js";
import { createHouseCareer } from "../src/house.js";
import { billById } from "../src/bills.js";

/**
 * What a member does when they cannot get a vote.
 *
 * The mode gave a backbencher one verb. Everything else — burying a bill,
 * amending one, seeing the whip count — was gated behind a rank most careers
 * never reach, and the schedule itself belonged entirely to leadership. A member
 * who disagreed with the calendar could do nothing about the calendar.
 *
 * A discharge petition is the real answer to that and needs no rank at all: two
 * hundred and eighteen signatures drag a bill out of a committee that will not
 * report it and onto the floor, over the objection of the people who decide what
 * the floor is. It is rare because it is costly — signing one is a public act of
 * defiance against your own leadership — and it is the only tool in the building
 * a first-term member can use to set the agenda.
 */

const member = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Republican", startYear: 2025,
  ideology: "Traditional Conservative", district: "WV-2", events: "classic", ...o,
});

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

test("the shelf holds bills the chamber would pass and leadership will not schedule", () => {
  const shelf = shelvedBills(member());
  assert.ok(shelf.length, "a majority always sits on something");
  for (const bill of shelf) {
    assert.ok(bill.id && bill.title, "shelved bills are real bills, not stubs");
    assert.ok(bill.wouldPass, "there is no point discharging a bill that loses on the floor");
    assert.ok(!bill.leadershipWants, "and none in scheduling one leadership already wants");
  }
});

test("it is stable within a term, because a shelf is not a docket", () => {
  const state = member();
  assert.deepEqual(shelvedBills(state).map((b) => b.id), shelvedBills(state).map((b) => b.id));
});

test("bills already voted on are off it", () => {
  const state = member();
  const first = shelvedBills(state)[0];
  const after = shelvedBills({ ...state, voteLog: [{ id: first.id, title: first.title }] });
  assert.ok(!after.some((b) => b.id === first.id));
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

test("the ceiling is what the chamber would sign, which is well short of what it would vote for", () => {
  const state = member();
  const bill = shelvedBills(state)[0];
  const { ceiling, wouldVoteYes } = petitionCeiling(state, bill);
  assert.ok(ceiling < wouldVoteYes,
    "signing is a public act against your own leadership and voting is not");
  assert.ok(ceiling > 0);
});

test("launching costs favours and standing, and starts short of the line", () => {
  const state = { ...member(), capital: 20 };
  const bill = shelvedBills(state)[0];
  const out = launchPetition(state, bill.id, 0);
  assert.ok(!out.rejected, out.note);
  assert.equal(out.state.petition.billId, bill.id);
  assert.ok(out.state.petition.signatures < DISCHARGE_THRESHOLD(state), "never a formality");
  assert.equal(out.state.capital, 20 - PETITION_COST);
  assert.ok(out.state.leadership < state.leadership, "leadership knows who filed it");
});

test("a petition cannot be launched without the favours to file it", () => {
  const broke = { ...member(), capital: 0 };
  const out = launchPetition(broke, shelvedBills(broke)[0].id, 0);
  assert.ok(out.rejected);
});

test("only one runs at a time", () => {
  const state = { ...member(), capital: 40 };
  const shelf = shelvedBills(state);
  const first = launchPetition(state, shelf[0].id, 0).state;
  const second = launchPetition(first, shelf[shelf.length - 1].id, 0);
  assert.ok(second.rejected, "a member has one petition's worth of standing to spend");
  assert.match(second.note, /already carrying/);
});

test("the shelf is worth looking at, not a single bill", () => {
  assert.ok(shelvedBills(member()).length >= 2,
    "one bill is a curiosity; a shelf is a decision about which fight to pick");
});

test("signatures climb toward the ceiling and stop there", () => {
  let state = { ...member(), capital: 20 };
  const bill = shelvedBills(state)[0];
  state = launchPetition(state, bill.id, 0).state;
  const { ceiling } = petitionCeiling(state, bill);

  let last = state.petition.signatures;
  for (let month = 0; month < 12; month++) {
    state = advancePetition(state).state;
    if (!state.petition) break;
    assert.ok(state.petition.signatures >= last, "a signature is not withdrawn");
    assert.ok(state.petition.signatures <= ceiling + 1, "and nobody signs who would not");
    last = state.petition.signatures;
  }
});

test("spending favours buys signatures leadership would otherwise hold", () => {
  let state = { ...member(), capital: 30 };
  const bill = shelvedBills(state)[0];
  state = launchPetition(state, bill.id, 0).state;
  const quiet = advancePetition(state).state.petition.signatures;
  const pushed = advancePetition(signPetition(state, 12).state).state.petition.signatures;
  assert.ok(pushed > quiet, "calling in favours is the whole reason to have banked them");
});

test("it drags on your standing every month it is live", () => {
  let state = { ...member(), capital: 20 };
  state = launchPetition(state, shelvedBills(state)[0].id, 0).state;
  const before = state.leadership;
  state = advancePetition(state).state;
  assert.equal(state.leadership, Math.max(0, before - PETITION_DRAG));
});

// ---------------------------------------------------------------------------
// What winning looks like
// ---------------------------------------------------------------------------

test("reaching the line puts the bill on the floor and closes the petition", () => {
  let state = { ...member(), capital: 20 };
  const bill = shelvedBills(state)[0];
  state = launchPetition(state, bill.id, 0).state;
  // Hand it the signatures rather than grinding twelve months for them.
  state = { ...state, petition: { ...state.petition, signatures: DISCHARGE_THRESHOLD(state) } };

  const out = advancePetition(state);
  assert.ok(out.discharged, "the bill is dragged out of committee");
  assert.equal(out.discharged.id, bill.id);
  assert.equal(out.state.petition, null, "and the petition is spent");
  assert.ok(out.state.discharged.includes(bill.id), "the floor is told to schedule it");
  assert.match(out.note, /floor/i);
});

test("a discharged bill is scheduled once and not again", () => {
  const state = { ...member(), discharged: ["crime_bill"] };
  assert.ok(!shelvedBills(state).some((b) => b.id === "crime_bill"));
});

test("the threshold is a majority of the room you are actually in", () => {
  assert.equal(DISCHARGE_THRESHOLD({ office: "house" }), 218);
  assert.equal(DISCHARGE_THRESHOLD({ office: "senate" }), 51);
});

test("a bill nobody would sign for cannot be dragged out however long you push", () => {
  const state = { ...member(), capital: 0 };
  // A bill the chamber would vote down has no ceiling worth the name.
  const hopeless = billById("seize_industry");
  const { ceiling } = petitionCeiling(state, hopeless);
  assert.ok(ceiling < DISCHARGE_THRESHOLD(state),
    "a discharge petition is a way past leadership, not past the chamber");
});
