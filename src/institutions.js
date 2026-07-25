import { seeded, clamp, round1 } from "./rng.js";

/**
 * Institutional positions — the offices a president inherits rather than
 * chooses, and can only replace at a price.
 *
 * Each holder has three numbers that pull against each other:
 *   competence   — how well the institution actually runs
 *   loyalty      — whether they protect the President
 *   independence — how much the country believes they are nobody's creature
 *
 * Independence is the trap. A highly independent holder is the one whose
 * dismissal becomes a constitutional crisis, and also the one whose backing is
 * worth something. Stacking every post with loyalists works, right up until it
 * doesn't.
 */

export const INSTITUTIONS = [
  {
    id: "fed", title: "Fed Chair", term: 48,
    remit: "interest rates, inflation and the health of the banking system",
    vacancyNote: "With no Fed chair, markets price in the uncertainty every single month.",
  },
  {
    id: "fbi", title: "FBI Director", term: 120,
    remit: "federal law enforcement, and any investigation that touches this administration",
    vacancyNote: "An acting director runs the Bureau, and nobody in it is sure who they answer to.",
  },
  {
    id: "dni", title: "Director of National Intelligence", term: 48,
    remit: "the intelligence community and what the President is told each morning",
    vacancyNote: "The morning brief is being assembled by committee, and it shows.",
  },
  {
    id: "joint_chiefs", title: "Joint Chiefs", term: 48,
    remit: "military advice, force posture and the chain of command",
    vacancyNote: "The Pentagon is running on an acting chairman and its own momentum.",
  },
  {
    id: "surgeon_general", title: "Surgeon General", term: 48,
    remit: "public-health guidance the country may or may not follow",
    vacancyNote: "There is no public-health voice with a podium of its own.",
  },
];

const FIRST = ["Adele", "Marcus", "Priya", "Curtis", "Ingrid", "Rafael", "Naomi", "Desmond",
  "Yara", "Gordon", "Beatriz", "Elias", "Tabitha", "Hiroshi", "Colette", "Amara"];
const LAST = ["Pemberton", "Achebe", "Vance", "Lindqvist", "Ferraro", "Okonjo", "Brightwater",
  "Halloran", "Nakashima", "Ferreira", "Adeyemi", "Stroud", "Cardoza", "Whitlock"];

/** A plausible holder, seeded so a given career always inherits the same bench. */
function makeHolder(seed, { loyaltyFloor = 20, independenceFloor = 35 } = {}) {
  const r = seeded(seed);
  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    competence: r.between(58, 92),
    loyalty: r.between(loyaltyFloor, loyaltyFloor + 45),
    independence: r.between(independenceFloor, independenceFloor + 45),
  };
}

/**
 * The bench a new president walks in on. Inherited holders are part-way
 * through their terms, which is why some seats come up mid-presidency.
 */
export function buildInstitutions(scenario) {
  const out = {};
  for (const inst of INSTITUTIONS) {
    const r = seeded(`${scenario.presidentName}|${inst.id}|${scenario.startYear}`);
    // Roughly one seat in six is already empty on day one.
    const vacant = r.chance(0.18);
    out[inst.id] = vacant
      ? { vacant: true, monthsRemaining: 0, holder: null, actingSince: 1 }
      : {
          vacant: false,
          holder: makeHolder(`${scenario.presidentName}|${inst.id}|holder`),
          monthsRemaining: r.between(2, inst.term),
          appointedByYou: false,
        };
  }
  return out;
}

const def = (id) => INSTITUTIONS.find((i) => i.id === id);

/** Three candidates per vacancy, each a different bargain. */
export function candidatesFor(state, institutionId) {
  const inst = def(institutionId);
  if (!inst) return [];
  const seed = `${state.scenario.presidentName}|${institutionId}|${state.month}|slate`;

  return [
    {
      key: "loyalist",
      ...makeHolder(`${seed}|loyalist`, { loyaltyFloor: 62, independenceFloor: 10 }),
      pitch: "Will not surprise you. The Senate knows exactly why you picked them, and so does the press.",
    },
    {
      key: "professional",
      ...makeHolder(`${seed}|professional`, { loyaltyFloor: 38, independenceFloor: 45 }),
      pitch: "A career appointment. Confirms easily, runs the place well, and will tell you no in writing.",
    },
    {
      key: "independent",
      ...makeHolder(`${seed}|independent`, { loyaltyFloor: 12, independenceFloor: 62 }),
      pitch: "Nobody's creature, and everybody knows it. Costs you control and buys you credibility.",
    },
  ].map((c) => ({ ...c, institutionId, confirmOdds: confirmOdds(state, c) }));
}

/**
 * Confirmation is a Senate problem. An independent nominee clears easily; a
 * transparent loyalist needs the votes to be there.
 */
function confirmOdds(state, candidate) {
  const party = state.scenario.party;
  const mine = party === "Republican" ? state.congress.senateR
    : party === "Democrat" ? state.congress.senateD : 50;
  const base = 34 + (mine - 50) * 2.2;
  const merit = (candidate.competence - 60) * 0.5 + (candidate.independence - 40) * 0.55;
  return clamp(Math.round(base + merit), 5, 97);
}

