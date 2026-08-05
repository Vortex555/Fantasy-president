import test from "node:test";
import assert from "node:assert/strict";

import { TERM_LIMITS, REPEALED, limitFor, standing, canRunAgain } from "../src/termLimits.js";
import {
  STATE_HOUSE, createStatehouseCareer, advanceStatehouseMonth, STATEHOUSE_TERM,
} from "../src/statehouse.js";
import { newCareer } from "../src/career.js";

/**
 * Term limits, as they actually are.
 *
 * Fifteen states limit how long anybody may sit in their legislature and no two
 * of them do it the same way. The distinction that matters is consecutive
 * against lifetime: a consecutive limit is a pause, which is why so many
 * term-limited legislators sit one out and come back or simply move to the
 * other chamber. A lifetime limit is a door.
 */

const member = (code, term = 1) => {
  const s = createStatehouseCareer({
    presidentName: "Daniel Tolpa", party: "Republican", ideology: "Groyper",
    ideologyAxis: 0.9, startYear: 2025, seatState: code,
  });
  return { ...s, term };
};

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

test("fifteen states enforce a limit, and six had one and lost it", () => {
  assert.equal(Object.keys(TERM_LIMITS).length, 15);
  assert.equal(Object.keys(REPEALED).length, 6);
  for (const [code, limit] of Object.entries(TERM_LIMITS)) {
    assert.ok(STATE_HOUSE[code], `${code} is not a state`);
    assert.ok(limit.years >= 8 && limit.years <= 16, `${code}: ${limit.years} is not a real limit`);
    assert.ok(["consecutive", "lifetime"].includes(limit.kind));
    assert.ok(limit.note.length > 30, `${code} does not say what the rule is`);
  }
});

test("the limits are the real ones", () => {
  // Maine adopted the first in 1993: four consecutive terms.
  assert.deepEqual(
    { years: limitFor("ME").years, kind: limitFor("ME").kind },
    { years: 8, kind: "consecutive" },
  );
  // Missouri is eight years in the House, ever.
  assert.equal(limitFor("MO").kind, "lifetime");
  assert.equal(limitFor("MO").years, 8);
  // California and Michigan are twelve years across the whole legislature.
  assert.equal(limitFor("CA").years, 12);
  assert.equal(limitFor("MI").years, 12);
  // Arkansas is sixteen, the longest anybody enforces.
  assert.equal(limitFor("AR").years, 16);
  // Louisiana is three terms — of four years each.
  assert.equal(limitFor("LA").years, 12);
  assert.equal(STATE_HOUSE.LA.term, 4);
});

/**
 * The most telling fact in the subject, and the reason thirty-five states have
 * none: nobody has ever voted them out. Two legislatures repealed limits their
 * own voters imposed, and four state supreme courts struck them down.
 */
test("the states that lost them lost them in one of two ways, and neither was a vote", () => {
  assert.match(REPEALED.ID, /repealed/);
  assert.match(REPEALED.UT, /repealed/);
  for (const code of ["MA", "OR", "WA", "WY"]) {
    assert.match(REPEALED[code], /[Ss]truck down/, `${code} did not lose them in court`);
  }
});

test("a state with no limit says why, when there is a why", () => {
  assert.match(standing(member("ID")).note, /repealed/);
  assert.match(standing(member("WV")).note, /No term limits/);
  assert.equal(standing(member("WV", 9)).limited, false, "nine terms in West Virginia is fine");
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

test("a four-year chamber counts terms, not years", () => {
  /**
   * The bug this test exists for. Hardcoding two-year terms granted a Louisiana
   * member six terms against a limit of three, because Louisiana's house runs
   * on four-year terms and its twelve years are three of them.
   */
  const la = standing(member("LA", 3));
  assert.equal(la.allowed, 3, "twelve years of four-year terms is three terms");
  assert.equal(la.last, true, "so a third-term member is in their last");

  const oh = standing(member("OH", 3));
  assert.equal(oh.allowed, 4, "and eight years of two-year terms is four");
  assert.equal(oh.last, false);
});

test("the clock counts down and says so in terms a member would use", () => {
  assert.equal(standing(member("OH", 1)).remaining, 3);
  assert.equal(standing(member("OH", 3)).remaining, 1);
  assert.equal(standing(member("OH", 4)).last, true);
});

test("a consecutive limit is a pause and a lifetime limit is a door", () => {
  assert.match(standing(member("OH", 4)).after, /sit a term out/);
  assert.match(standing(member("MO", 4)).after, /for good/);

  assert.match(canRunAgain(member("OH", 4)).reason, /sit a term out/);
  assert.match(canRunAgain(member("MO", 4)).reason, /no version of this/);
});

// ---------------------------------------------------------------------------
// What it does to a career
// ---------------------------------------------------------------------------

test("you may stand again until you may not", () => {
  assert.equal(canRunAgain(member("OH", 2)).can, true);
  assert.equal(canRunAgain(member("OH", 4)).can, false);
  assert.equal(canRunAgain(member("WV", 20)).can, true, "no limit is no limit");
});

/**
 * The pressure the whole rung was added for. A term-limited legislator cannot
 * keep the seat however popular they are, so the choice at the end of a term is
 * the ladder or the door — which is exactly why term-limited states send so
 * many of their members to Congress.
 */
test("the clock ends the seat, whatever the district thinks", () => {
  const s = member("OH", 4);
  s.month = STATEHOUSE_TERM;
  s.approval = 92;                       // adored, and it makes no difference

  const out = advanceStatehouseMonth(s);
  assert.equal(out.state.termLimited, true);
  assert.equal(out.reelection, null, "there is no election to win");
  assert.match(out.termLimited.reason, /limits you to 8 years/);
});

/**
 * The ladder or the door, and not only the door. A limited legislator has to go
 * somewhere, which is exactly why term-limited states send so many of their
 * members to Congress — so the clock closes the seat and offers whatever the
 * career can still reach.
 */
test("a limited member is offered the climb rather than the exit", () => {
  const s = member("OH", 4);
  s.month = STATEHOUSE_TERM;
  s.career = newCareer(s.scenario);
  s.career.year = 2033;

  const out = advanceStatehouseMonth(s);
  assert.ok(out.choices, "there has to be somewhere to go");

  const reelect = out.choices.find((c) => c.id === "re-elect");
  assert.equal(reelect.eligible, false, "the one thing they cannot do is stay");
  assert.match(reelect.reason, /limits you to 8 years/);

  assert.ok(out.choices.some((c) => c.office === "house" && c.eligible),
    "and the US House is the thing they go to");
  assert.notEqual(out.state.over, true, "the career is not over, the seat is");
});

test("with nowhere above it, the clock really is the door", () => {
  const s = member("MO", 4);
  s.month = STATEHOUSE_TERM;
  // No career envelope, so there is no ladder to offer.
  const out = advanceStatehouseMonth(s);
  assert.equal(out.state.over, true);
  assert.equal(out.state.ending.type, "term-limited");
});

test("and a member with terms left simply faces the voters", () => {
  const s = member("OH", 2);
  s.month = STATEHOUSE_TERM;
  s.approval = 70;

  const out = advanceStatehouseMonth(s);
  assert.notEqual(out.state.ending?.type, "term-limited");
  assert.ok(out.reelection, "the district decides this one");
});

test("an unlimited state never ends a career on the clock", () => {
  const s = member("WV", 12);
  s.month = STATEHOUSE_TERM;
  s.approval = 70;
  const out = advanceStatehouseMonth(s);
  assert.notEqual(out.state.ending?.type, "term-limited");
});
