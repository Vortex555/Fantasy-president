/**
 * Term limits, as they actually are.
 *
 * Fifteen states limit how long anybody may sit in their legislature, and no
 * two of them do it the same way. The differences are not decoration: a
 * *consecutive* limit means you sit out a term and may come back, which is why
 * so many term-limited legislators simply run for the other chamber and return
 * four years later. A *lifetime* limit means the seat is finished with you.
 * Missouri and Nevada are done with you; Ohio and Florida would like you to
 * wait.
 *
 * Six more states had limits and lost them, and how they lost them is the most
 * telling fact in the whole subject. Idaho's legislature repealed its own
 * limits in 2002 and Utah's did the same in 2003 — the only two occasions in
 * American history a legislature has abolished a limit the voters imposed on
 * it. Massachusetts, Oregon, Washington and Wyoming had theirs struck down by
 * their own supreme courts. Nobody has ever voted them out.
 *
 * The years below are for the LOWER chamber, which is the one this mode plays.
 */

/**
 * @typedef {object} Limit
 * @property {number} years   how long you may sit in the lower chamber
 * @property {"consecutive"|"lifetime"} kind  whether sitting out resets it
 * @property {string} note    what the rule actually is, in words
 */

/** The fifteen states that enforce one. */
export const TERM_LIMITS = {
  AZ: { years: 8, kind: "consecutive",
    note: "Four terms in the House, then out — though you may return after a term away." },
  AR: { years: 16, kind: "lifetime",
    note: "Sixteen years in the legislature in total, in either chamber, and then never again." },
  CA: { years: 12, kind: "lifetime",
    note: "Twelve years in the legislature altogether, whichever chamber you spend them in." },
  CO: { years: 8, kind: "consecutive",
    note: "Four terms consecutively. Sit out one and the clock starts again." },
  FL: { years: 8, kind: "consecutive",
    note: "Four consecutive terms in the House and no more without a break." },
  LA: { years: 12, kind: "consecutive",
    note: "Three consecutive terms. Louisiana runs on four-year terms, so that is twelve years." },
  ME: { years: 8, kind: "consecutive",
    note: "Four consecutive terms — the first limit any state adopted, in 1993." },
  MI: { years: 12, kind: "lifetime",
    note: "Twelve years in the legislature in total, since the voters rewrote it in 2022." },
  MO: { years: 8, kind: "lifetime",
    note: "Eight years in the House, ever. Sixteen in the legislature altogether." },
  MT: { years: 8, kind: "consecutive",
    note: "Eight years in any sixteen, which is a limit you can outlast rather than escape." },
  NE: { years: 8, kind: "consecutive",
    note: "Two terms in the one chamber Nebraska has, and then a term away." },
  NV: { years: 12, kind: "lifetime",
    note: "Twelve years in the Assembly, ever." },
  OH: { years: 8, kind: "consecutive",
    note: "Four consecutive terms. Ohio's legislators famously swap chambers to stay put." },
  OK: { years: 12, kind: "lifetime",
    note: "Twelve years in the legislature in total, and that is the whole career." },
  SD: { years: 8, kind: "consecutive",
    note: "Four consecutive terms, then one term out." },
};

/**
 * The six that had them and do not.
 *
 * Kept because it is the most interesting thing about the subject and because a
 * player in Idaho or Massachusetts should be told why they are not limited when
 * their neighbours are.
 */
export const REPEALED = {
  ID: "Idaho's legislature repealed the limits its voters imposed, in 2002.",
  UT: "Utah's legislature repealed its own limits in 2003, before they had bound anybody.",
  MA: "Struck down by the Supreme Judicial Court in 1997 as beyond what a statute could do.",
  OR: "Struck down by the Oregon Supreme Court in 2002 on a single-subject technicality.",
  WA: "Struck down by the Washington Supreme Court in 1998.",
  WY: "Struck down by the Wyoming Supreme Court in 2004.",
};

export const limitFor = (code) => TERM_LIMITS[code] || null;

/**
 * Where this member stands against the clock.
 *
 * `served` counts terms completed *in this chamber*, which is what the
 * consecutive states measure. The lifetime states measure the same thing here
 * because this mode plays one chamber — the distinction between them shows up
 * in what happens afterwards, not in the counting.
 */
export function standing(state) {
  const code = state?.seat?.state;
  const limit = limitFor(code);
  /**
   * The state's own term length, not two.
   *
   * Hardcoding two years granted a Louisiana member six terms against a limit
   * of three: Louisiana runs four-year house terms, so its twelve years are
   * three terms and not six. Alabama, Maryland, Mississippi, North Dakota and
   * Nebraska are the other four-year chambers — none of the first four limits
   * anybody, but Nebraska does, and its two terms are eight years for the same
   * reason. Read from the career rather than imported, because statehouse.js
   * imports this module and the cycle would not resolve.
   */
  const termYears = Number(state?.chamber?.term) || 2;

  if (!limit) {
    return {
      limited: false,
      note: REPEALED[code]
        ? `${REPEALED[code]} You may serve here as long as the district will have you.`
        : "No term limits here. You may serve as long as the district will have you.",
    };
  }

  const served = (state.term || 1) - 1;
  const allowed = Math.floor(limit.years / termYears);
  const remaining = Math.max(0, allowed - (state.term || 1));

  return {
    limited: true,
    kind: limit.kind,
    years: limit.years,
    allowed,
    served,
    remaining,
    /** Whether this is the last term they may serve. */
    last: remaining <= 0,
    note: limit.note,
    /**
     * What happens at the end of it, which is the whole difference between the
     * two kinds. A consecutive limit is a pause; a lifetime one is a door.
     */
    after: limit.kind === "lifetime"
      ? "When it runs out you are finished in this chamber for good."
      : "When it runs out you must sit a term out — and most who do run for something else instead.",
  };
}

/**
 * Whether they may stand again.
 *
 * The pressure the whole rung was added for. A term-limited legislator cannot
 * simply keep the seat, so the choice at the end of a term is the ladder or the
 * door — which is exactly why term-limited states send so many of their members
 * to Congress.
 */
export function canRunAgain(state) {
  const read = standing(state);
  if (!read.limited || !read.last) return { can: true, reason: null };

  return {
    can: false,
    reason: `${state.seat.stateName} limits you to ${read.years} years here and you have served them. `
      + (read.kind === "lifetime"
        ? "There is no version of this where you file again."
        : "You would have to sit a term out, and the seat will not be waiting."),
  };
}
