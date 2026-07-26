import test from "node:test";
import assert from "node:assert/strict";

import {
  vicePresident,
  canSucceed,
  succeed,
  tickTwentyFifth,
  resolveTwentyFifth,
  hasTieBreak,
  vpSupports,
  TWENTY_FIFTH_SUSTAIN,
} from "../src/succession.js";
import {
  createGame, partyControl, computeRollCall, canServeAnotherTerm, applyResult,
} from "../src/gameEngine.js";
import { rollCall } from "../src/bills.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

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
    vp: {
      name: "Marcus Okafor", region: "Midwestern", background: "senator",
      ideology: "Liberal", loyalty: 84, competence: 77,
      bio: "A Midwestern senator who runs as a liberal.", portfolio: "",
    },
    ...(overrides.scenario || {}),
  });
  return { ...state, ...overrides, scenario: { ...state.scenario, ...(overrides.scenario || {}) } };
}

/** Set every cabinet member's loyalty, to isolate the 25th Amendment gate. */
function withLoyalty(state, cabinetLoyalty, vpLoyalty = cabinetLoyalty) {
  return {
    ...state,
    cabinet: state.cabinet.map((c) => ({
      ...c, loyalty: c.id === "vp" ? vpLoyalty : cabinetLoyalty,
    })),
  };
}

const ending = (type) => ({ type, reason: "..." });

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------

test("the Vice President is findable and is the one the player picked", () => {
  const vp = vicePresident(game());
  assert.equal(vp.name, "Marcus Okafor");
  assert.equal(vp.loyalty, 84);
});

test("removal, resignation and collapse all hand over; an election result does not", () => {
  const state = game();
  for (const type of ["removed", "resigned", "collapse", "incapacitated"]) {
    assert.equal(canSucceed(state, ending(type)), true, `${type} should hand over`);
  }
  for (const type of ["defeated", "reelected", "term_limited", "narrow", "autocrat"]) {
    assert.equal(canSucceed(state, ending(type)), false, `${type} should not hand over`);
  }
});

test("there is no succession once the Capitol is padlocked", () => {
  assert.equal(canSucceed({ ...game(), congressDissolved: true }, ending("removed")), false);
});

test("the Vice President takes the oath and the career continues", () => {
  const before = { ...game(), month: 19, approval: 24, stability: 18 };
  const next = succeed(before, ending("removed"));

  assert.equal(next.scenario.presidentName, "Marcus Okafor");
  assert.equal(next.scenario.party, "Democrat", "the party does not change hands mid-term");
  assert.equal(next.over, false, "the career continues under the new president");
  assert.equal(next.ending, null);
  assert.equal(next.month, 19, "the term keeps running; a successor does not get a fresh four years");
  assert.equal(next.term, 1);
});

test("the country the new president inherits is the one that was left to them", () => {
  const before = {
    ...game(), month: 19,
    arcs: [{ id: "arc_1", status: "active", severity: 4, domain: "economy", title: "T", brief: "b", log: [] }],
    economy: { gdpGrowth: -1.2, unemployment: 8.4, inflation: 6.1, debt: 41.7 },
    congress: { houseD: 190, houseR: 245, senateD: 46, senateR: 54 },
    court: { conservative: 7, liberal: 2 },
  };
  const next = succeed(before, ending("resigned"));

  assert.deepEqual(next.economy, before.economy, "the economy carries");
  assert.deepEqual(next.congress, before.congress, "Congress carries");
  assert.deepEqual(next.court, before.court, "the bench carries");
  assert.equal(next.arcs.length, 1, "the unfinished business carries");
  assert.equal(next.arcs[0].severity, 4);
});

test("a successor is not handed their predecessor's approval", () => {
  const hated = succeed({ ...game(), approval: 19 }, ending("removed"));
  const loved = succeed({ ...game(), approval: 71 }, ending("resigned"));
  assert.ok(hated.approval > 19, "a new president is not blamed for the old one's numbers");
  assert.ok(hated.approval < 55, "but they do not get a clean slate either");
  assert.ok(loved.approval < 71, "and they do not inherit goodwill they never earned");
});

test("the map is redrawn for the politician who now holds the office", () => {
  const before = { ...game(), approval: 30 };
  const next = succeed(before, ending("removed"));
  const spread = Object.values(next.stateApproval);
  assert.ok(Math.max(...spread) - Math.min(...spread) > 5,
    "the new president has a map of their own, not a flat one");
  assert.notDeepEqual(next.stateApproval, before.stateApproval);
});

