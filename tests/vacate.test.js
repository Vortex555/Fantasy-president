import test from "node:test";
import assert from "node:assert/strict";

import {
  vacateCount, moveToVacate, resolveVacancy, VACANCY_MONTHS,
  VACATE_COST, VACATE_DRAG,
} from "../src/procedure.js";
import { createHouseCareer, docketSize } from "../src/house.js";

/**
 * Removing the Speaker.
 *
 * A bloc's power in this game was entirely negative and entirely invisible:
 * `canDenyMajority` said whether your caucus could withhold enough votes to sink
 * a bill, and there was nothing anywhere to spend that on. The motion to vacate
 * is what denying a majority actually buys — the one move in the building where
 * a faction of thirty decides who runs a chamber of four hundred and thirty-five.
 *
 * It went from a theoretical procedure to a used one in October 2023, and the
 * arithmetic of that day is the arithmetic here: the minority votes for chaos
 * almost to a member, and the last twenty-odd names come off your own side. You
 * cannot do it alone and you cannot do it without the people who hate you.
 */

const member = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Republican", startYear: 2025,
  ideology: "Traditional Conservative", district: "WV-2", events: "classic", ...o,
});

/** A chamber where the player's party holds the gavel. */
const majority = (o = {}) => ({
  ...member(o),
  congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
  capital: 40,
});

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

test("the minority votes for chaos and your own side supplies the rest", () => {
  const count = vacateCount(majority(), 0);
  assert.ok(count.minorityYes > 180, "opposing a Speaker is free politics for the other party");
  assert.ok(count.rebels > 0, "and it is never only them");
  assert.ok(count.rebels < count.minorityYes,
    "the whole point is that a handful of your own decide it");
});

test("it is close, because a motion nobody could lose is not a decision", () => {
  const count = vacateCount(majority(), 0);
  assert.ok(Math.abs(count.yes - count.threshold) < 60,
    `${count.yes} against a line of ${count.threshold} is not a fight`);
});

test("the caucus that organised the rebellion can whip it", () => {
  const insurgent = vacateCount({ ...majority(),
    scenario: { ...majority().scenario, ideology: "Groyper" } }, 0);
  const centre = vacateCount({ ...majority(),
    scenario: { ...majority().scenario, ideology: "Traditional Conservative" } }, 0);
  assert.ok(insurgent.rebels > centre.rebels,
    "a Freedom Caucus member moving this is whipping their own room, not asking strangers");
});

test("favours move your own side, not the other one", () => {
  const quiet = vacateCount(majority(), 0);
  const pushed = vacateCount(majority(), 25);
  assert.equal(quiet.minorityYes, pushed.minorityYes, "the minority needs no persuading");
  assert.ok(pushed.rebels > quiet.rebels);
  assert.ok(pushed.yes > quiet.yes);
});

// ---------------------------------------------------------------------------
// Moving it
// ---------------------------------------------------------------------------

test("you cannot vacate a chair your own side does not hold", () => {
  const minorityParty = { ...majority(), congress: { houseD: 240, houseR: 195, senateD: 53, senateR: 47 } };
  const out = moveToVacate(minorityParty, 0);
  assert.ok(out.rejected);
  assert.match(out.note, /other party/i);
});

test("nor without the standing to be taken seriously", () => {
  const out = moveToVacate({ ...majority(), capital: 1 }, 0);
  assert.ok(out.rejected);
});

test("winning empties the chair and stops the floor", () => {
  const out = moveToVacate(majority(), 40);
  assert.ok(!out.rejected, out.note);
  if (!out.passed) return;                       // covered by the losing test below
  assert.equal(out.state.vacancy, VACANCY_MONTHS);
  for (let month = 1; month <= 12; month++) {
    assert.equal(docketSize({ ...out.state, month }), 0,
      `month ${month} scheduled bills with no Speaker to schedule them`);
  }
  assert.ok(out.state.leadership < majority().leadership, "you did this and everyone knows");
  assert.ok(out.state.bloc > majority().bloc, "and your own wing has never been happier");
});

test("losing costs more than winning and buys nothing", () => {
  const out = moveToVacate(majority(), 0);
  if (out.passed) return;
  assert.equal(out.state.vacancy ?? 0, 0, "the Speaker is still there");
  assert.ok(out.state.leadership < majority().leadership - VACATE_DRAG,
    "a failed motion is worse than none: they know and they survived");
});

test("it costs favours whichever way it goes", () => {
  const out = moveToVacate(majority(), 0);
  assert.equal(out.state.capital, 40 - VACATE_COST);
});

// ---------------------------------------------------------------------------
// What the paralysis is worth
// ---------------------------------------------------------------------------

test("the vacancy runs down a month at a time", () => {
  let state = { ...majority(), vacancy: VACANCY_MONTHS };
  for (let i = 0; i < VACANCY_MONTHS; i++) {
    const out = resolveVacancy(state);
    state = out.state;
  }
  assert.equal(state.vacancy, 0);
});

test("the chamber comes back with a Speaker who owes your wing something", () => {
  const before = { ...majority(), vacancy: 1, leadership: 20 };
  const out = resolveVacancy(before);
  assert.equal(out.state.vacancy, 0);
  assert.ok(out.state.leadership > before.leadership,
    "the price of the gavel was being acceptable to the people who took the last one");
  assert.match(out.note, /Speaker/);
});

test("a bloc that could never deny a majority extracts less", () => {
  const big = resolveVacancy({ ...majority(), vacancy: 1, leadership: 20,
    scenario: { ...majority().scenario, ideology: "Groyper" } });
  const small = resolveVacancy({ ...majority(), vacancy: 1, leadership: 20,
    scenario: { ...majority().scenario, ideology: "Moderate Republican" } });
  assert.ok(big.state.leadership >= small.state.leadership);
});

test("nothing happens to a chamber that has a Speaker", () => {
  const state = majority();
  const out = resolveVacancy(state);
  assert.equal(out.state, state);
  assert.equal(out.note, null);
});
