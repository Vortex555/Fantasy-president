import test from "node:test";
import assert from "node:assert/strict";

import { migrateSave } from "../src/career.js";
import { createHouseCareer } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";

/**
 * Migration.
 *
 * There are saves in the wild that predate the ladder entirely: a bare `state`
 * with no envelope around it. Those careers are somebody's twenty hours, and
 * the only acceptable behaviour is that they keep loading and can start
 * climbing from wherever they already stand.
 */

const scenario = {
  presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, age: "40s", office: "house", district: "OH-6",
};

test("a save from before the ladder existed still loads, and can start climbing", () => {
  const old = {
    state: {
      ...createHouseCareer(scenario), term: 2,
      seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 2 },
    },
  };
  const out = migrateSave(old);

  assert.ok(out.career, "an envelope is synthesised around it");
  assert.equal(out.career.name, "Dale Fairweather");
  assert.equal(out.career.status, "in-office");
  assert.equal(out.state.seat.district, "OH-6", "the state itself is untouched");
  assert.ok(out.career.year >= 2025);
});

test("a save that already has a career is left exactly alone", () => {
  const already = {
    career: {
      id: "x", name: "Someone", year: 2031, offices: [],
      record: { votes: [], bills: [], confirmations: [] },
      recognition: { national: 5, states: {}, districts: {} },
      warChest: 1, standing: 55, status: "in-office",
    },
    state: { office: "senate" },
  };
  assert.deepEqual(migrateSave(already), already);
});

test("the calendar is inferred from the terms already served", () => {
  // Four House terms means the career began three terms — six years — ago.
  const old = {
    state: {
      ...createHouseCareer(scenario), term: 4,
      seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 4 },
    },
  };
  assert.equal(migrateSave(old).career.year, 2025 + 3 * 2);
});

test("recognition is inferred from the seat already held, so nobody is made a stranger", () => {
  const old = {
    state: {
      ...createHouseCareer(scenario), term: 4, rank: "chair",
      seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 4 },
    },
  };
  const out = migrateSave(old);
  assert.ok(out.career.recognition.districts["OH-6"] > 55,
    "four terms and a gavel is not anonymity");
});

test("a senate save migrates onto its state, not a district", () => {
  const senate = createSenateCareer({ ...scenario, office: "senate", seatState: "OH" });
  const out = migrateSave({ state: { ...senate, term: 2, seat: { ...senate.seat, seniority: 2 } } });
  assert.ok(out.career.recognition.states.OH > 55);
  assert.deepEqual(out.career.recognition.districts, {});
  assert.equal(out.career.year, 2025 + 6, "a senate term is six years, not two");
});

test("a bare state with no wrapper is accepted too", () => {
  // Older shapes stored the state directly rather than under a `state` key.
  const out = migrateSave({ ...createHouseCareer(scenario) });
  assert.ok(out.career);
  assert.equal(out.state.office, "house");
});

test("migration is idempotent — loading twice changes nothing", () => {
  const old = { state: { ...createHouseCareer(scenario), term: 3, seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 3 } } };
  const once = migrateSave(old);
  assert.deepEqual(migrateSave(once), once);
});

test("nothing is invented from nothing", () => {
  assert.equal(migrateSave(null), null);
  assert.equal(migrateSave(undefined), undefined);
});
