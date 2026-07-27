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
