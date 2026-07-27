import test from "node:test";
import assert from "node:assert/strict";

import {
  LADDER, officeAt, isPresidentialYear, isMidtermYear, nextElectionYear,
} from "../src/career.js";

/**
 * One career, across every office it passes through.
 *
 * The office modules build completely different states, and this is the layer
 * that survives between them — so most of what is tested here is arithmetic
 * about time, geography and fame rather than anything about how a month plays.
 */

// ---------------------------------------------------------------------------
// The ladder and the calendar
// ---------------------------------------------------------------------------

test("the ladder is a table, so later rungs are additions rather than rewrites", () => {
  assert.ok(LADDER.length >= 3);
  for (const rung of LADDER) {
    assert.ok(rung.id && rung.title && rung.termYears > 0);
    assert.ok(["district", "state", "nation"].includes(rung.constituency));
  }
  assert.equal(officeAt("senate").termYears, 6);
  assert.equal(officeAt("house").constituency, "district");
  assert.equal(officeAt("nonsense"), null);
});

test("the calendar is the real one", () => {
  assert.equal(isPresidentialYear(2028), true);
  assert.equal(isPresidentialYear(2030), false);
  assert.equal(isMidtermYear(2030), true);
  assert.equal(isMidtermYear(2028), false);
  // Every era the game ships sits correctly against it: each starts the year
  // after a presidential election, because that is when a term begins.
  for (const start of [1949, 1961, 1993, 2001, 2013, 2025]) {
    assert.equal(isPresidentialYear(start - 1), true, `${start} follows an election`);
  }
});

test("the next election for an office is the next year it is actually on the ballot", () => {
  assert.equal(nextElectionYear("house", 2029), 2030, "the whole House, every even year");
  assert.equal(nextElectionYear("house", 2030), 2030, "including the year you are standing in");
  assert.equal(nextElectionYear("president", 2029), 2032);
  assert.equal(nextElectionYear("president", 2032), 2032);
  // A third of the Senate each cycle, rotating through three classes.
  assert.equal(nextElectionYear("senate", 2029, 1), 2030);
  assert.equal(nextElectionYear("senate", 2031, 1), 2036);
  assert.equal(nextElectionYear("senate", 2029, 2), 2032);
  assert.equal(nextElectionYear("senate", 2029, 3), 2034);
});
