import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIMARY_MONTH,
  PRIMARY_STRATEGIES,
  partyStanding,
  governingDrift,
  primaryThreat,
  primaryChallenger,
  runPrimary,
  delegateBoard,
} from "../src/primary.js";
import { createGame, applyResult, finishPrimary, pacing } from "../src/gameEngine.js";
import { STATE_CODES } from "../src/states.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function game(overrides = {}) {
  const state = createGame({
    presidentName: "Ruth Ellery",
    party: "Democrat",
    startYear: 2025,
    startApproval: 51,
    ideologyAxis: -0.35,
    ideology: "Social Democrat",
    difficulty: "hard",
    vp: { name: "Marcus Okafor", region: "Midwestern", background: "senator",
      ideology: "Liberal", loyalty: 84, competence: 77, bio: "b", portfolio: "" },
    ...(overrides.scenario || {}),
  });
  return { ...state, ...overrides, scenario: { ...state.scenario, ...(overrides.scenario || {}) } };
}

/** Set every bloc to the same number, to isolate party standing. */
const withBlocs = (state, value) => ({
  ...state,
  stakeholders: Object.fromEntries(Object.keys(state.stakeholders).map((k) => [k, value])),
});

const at = (state, month) => ({ ...state, month });

// ---------------------------------------------------------------------------
// Party standing — the number that used to be decoration
// ---------------------------------------------------------------------------

test("party standing reads the blocs that actually lean the president's way", () => {
  const warm = partyStanding(withBlocs(game(), 80));
  const cold = partyStanding(withBlocs(game(), 20));
  assert.ok(warm > cold);
  assert.ok(warm >= 0 && warm <= 100 && cold >= 0 && cold <= 100);
});

test("an independent has no coalition to lose, so the whole board counts", () => {
  const indie = game({ scenario: { party: "Independent", ideologyAxis: 0 } });
  assert.ok(Number.isFinite(partyStanding(indie)));
});

// ---------------------------------------------------------------------------
// Governing drift — what you signed, versus what you ran as
// ---------------------------------------------------------------------------

test("a president who has signed nothing has not drifted", () => {
  assert.equal(governingDrift(game()), 0);
});

test("signing bills from the other end of the spectrum is drift", () => {
  const loyal = { ...game(), billLog: [
    { id: "union_rights", outcome: "signed" },   // axis -0.48, next to the president
    { id: "childcare", outcome: "signed" },      // axis -0.35, the president exactly
  ] };
  const sellout = { ...game(), billLog: [
    { id: "tax_cuts", outcome: "signed" },       // axis +0.45, the other side
    { id: "deregulation", outcome: "signed" },   // axis +0.52
  ] };
  assert.ok(governingDrift(sellout) > governingDrift(loyal),
    "signing the other side's agenda should read as drift");
});

test("vetoing your own side's bill is drift too", () => {
  const betrayed = { ...game(), billLog: [{ id: "union_rights", outcome: "vetoed" }] };
  assert.ok(governingDrift(betrayed) > 0, "killing your own side's bill is a betrayal of the base");
});

// ---------------------------------------------------------------------------
// The threat
// ---------------------------------------------------------------------------

test("a popular president with a warm coalition faces no serious challenge", () => {
  const safe = { ...withBlocs(game(), 78), approval: 58 };
  assert.equal(primaryThreat(safe).serious, false);
});

test("a failing president with an abandoned base faces one", () => {
  const doomed = { ...withBlocs(game(), 22), approval: 27 };
  assert.equal(primaryThreat(doomed).serious, true);
  assert.ok(primaryThreat(doomed).reasons.length > 0, "the threat says why");
});

test("drifting from your own base is itself grounds for a challenge", () => {
  const base = { ...withBlocs(game(), 48), approval: 46 };
  const drifted = { ...base, billLog: [
    { id: "tax_cuts", outcome: "signed" },
    { id: "deregulation", outcome: "signed" },
    { id: "entitlement_reform", outcome: "signed" },
  ] };
  assert.ok(primaryThreat(drifted).score > primaryThreat(base).score);
});

test("an independent president has no party to be challenged in", () => {
  const indie = { ...withBlocs(game({ scenario: { party: "Independent", ideologyAxis: 0 } }), 20), approval: 25 };
  assert.equal(primaryThreat(indie).serious, false);
});

test("a president who cannot run again is not worth challenging", () => {
  const lameDuck = { ...withBlocs(game(), 20), approval: 25, term: 2 };
  assert.equal(primaryThreat(lameDuck).serious, false);
});

// ---------------------------------------------------------------------------
// The challenger
// ---------------------------------------------------------------------------

test("the challenger comes from the president's own party", () => {
  const c = primaryChallenger({ ...withBlocs(game(), 25), approval: 28 });
  assert.equal(c.party, "Democrat");
  assert.ok(c.name && c.pitch && c.wing);
});

test("an abandoned base sends someone from the wing; a failing president draws a pragmatist", () => {
  const abandoned = { ...withBlocs(game(), 44), approval: 47, billLog: [
    { id: "tax_cuts", outcome: "signed" }, { id: "deregulation", outcome: "signed" },
    { id: "entitlement_reform", outcome: "signed" },
  ] };
  const failing = { ...withBlocs(game(), 30), approval: 24 };
  assert.equal(primaryChallenger(abandoned).wing, "base");
  assert.equal(primaryChallenger(failing).wing, "electability");
});

test("the challenger is stable — the same career always faces the same rival", () => {
  const s = { ...withBlocs(game(), 25), approval: 28 };
  assert.equal(primaryChallenger(s).name, primaryChallenger({ ...s, month: 44 }).name);
});

// ---------------------------------------------------------------------------
// The contest
// ---------------------------------------------------------------------------

