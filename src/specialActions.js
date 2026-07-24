import { seeded, clamp, round1 } from "./rng.js";

/**
 * Special actions — the things a president can attempt that change the rules
 * of the game itself rather than the state of the country.
 *
 * They are deliberately hard. Every one needs Congress, most need the states,
 * and the ones that would hand a president permanent advantage need both plus
 * a country willing to go along with it. Failure is public and expensive.
 */

const AMENDMENT_MONTHS = 9; // states have this long to ratify
const STATES_NEEDED = 38;

export const SPECIAL_ACTIONS = [
  {
    id: "repeal_22",
    group: "Constitutional amendments",
    title: "Repeal the 22nd Amendment",
    desc: "Lift the two-term limit. Successful ratification clears the path to a third term and beyond.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    // Nakedly self-serving, so the country has to be badly on-side.
    difficulty: 0.85,
    approvalFloor: 58,
  },
  {
    id: "continuity_28",
    group: "Constitutional amendments",
    title: "28th Amendment: Continuity of Government",
    desc: "Rewrite the doomsday rulebook — dispersed designated survivors, a hardened line of succession, and emergency-powers sunsets written into the Constitution itself.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    difficulty: 0.45,
    approvalFloor: 42,
  },
  {
    id: "term_limits_congress",
    group: "Constitutional amendments",
    title: "Term Limits for Congress",
    desc: "Cap House and Senate service. Wildly popular with the public and loathed by the people whose votes you need.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    difficulty: 0.75,
    approvalFloor: 46,
    congressPenalty: 0.55, // members are voting on their own careers
  },
  {
    id: "balanced_budget",
    group: "Constitutional amendments",
    title: "Balanced Budget Amendment",
    desc: "Require the federal budget to balance. Binds you and every president after you.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    difficulty: 0.6,
    approvalFloor: 44,
  },
  {
    id: "dc_statehood",
    group: "Structural reform",
    title: "Grant Statehood to Washington D.C.",
    desc: "Bring the District into the Union as a full state, with representation in Congress and the Electoral College.",
    requirement: "House majority and 60 in the Senate (51 if the filibuster is gone)",
    kind: "statute",
    difficulty: 0.5,
    approvalFloor: 40,
  },
  {
    id: "pr_statehood",
    group: "Structural reform",
    title: "Grant Statehood to Puerto Rico",
    desc: "Bring Puerto Rico into the Union as a full state — representation in Congress and the Electoral College for the first time.",
    requirement: "House majority and 60 in the Senate (51 if the filibuster is gone)",
    kind: "statute",
    difficulty: 0.45,
    approvalFloor: 40,
  },
  {
    id: "abolish_filibuster",
    group: "Structural reform",
    title: "Abolish the Senate Filibuster",
    desc: "Eliminate the 60-vote cloture threshold. A simple majority becomes enough, and the minority loses its veto.",
    requirement: "Simple Senate majority (51)",
    kind: "senate_rule",
    difficulty: 0.35,
    approvalFloor: 0,
  },
  {
    id: "expand_court",
    group: "Structural reform",
    title: "Expand the Supreme Court",
    desc: "Add two seats to the bench and fill them. The Court's balance moves the day the gavel falls, and the precedent belongs to everyone after you.",
    requirement: "House majority and Senate cloture",
    kind: "statute",
    difficulty: 0.62,
    approvalFloor: 45,
  },
];

export const actionById = (id) => SPECIAL_ACTIONS.find((a) => a.id === id);

const partySeats = (state) => {
  const p = state.scenario.party;
  if (p === "Republican") return { house: state.congress.houseR, senate: state.congress.senateR };
  if (p === "Democrat") return { house: state.congress.houseD, senate: state.congress.senateD };
  // An independent has to build every coalition from scratch.
  return { house: Math.min(state.congress.houseD, state.congress.houseR), senate: 40 };
};

/**
 * Whether an action can even be attempted right now, and why not if not.
 * This is deliberately generous — the point is that you can *try* and fail.
 */
export function availability(state, action) {
  const already = (state.specialActions?.passed || []).includes(action.id);
  if (already) return { available: false, reason: "Already done." };
  const pending = state.specialActions?.pending;
  if (pending && pending.id === action.id) return { available: false, reason: "Out with the states." };
  if (pending) return { available: false, reason: `Waiting on ${actionById(pending.id)?.title || "another amendment"}.` };

  const attempts = state.specialActions?.attempts?.[action.id] || 0;
  if (attempts >= 2) return { available: false, reason: "Twice attempted, twice failed. The votes are not there." };

  if (action.id === "abolish_filibuster" && state.specialActions?.filibusterGone) {
    return { available: false, reason: "The filibuster is already gone." };
  }
  if (state.approval < action.approvalFloor) {
    return { available: false, reason: `Needs about ${action.approvalFloor}% approval to be worth the floor time.` };
  }
  return { available: true };
}

/** The odds, before the roll, so the UI can be honest about the gamble. */
export function odds(state, action) {
  const seats = partySeats(state);
  const houseShare = seats.house / 435;
  const senateShare = seats.senate / 100;

  let score = 0;
  if (action.kind === "amendment") {
    // Two-thirds of both chambers is the real wall here.
    score = (houseShare - 0.667) * 130 + (senateShare - 0.667) * 130;
  } else if (action.kind === "senate_rule") {
    score = (senateShare - 0.5) * 260;
  } else {
    const cloture = state.specialActions?.filibusterGone ? 0.51 : 0.6;
    score = (houseShare - 0.5) * 110 + (senateShare - cloture) * 190;
  }

  score += (state.approval - 50) * 1.4;
  score += (state.stability - 55) * 0.5;
  score -= action.difficulty * 55;
  if (action.congressPenalty) score -= action.congressPenalty * 40;

  return clamp(Math.round(50 + score), 2, 96);
}

