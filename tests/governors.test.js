import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGovernors,
  governorRoster,
  governorFor,
  tickGovernors,
  courtGovernor,
  risingStars,
  benchFor,
  defianceDrag,
  MAX_DEFIANCE,
  COURTING_COST,
} from "../src/governors.js";
import { createGame, applyResult } from "../src/gameEngine.js";
import { STATE_CODES, STATES } from "../src/states.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function game(overrides = {}) {
  const state = createGame({
    presidentName: "Ruth Ellery", party: "Democrat", startYear: 2025,
    startApproval: 51, ideologyAxis: -0.35, ideology: "Social Democrat", difficulty: "hard",
    vp: { name: "Marcus Okafor", region: "Midwestern", background: "senator",
      ideology: "Liberal", loyalty: 84, competence: 77, bio: "b", portfolio: "" },
    ...(overrides.scenario || {}),
  });
  return { ...state, ...overrides, scenario: { ...state.scenario, ...(overrides.scenario || {}) } };
}

const quietTurn = () => ({
  analysis: "", approvalChange: 0, economy: {}, stakeholders: [], press: [],
  stateEffects: [], arcs: [], nextEvent: { title: "x", brief: "y" }, flags: {},
});

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

test("every state has a governor, and the District does not", () => {
  const roster = governorRoster(game());
  assert.equal(roster.length, 50);
  for (const g of roster) {
    assert.ok(STATES[g.state], `${g.state} is not a state`);
    assert.notEqual(g.state, "DC", "the District has no governor");
    assert.ok(g.name && g.party && Number.isFinite(g.axis));
  }
});

test("governors mostly match their state, but not always", () => {
  const roster = governorRoster(game());
  const matching = roster.filter((g) => {
    const lean = STATES[g.state].lean;
    return (lean > 0 && g.party === "Republican") || (lean < 0 && g.party === "Democrat");
  });
  assert.ok(matching.length > 30, "most governors should match their state's lean");
  assert.ok(matching.length < 50, "some states elect a governor from the other party");
});

test("the roster is stable — the same career always has the same governors", () => {
  const s = game();
  assert.deepEqual(governorRoster(s).map((g) => g.name), governorRoster(s).map((g) => g.name));
});

test("a governor can be looked up by their state", () => {
  const g = governorFor(game(), "CA");
  assert.equal(g.state, "CA");
  assert.equal(g.name, governorRoster(game()).find((x) => x.state === "CA").name);
});

// ---------------------------------------------------------------------------
// Defiance
// ---------------------------------------------------------------------------

test("a new career starts with defiance seeded from the politics, not from zero", () => {
  const defiance = buildGovernors(game());
  assert.equal(Object.keys(defiance).length, 50);
  const values = Object.values(defiance);
  assert.ok(Math.max(...values) > Math.min(...values), "governors do not all start the same");
  for (const v of values) assert.ok(v >= 0 && v <= MAX_DEFIANCE);
});

test("the opposing party in a hostile state is the most defiant", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  const roster = governorRoster(s);
  const opposed = roster.filter((g) => g.party === "Republican");
  const allied = roster.filter((g) => g.party === "Democrat");
  const avg = (list) => list.reduce((sum, g) => sum + s.governors[g.state], 0) / list.length;
  assert.ok(avg(opposed) > avg(allied), "the other party's governors resist more");
});

test("defiance blunts what a policy achieves in that state", () => {
  assert.ok(defianceDrag(0) > defianceDrag(90), "a defiant state absorbs less of what you do");
  assert.equal(defianceDrag(0), 1, "a cooperative governor implements it in full");
  assert.ok(defianceDrag(MAX_DEFIANCE) > 0, "even total defiance does not zero it out");
});

test("a month of governing moves the governors who were touched by it", () => {
  const before = { ...game(), governors: buildGovernors(game()) };
  const next = structuredClone(before);
  tickGovernors(next, "We are federalising the California high-speed rail project by executive order.");
  assert.notDeepEqual(next.governors, before.governors, "governing should move somebody");
});