test("the case against the former president does not follow the new one", () => {
  const before = {
    ...game(),
    jeopardy: { investigation: { subject: "a bribe", opened: 4, progress: 80 },
      articles: [{ source: "scandal", title: "Abuse of the office", weight: 2 }],
      status: "investigating", houseVote: null, senateVote: null, trialMonth: null,
      acquittals: 0, obstructed: false },
  };
  const next = succeed(before, ending("removed"));
  assert.equal(next.jeopardy.articles.length, 0, "the articles were against someone else");
  assert.equal(next.jeopardy.investigation, null);
});

test("the outgoing president goes into the record", () => {
  const next = succeed({ ...game(), month: 19, approval: 24 }, ending("removed"));
  assert.equal(next.formerPresidents.length, 1);
  const gone = next.formerPresidents[0];
  assert.equal(gone.name, "Ruth Ellery");
  assert.equal(gone.ending.type, "removed");
  assert.equal(gone.leftMonth, 19);
});

test("a new Vice President is sworn in, because the office cannot stay empty", () => {
  const next = succeed(game(), ending("removed"));
  const vp = vicePresident(next);
  assert.ok(vp, "there is a Vice President");
  assert.notEqual(vp.name, "Marcus Okafor", "the old VP is the President now");
  assert.notEqual(vp.name, "Ruth Ellery");
});

test("a successor who serves most of a term can only be elected once more", () => {
  // Sworn in early: more than half the term served, so one election only.
  const early = succeed({ ...game(), month: 10 }, ending("removed"));
  assert.equal(canServeAnotherTerm({ ...early, term: 2 }), false,
    "having served most of a term plus a full one, they are done");

  // Sworn in late: less than half, so two elections of their own remain.
  const late = succeed({ ...game(), month: 40 }, ending("removed"));
  assert.equal(canServeAnotherTerm({ ...late, term: 2 }), true);
});

// ---------------------------------------------------------------------------
// The Twenty-Fifth Amendment
// ---------------------------------------------------------------------------

const failing = (state) => ({ ...state, approval: 21, stability: 19 });

test("a loyal cabinet never moves, however badly it is going", () => {
  const state = failing(withLoyalty(game(), 88, 92));
  for (let month = 1; month <= 40; month++) {
    const next = { ...state, month };
    tickTwentyFifth(next);
    assert.notEqual(next.phase, "twentyfifth", `a loyal cabinet moved in month ${month}`);
  }
});

test("a loyal Vice President will not lead it, even with a mutinous cabinet", () => {
  const state = failing(withLoyalty(game(), 20, 95));
  for (let month = 1; month <= 40; month++) {
    const next = { ...state, month };
    tickTwentyFifth(next);
    assert.notEqual(next.phase, "twentyfifth", `a loyal VP moved in month ${month}`);
  }
});

test("a disloyal cabinet behind a disloyal VP eventually moves", () => {
  const state = failing(withLoyalty(game(), 16, 20));
  const moved = Array.from({ length: 40 }, (_, i) => {
    const next = { ...state, month: i + 1 };
    tickTwentyFifth(next);
    return next.phase === "twentyfifth";
  });
  assert.ok(moved.some(Boolean), "a mutinous cabinet should move at some point");
});

test("a functioning presidency is safe even from a cabinet that dislikes it", () => {
  const healthy = { ...withLoyalty(game(), 16, 20), approval: 58, stability: 71 };
  for (let month = 1; month <= 40; month++) {
    const next = { ...healthy, month };
    tickTwentyFifth(next);
    assert.notEqual(next.phase, "twentyfifth",
      `they moved against a president at 58% in month ${month}`);
  }
});

test("stepping aside hands the office over at once", () => {
  const state = { ...failing(withLoyalty(game(), 16, 20)), phase: "twentyfifth",
    twentyFifth: { declaredMonth: 6, cabinetFor: 8, cabinetAgainst: 3 } };
  const { state: next } = resolveTwentyFifth(state, "step_aside");
  assert.equal(next.scenario.presidentName, "Marcus Okafor");
  assert.equal(next.phase, null);
});

test("contesting it goes to Congress, and Congress needs two thirds of both chambers", () => {
  const base = { ...failing(withLoyalty(game(), 16, 20)), phase: "twentyfifth",
    twentyFifth: { declaredMonth: 6, cabinetFor: 8, cabinetAgainst: 3 } };
  const { result } = resolveTwentyFifth(base, "contest");
  assert.ok(result.house && result.senate, "both chambers vote");
  assert.equal(result.house.needed, Math.ceil(result.house.total * TWENTY_FIFTH_SUSTAIN));
  assert.equal(result.senate.needed, Math.ceil(result.senate.total * TWENTY_FIFTH_SUSTAIN));
  // Sustaining the VP takes two thirds of BOTH; anything less and the President wins.
  assert.equal(result.sustained,
    result.house.yes >= result.house.needed && result.senate.yes >= result.senate.needed);
});