test("every state sends delegates, and there are enough of them to need a majority", () => {
  const board = delegateBoard(game());
  assert.equal(board.states.length, STATE_CODES.length);
  assert.ok(board.total > 0);
  assert.equal(board.majority, Math.floor(board.total / 2) + 1);
  for (const s of board.states) assert.ok(s.delegates >= 1, `${s.code} sends no delegates`);
});

test("a party's delegates concentrate where the party is strong", () => {
  const board = delegateBoard(game());   // a Democrat
  const ca = board.states.find((s) => s.code === "CA");
  const wy = board.states.find((s) => s.code === "WY");
  assert.ok(ca.delegates > wy.delegates, "California should outweigh Wyoming for a Democrat");
});

test("a strong president is renominated and a collapsed one is not", () => {
  const strong = runPrimary({ ...withBlocs(game(), 76), approval: 57 }, "record");
  const collapsed = runPrimary({ ...withBlocs(game(), 14), approval: 18 }, "record");
  assert.equal(strong.won, true);
  assert.equal(collapsed.won, false);
});

test("the delegate count is whole and adds up", () => {
  for (const approval of [20, 35, 50, 65]) {
    const r = runPrimary({ ...withBlocs(game(), approval), approval }, "record");
    assert.equal(r.delegates.you + r.delegates.them, r.delegates.total);
    assert.ok(r.delegates.you >= 0 && r.delegates.them >= 0);
    assert.equal(r.won, r.delegates.you >= r.delegates.majority);
  }
});

test("every strategy is offered with its price stated", () => {
  assert.ok(PRIMARY_STRATEGIES.length >= 3);
  for (const s of PRIMARY_STRATEGIES) {
    assert.ok(s.id && s.label && s.detail && s.cost, `${s.id} needs its cost spelled out`);
  }
});

test("running to the base wins delegates and running on the record does not", () => {
  const shaky = { ...withBlocs(game(), 40), approval: 41 };
  const base = runPrimary(shaky, "base");
  const record = runPrimary(shaky, "record");
  assert.ok(base.delegates.you > record.delegates.you, "tacking to the base should win delegates");
});

test("the contest is deterministic — the same party votes the same way", () => {
  const s = { ...withBlocs(game(), 43), approval: 44 };
  assert.deepEqual(runPrimary(s, "record").delegates, runPrimary(s, "record").delegates);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const quietTurn = () => ({
  analysis: "", approvalChange: 0, economy: {}, stakeholders: [], press: [],
  stateEffects: [], arcs: [], nextEvent: { title: "x", brief: "y" }, flags: {},
});

test("the primary happens before campaign season, not after it", () => {
  assert.ok(PRIMARY_MONTH < pacing(game()).campaignStart);
});

test("a threatened president is stopped at the primary; a safe one sails past", () => {
  const threatened = at({ ...withBlocs(game(), 20), approval: 24 }, PRIMARY_MONTH - 1);
  assert.equal(applyResult(threatened, "We continue.", quietTurn()).phase, "primary");

  const safe = at({ ...withBlocs(game(), 78), approval: 58 }, PRIMARY_MONTH - 1);
  assert.notEqual(applyResult(safe, "We continue.", quietTurn()).phase, "primary");
});

test("winning the nomination clears the phase and lets the term run on", () => {
  const s = { ...at({ ...withBlocs(game(), 62), approval: 52 }, PRIMARY_MONTH), phase: "primary" };
  const { state: next, result } = finishPrimary(s, "record");
  assert.equal(result.won, true);
  assert.equal(next.phase, null);
  assert.equal(next.over, false);
  assert.equal(next.primaryHeld, true, "it must not re-trigger next month");
});

test("losing the nomination ends the career, and says why", () => {
  const s = { ...at({ ...withBlocs(game(), 12), approval: 16 }, PRIMARY_MONTH), phase: "primary" };
  const { state: next, result } = finishPrimary(s, "record");
  assert.equal(result.won, false);
  assert.equal(next.over, true);
  assert.equal(next.ending.type, "primaried");
  assert.ok(/nomination/i.test(next.ending.reason));
});

test("running to the base moves where the president stands, and it sticks", () => {
  const s = { ...at({ ...withBlocs(game(), 44), approval: 44 }, PRIMARY_MONTH), phase: "primary" };
  const before = s.scenario.ideologyAxis;
  const { state: next } = finishPrimary(s, "base");
  assert.notEqual(next.scenario.ideologyAxis, before, "tacking left or right is a real move");
  assert.ok(Math.abs(next.scenario.ideologyAxis) > Math.abs(before),
    "you end up further from the centre than you started");
});

test("cutting a deal puts the challenger on the ticket, and they are nobody's friend", () => {
  const s = { ...at({ ...withBlocs(game(), 40), approval: 42 }, PRIMARY_MONTH), phase: "primary" };
  const vpBefore = s.cabinet.find((c) => c.id === "vp");
  const { state: next, result } = finishPrimary(s, "deal");
  const vpAfter = next.cabinet.find((c) => c.id === "vp");
  assert.notEqual(vpAfter.name, vpBefore.name, "the challenger takes the ticket");
  assert.equal(vpAfter.name, result.challenger.name);
  assert.ok(vpAfter.loyalty < 45,
    "a rival you had to buy off is exactly the VP who can invoke the Twenty-Fifth");
});

test("a bruising primary costs you something whatever you do", () => {
  const s = { ...at({ ...withBlocs(game(), 40), approval: 44 }, PRIMARY_MONTH), phase: "primary" };
  for (const strategy of ["record", "base", "deal"]) {
    const { state: next } = finishPrimary(s, strategy);
    if (!next.over) {
      assert.ok(next.approval <= s.approval,
        `${strategy} should not leave the president better off than not being challenged`);
    }
  }
});
