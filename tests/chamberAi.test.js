import test from "node:test";
import assert from "node:assert/strict";

import { validateDocket, staffOf } from "../src/chamberAi.js";
import { createHouseCareer, partyLine, districtView, castVote } from "../src/house.js";

/**
 * The model writes the bills; the engine computes everything they cost. So the
 * only question that matters about a written calendar is whether the engine can
 * take it — a bill reaches the roll call with an id, a title and a number
 * between -1 and 1, or it does not reach the roll call at all.
 */

const scenario = (o = {}) => ({
  office: "house",
  presidentName: "Dale Fairweather",
  party: "Democrat",
  startYear: 2025,
  ideologyAxis: -0.35,
  ideology: "Social Democrat",
  district: "OH-6",
  ...o,
});

const house = (o = {}) => ({ ...createHouseCareer(scenario()), ...o });

const bill = (o = {}) => ({
  title: "Bridges and Ports Act",
  brief: "A decade of federal spending on roads and water systems.",
  axis: -0.05,
  domain: "economy",
  sponsor: "Rep. Marguerite Kirkland (D-OH)",
  because: "the refinery fallout has closed two Gulf ports",
  ...o,
});

// ---------------------------------------------------------------------------
// What survives
// ---------------------------------------------------------------------------

test("a well-formed bill comes through intact", () => {
  const [out] = validateDocket({ bills: [bill()] }, house({ month: 3 }), 2);

  assert.equal(out.title, "Bridges and Ports Act");
  assert.equal(out.axis, -0.05);
  assert.equal(out.domain, "economy");
  assert.equal(out.sponsor, "Rep. Marguerite Kirkland (D-OH)");
  assert.equal(out.because, "the refinery fallout has closed two Gulf ports");
  assert.equal(out.written, true);
  assert.equal(out.fringe, false);
});

test("ids are unique within a month and stamped with it", () => {
  const out = validateDocket(
    { bills: [bill(), bill({ title: "Rural Health Act" }), bill({ title: "Public Order Act" })] },
    house({ month: 7, term: 2 }), 3,
  );
  assert.deepEqual(out.map((b) => b.id), ["ai_2_7_1", "ai_2_7_2", "ai_2_7_3"]);
  assert.equal(new Set(out.map((b) => b.id)).size, 3);
});

// ---------------------------------------------------------------------------
// What does not
// ---------------------------------------------------------------------------

test("a bill with no title is not a bill", () => {
  const out = validateDocket({ bills: [bill({ title: "" }), bill()] }, house(), 2);
  assert.equal(out.length, 1);
});

test("a bill with no honest position on it is dropped, not guessed at", () => {
  // Every stance, the whip count and the entire roll call are computed from the
  // axis. A bill without one cannot be voted on, so it never reaches the floor.
  const out = validateDocket({
    bills: [bill({ axis: "quite left" }), bill({ title: "B", axis: null }), bill({ title: "C" })],
  }, house(), 3);

  assert.equal(out.length, 1);
  assert.equal(out[0].title, "C");
});

test("the same bill twice is one bill", () => {
  const out = validateDocket({
    bills: [bill(), bill({ title: "BRIDGES AND PORTS ACT" })],
  }, house(), 3);
  assert.equal(out.length, 1);
});

test("the model does not get to decide how busy the chamber is", () => {
  const out = validateDocket({
    bills: Array.from({ length: 9 }, (_, i) => bill({ title: `Act ${i}` })),
  }, house(), 2);
  assert.equal(out.length, 2);
});

test("a reply that is not a docket at all yields nothing, and the caller falls back", () => {
  assert.deepEqual(validateDocket({}, house(), 2), []);
  assert.deepEqual(validateDocket({ bills: "soon" }, house(), 2), []);
  assert.deepEqual(validateDocket(null, house(), 2), []);
});

// ---------------------------------------------------------------------------
// What gets corrected
// ---------------------------------------------------------------------------

test("an axis past the ends of the spectrum is brought back onto it", () => {
  const out = validateDocket({
    bills: [bill({ axis: 4.2 }), bill({ title: "B", axis: -9 })],
  }, house(), 2);
  assert.equal(out[0].axis, 1);
  assert.equal(out[1].axis, -1);
});

test("a domain nothing tracks becomes one that does", () => {
  const [out] = validateDocket({ bills: [bill({ domain: "transport" })] }, house(), 1);
  assert.equal(out.domain, "social");
});

test("a model that writes an essay for a title gets a title", () => {
  const long = "An Act ".repeat(60);
  const [out] = validateDocket({ bills: [bill({ title: long, brief: long })] }, house(), 1);
  assert.ok(out.title.length <= 90);
  assert.ok(out.brief.length <= 240);
});

test("a missing sponsor or reason is absent rather than empty", () => {
  const [out] = validateDocket({ bills: [bill({ sponsor: "", because: undefined })] }, house(), 1);
  assert.equal(out.sponsor, null);
  assert.equal(out.because, null);
});

// ---------------------------------------------------------------------------
// The engine takes it from there
// ---------------------------------------------------------------------------

test("a written bill runs through the engine exactly like a drawn one", () => {
  const state = house({ month: 2 });
  const [written] = validateDocket({ bills: [bill({ axis: -0.62 })] }, state, 1);

  const party = partyLine(state, written);
  const district = districtView(state, written);
  assert.ok(["yes", "no"].includes(party.position));
  assert.ok(party.intensity >= 5 && party.intensity <= 100);
  assert.ok(["yes", "no"].includes(district.position));

  const { state: after, result } = castVote(state, written, "yes");
  assert.equal(result.tally.total, 435);
  assert.equal(after.voteLog[0].id, written.id);
  assert.equal(after.voteLog[0].domain, written.domain);
});

// ---------------------------------------------------------------------------
// The office
// ---------------------------------------------------------------------------

test("a career has the same chief of staff every month of it", () => {
  const state = house();
  const first = staffOf(state);
  const later = staffOf({ ...state, month: 19, term: 2 });

  assert.equal(first.name, later.name);
  assert.ok(first.name.includes(" "));
  assert.ok(first.manner);
});

test("two different careers do not share an office", () => {
  const a = staffOf({ rosterSeed: "one" });
  const b = staffOf({ rosterSeed: "two" });
  assert.notEqual(a.name + a.manner, b.name + b.manner);
});

test("a save with no seed still has somebody answering the phone", () => {
  const chief = staffOf({});
  assert.ok(chief.name);
  assert.ok(chief.manner);
});
