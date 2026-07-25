import { seeded, clamp, round1 } from "./rng.js";
import { PERSONAS } from "./personas.js";
import { buildCourt } from "../public/js/data/government.js";

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
    id: "repeal_19",
    group: "Constitutional amendments",
    title: "Repeal the 19th Amendment",
    desc: "Strip women of the federal vote. Female voters stop being polled, stop counting at the ballot box, and vanish from the focus group.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    // Effectively impossible, and ruinous to attempt. That is the design.
    difficulty: 0.98,
    approvalFloor: 72,
    franchise: "f",
  },
  {
    id: "strengthen_19",
    group: "Constitutional amendments",
    title: "Strengthen the 19th Amendment",
    desc: "Restrict the federal vote to women only. Male voters stop being polled, stop counting at the ballot box, and vanish from the focus group.",
    requirement: "Two-thirds of both chambers, then 38 states within 9 months",
    kind: "amendment",
    difficulty: 0.98,
    approvalFloor: 72,
    franchise: "m",
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
  {
    id: "dissolve_congress",
    group: "Structural reform",
    title: "Dissolve Congress",
    desc: "Padlock the Capitol and rule by decree. Congress gets no vote on its own abolition — this stands only if the military is firmly behind you, and the republic never forgives it.",
    requirement: "The Pentagon and the veterans must be solidly yours, and the government steady enough to execute. One attempt per term.",
    kind: "coup",
    difficulty: 0.9,
    approvalFloor: 0,
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
  if (state.congressDissolved && action.kind !== "coup") {
    return { available: false, reason: "There is no Congress left to pass it." };
  }

  // The franchise can only be taken from one side, and only once.
  if (action.franchise) {
    if (state.electorate?.excluded) return { available: false, reason: "The franchise has already been rewritten." };
  }

  // A coup is gated on the men with the guns, not on the polls.
  if (action.kind === "coup") {
    if (state.congressDissolved) return { available: false, reason: "Congress is already dissolved." };
    if (attempts >= 1) return { available: false, reason: "One attempt per term, and you have used it." };
    if (state.stakeholders.pentagon < 75) {
      return { available: false, reason: `The Pentagon is at ${state.stakeholders.pentagon}. It would have to be 75 or better.` };
    }
    if (state.stability < 55) {
      return { available: false, reason: `Government stability is ${state.stability}. Below 55 the order would not be carried out.` };
    }
    return { available: true };
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
  if (action.kind === "coup") {
    // Only the loyalty of the armed forces and the machinery of state matter.
    const pentagon = state.stakeholders.pentagon;
    const jointChiefs = state.institutions?.joint_chiefs;
    const chiefsLoyalty = jointChiefs && !jointChiefs.vacant ? jointChiefs.holder.loyalty : 30;
    return clamp(Math.round(
      (pentagon - 75) * 2.2 + (state.stability - 55) * 1.1 + (chiefsLoyalty - 50) * 0.8 + 10
    ), 3, 92);
  }

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

  // A coup is not a vote. It either happens or it ends your presidency.
  if (action.kind === "coup") return attemptCoup(next, action, passed, chance);

  if (!passed) {
    // A failed floor vote burns capital and emboldens the opposition.
    next.approval = clamp(round1(next.approval - 2.2));
    next.stability = clamp(next.stability - 3);
    // Trying to take the vote from half the country and failing is not a
    // normal legislative defeat.
    if (action.franchise) {
      next.approval = clamp(round1(next.approval - 12));
      next.stability = clamp(next.stability - 18);
      next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - 30);
      if (next.society) next.society.unrest = clamp(next.society.unrest + 25);
    }
    next.specialActions.log.unshift({
      month: state.month, id: actionId, title: action.title, outcome: "failed",
      note: `Failed on the floor. ${chance}% was the read going in.`,
    });
    return { state: next, passed: false, chance,
      note: action.franchise
        ? `${action.title} failed, and the attempt itself is now the only thing anyone will remember about your presidency.`
        : `${action.title} failed in Congress. You spent capital and got nothing for it.` };
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

/**
 * Dissolving Congress. There is no floor vote — the order is either carried
 * out or it is refused, and a refused order is the end of the presidency.
 */
function attemptCoup(next, action, succeeded, chance) {
  next.specialActions.log.unshift({
    month: next.month, id: action.id, title: action.title,
    outcome: succeeded ? "enacted" : "failed",
    note: succeeded ? "The Capitol was padlocked." : "The order was refused.",
  });

  if (!succeeded) {
    next.over = true;
    next.ending = {
      type: "removed",
      reason: "You ordered the Capitol closed and the Joint Chiefs refused. " +
        "Within six hours you were in custody, and the republic held — barely.",
    };
    return { state: next, passed: false, chance, note: "The order was refused. Your presidency is over." };
  }

  next.congressDissolved = true;
  next.specialActions.passed.push(action.id);
  next.congress = { houseD: 0, houseR: 0, senateD: 0, senateR: 0 };
  next.approval = clamp(round1(next.approval - 18));
  next.stability = clamp(next.stability - 25);
  next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - 40);
  next.stakeholders.wall_street = clamp(next.stakeholders.wall_street - 20);
  next.stakeholders.big_business = clamp(next.stakeholders.big_business - 15);
  if (next.society) next.society.unrest = clamp(next.society.unrest + 40);

  return {
    state: next, passed: true, chance,
    note: "The Capitol is padlocked and you rule by decree. Nothing stops you now, " +
      "and nothing protects you either — the only thing holding your government up is the army.",
  };
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
      // Two new justices means two new names on the bench.
      next.justices = buildCourt({
        seed: next.rosterSeed || next.scenario.presidentName,
        court: next.court,
        radical: next.scenario.radicals === true,
      });
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
    if (action?.franchise) applyFranchise(next, action);
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

/**
 * Remove a bloc from the electorate.
 *
 * Approval is a number about *the people who count*, so cutting half of them
 * out re-bases it: the president's standing shifts toward the average lean of
 * whoever is left. Everything else here is the cost of having done it.
 */
function applyFranchise(next, action) {
  const excluded = action.franchise;
  next.electorate = { excluded, since: next.month };

  const remaining = PERSONAS.filter((p) => p.sex !== excluded);
  const removed = PERSONAS.filter((p) => p.sex === excluded);
  if (remaining.length && removed.length) {
    const mean = (list) => list.reduce((sum, p) => sum + p.lean, 0) / list.length;
    const sign = next.scenario.party === "Republican" ? 1 : next.scenario.party === "Democrat" ? -1 : 0;
    // A president gains where the surviving electorate agrees with them.
    const shift = (mean(remaining) - mean(PERSONAS)) * sign * 22;
    next.approval = clamp(round1(next.approval + shift));
    for (const code of Object.keys(next.stateApproval)) {
      next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + shift));
    }
  }

  // And the bill for it.
  next.stability = clamp(next.stability - 30);
  next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - 45);
  next.stakeholders.labor = clamp(next.stakeholders.labor - 20);
  next.stakeholders.big_business = clamp(next.stakeholders.big_business - 15);
  if (next.society) {
    next.society.unrest = clamp(next.society.unrest + 45);
    next.society.literacy = clamp(next.society.literacy - 2, 40, 100);
  }
}

export function emptyLedger() {
  return {
    passed: [], attempts: {}, log: [], pending: null,
    filibusterGone: false, termLimitGone: false,
  };
}
