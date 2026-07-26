import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { buildCongress } from "../public/js/data/government.js";
import { findIdeology } from "../public/js/data/ideologies.js";
import { emptyJeopardy } from "./impeachment.js";

/**
 * Succession, the Twenty-Fifth Amendment, and the casting vote.
 *
 * Three things that all turn on the same person. The Vice President has spent
 * this whole game as a name with two numbers attached, consulted before
 * decisions and otherwise inert. Here they become the reason those numbers
 * matter: they break ties in the Senate, they are the only lawful way the
 * cabinet can remove a president who has not committed a crime, and they are
 * what stands between losing the office and losing the career.
 *
 * The design rule: a presidency ending is not the game ending. The country
 * carries on — the same economy, the same unfinished business, the same
 * Congress and the same scars — under somebody new, who now has to live with
 * what their predecessor did.
 */

/** Ways of leaving office that pass the office along rather than closing it. */
export const SUCCESSION_ENDINGS = new Set(["removed", "resigned", "collapse", "incapacitated"]);

/** Two thirds of both chambers, to keep the Vice President in charge. */
export const TWENTY_FIFTH_SUSTAIN = 2 / 3;

/**
 * How far apart a bill and the administration can be before the Vice President
 * will not cast a tie-breaking vote for it.
 */
const VP_AGREEMENT = 0.5;

// --- Who the Vice President is ---------------------------------------------

export function vicePresident(state) {
  return (state?.cabinet || []).find((c) => c.id === "vp") || null;
}

/** Whether the President has a casting vote in a tied Senate. */
export function hasTieBreak(state) {
  return Boolean(vicePresident(state));
}

