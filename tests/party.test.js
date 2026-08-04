import test from "node:test";
import assert from "node:assert/strict";

import {
  primaryTargets, challengeOdds, endorseChallenger, resolvePrimaries,
  fundraiseForColleagues, resetFundraising,
  ENDORSE_COST, MAX_CHALLENGES, PRIMARY_MONTHS,
} from "../src/party.js";
import { createHouseCareer } from "../src/house.js";
import { factionRoll, factionOf } from "../src/factions.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";
import { findIdeology } from "../public/js/data/ideologies.js";

/**
 * The war inside your own party.
 *
 * Every lever the mode had pointed at the other side or at leadership. Nothing
 * pointed at the people sitting next to you, and a great deal of what a member
 * actually does is aimed exactly there. Congressional careers are ended by their
 * own party far more often than by the other one.
 *
 * The Groyper's trait has promised since it was written that "you can end a
 * mainstream conservative's career from a phone". Nothing in the codebase let
 * anybody do that until this.
 */

const insurgent = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "M", party: "Republican", startYear: 2025,
    ideology: "Groyper", district: "WV-2", events: "classic", ...o,
  }),
  capital: 30, month: 1,
});

test("you challenge your own party, in your own chamber, outside your own bloc", () => {
  const state = insurgent();
  const mine = factionOf(state.scenario).id;
  const targets = primaryTargets(state);
  assert.ok(targets.length, "a caucus always has somebody worth removing");
  for (const t of targets) {
    assert.ok(t.seat && t.name);
    assert.notEqual(t.faction, mine, "you do not primary the people you sit with");
  }
});

test("the most exposed are offered first", () => {
  const targets = primaryTargets(insurgent());
  for (let i = 1; i < targets.length; i++) {
    assert.ok(targets[i - 1].distance >= targets[i].distance);
  }
});

test("a challenger without a movement behind them almost never wins", () => {
  const alone = { ...insurgent(), scenario: { ...insurgent().scenario, ideology: "Fusionist" } };
  const backed = insurgent();
  const target = primaryTargets(backed)[0];
  assert.ok(challengeOdds(backed, target) > challengeOdds(alone, target),
    "what beats an incumbent in a primary is an organised faction with a reason");
  assert.ok(challengeOdds(backed, target) < 80, "and even then it is not a coin flip in your favour");
});

test("endorsing costs everything with leadership and delights your own wing", () => {
  const state = insurgent();
  const out = endorseChallenger(state, primaryTargets(state)[0].seat);
  assert.ok(!out.rejected, out.note);
  assert.ok(out.state.leadership < state.leadership - 10);
  assert.ok(out.state.bloc > state.bloc);
  assert.equal(out.state.capital, 30 - ENDORSE_COST);
  assert.equal(out.state.challenges.length, 1);
});

test("there is a limit to how many of your own you can be at war with", () => {
  let state = insurgent();
  const targets = primaryTargets(state);
  for (let i = 0; i < MAX_CHALLENGES; i++) state = endorseChallenger(state, targets[i].seat).state;
  const tooMany = endorseChallenger(state, targets[MAX_CHALLENGES].seat);
  assert.ok(tooMany.rejected);
});

test("nothing resolves before the primary is held", () => {
  const state = endorseChallenger(insurgent(), primaryTargets(insurgent())[0].seat).state;
  assert.deepEqual(resolvePrimaries({ ...state, month: 2 }).results, []);
  assert.ok(resolvePrimaries({ ...state, month: 1 + PRIMARY_MONTHS }).results.length);
});

test("losing is the common case and it is not free", () => {
  const state = endorseChallenger(insurgent(), primaryTargets(insurgent())[0].seat).state;
  const out = resolvePrimaries({ ...state, month: 1 + PRIMARY_MONTHS });
  assert.ok(out.state.leadership < state.leadership, "a colleague you failed to remove is a colleague for life");
  assert.equal(out.state.challenges.length, 0, "the season is over either way");
});

// ---------------------------------------------------------------------------
// What winning actually changes
// ---------------------------------------------------------------------------

test("a won primary puts somebody like you in the seat", () => {
  const state = insurgent();
  const seat = primaryTargets(state)[0].seat;
  const after = { ...state, primaried: [{ seat, ideology: "Groyper", name: null }] };

  const before = buildCongress(state, STATES).house.find((m) => m.seat === seat);
  const now = buildCongress(after, STATES).house.find((m) => m.seat === seat);
  assert.notEqual(before.ideology, "Groyper");
  assert.equal(now.ideology, "Groyper");
  assert.equal(now.axis, findIdeology("Republican", "Groyper").axis, "and votes like one");
  assert.ok(now.primaried);
});

test("which moves the chamber, and therefore everything read off it", () => {
  const state = insurgent();
  const mine = factionOf(state.scenario).id;
  const seats = primaryTargets(state).slice(0, 4).map((t) => t.seat);
  const after = { ...state, primaried: seats.map((seat) => ({ seat, ideology: "Groyper", name: null })) };

  const before = factionRoll(state).find((f) => f.id === mine).members;
  const now = factionRoll(after).find((f) => f.id === mine).members;
  assert.ok(now > before, "a caucus you have replaced four members of is a caucus you are bigger in");
});

// ---------------------------------------------------------------------------
// The other direction
// ---------------------------------------------------------------------------

test("raising for colleagues is casework run backwards", () => {
  const state = insurgent();
  const out = fundraiseForColleagues(state);
  assert.ok(out.state.leadership > state.leadership, "thirty colleagues owing you is how assignments are decided");
  assert.ok(out.state.capital > state.capital);
  assert.ok(out.state.approval < state.approval, "and none of those dinners were in your district");
});

test("there are only so many rubber-chicken dinners in a calendar", () => {
  const once = fundraiseForColleagues(insurgent()).state;
  assert.ok(fundraiseForColleagues(once).rejected);
  assert.ok(!fundraiseForColleagues(resetFundraising(once)).rejected);
});

test("targets are ordered from your real politics, not from a missing field", () => {
  // A save or an API call that omits `ideologyAxis` used to fall to zero, which
  // silently reordered the whole list by distance from a politics nobody holds.
  const withAxis = insurgent();
  const without = { ...withAxis, scenario: { ...withAxis.scenario, ideologyAxis: undefined } };
  assert.deepEqual(
    primaryTargets(without).map((t) => t.seat),
    primaryTargets(withAxis).map((t) => t.seat),
  );
});