/** Nominate someone to a vacant seat. */
export function appoint(state, institutionId, candidateKey) {
  const inst = def(institutionId);
  const seat = state.institutions?.[institutionId];
  if (!inst || !seat) return { rejected: true, note: "No such office." };
  if (!seat.vacant) return { rejected: true, note: `The ${inst.title} seat is not vacant.` };

  const candidate = candidatesFor(state, institutionId).find((c) => c.key === candidateKey);
  if (!candidate) return { rejected: true, note: "No such nominee." };

  const r = seeded(`${state.scenario.presidentName}|${institutionId}|${state.month}|vote`);
  const confirmed = r.between(1, 100) <= candidate.confirmOdds;
  const next = structuredClone(state);

  if (!confirmed) {
    // A failed nomination is a visible defeat, and the seat stays empty.
    next.approval = clamp(round1(next.approval - 1.2));
    next.stability = clamp(next.stability - 2);
    return {
      state: next, confirmed: false,
      note: `The Senate rejected ${candidate.name} for ${inst.title}. The seat stays empty and the defeat is the story.`,
    };
  }

  next.institutions[institutionId] = {
    vacant: false,
    holder: {
      name: candidate.name,
      competence: candidate.competence,
      loyalty: candidate.loyalty,
      independence: candidate.independence,
    },
    monthsRemaining: inst.term,
    appointedByYou: true,
  };
  next.stability = clamp(next.stability + 3);
  next.approval = clamp(round1(next.approval + (candidate.independence >= 60 ? 0.8 : 0.2)));

  return {
    state: next, confirmed: true,
    note: `${candidate.name} was confirmed as ${inst.title}. Competence ${candidate.competence}, loyalty ${candidate.loyalty}, independence ${candidate.independence}.`,
  };
}

/**
 * Remove a holder. The cost scales with how independent the country believed
 * they were — sacking a nobody is housekeeping, sacking an institution is a
 * crisis.
 */
export function dismiss(state, institutionId) {
  const inst = def(institutionId);
  const seat = state.institutions?.[institutionId];
  if (!inst || !seat) return { rejected: true, note: "No such office." };
  if (seat.vacant) return { rejected: true, note: `The ${inst.title} seat is already vacant.` };

  const holder = seat.holder;
  const next = structuredClone(state);
  const outrage = holder.independence / 100;

  next.institutions[institutionId] = {
    vacant: true, holder: null, monthsRemaining: 0, actingSince: state.month,
  };
  next.approval = clamp(round1(next.approval - (1.5 + outrage * 5)));
  next.stability = clamp(next.stability - Math.round(4 + outrage * 14));

  // Firing the Fed rattles markets; firing the FBI rattles the rule of law.
  if (institutionId === "fed") {
    next.economy.inflation = round1(next.economy.inflation + 0.4 + outrage);
    next.stakeholders.wall_street = clamp(next.stakeholders.wall_street - Math.round(6 + outrage * 12));
  }
  if (institutionId === "fbi") {
    next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - Math.round(4 + outrage * 10));
    // Removing the investigator while the investigation is open is its own
    // offence. impeachment.js turns this flag into an article next month.
    if (next.jeopardy?.investigation) next.jeopardy.obstructed = true;
  }
  if (institutionId === "joint_chiefs") {
    next.stakeholders.pentagon = clamp(next.stakeholders.pentagon - Math.round(5 + outrage * 12));
  }

  const note = holder.independence >= 60
    ? `You dismissed ${holder.name} as ${inst.title}. They were widely seen as independent, and removing them reads as exactly what it is.`
    : `You dismissed ${holder.name} as ${inst.title}. The seat is vacant until the Senate confirms a replacement.`;

  return { state: next, note, fired: { name: holder.name, title: inst.title } };
}

/** One month of terms running down, and what an empty chair costs. */
export function tickInstitutions(next) {
  if (!next.institutions) return;
  let stabilityDrag = 0;

  for (const inst of INSTITUTIONS) {
    const seat = next.institutions[inst.id];
    if (!seat) continue;

    if (seat.vacant) {
      stabilityDrag += 0.8;
      continue;
    }
    seat.monthsRemaining = Math.max(0, seat.monthsRemaining - 1);
    if (seat.monthsRemaining === 0) {
      next.institutions[inst.id] = {
        vacant: true, holder: null, monthsRemaining: 0, actingSince: next.month, expired: true,
      };
    }
  }

  // A competent, independent Fed quietly does its job on inflation.
  const fed = next.institutions.fed;
  if (fed && !fed.vacant && next.scenario.economy !== false) {
    const skill = (fed.holder.competence - 60) / 100 + (fed.holder.independence - 45) / 160;
    next.economy.inflation = round1(clamp(next.economy.inflation - skill * 0.25, -3, 40));
  }

  next.stability = clamp(Math.round(next.stability - stabilityDrag));
}

/** A one-line status per seat, for the AI's context block. */
export function institutionsSummary(state) {
  if (!state.institutions) return "";
  return INSTITUTIONS.map((inst) => {
    const seat = state.institutions[inst.id];
    if (!seat) return null;
    if (seat.vacant) return `${inst.title}: VACANT`;
    const h = seat.holder;
    return `${inst.title}: ${h.name} (competence ${h.competence}, loyalty ${h.loyalty}, independence ${h.independence}, ${seat.monthsRemaining} mo left)`;
  }).filter(Boolean).join("\n");
}
