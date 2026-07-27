import { clamp, round1 } from "./rng.js";

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