/** Attempt it. Amendments that clear Congress go out to the states. */
export function propose(state, actionId) {
  const action = actionById(actionId);
  if (!action) return { rejected: true, note: "No such action." };

  const gate = availability(state, action);
  if (!gate.available) return { rejected: true, note: gate.reason };

  const chance = odds(state, action);
  const r = seeded(`${state.scenario.presidentName}|${actionId}|${state.month}`);
  const passed = r.between(1, 100) <= chance;

  const next = structuredClone(state);
  next.specialActions = next.specialActions || emptyLedger();
  next.specialActions.attempts[actionId] = (next.specialActions.attempts[actionId] || 0) + 1;

  if (!passed) {
    // A failed floor vote burns capital and emboldens the opposition.
    next.approval = clamp(round1(next.approval - 2.2));
    next.stability = clamp(next.stability - 3);
    next.specialActions.log.unshift({
      month: state.month, id: actionId, title: action.title, outcome: "failed",
      note: `Failed on the floor. ${chance}% was the read going in.`,
    });
    return { state: next, passed: false, chance,
      note: `${action.title} failed in Congress. You spent capital and got nothing for it.` };
  }

  if (action.kind === "amendment") {
    next.specialActions.pending = {
      id: actionId, title: action.title, proposedMonth: state.month,
      deadline: state.month + AMENDMENT_MONTHS, ratified: 0, needed: STATES_NEEDED,
    };
    next.approval = clamp(round1(next.approval + 1.4));
    next.specialActions.log.unshift({
      month: state.month, id: actionId, title: action.title, outcome: "to_states",
      note: `Cleared both chambers. ${STATES_NEEDED} states in ${AMENDMENT_MONTHS} months.`,
    });
    return { state: next, passed: true, chance, toStates: true,
      note: `${action.title} cleared both chambers by two-thirds. It now goes to the states — ${STATES_NEEDED} needed within ${AMENDMENT_MONTHS} months.` };
  }

  applyEnacted(next, action);
  next.specialActions.passed.push(actionId);
  next.specialActions.log.unshift({
    month: state.month, id: actionId, title: action.title, outcome: "enacted", note: "Signed into law.",
  });
  return { state: next, passed: true, chance, note: `${action.title} — done.` };
}

/** The mechanical consequence of each structural reform. */
function applyEnacted(next, action) {
  switch (action.id) {
    case "abolish_filibuster":
      next.specialActions.filibusterGone = true;
      next.stability = clamp(next.stability - 4);
      break;
    case "dc_statehood":
    case "pr_statehood":
      // A new state's senators arrive caucusing with somebody.
      next.congress.senateD += action.id === "dc_statehood" ? 2 : 1;
      next.congress.senateR += action.id === "dc_statehood" ? 0 : 1;
      next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights + 8);
      break;
    case "expand_court": {
      const sign = next.scenario.party === "Republican" ? 1 : -1;
      if (sign > 0) next.court.conservative += 2; else next.court.liberal += 2;
      next.stability = clamp(next.stability - 8);
      next.approval = clamp(round1(next.approval - 1.5));
      break;
    }
    default:
      break;
  }
}

/** Ratification runs in the background, a few states a month. */
export function tickSpecialActions(next) {
  const ledger = next.specialActions;
  const pending = ledger?.pending;
  if (!pending) return null;

  const action = actionById(pending.id);
  const r = seeded(`${next.scenario.presidentName}|${pending.id}|ratify|${next.month}`);

  // Momentum tracks the president: unpopular amendments stall in the states.
  const pace = Math.max(0, (next.approval - 38) / 8) * (1 - (action?.difficulty ?? 0.5) * 0.6);
  pending.ratified = Math.min(pending.needed, pending.ratified + r.between(0, Math.ceil(pace)));

  if (pending.ratified >= pending.needed) {
    ledger.pending = null;
    ledger.passed.push(pending.id);
    if (pending.id === "repeal_22") ledger.termLimitGone = true;
    next.approval = clamp(round1(next.approval + 2.5));
    ledger.log.unshift({
      month: next.month, id: pending.id, title: pending.title, outcome: "ratified",
      note: `Ratified by ${pending.needed} states.`,
    });
    return { kind: "ratified", title: pending.title };
  }

  if (next.month >= pending.deadline) {
    ledger.pending = null;
    next.approval = clamp(round1(next.approval - 1.8));
    ledger.log.unshift({
      month: next.month, id: pending.id, title: pending.title, outcome: "expired",
      note: `Died in the states at ${pending.ratified} of ${pending.needed}.`,
    });
    return { kind: "expired", title: pending.title, ratified: pending.ratified };
  }
  return { kind: "pending", title: pending.title, ratified: pending.ratified, needed: pending.needed };
}

export function emptyLedger() {
  return {
    passed: [], attempts: {}, log: [], pending: null,
    filibusterGone: false, termLimitGone: false,
  };
}
