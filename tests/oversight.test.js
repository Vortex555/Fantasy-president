import test from "node:test";
import assert from "node:assert/strict";

import {
  canHold, canCompel, hearingTargets, holdHearing, resetHearings,
  profileEarned, HEARING_COST, SUBPOENA_COST, PROFILE_CAP,
} from "../src/oversight.js";
import { createHouseCareer } from "../src/house.js";
import { earnRecognition, newCareer, recognitionFor } from "../src/career.js";

/**
 * A gavel you use, rather than one that gates other things.
 *
 * A chairmanship was worth exactly two powers and both were about bills somebody
 * else had written: bury one, amend one. That is a veto, not a platform — while
 * the committee list has said since the day it was written that Oversight is "a
 * platform more than a legislature", and nothing in the game let it be one.
 *
 * A hearing passes nothing and moves no votes. What it produces is the one
 * currency the chamber modes never generated and the ladder above them runs
 * entirely on: being known by people who cannot name their own member.
 */

const chair = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "M", party: "Republican", startYear: 2025,
    ideology: "Traditional Conservative", district: "WV-2", events: "classic", ...o,
  }),
  rank: "chair", committee: "oversight", capital: 30,
  arcs: [
    { id: "arc_1", title: "A Contracting Scandal", domain: "justice", severity: 4, status: "active" },
    { id: "arc_2", title: "A Grain Shortage", domain: "economy", severity: 3, status: "active" },
  ],
});

test("a backbencher may attend a hearing and not call one", () => {
  assert.equal(canHold({ rank: "member" }), false);
  assert.equal(canHold({ rank: "subchair" }), true);
  assert.equal(canCompel({ rank: "subchair" }), false, "a subcommittee can ask and be refused");
  assert.equal(canCompel({ rank: "chair" }), true);
});

test("you can only hold hearings on what your committee owns", () => {
  const targets = hearingTargets(chair());
  assert.ok(targets.some((t) => t.id === "arc_1"), "Oversight covers justice");
  assert.ok(!targets.some((t) => t.id === "arc_2"), "and not a grain shortage");
});

test("a hearing buys a national profile and nothing else", () => {
  const state = chair();
  const out = holdHearing(state, "arc_1");
  assert.ok(!out.rejected, out.note);
  assert.ok(out.state.profile > 0, "this is the entire point of it");
  assert.equal(out.state.capital, 30 - HEARING_COST);
  assert.ok(out.state.bloc > state.bloc, "a member on television is a member fighting");
});

test("a live crisis is news and a quiet problem is an empty room", () => {
  const loud = holdHearing(chair(), "arc_1").state.profile;
  const quiet = holdHearing({
    ...chair(),
    arcs: [{ id: "arc_1", title: "A Contracting Scandal", domain: "justice", severity: 1, status: "active" }],
  }, "arc_1").state.profile;
  assert.ok(loud > quiet);
});

test("embarrassing your own administration costs you with your own leadership", () => {
  const other = chair();
  const own = { ...chair(), president: { ...chair().president, party: "Republican" } };
  assert.ok(holdHearing(own, "arc_1").state.leadership < own.leadership,
    "which is why most oversight is done by the party out of power");
  assert.ok(holdHearing(other, "arc_1").state.leadership >= other.leadership);
});

test("a subpoena carries further and costs more", () => {
  const state = chair();
  const asked = holdHearing(state, "arc_1");
  const compelled = holdHearing(state, "arc_1", { compel: true });
  assert.equal(compelled.state.capital, 30 - SUBPOENA_COST);
  if (!compelled.stonewalled) {
    assert.ok(compelled.state.profile > asked.state.profile);
  }
});

test("a chair nobody fears gets an empty chair and the story becomes them", () => {
  let stonewalls = 0;
  for (let m = 1; m <= 40; m++) {
    const weak = { ...chair(), leadership: 12, month: m };
    if (holdHearing(weak, "arc_1", { compel: true }).stonewalled) stonewalls += 1;
  }
  assert.ok(stonewalls > 0, "compelling a witness is not a formality");
});

test("the committee sits once a month", () => {
  const first = holdHearing(chair(), "arc_1").state;
  assert.ok(holdHearing(first, "arc_1").rejected);
  assert.ok(!holdHearing(resetHearings(first), "arc_1").rejected);
});

test("nobody becomes a household name from a committee room alone", () => {
  let state = chair();
  for (let m = 1; m <= 40; m++) {
    state = resetHearings({ ...state, month: m, capital: 30 });
    const out = holdHearing(state, "arc_1", { compel: true });
    if (!out.rejected) state = out.state;
  }
  assert.ok(profileEarned(state) <= PROFILE_CAP);
});

// ---------------------------------------------------------------------------
// What it is for
// ---------------------------------------------------------------------------

test("a term of hearings makes you known where a backbencher is not", () => {
  const office = { ...chair(), rank: "subchair", profile: 40, seat: { district: "WV-2", seniority: 4 } };
  const withHearings = earnRecognition(newCareer({ presidentName: "M", party: "Republican" }), office);
  const without = earnRecognition(newCareer({ presidentName: "M", party: "Republican" }),
    { ...office, profile: 0 });

  assert.ok(recognitionFor(withHearings, "nation") > recognitionFor(without, "nation"),
    "the committee room is the slow road to a name, and the only one most careers get");
});
