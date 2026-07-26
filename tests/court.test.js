import test from "node:test";
import assert from "node:assert/strict";

import {
  policyThrust,
  deferenceOf,
  justiceVote,
  courtRuling,
  DEFERENCE_RANGE,
} from "../src/court.js";
import { createGame, computeChecks, refreshCourt } from "../src/gameEngine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function game(overrides = {}) {
  const state = createGame({
    presidentName: "Ruth Ellery", party: "Democrat", startYear: 2025,
    startApproval: 51, ideologyAxis: -0.35, ideology: "Social Democrat", difficulty: "hard",
    vp: { name: "Marcus Okafor", region: "M", background: "senator",
      ideology: "Liberal", loyalty: 84, competence: 77, bio: "b", portfolio: "" },
    ...(overrides.scenario || {}),
  });
  return { ...state, ...overrides, scenario: { ...state.scenario, ...(overrides.scenario || {}) } };
}

/** Rebuild the bench at a given balance. */
function bench(state, conservative, liberal) {
  const next = { ...state, court: { conservative, liberal } };
  refreshCourt(next);
  return next;
}

const ORDER = "I am ordering, by executive action, an immediate nationwide ban on the practice, " +
  "bypassing Congress entirely and directing every federal agency to enforce it.";

// ---------------------------------------------------------------------------
// Reading the policy
// ---------------------------------------------------------------------------

test("a policy has an ideological thrust and a legal character", () => {
  const t = policyThrust(game(), ORDER);
  assert.equal(t.executive, true);
  assert.equal(t.aggressive, true);
  assert.ok(Number.isFinite(t.axis));
});

test("the thrust follows the president unless the policy says otherwise", () => {
  const left = policyThrust(game(), ORDER);
  const right = policyThrust(game({ scenario: { party: "Republican", ideologyAxis: 0.5 } }), ORDER);
  assert.ok(right.axis > left.axis, "a Republican order pushes the other way");
});

// ---------------------------------------------------------------------------
// The justices
// ---------------------------------------------------------------------------

test("a justice's deference to executive power is stable and bounded", () => {
  const j = { name: "Justice Whitlock", axis: 0.4 };
  assert.equal(deferenceOf(j), deferenceOf({ ...j }));
  assert.ok(deferenceOf(j) >= DEFERENCE_RANGE[0] && deferenceOf(j) <= DEFERENCE_RANGE[1]);
});

test("the bench does not all share one deference", () => {
  const values = (game().justices || []).map(deferenceOf);
  assert.equal(values.length, 9);
  assert.ok(new Set(values.map((v) => v.toFixed(2))).size > 3,
    "justices should differ on how far they let a president go");
});

test("a justice who agrees with a policy is likelier to uphold it than one who does not", () => {
  const state = game();
  const thrust = policyThrust(state, ORDER);
  const ally = { name: "Justice Adeyemi", axis: -0.4, wing: "liberal" };
  const foe = { name: "Justice Adeyemi", axis: 0.7, wing: "conservative" };
  assert.ok(justiceVote(ally, thrust, state).score > justiceVote(foe, thrust, state).score);
});

test("every vote carries a reason the opinion can quote", () => {
  const state = game();
  const v = justiceVote(state.justices[0], policyThrust(state, ORDER), state);
  assert.ok(v.reason && v.reason.length > 3);
  assert.equal(typeof v.uphold, "boolean");
});

// ---------------------------------------------------------------------------
// The ruling
// ---------------------------------------------------------------------------

test("all nine vote, and the tally adds up", () => {
  const r = courtRuling(game(), ORDER);
  assert.equal(r.heard, true);
  assert.equal(r.votes.length, 9);
  assert.equal(r.upholds + r.strikes, 9);
  assert.equal(r.struck, r.strikes > r.upholds);
});

test("a case nobody brought is not heard", () => {
  const r = courtRuling(game(), "We will fund school lunches through the ordinary appropriations process.");
  assert.equal(r.heard, false);
  assert.equal(r.votes.length, 0);
});

test("a hostile bench strikes what a friendly one upholds", () => {
  const state = game();                       // a Democrat
  const hostile = courtRuling(bench(state, 8, 1), ORDER);
  const friendly = courtRuling(bench(state, 1, 8), ORDER);
  assert.ok(hostile.strikes > friendly.strikes,
    "an 8-1 conservative bench should be harder on a liberal president than an 8-1 liberal one");
});

test("the ruling names who was in the majority and who dissented", () => {
  const r = courtRuling(bench(game(), 6, 3), ORDER);
  assert.equal(r.majority.length + r.dissent.length, 9);
  assert.ok(r.majority.every((j) => j.name));
  assert.ok(r.opinion.includes("–") || r.opinion.includes("-"), "the opinion states the split");
});

test("the closest vote is identified, because that is the justice who decided it", () => {
  const r = courtRuling(bench(game(), 5, 4), ORDER);
  assert.ok(r.swing?.name, "a divided court has somebody in the middle");
});

test("a ruling is deterministic — the same case decides the same way", () => {
  const s = game();
  assert.deepEqual(courtRuling(s, ORDER).votes.map((v) => v.uphold),
    courtRuling(s, ORDER).votes.map((v) => v.uphold));
});

test("the same bench can split differently on different policies", () => {
  const s = bench(game(), 6, 3);
  const a = courtRuling(s, ORDER);
  const b = courtRuling(s, "By emergency decree I am seizing the refineries and nationalising the grid.");
  assert.ok(a.heard && b.heard);
  assert.ok(a.upholds !== b.upholds || a.votes.some((v, i) => v.uphold !== b.votes[i].uphold),
    "a court that always returns the same tally is not reading the case");
});

test("appointing a justice changes who is on the bench and how it rules", () => {
  const before = bench(game(), 7, 2);
  const after = bench(game(), 5, 4);
  assert.notDeepEqual(before.justices.map((j) => j.name), after.justices.map((j) => j.name));
  assert.ok(courtRuling(after, ORDER).upholds >= courtRuling(before, ORDER).upholds);
});

// ---------------------------------------------------------------------------
// The contract the rest of the game depends on
// ---------------------------------------------------------------------------

test("computeChecks still returns the status the arcs and the client read", () => {
  const checks = computeChecks(game(), ORDER);
  assert.ok(["none", "upheld", "struck_down"].includes(checks.court.status));
  assert.equal(typeof checks.court.note, "string");
});

test("a struck-down policy is still blunted", () => {
  // Find a bench that actually strikes, then confirm the penalty survives.
  const hostile = bench(game(), 9, 0);
  const checks = computeChecks(hostile, ORDER);
  if (checks.court.status === "struck_down") {
    assert.ok(checks.effectMultiplier < 1);
    assert.ok(checks.courtPenalty < 0);
  }
});

test("the ruling is attached for the client to render", () => {
  const checks = computeChecks(game(), ORDER);
  if (checks.court.status !== "none") {
    assert.equal(checks.court.ruling.votes.length, 9);
    assert.ok(checks.court.ruling.opinion);
  }
});

test("with checks switched off the court never sits", () => {
  const checks = computeChecks(game({ scenario: { checks: false } }), ORDER);
  assert.equal(checks.court.status, "none");
});
