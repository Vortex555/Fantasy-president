import { clamp, round1, seeded } from "./rng.js";
import { committeeById } from "./committees.js";

/**
 * The half of the job nobody writes a story about.
 *
 * Everything the mode could do happened in Washington: vote, file, whip, bury,
 * hold a hearing. A member's district existed only as a number that judged them
 * — an approval rating that moved when they voted and could not be worked on
 * directly — which leaves out the thing congressional offices actually spend
 * most of their staff time doing.
 *
 * Casework is chasing a veteran's benefits, a stuck passport, a social security
 * error. It is unglamorous, it is constant, and it is a large part of why
 * incumbents are hard to beat: it buys goodwill that has nothing to do with how
 * you voted, from people who may disagree with every vote you cast.
 *
 * Its cost is the honest one. Time in the district is time not in the building,
 * and a member who is always home is a member who is not in the room when the
 * favours are handed out. So casework trades standing with your caucus for
 * standing with the people who actually re-elect you — which is the mode's
 * founding tension, finally available as something you *do* rather than only as
 * a consequence of how you voted.
 */

/** How hard a month can be worked. Three days a week home is the real ceiling. */
export const MAX_CASEWORK = 3;

/** What each day home is worth at home, and what it costs in the building. */
const APPROVAL_PER_EFFORT = 1.9;
const LEADERSHIP_PER_EFFORT = 0.7;

/**
 * A district that already loves you has fewer people left to help.
 *
 * Diminishing against your current standing, so casework is how a member in
 * trouble digs out and not how a safe member becomes untouchable.
 */
const ceilingPull = (approval) => clamp((88 - approval) / 40, 0.15, 1.3);

export function doCasework(state, effort = 1) {
  if (state.caseworkThisMonth) {
    return { rejected: true, note: "Your office has done what it can this month. The queue is not infinite and neither are your staff." };
  }
  const days = Math.max(1, Math.min(MAX_CASEWORK, Math.round(Number(effort) || 1)));

  const gain = round1(days * APPROVAL_PER_EFFORT * ceilingPull(state.approval ?? 50));
  const cost = round1(days * LEADERSHIP_PER_EFFORT);

  const r = seeded(`${state.rosterSeed}|casework|${state.term || 1}|${state.month}`);
  const story = CASES[Math.floor(r.next() * CASES.length)];

  return {
    state: {
      ...state,
      approval: clamp(round1((state.approval ?? 50) + gain)),
      leadership: clamp(round1(state.leadership - cost)),
      caseworkThisMonth: true,
      casework: round1((state.casework ?? 0) + days),
    },
    note: `${story} ${gain >= 3 ? "Word gets round a place like this." : "One family, and they will tell four more."}`,
    gain, cost,
  };
}

/** The cases themselves, because a number with no story attached is a number. */
const CASES = [
  "Your office got a widow's survivor benefit unstuck after fourteen months.",
  "A veteran had been refused three times. Your staff found the form nobody had filed.",
  "You got a passport issued in four days for a funeral abroad.",
  "A family farm's disaster payment had been sitting in a queue since spring. It is not sitting there now.",
  "Somebody's disability claim was denied for a typo in their own name. Your office fixed it in a morning.",
  "A shuttered clinic's federal grant was reinstated because your staff would not stop calling.",
];

export const resetCasework = (state) => ({ ...state, caseworkThisMonth: false });

/**
 * Money for the district, which is the other half and the one with a price.
 *
 * Earmarks were banned in 2011 and came back in 2021 under a politer name, and
 * they are the most direct thing a member can hand their voters: a bridge, a
 * clinic, a water system with your name somewhere on the paperwork. They cost
 * favours, because the money is allocated by people who will want something, and
 * they are gated by the committee that actually holds the purse.
 */
export const EARMARK_COST = 8;
const EARMARK_COMMITTEES = new Set(["appropriations", "ways_means", "budget", "energy_commerce"]);

export const canEarmark = (state) =>
  EARMARK_COMMITTEES.has(state?.committee) || ["chair", "speaker", "whip"].includes(state?.rank);

export function requestEarmark(state) {
  if (!canEarmark(state)) {
    return { rejected: true, note: "You are not on a committee that writes the cheques, and nobody is putting your district in a bill as a favour." };
  }
  if (state.earmarkThisTerm) {
    return { rejected: true, note: "You have had your project this Congress. Asking twice is how members stop getting one." };
  }
  if ((state.capital ?? 0) < EARMARK_COST) {
    return { rejected: true, note: `A project costs ${EARMARK_COST} favours and you are owed fewer. This is exactly what they were for.` };
  }

  const r = seeded(`${state.rosterSeed}|earmark|${state.term || 1}`);
  const project = PROJECTS[Math.floor(r.next() * PROJECTS.length)];
  const gain = round1(6 * ceilingPull(state.approval ?? 50));

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - EARMARK_COST)),
      approval: clamp(round1((state.approval ?? 50) + gain)),
      earmarkThisTerm: true,
      earmarks: [...(state.earmarks || []), { term: state.term || 1, month: state.month, project }],
    },
    note: `${project} Your name is on the paperwork and the local paper ran it above the fold.`,
    gain,
  };
}

const PROJECTS = [
  "Forty million for the bypass that has been “under review” since your predecessor.",
  "A rural broadband build-out reaching eleven thousand households that had nothing.",
  "The lock and dam repair the barge operators have asked four members for.",
  "A new wing on the veterans' clinic, and the staffing to open it.",
  "Replacement of the water mains that have been failing since the seventies.",
];

/** A new Congress is a new project. */
export const resetEarmarks = (state) => ({ ...state, earmarkThisTerm: false });