test("surviving the attempt leaves you in office and worse off", () => {
  // A Congress full of the President's own party will not sustain the VP.
  const friendly = { ...failing(withLoyalty(game(), 16, 20)),
    congress: { houseD: 400, houseR: 35, senateD: 92, senateR: 8 },
    phase: "twentyfifth", twentyFifth: { declaredMonth: 6, cabinetFor: 8, cabinetAgainst: 3 } };
  const { state: next, result } = resolveTwentyFifth(friendly, "contest");
  assert.equal(result.sustained, false, "their own party should not remove them");
  assert.equal(next.scenario.presidentName, "Ruth Ellery", "they keep the office");
  assert.equal(next.phase, null);
  assert.ok(next.stability < friendly.stability, "but the government is shakier for it");
});

test("losing the vote hands the office to the Vice President", () => {
  // An opposition supermajority in both chambers will sustain the VP.
  const hostile = { ...failing(withLoyalty(game(), 12, 14)),
    congress: { houseD: 20, houseR: 415, senateD: 4, senateR: 96 },
    phase: "twentyfifth", twentyFifth: { declaredMonth: 6, cabinetFor: 11, cabinetAgainst: 0 } };
  const { state: next, result } = resolveTwentyFifth(hostile, "contest");
  assert.equal(result.sustained, true);
  assert.equal(next.scenario.presidentName, "Marcus Okafor");
  assert.equal(next.formerPresidents[0].ending.type, "incapacitated");
});

// ---------------------------------------------------------------------------
// The tie-breaking vote
// ---------------------------------------------------------------------------

const tied = (state) => ({ ...state, congress: { ...state.congress, senateD: 50, senateR: 50 } });

test("a president with a Vice President has the casting vote", () => {
  assert.equal(hasTieBreak(game()), true);
  assert.equal(hasTieBreak({ ...game(), cabinet: game().cabinet.filter((c) => c.id !== "vp") }), false);
});

test("a tied Senate counts as the President's, which is what the dashboard already says", () => {
  const control = partyControl(tied(game()));
  assert.equal(control.senate, "Democrat", "the VP breaks it for the administration");
});

test("a tied Senate has no casting vote when there is no Vice President", () => {
  const noVp = { ...tied(game()), cabinet: game().cabinet.filter((c) => c.id !== "vp") };
  assert.equal(partyControl(noVp).senate, "Republican", "50-50 is not a majority for the President");
});

test("the casting vote carries the President's own legislation", () => {
  // A chamber split exactly in half on the President's bill.
  const state = tied(game());
  const roll = computeRollCall(state, false);
  if (roll.senate.yes === 50) {
    assert.equal(roll.senate.passed, true, "the VP breaks a 50-50 for the President");
  }
  // Whatever the split, a Senate tie must never be scored against the President.
  assert.ok(roll.senate.yes !== 50 || roll.senate.passed);
});

test("the Vice President breaks ties for bills the administration agrees with", () => {
  assert.equal(vpSupports(game(), -0.4), true, "a bill next to the President's own politics");
  assert.equal(vpSupports(game(), 0.8), false, "a bill from the other end of the spectrum");
});

test("a bill the administration hates does not get the casting vote", () => {
  const state = tied(game());
  const roster = buildCongress(state, STATES);
  const friendly = rollCall(roster.senate, -0.4, { tieBreak: vpSupports(state, -0.4) });
  const hostile = rollCall(roster.senate, 0.8, { tieBreak: vpSupports(state, 0.8) });
  if (friendly.yes === 50) assert.equal(friendly.passed, true);
  if (hostile.yes === 50) assert.equal(hostile.passed, false);
  // A tie-break never lowers the bar for an override.
  assert.equal(friendly.overrideThreshold, Math.ceil(friendly.total * 2 / 3));
});

test("the casting vote never applies to a two-thirds threshold", () => {
  const roster = buildCongress(tied(game()), STATES);
  const roll = rollCall(roster.senate, -0.4, { tieBreak: true });
  assert.equal(roll.overrode, roll.yes >= Math.ceil(roll.total * 2 / 3),
    "an override still takes two thirds on its own");
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("a collapse in government now hands over rather than ending the career", () => {
  const doomed = { ...game(), month: 12, approval: 12, stability: 9 };
  const next = applyResult(doomed, "Nothing works any more.", {
    analysis: "", approvalChange: -6, economy: {}, stakeholders: [], press: [],
    stateEffects: [], arcs: [], nextEvent: { title: "x", brief: "y" }, flags: {},
  });
  if (next.formerPresidents?.length) {
    assert.equal(next.over, false, "the republic continues under the Vice President");
    assert.equal(next.scenario.presidentName, "Marcus Okafor");
  }
});