test("working with a state calms it and steamrolling it does not", () => {
  const base = { ...game(), governors: buildGovernors(game()) };
  const cooperative = structuredClone(base);
  tickGovernors(cooperative, "We will work with the governors of Texas and Florida on a bipartisan grant.");
  const hostile = structuredClone(base);
  tickGovernors(hostile, "We will override Texas and Florida and federalise this by decree, whatever they say.");
  assert.ok(cooperative.governors.TX < hostile.governors.TX,
    "a president who works with a governor should face less resistance than one who overrides them");
});

test("defiance never escapes its bounds however hard you push", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  for (let i = 0; i < 60; i++) {
    tickGovernors(s, "We override every state and federalise everything by decree, ignoring the governors.");
  }
  for (const v of Object.values(s.governors)) {
    assert.ok(v >= 0 && v <= MAX_DEFIANCE, `defiance escaped bounds: ${v}`);
  }
});

// ---------------------------------------------------------------------------
// Courting them
// ---------------------------------------------------------------------------

test("courting a governor costs money and buys cooperation", () => {
  const s = { ...game(), governors: { ...buildGovernors(game()), TX: 80 }, warChest: 200 };
  const { state: next, note } = courtGovernor(s, "TX");
  assert.ok(next.governors.TX < 80, "the deal should reduce defiance");
  assert.equal(next.warChest, 200 - COURTING_COST);
  assert.ok(note.includes("Texas") || note.includes(governorFor(s, "TX").name));
});

test("you cannot buy a governor with money you do not have", () => {
  const s = { ...game(), governors: buildGovernors(game()), warChest: 2 };
  const out = courtGovernor(s, "TX");
  assert.equal(out.rejected, true);
  assert.equal(out.state.warChest, 2, "a refused deal costs nothing");
});

test("courting an unknown state is refused rather than crashing", () => {
  const s = { ...game(), governors: buildGovernors(game()), warChest: 200 };
  assert.equal(courtGovernor(s, "ZZ").rejected, true);
  assert.equal(courtGovernor(s, "DC").rejected, true);
});

// ---------------------------------------------------------------------------
// The bench — where challengers come from
// ---------------------------------------------------------------------------

test("the bench ranks governors by ambition, standing and distance from you", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  const stars = risingStars(s);
  assert.ok(stars.length > 0);
  for (let i = 1; i < stars.length; i++) {
    assert.ok(stars[i - 1].score >= stars[i].score, "the bench is ordered");
  }
});

test("the opposing party's bench produces a general-election challenger", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  const rival = benchFor(s, "Republican")[0];
  assert.equal(rival.party, "Republican");
  assert.ok(rival.name && rival.state);
});

test("your own party's bench produces a primary challenger", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  const rival = benchFor(s, "Democrat")[0];
  assert.equal(rival.party, "Democrat");
});

test("the bench is stable across a term, so a rival is a known face", () => {
  const s = { ...game(), governors: buildGovernors(game()) };
  assert.equal(benchFor(s, "Republican")[0].name, benchFor({ ...s, month: 30 }, "Republican")[0].name);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("a new career walks in on fifty governors it did not pick", () => {
  const s = game();
  assert.ok(s.governors, "governors exist from day one");
  assert.equal(Object.keys(s.governors).length, 50);
});

test("a month of governing carries the governors forward", () => {
  const s = game();
  const next = applyResult(s, "We federalise the grid over the objections of Texas.", quietTurn());
  assert.equal(Object.keys(next.governors).length, 50);
});

test("a defiant state absorbs less of a policy aimed at it", () => {
  const cooperative = { ...game(), governors: Object.fromEntries(STATE_CODES.filter((c) => c !== "DC").map((c) => [c, 0])) };
  const defiant = { ...game(), governors: Object.fromEntries(STATE_CODES.filter((c) => c !== "DC").map((c) => [c, MAX_DEFIANCE])) };
  const effect = () => ({ ...quietTurn(), stateEffects: [{ code: "TX", change: 10 }] });

  const a = applyResult(cooperative, "A federal programme for Texas.", effect());
  const b = applyResult(defiant, "A federal programme for Texas.", effect());
  assert.ok(a.stateApproval.TX > b.stateApproval.TX,
    "the same policy should land harder where the governor is cooperating");
});
