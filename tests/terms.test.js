import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame, applyResult, finishCampaign, beginNextTerm,
  absoluteMonth, canServeAnotherTerm, TERM_LENGTH, TERM_LIMIT,
} from "../src/gameEngine.js";
import { emptyLedger } from "../src/specialActions.js";

function newState(over = {}) {
  const state = createGame({
    presidentName: "Test President",
    party: "Republican",
    ideologyAxis: 0.45,
    era: "A test era.",
    startApproval: 55,
    startYear: 2025,
    difficulty: "hard",
  });
  return { ...state, ...over };
}

/** A state on the brink of winning re-election. */
function onTheVergeOfWinning(over = {}) {
  const s = newState({ month: TERM_LENGTH - 2, approval: 64, ...over });
  for (const code of Object.keys(s.stateApproval)) s.stateApproval[code] = 62;
  s.phase = "campaign";
  s.campaign = {
    opponent: { name: "Gov. Test Challenger", party: "Democrat", style: "steady", attack: "chaos" },
    topics: [{ topic: "a", q: "a" }, { topic: "b", q: "b" }, { topic: "c", q: "c" }],
  };
  return s;
}

// --- The clock -------------------------------------------------------------

test("a new career starts in its first term", () => {
  const s = newState();
  assert.equal(s.term, 1);
  assert.equal(absoluteMonth(s), 1);
  assert.equal(canServeAnotherTerm(s), true);
});

test("the calendar runs off the whole presidency, not the current term", () => {
  assert.equal(absoluteMonth(newState({ term: 1, month: 12 })), 12);
  assert.equal(absoluteMonth(newState({ term: 2, month: 1 })), TERM_LENGTH + 1);
  assert.equal(absoluteMonth(newState({ term: 3, month: 6 })), TERM_LENGTH * 2 + 6);
});

// --- Winning ---------------------------------------------------------------

test("winning re-election starts the next term instead of ending the career", () => {
  const before = onTheVergeOfWinning();
  const after = finishCampaign(before, 14);

  assert.equal(after.ending, null, "a win is not an ending");
  assert.equal(after.over, false, "the career continues");
  assert.equal(after.term, 2);
  assert.equal(after.month, 1);
  assert.equal(after.phase, null);
  assert.equal(after.campaign, null);
  assert.equal(absoluteMonth(after), TERM_LENGTH + 1, "the calendar moves forward, not back");
});

test("the second term inherits the country you made", () => {
  const before = onTheVergeOfWinning();
  before.arcs = [{ id: "arc_1", title: "Unfixed", status: "active", severity: 4, domain: "economy", monthsActive: 9 }];
  before.stakeholders.labor = 22;
  before.economy.debt = 41.7;
  before.court = { conservative: 7, liberal: 2 };
  before.specialActions = { ...emptyLedger(), filibusterGone: true, passed: ["abolish_filibuster"] };
  before.billHistory = ["tax_cuts"];

  const after = finishCampaign(before, 10);
  assert.equal(after.arcs.length, 1, "problems do not evaporate at an inauguration");
  assert.equal(after.arcs[0].severity, 4);
  assert.equal(after.stakeholders.labor, 22);
  assert.equal(after.economy.debt, 41.7);
  assert.deepEqual(after.court, { conservative: 7, liberal: 2 });
  assert.equal(after.specialActions.filibusterGone, true);
  assert.deepEqual(after.billHistory, ["tax_cuts"], "a bill already sent does not come back");
  assert.deepEqual(after.bills, [], "but the legislative slate is clean");
});

test("an inauguration records the election and gives a short honeymoon", () => {
  const before = onTheVergeOfWinning();
  const after = finishCampaign(before, 10);

  assert.equal(after.elections.length, 1);
  assert.equal(after.elections[0].term, 1);
  assert.ok(after.approval > 50, "a winner starts the new term above water");
  assert.ok(after.history.some((h) => h.inauguration), "the swearing-in is on the record");
});

test("a second-term cabinet turns over", () => {
  const before = onTheVergeOfWinning();
  const namesBefore = Object.fromEntries(before.cabinet.map((c) => [c.id, c.name]));
  const after = finishCampaign(before, 10);

  assert.ok(after.cabinetChanges.length >= 1, "somebody always goes home");
  for (const id of after.cabinetChanges) {
    assert.notEqual(after.cabinet.find((c) => c.id === id).name, namesBefore[id]);
    assert.ok(id !== "vp" && id !== "spouse", "the ticket and the family stay");
  }
});

// --- The limit -------------------------------------------------------------

test("two terms is the limit", () => {
  assert.equal(canServeAnotherTerm(newState({ term: 1 })), true);
  assert.equal(canServeAnotherTerm(newState({ term: TERM_LIMIT })), false);
});

test("a term-limited president never gets a campaign", () => {
  let s = newState({ term: 2, month: 45, approval: 70 });
  for (let i = 0; i < 3; i++) {
    s = applyResult(s, "A steady month.", { approvalChange: 0, analysis: "" });
    assert.notEqual(s.phase, "campaign", `campaign started at month ${s.month} of a final term`);
  }
});

test("a final term ends with the Constitution, not the voters", () => {
  let s = newState({ term: 2, month: TERM_LENGTH, approval: 70 });
  s = applyResult(s, "A steady month.", { approvalChange: 0, analysis: "" });
  assert.equal(s.over, true);
  assert.equal(s.ending.type, "term_limited");
  assert.match(s.ending.reason, /Twenty-Second/);
});

test("repealing the 22nd Amendment unlocks a third term", () => {
  const limited = newState({ term: 2 });
  assert.equal(canServeAnotherTerm(limited), false);

  const unlimited = newState({
    term: 2,
    specialActions: { ...emptyLedger(), termLimitGone: true, passed: ["repeal_22"] },
  });
  assert.equal(canServeAnotherTerm(unlimited), true, "the repeal must actually do something");

  // And the campaign runs again rather than the term simply expiring.
  let s = { ...unlimited, month: 45, approval: 60 };
  for (let i = 0; i < 3 && s.phase !== "campaign"; i++) {
    s = applyResult(s, "A steady month.", { approvalChange: 0, analysis: "" });
  }
  assert.equal(s.phase, "campaign");
});

test("a third term is reachable once the limit is gone", () => {
  const s = onTheVergeOfWinning({
    term: 2,
    specialActions: { ...emptyLedger(), termLimitGone: true, passed: ["repeal_22"] },
  });
  const after = finishCampaign(s, 12);
  assert.equal(after.term, 3);
  assert.equal(after.over, false);
  assert.equal(after.elections.length, 1);
});

// --- Losing still ends it --------------------------------------------------

test("losing re-election still ends the career", () => {
  const s = onTheVergeOfWinning({ approval: 30 });
  for (const code of Object.keys(s.stateApproval)) s.stateApproval[code] = 28;
  const after = finishCampaign(s, -14);

  assert.equal(after.over, true);
  assert.ok(["defeated", "narrow"].includes(after.ending.type), after.ending.type);
  assert.equal(after.term, 2 - 1, "a loser does not get sworn in again");
});

test("history entries carry the term they belong to", () => {
  let s = newState();
  s = applyResult(s, "A first act.", { approvalChange: 1, analysis: "" });
  assert.equal(s.history.at(-1).term, 1);

  const second = beginNextTerm({ ...s, month: TERM_LENGTH + 1 }, { electoral: 300 });
  const played = applyResult(second, "A second-term act.", { approvalChange: 1, analysis: "" });
  assert.equal(played.history.at(-1).term, 2);
});