const presidentAxisOf = (state) => {
  const axis = Number(state?.scenario?.ideologyAxis);
  if (Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
  return state?.scenario?.party === "Republican" ? 0.45
    : state?.scenario?.party === "Democrat" ? -0.45 : 0;
};

/**
 * Whether the Vice President would actually vote for this.
 *
 * A casting vote is not automatic support for whatever Congress sends up — the
 * Vice President votes the administration's line, so a bill from the far end of
 * the spectrum dies on a tie rather than passing on one.
 */
export function vpSupports(state, axis) {
  if (!hasTieBreak(state)) return false;
  const billAxis = Number(axis);
  if (!Number.isFinite(billAxis)) return false;
  return Math.abs(billAxis - presidentAxisOf(state)) < VP_AGREEMENT;
}

// --- Succession -------------------------------------------------------------

/**
 * Whether this ending hands the office on. An election result does not — the
 * country chose somebody else, and there is nothing to succeed to. Neither does
 * an ending reached with the Capitol padlocked, because by then there is no
 * constitutional order left to carry anyone into office.
 */
export function canSucceed(state, ending) {
  if (!ending || !SUCCESSION_ENDINGS.has(ending.type)) return false;
  if (state?.congressDissolved) return false;
  return Boolean(vicePresident(state));
}

const FIRST = ["Adele", "Marcus", "Priya", "Curtis", "Ingrid", "Rafael", "Naomi", "Desmond",
  "Yara", "Gordon", "Beatriz", "Elias", "Tabitha", "Hiroshi", "Colette", "Amara"];
const LAST = ["Pemberton", "Achebe", "Vance", "Lindqvist", "Ferraro", "Okonjo", "Brightwater",
  "Halloran", "Nakashima", "Ferreira", "Adeyemi", "Stroud", "Cardoza", "Whitlock"];

/**
 * Swear in the Vice President.
 *
 * The term does not restart — a successor serves out what is left of somebody
 * else's four years, which is exactly what makes inheriting a wrecked
 * presidency at month 40 different from inheriting one at month 6.
 */
export function succeed(state, ending) {
  const next = structuredClone(state);
  const vp = vicePresident(next);
  const outgoing = next.scenario.presidentName;
  const r = seeded(`${outgoing}|succession|${next.term || 1}|${next.month}`);

  // The record of who was here before, and how it ended for them.
  next.formerPresidents = [...(next.formerPresidents || []), {
    name: outgoing,
    party: next.scenario.party,
    ideology: next.scenario.ideology || "",
    term: next.term || 1,
    leftMonth: next.month,
    finalApproval: round1(next.approval),
    ending: { type: ending.type, reason: ending.reason },
  }];

  // The new president is the Vice President — same party, their own politics.
  const axis = findIdeology(next.scenario.party, vp.ideology)?.axis;
  next.scenario = {
    ...next.scenario,
    presidentName: vp.name,
    ideology: vp.ideology || next.scenario.ideology,
    ideologyAxis: Number.isFinite(axis) ? axis : next.scenario.ideologyAxis,
    profile: vp.persona || next.scenario.profile,
  };
  // The roster seed is what derives Congress and the bench; it must not move,
  // or 535 members would change identity the moment the President did.

  /**
   * How much of the old president's standing carries. A successor is neither
   * blamed for their predecessor nor credited with them: the country mostly
   * resets to "we do not know this person yet" and then finds out.
   */
  next.approval = clamp(round1(next.approval * 0.35 + 50 * 0.65));
  // A different politician means a different map, drawn from where they stand.
  for (const code of STATE_CODES) {
    const lean = STATES[code]?.lean ?? 0;
    next.stateApproval[code] = clamp(round1(next.approval + presidentAxisOf(next) * lean * 0.55));
  }
  // A transfer of power is steadying in itself — the crisis has an answer now.
  next.stability = clamp(next.stability + 12);

  // The case was against the last president. It does not follow the office.
  next.jeopardy = emptyJeopardy();

  // Donors reassess when the principal changes.
  next.warChest = round1((next.warChest ?? 0) * 0.5);

  // The Twenty-Fifth requires a new Vice President, confirmed by both chambers.
  // The cabinet stays in post but their loyalty is to somebody else now.
  const usedFirst = new Set(next.cabinet.map((c) => c.name.split(" ")[0]));
  const usedLast = new Set(next.cabinet.map((c) => c.name.split(" ").slice(-1)[0]));
  const pick = (pool, used) => {
    for (let i = 0; i < 30; i++) {
      const name = r.pick(pool);
      if (!used.has(name)) { used.add(name); return name; }
    }
    return r.pick(pool);
  };
  for (const member of next.cabinet) {
    if (member.id === "vp") {
      member.name = `${pick(FIRST, usedFirst)} ${pick(LAST, usedLast)}`;
      member.loyalty = r.between(64, 94);
      member.competence = r.between(48, 88);
      continue;
    }
    if (member.id === "spouse") continue; // the new president's own family
    member.loyalty = r.between(45, 88);
  }

  // The Twenty-Second Amendment: a successor who serves more than half of
  // somebody else's term may only be elected once in their own right.
  const clock = state.termLength || 48;
  next.succeeded = {
    from: outgoing,
    month: next.month,
    term: next.term || 1,
    // Months of the predecessor's term this president will have served.
    inheritedMonths: clock - next.month + 1,
  };

  next.over = false;
  next.ending = null;
  next.phase = null;
  next.twentyFifth = null;

  next.history.push({
    month: next.month,
    term: next.term || 1,
    succession: true,
    headline: `${vp.name} sworn in as President`,
    approval: next.approval,
    approvalChange: 0,
  });

  return next;
}

// --- The Twenty-Fifth Amendment ---------------------------------------------

/**
 * Section 4. The Vice President and a majority of the cabinet may declare the
 * President unable to discharge the powers of the office.
 *
 * There are three locks, and all three have to be open. The Vice President has
 * to be willing to lead it — a loyal one never will, which is what the running
 * mate's loyalty score has been quietly buying all game. A majority of the
 * cabinet has to sign. And the presidency has to be visibly failing, because a
 * cabinet that dislikes a *functioning* president has no cover for this.
 */
const VP_WILLING = 45;        // above this the VP will not lead it
const SIGNATORY_LOYALTY = 45; // below this a secretary will sign
const FAILING_STABILITY = 35;
const FAILING_APPROVAL = 32;

/**
 * How close the cabinet is to moving, as something the player can be shown.
 *
 * A declaration must never be an ambush. Every one of the three locks is
 * legible on the dashboard before it turns, so a president who is losing their
 * cabinet can see it and do something — replace the signatories, or rebuild
 * with the people they have.
 */
export function twentyFifthRisk(state) {
  const s = twentyFifthStanding(state);
  if (!s.vp || state.congressDissolved) return { level: "none", ...s };

  const locks = [s.vpWilling, s.majority, s.failing].filter(Boolean).length;
  const level = locks === 3 ? "imminent" : locks === 2 ? "serious" : locks === 1 ? "watch" : "none";
  return { level, locks, ...s };
}

export function twentyFifthStanding(state) {
  const vp = vicePresident(state);
  const cabinet = (state.cabinet || []).filter((c) => c.id !== "vp" && c.id !== "spouse");
  const forIt = cabinet.filter((c) => c.loyalty < SIGNATORY_LOYALTY).length;

  return {
    vp,
    vpWilling: Boolean(vp) && vp.loyalty < VP_WILLING,
    cabinetFor: forIt,
    cabinetAgainst: cabinet.length - forIt,
    majority: forIt > cabinet.length / 2,
    failing: (state.stability ?? 100) < FAILING_STABILITY
      && (state.approval ?? 100) < FAILING_APPROVAL,
  };
}

/**
 * One month of the cabinet deciding whether to move. Mutates `next` and
 * returns the event worth telling the player about, if anything happened.
 */
export function tickTwentyFifth(next) {
  if (next.phase === "twentyfifth" || next.congressDissolved || next.over) return null;
  const standing = twentyFifthStanding(next);
  if (!standing.vpWilling || !standing.majority || !standing.failing) return null;

  // Even with every lock open this is an extraordinary step, so it is a roll
  // rather than a certainty — and the worse it gets, the likelier it becomes.
  const desperation = (FAILING_STABILITY - next.stability) / FAILING_STABILITY;
  const chance = Math.min(0.4, 0.08 + desperation * 0.45);
  if (!seeded(`${next.rosterSeed}|25th|${next.term || 1}|${next.month}`).chance(chance)) return null;

  next.phase = "twentyfifth";
  next.twentyFifth = {
    declaredMonth: next.month,
    vpName: standing.vp.name,
    cabinetFor: standing.cabinetFor,
    cabinetAgainst: standing.cabinetAgainst,
  };
  return {
    kind: "declared",
    detail: `${standing.vp.name} and ${standing.cabinetFor} members of your cabinet have signed a ` +
      `declaration that you are unable to discharge the powers of the office.`,
  };
}

/**
 * The President's answer.
 *
 * Stepping aside hands the office over. Contesting it sends the question to
 * Congress, where the Constitution sets a deliberately brutal bar: the Vice
 * President stays in charge only on two thirds of *both* chambers. Anything
 * less and the President resumes — which means contesting is usually right,
 * and the cost of being right is that everyone saw it happen.
 */
export function resolveTwentyFifth(state, action) {
  const declaration = state.twentyFifth;
  if (state.phase !== "twentyfifth" || !declaration) {
    return { state, rejected: true, note: "There is no declaration to answer." };
  }

  if (action === "step_aside") {
    const next = succeed(state, {
      type: "incapacitated",
      reason: `You accepted the cabinet's declaration and stood down. ${declaration.vpName} was ` +
        `sworn in the same afternoon.`,
    });
    return { state: next, result: { contested: false, sustained: true } };
  }

  const roster = buildCongress(state, STATES);
  const house = sustainVote(roster.house, state, declaration);
  const senate = sustainVote(roster.senate, state, declaration);
  const sustained = house.yes >= house.needed && senate.yes >= senate.needed;
  const result = { contested: true, house, senate, sustained };

  if (sustained) {
    const next = succeed(state, {
      type: "incapacitated",
      reason: `You contested the cabinet's declaration and Congress sided with them — ` +
        `${house.yes}–${house.no} in the House and ${senate.yes}–${senate.no} in the Senate, ` +
        `both past the two thirds it takes. ${declaration.vpName} is President.`,
    });
    return { state: next, result };
  }

  // The President resumes. They are still President, and everyone watched.
  const next = structuredClone(state);
  next.phase = null;
  next.twentyFifth = null;
  next.approval = clamp(round1(next.approval - 3));
  next.stability = clamp(next.stability - 9);
  next.twentyFifthSurvived = (next.twentyFifthSurvived || 0) + 1;

  // A cabinet that tried and failed does not stay. The signatories go.
  const purged = [];
  const r = seeded(`${next.rosterSeed}|purge|${next.month}`);
  for (const member of next.cabinet) {
    if (member.id === "spouse") continue;
    if (member.id !== "vp" && member.loyalty >= SIGNATORY_LOYALTY) continue;
    purged.push({ name: member.name, role: member.role });
    member.name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    member.loyalty = r.between(70, 96);
    member.competence = r.between(38, 74);
  }
  next.cabinetChanges = purged.map((p) => p.role);
  result.purged = purged;

  next.history.push({
    month: next.month,
    term: next.term || 1,
    headline: "Survived a Twenty-Fifth Amendment declaration",
    approval: next.approval,
    approvalChange: -3,
  });

  return { state: next, result };
}

/**
 * How a chamber votes on sustaining the declaration.
 *
 * This is not a policy vote and it is not an impeachment either — there is no
 * crime alleged, only incapacity, so the opposition needs less persuading than
 * for a conviction and the President's own party needs far more. What decides
 * it is whether the President's own side has given up on them.
 */
function sustainVote(roster, state, declaration) {
  const party = state.scenario.party;
  const axis = presidentAxisOf(state);
  // Popularity is armour here exactly as it is at an impeachment trial.
  const armour = 0.45 + clamp(state.approval, 0, 100) / 160;
  // A cabinet that signed almost unanimously is itself evidence.
  const total = declaration.cabinetFor + declaration.cabinetAgainst;
  const evidence = total ? declaration.cabinetFor / total : 0.5;

  let yes = 0;
  for (const m of roster) {
    const opposition = m.party !== party;
    const loyalty = opposition ? 0 : (1 - Math.abs(m.axis - axis)) * armour;
    const spine = ((hashString(`${m.id}|25th`) % 1000) / 1000 - 0.5) * 0.5;
    const score = evidence - loyalty + (opposition ? 0.4 : 0) + spine;
    if (score > 0.5) yes += 1;
  }
  const seats = roster.length;
  return {
    yes, no: seats - yes, total: seats,
    needed: Math.ceil(seats * TWENTY_FIFTH_SUSTAIN),
  };
}
