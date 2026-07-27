import { clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";

/**
 * One political career, across every office it passes through.
 *
 * The office modules build completely different states — a House career has a
 * seat and a voting record, a presidency has a cabinet and fifty state polls —
 * and this is the layer that survives between them. Nothing here knows how an
 * office plays. It knows who you are, where you have been, and what that is
 * worth to the next electorate.
 *
 * The whole design turns on one idea: reaching past a rung is never *blocked*,
 * it is simply hard, because the four things a career carries — a record, a
 * name, money, and the party's opinion — are the four things a stranger asking
 * for a promotion does not have.
 */

/**
 * The rungs.
 *
 * A table rather than a switch, because the offices below the House — school
 * board, city council, mayor, state legislature, governor — are meant to be
 * additions here rather than rewrites everywhere else.
 */
export const LADDER = [
  { id: "house", title: "US Representative", termYears: 2, constituency: "district", minAge: 25 },
  { id: "senate", title: "US Senator", termYears: 6, constituency: "state", minAge: 30 },
  { id: "president", title: "President", termYears: 4, constituency: "nation", minAge: 35 },
];

export const officeAt = (id) => LADDER.find((o) => o.id === id) || null;
export const rungOf = (id) => LADDER.findIndex((o) => o.id === id);

// --- The calendar -----------------------------------------------------------

/**
 * The real one. Presidential elections land on years divisible by four, the
 * whole House stands every even year, and the midterms are the even years in
 * between. Every era the game ships begins the year after an election, which is
 * what an inauguration year is.
 */
export const isPresidentialYear = (year) => year % 4 === 0;
export const isMidtermYear = (year) => year % 2 === 0 && year % 4 !== 0;
export const isElectionYear = (year) => year % 2 === 0;

/**
 * The Senate needs more than the calendar. A state's two seats sit in different
 * classes, so which year a given seat is contested depends on the class it
 * belongs to — the classes rotate across three consecutive even years, which is
 * why a wave takes two cycles to finish working through the chamber.
 */
const SENATE_ROTATION = 6;

export function nextElectionYear(officeId, fromYear, seatClass = 1) {
  const start = Math.ceil(fromYear);

  if (officeId === "president") {
    const past = ((start % 4) + 4) % 4;
    return past === 0 ? start : start + (4 - past);
  }

  if (officeId === "senate") {
    const target = ((2 * seatClass) % SENATE_ROTATION + SENATE_ROTATION) % SENATE_ROTATION;
    let year = start % 2 === 0 ? start : start + 1;
    while (((year % SENATE_ROTATION) + SENATE_ROTATION) % SENATE_ROTATION !== target) year += 2;
    return year;
  }

  // The House, and every other rung: all of it, every even year.
  return start % 2 === 0 ? start : start + 1;
}

// --- What reaching costs ----------------------------------------------------

/**
 * Does reaching for this office cost you the seat you hold?
 *
 * Only when both are on the same ballot, which is exactly how it works: you
 * cannot appear twice on one November. A House member is therefore always
 * gambling — their term ends the same even year every Senate race is held — and
 * a senator or governor reaching mid-term risks nothing but time. That
 * asymmetry is the reason governors run for president so often, and it falls
 * out of the calendar rather than being asserted anywhere.
 */
export function ballotsCollide({ holding, seatClass = 1, targetOffice, year }) {
  if (!holding) return false;
  const mine = nextElectionYear(holding, year, seatClass);
  const theirs = nextElectionYear(targetOffice, year, seatClass);
  return mine === theirs;
}

/** Your age in a given year. Careers here run for decades, so this moves. */
export const ageAt = (career, year) => year - (career?.birthYear ?? year - 50);

/**
 * The constitutional floors, which are real and cheap to honour. A rung you are
 * too young for is still offered — with the reason — because being told the
 * Constitution says thirty is part of the game, and silently omitting the
 * option would read as a bug.
 */
export function eligibleFor(career, officeId, year) {
  const office = officeAt(officeId);
  if (!office) return { eligible: false, reason: "No such office." };

  const age = ageAt(career, year);
  if (age < office.minAge) {
    return {
      eligible: false,
      reason: `The Constitution sets ${office.minAge} as the minimum age for ${office.title}. You are ${age}.`,
    };
  }
  return { eligible: true, reason: null };
}

// --- The envelope -----------------------------------------------------------

/**
 * Turn the character profile's age band into a birth year, so that age is a
 * live number rather than a label. A career here can run thirty years.
 */
const AGE_BANDS = { "30s": 35, "40s": 45, "50s": 55, "60s": 62, "70s": 71 };

function birthYearFrom(scenario) {
  const explicit = Number(scenario?.customAge);
  const age = Number.isFinite(explicit) && explicit > 0
    ? explicit
    : AGE_BANDS[scenario?.age] || 50;
  return (scenario?.startYear || 2025) - age;
}

export function newCareer(scenario) {
  return {
    id: `career-${scenario?.presidentName || "unnamed"}-${scenario?.startYear || 2025}`,
    name: scenario?.presidentName || "Unnamed",
    party: scenario?.party || "Independent",
    gender: scenario?.gender || "unspecified",
    ideologyAxis: Number(scenario?.ideologyAxis) || 0,
    birthYear: birthYearFrom(scenario),
    year: scenario?.startYear || 2025,
    status: "in-office",
    offices: [],
    record: { votes: [], bills: [], confirmations: [] },
    recognition: { national: 0, states: {}, districts: {} },
    warChest: 0,
    standing: 50,
  };
}

/**
 * How far one chamber's opinion of you moves the national party's.
 *
 * Not all the way, deliberately. `leadership` is what your caucus thinks this
 * month and it swings on single votes; `standing` is a reputation, and a
 * reputation should compound over a career rather than be rewritten by one bad
 * term.
 */
const STANDING_PULL = 0.4;

/**
 * Close an office out into the career.
 *
 * The only place a record leaves `state` and enters the archive, which is what
 * keeps exactly one source of truth while an office is still being played.
 */
export function foldOffice(career, state, ending) {
  const office = state.office || "house";
  const tag = (rows) => (rows || []).map((row) => ({ ...row, office }));
  const seat = state.seat || {};
  const termYears = officeAt(office)?.termYears ?? 2;
  const terms = seat.seniority || state.term || 1;
  const to = career.year;

  return {
    ...career,
    offices: [...career.offices, {
      office,
      seat: seat.district || seat.state || "national",
      stateName: seat.stateName || null,
      terms,
      from: to - terms * termYears,
      to,
      rank: state.rank || null,
      ending,
      verdict: state.verdict || null,
    }],
    record: {
      votes: [...career.record.votes, ...tag(state.voteLog)],
      bills: [...career.record.bills, ...tag(state.sponsored)],
      confirmations: [...career.record.confirmations, ...tag(state.confirmations)],
    },
    standing: round1(clamp(
      career.standing + ((state.leadership ?? 50) - career.standing) * STANDING_PULL)),
  };
}

/**
 * The whole record — archived plus whatever is still being cast.
 *
 * A reach happens while you still hold the seat, so the votes that will decide
 * the race are split across two places. Every caller asks here, so that none of
 * them can accidentally see half a career.
 */
export function fullRecord(career, state = null) {
  const tag = (rows, office) => (rows || []).map((row) => ({ ...row, office }));
  const live = state?.office
    ? {
        votes: tag(state.voteLog, state.office),
        bills: tag(state.sponsored, state.office),
        confirmations: tag(state.confirmations, state.office),
      }
    : { votes: [], bills: [], confirmations: [] };

  return {
    votes: [...career.record.votes, ...live.votes],
    bills: [...career.record.bills, ...live.bills],
    confirmations: [...career.record.confirmations, ...live.confirmations],
  };
}

// --- Recognition ------------------------------------------------------------

/**
 * Fame, held geographically — the reason skipping a rung is hard without any
 * difficulty setting existing anywhere.
 *
 * A member of the House is famous in one district and unknown in the other
 * fourteen. Converting that into a statewide race is arithmetic rather than
 * judgement: a district is worth roughly its share of the state, and that share
 * is real, because a delegation is a state's electoral votes minus its two
 * senators.
 */
export const districtsInState = (code) => Math.max(1, (STATES[code]?.ev ?? 3) - 2);

const BASE_RECOGNITION = 55;    // an incumbent is known at home
const PER_TERM = 6;
const PER_RANK = 8;
const RECOGNITION_CAP = 95;     // nobody is universally known
const TRANSFER = 0.8;           // media spill into the neighbouring seats
const EV_TOTAL = 538;

/** Rungs of the committee ladder, in height order. See committees.js. */
const RANKS_BY_HEIGHT = ["member", "subchair", "chair", "whip", "speaker"];

/** The rungs from which a member is a national figure rather than a local one. */
const NATIONAL_RANK = 3;

export function earnRecognition(career, state) {
  const seat = state.seat || {};
  const terms = seat.seniority || state.term || 1;
  const rankHeight = Math.max(0, RANKS_BY_HEIGHT.indexOf(state.rank || "member"));
  const earned = round1(clamp(
    BASE_RECOGNITION + (terms - 1) * PER_TERM + rankHeight * PER_RANK, 0, RECOGNITION_CAP));

  const next = {
    ...career,
    recognition: {
      ...career.recognition,
      districts: { ...career.recognition.districts },
      states: { ...career.recognition.states },
    },
  };

  const office = state.office || "house";
  const keep = (bag, key) => { bag[key] = Math.max(bag[key] || 0, earned); };

  if (office === "house" && seat.district) keep(next.recognition.districts, seat.district);
  else if (office === "senate" && seat.state) keep(next.recognition.states, seat.state);
  else if (office === "president") next.recognition.national = Math.max(next.recognition.national, earned);

  /**
   * Rank is national on its own terms. A Speaker is known by people who could
   * not name their own member, and so is anybody who presided over an
   * impeachment — which is the shortcut a career can actually play for.
   */
  if (rankHeight >= NATIONAL_RANK) {
    next.recognition.national = Math.max(next.recognition.national, round1(rankHeight * PER_RANK));
  }
  return next;
}

/**
 * What this electorate has heard of you.
 *
 * Fame flows upward only: being known nationally makes you known in every
 * state, and being known in one district does not.
 */
export function recognitionFor(career, constituency, where = null) {
  const r = career.recognition;

  if (constituency === "district") {
    const stateCode = String(where || "").split("-")[0];
    return round1(Math.max(r.districts[where] || 0, r.states[stateCode] || 0, r.national));
  }

  if (constituency === "state") {
    // Every district you have held inside this state contributes its share.
    let fromDistricts = 0;
    for (const [district, value] of Object.entries(r.districts)) {
      if (district.split("-")[0] !== where) continue;
      fromDistricts += (value / districtsInState(where)) * TRANSFER;
    }
    return round1(Math.max(r.states[where] || 0, r.national) + fromDistricts);
  }

  // National: a statewide office converts at its share of the electoral college.
  let fromStates = 0;
  for (const [code, value] of Object.entries(r.states)) {
    fromStates += value * ((STATES[code]?.ev ?? 3) / EV_TOTAL) * TRANSFER;
  }
  return round1(r.national + fromStates);
}

// --- The wilderness ---------------------------------------------------------

/**
 * Out of office.
 *
 * A fall is a chapter rather than an ending, which is the only version of a
 * career game where reaching for something is worth the risk. Time moves a year
 * at a time and everything decays — but what you do with those years decides
 * which of the four assets you keep, and every option costs one of the others.
 */
export const WILDERNESS_CHOICES = [
  {
    id: "lobby", label: "Take the lobbying job",
    note: "The money is real and so is the stain. Nobody who does this is ever quite clean again.",
  },
  {
    id: "media", label: "Sign the cable news contract",
    note: "You stay visible, and you harden into whatever your own side needs you to be.",
  },
  {
    id: "nonprofit", label: "Run a foundation",
    note: "The country forgets you at full speed. Your reputation survives it intact.",
  },
  {
    id: "party", label: "Work the party circuit",
    note: "Fundraisers in other people's districts. The establishment remembers who showed up.",
  },
  {
    id: "nothing", label: "Wait",
    note: "Everything decays and nothing is owed to you.",
  },
];

/**
 * What a year out of office does to each asset.
 *
 * `fame` and `money` are multipliers, `standing` is a flat move, and `income`
 * is the only way money comes in when nobody is fundraising for you.
 */
const WILDERNESS_EFFECT = {
  lobby: { fame: 0.80, money: 0.9, income: 2.5, standing: 6, tainted: true },
  media: { fame: 0.97, money: 0.9, income: 0, standing: -2 },
  nonprofit: { fame: 0.75, money: 0.85, income: 0, standing: 1 },
  party: { fame: 0.88, money: 0.95, income: 0.4, standing: 9 },
  nothing: { fame: 0.80, money: 0.75, income: 0, standing: 0 },
};

/** How fast a reputation drifts back to the middle when nothing is happening. */
const STANDING_DRIFT = 0.15;

export function enterWilderness(career, { lostTo, office }) {
  return {
    ...career,
    status: "wilderness",
    wilderness: {
      lostTo: lostTo || "the other candidate",
      office: office || null,
      since: career.year,
    },
  };
}

const scaleRecognition = (recognition, factor) => ({
  national: round1(recognition.national * factor),
  states: Object.fromEntries(
    Object.entries(recognition.states).map(([k, v]) => [k, round1(v * factor)])),
  districts: Object.fromEntries(
    Object.entries(recognition.districts).map(([k, v]) => [k, round1(v * factor)])),
});

export function wildernessYear(career, choiceId) {
  const choice = WILDERNESS_CHOICES.find((c) => c.id === choiceId)
    || WILDERNESS_CHOICES[WILDERNESS_CHOICES.length - 1];
  const effect = WILDERNESS_EFFECT[choice.id] || WILDERNESS_EFFECT.nothing;

  const next = {
    ...career,
    year: career.year + 1,
    recognition: scaleRecognition(career.recognition, effect.fame),
    warChest: round1(Math.max(0, career.warChest * effect.money + effect.income)),
    standing: round1(clamp(
      career.standing + (50 - career.standing) * STANDING_DRIFT + effect.standing)),
  };
  if (effect.tainted) next.tainted = true;

  return { career: next, note: choice.note };
}

// --- Arriving somewhere new -------------------------------------------------

/**
 * What arriving with a career behind you is worth.
 *
 * Deliberately small. It buys a caucus that already has an opinion of you and a
 * seat that starts a little warmer — not a head start on the job itself. The
 * real value of a career is spent at the ballot box, in `runLadderRace`, and
 * paying it out twice would make every reached office trivially easy.
 */
const ARRIVAL_WEIGHT = 0.6;

export function seedFromCareer(state, career) {
  if (!career) return state;
  const reputation = clamp(50 + (career.standing - 50) * ARRIVAL_WEIGHT);
  return {
    ...state,
    careerId: career.id,
    leadership: round1(clamp((state.leadership ?? 50) * 0.4 + reputation * 0.6)),
  };
}

// --- The end of a term ------------------------------------------------------

/**
 * What a member may do when their term is up.
 *
 * Nothing is hidden. A rung you cannot reach is still listed, with the reason —
 * being told the Constitution says thirty is part of the game, and silently
 * omitting the option would read as a bug rather than a rule.
 *
 * This sub-project climbs only. Returning to a lower rung after a fall is the
 * wilderness's business, and it is the first thing to add when the comeback
 * race gets built.
 */
export function nextChoices(career, state) {
  const holding = state.office;
  const year = career.year;
  const seatClass = state.seat?.class || 1;
  const home = state.seat?.state || null;

  const choices = [{
    id: "re-elect",
    office: holding,
    where: state.seat?.district || home,
    label: "Run for re-election",
    collides: false,
    eligible: true,
    reason: null,
  }];

  for (const rung of LADDER) {
    if (rung.id === holding || rungOf(rung.id) <= rungOf(holding)) continue;
    const { eligible, reason } = eligibleFor(career, rung.id, year);
    const where = rung.constituency === "state" ? home : null;
    choices.push({
      id: `reach:${rung.id}`,
      office: rung.id,
      where,
      label: `Run for ${rung.title}${where ? ` from ${STATES[where]?.name || where}` : ""}`,
      collides: ballotsCollide({ holding, seatClass, targetOffice: rung.id, year }),
      eligible,
      reason,
    });
  }

  choices.push({
    id: "retire",
    office: null,
    where: null,
    label: "Retire, and let the record close",
    collides: false,
    eligible: true,
    reason: null,
  });
  return choices;
}
