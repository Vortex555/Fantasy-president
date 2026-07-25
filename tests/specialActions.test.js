import test from "node:test";
import assert from "node:assert/strict";

import {
  SPECIAL_ACTIONS, actionById, availability, odds, propose, tickSpecialActions, emptyLedger,
} from "../src/specialActions.js";
import { createGame, applyResult, computeChecks } from "../src/gameEngine.js";
import { PERSONAS, scoreAll, eligiblePersonas } from "../src/personas.js";
import { stateSummary as describeStateForPrompt } from "../src/claude.js";

function newState(over = {}) {
  const state = createGame({
    presidentName: "Test President",
    party: "Republican",
    era: "A test era.",
    startApproval: 50,
    startYear: 2025,
    difficulty: "hard",
  });
  return { ...state, ...over };
}

/** Force an action through regardless of the roll, to test its consequences. */
function forcePass(state, actionId) {
  // odds() is the only randomness gate; a state this strong clears everything.
  const strong = {
    ...state,
    approval: 95,
    stability: 95,
    congress: { houseD: 20, houseR: 415, senateD: 5, senateR: 95 },
    stakeholders: { ...state.stakeholders, pentagon: 100 },
  };
  return propose(strong, actionId);
}

test("every reference special action is present", () => {
  const ids = SPECIAL_ACTIONS.map((a) => a.id);
  for (const id of ["repeal_22", "repeal_19", "strengthen_19", "continuity_28",
    "dc_statehood", "pr_statehood", "abolish_filibuster", "dissolve_congress"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("actions are grouped as amendments or structural reform", () => {
  for (const a of SPECIAL_ACTIONS) {
    assert.ok(["Constitutional amendments", "Structural reform"].includes(a.group), a.id);
    assert.ok(a.title && a.desc && a.requirement, a.id);
  }
});

// --- Gating ----------------------------------------------------------------

test("an unpopular president cannot even attempt the big amendments", () => {
  const state = newState({ approval: 30 });
  const gate = availability(state, actionById("repeal_22"));
  assert.equal(gate.available, false);
  assert.match(gate.reason, /approval/);
});

test("dissolving Congress needs the Pentagon, not the polls", () => {
  const disloyalArmy = newState({
    approval: 90, stability: 90,
    stakeholders: { ...newState().stakeholders, pentagon: 40 },
  });
  const gate = availability(disloyalArmy, actionById("dissolve_congress"));
  assert.equal(gate.available, false);
  assert.match(gate.reason, /Pentagon/);

  const loyalArmy = newState({
    approval: 20, stability: 70,
    stakeholders: { ...newState().stakeholders, pentagon: 90 },
  });
  assert.equal(availability(loyalArmy, actionById("dissolve_congress")).available, true);
});

test("a shaky government cannot execute the order even with a loyal army", () => {
  const state = newState({
    stability: 30,
    stakeholders: { ...newState().stakeholders, pentagon: 95 },
  });
  const gate = availability(state, actionById("dissolve_congress"));
  assert.equal(gate.available, false);
  assert.match(gate.reason, /stability/);
});

test("the coup is one attempt per term", () => {
  const state = newState({
    stability: 80,
    stakeholders: { ...newState().stakeholders, pentagon: 90 },
    specialActions: { ...emptyLedger(), attempts: { dissolve_congress: 1 } },
  });
  assert.equal(availability(state, actionById("dissolve_congress")).available, false);
});

test("odds for the coup ignore approval and track the army", () => {
  const base = newState({ stability: 70, approval: 15 });
  const weak = { ...base, stakeholders: { ...base.stakeholders, pentagon: 76 } };
  const strong = { ...base, stakeholders: { ...base.stakeholders, pentagon: 100 } };
  assert.ok(odds(strong, actionById("dissolve_congress")) > odds(weak, actionById("dissolve_congress")));
});

// --- The franchise ---------------------------------------------------------

test("the franchise can only be rewritten once", () => {
  const state = newState({ approval: 90, electorate: { excluded: "f" } });
  assert.equal(availability(state, actionById("strengthen_19")).available, false);
});

test("disenfranchised voters leave the focus group", () => {
  const women = PERSONAS.filter((p) => p.sex === "f").length;
  assert.ok(women > 0, "roster needs women to remove");

  assert.equal(eligiblePersonas(null).length, PERSONAS.length);
  assert.equal(eligiblePersonas({ excluded: "f" }).length, PERSONAS.length - women);

  const scored = scoreAll({ approvalChange: 1, electorate: { excluded: "f" } });
  assert.equal(scored.length, PERSONAS.length - women);
  const femaleIds = new Set(PERSONAS.filter((p) => p.sex === "f").map((p) => p.id));
  assert.ok(scored.every((s) => !femaleIds.has(s.id)));
});

test("ratifying a franchise amendment re-bases approval and costs dearly", () => {
  let state = newState({ approval: 90, stability: 90 });
  const out = forcePass(state, "repeal_19");
  assert.ok(out.passed, "should clear Congress from an overwhelming position");
  assert.ok(out.toStates, "an amendment goes to the states");

  // Drive ratification to completion.
  let next = out.state;
  next.specialActions.pending.ratified = next.specialActions.pending.needed;
  const civilRightsBefore = next.stakeholders.civil_rights;
  const result = tickSpecialActions(next);

  assert.equal(result.kind, "ratified");
  assert.equal(next.electorate.excluded, "f");
  assert.ok(next.stakeholders.civil_rights < civilRightsBefore - 30, "civil rights must collapse");
  assert.ok(next.stability < 90, "stability must fall");
});

test("failing a franchise amendment is itself catastrophic", () => {
  // A state strong enough to try but with odds that will not clear.
  const state = newState({ approval: 75, stability: 60 });
  const out = propose(state, "repeal_19");
  if (out.passed) return; // the roll can succeed; the failure path is what we assert
  assert.ok(out.state.approval < 75 - 10, "approval must crater");
  assert.ok(out.state.stakeholders.civil_rights < state.stakeholders.civil_rights - 20);
});

// --- Rule by decree --------------------------------------------------------

test("a successful coup dissolves Congress and bypasses roll calls", () => {
  const state = newState({
    stability: 95,
    stakeholders: { ...newState().stakeholders, pentagon: 100 },
    institutions: { joint_chiefs: { vacant: false, holder: { competence: 80, loyalty: 95, independence: 10 }, monthsRemaining: 40 } },
  });
  const out = propose(state, "dissolve_congress");
  if (!out.passed) {
    // The refusal path must end the presidency rather than doing nothing.
    assert.equal(out.state.over, true);
    assert.equal(out.state.ending.type, "removed");
    return;
  }

  assert.equal(out.state.congressDissolved, true);
  assert.equal(out.state.congress.houseR + out.state.congress.houseD, 0);
  assert.ok(out.state.approval < state.approval, "the country does not thank you");

  const checks = computeChecks(out.state, "I am passing a sweeping new law by decree.");
  assert.equal(checks.congress.status, "executive");
  assert.match(checks.congress.note, /no Congress/i);
  assert.equal(checks.effectMultiplier, 1, "nothing blunts a decree");
});

test("a dictator faces no election, only the army", () => {
  const base = newState({ congressDissolved: true, approval: 45 });
  base.month = 48; // the last month of the term

  // The army still behind you: no election, and the term simply ends this way.
  const loyal = applyResult({ ...base, stakeholders: { ...base.stakeholders, pentagon: 80 } },
    "Routine administration by decree.", { approvalChange: 0, analysis: "" });
  assert.notEqual(loyal.phase, "campaign", "there is nobody left to call an election");
  assert.equal(loyal.over, true);
  assert.equal(loyal.ending.type, "autocrat");

  // The army walking away is the only remaining way out of office.
  const abandoned = applyResult({ ...base, stakeholders: { ...base.stakeholders, pentagon: 40 } },
    "Routine administration by decree.", { approvalChange: 0, analysis: "" });
  assert.equal(abandoned.over, true);
  assert.equal(abandoned.ending.type, "removed");
  assert.match(abandoned.ending.reason, /generals/i);
});

test("a dissolved Congress is described to the model as dissolved", () => {
  const state = newState({ congressDissolved: true });
  const summary = describeStateForPrompt(state);
  assert.match(summary, /Congress: DISSOLVED/);
  assert.doesNotMatch(summary, /House 0D-0R/, "never report a phantom chamber");
});

test("with Congress gone, ordinary legislation is off the docket", () => {
  const state = newState({ congressDissolved: true, approval: 80 });
  assert.equal(availability(state, actionById("dc_statehood")).available, false);
  assert.match(availability(state, actionById("dc_statehood")).reason, /no Congress/i);
});

test("checks & balances switched off still yields an unblunted result", () => {
  const state = newState({ scenario: { ...newState().scenario, checks: false } });
  const checks = computeChecks(state, "A sweeping new law.");
  assert.equal(checks.effectMultiplier, 1);
});

// --- The ledger ------------------------------------------------------------

test("a failed attempt is recorded and twice-failed actions are closed off", () => {
  let state = newState({
    approval: 46, stability: 50,
    congress: { houseD: 300, houseR: 135, senateD: 70, senateR: 30 },
    specialActions: { ...emptyLedger(), attempts: { dc_statehood: 2 } },
  });
  const gate = availability(state, actionById("dc_statehood"));
  assert.equal(gate.available, false);
  assert.match(gate.reason, /Twice attempted/);
});

test("abolishing the filibuster lowers the bar for later statutes", () => {
  const base = newState({ approval: 60, stability: 70 });
  const before = odds(base, actionById("dc_statehood"));
  const after = odds(
    { ...base, specialActions: { ...emptyLedger(), filibusterGone: true } },
    actionById("dc_statehood"));
  assert.ok(after > before, "removing cloture must help");
});

test("an amendment that misses its deadline dies in the states", () => {
  const state = newState({ approval: 50 });
  state.specialActions = {
    ...emptyLedger(),
    pending: { id: "continuity_28", title: "28th Amendment", proposedMonth: 1, deadline: 2, ratified: 4, needed: 38 },
  };
  state.month = 3;
  const result = tickSpecialActions(state);
  assert.equal(result.kind, "expired");
  assert.equal(state.specialActions.pending, null);
});
