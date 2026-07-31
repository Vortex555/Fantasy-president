import test from "node:test";
import assert from "node:assert/strict";

import {
  AXES, nationalProfile, nationalRate, profileFor, stateProfile, districtProfile,
  describeProfile, profileRows, billImpact, loudestObjection, driftProfile, leanDriftFor,
  seedCountry,
} from "../src/demographics.js";
import {
  migrationEffect, applyMigration, applyMigrationPolicy, migrationPopulation,
} from "../src/consequence.js";
import { createGame, applyResult } from "../src/gameEngine.js";
import { createHouseCareer, advanceHouseMonth } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";
import { STATES } from "../src/states.js";

/**
 * Every place in the game used to be one integer. A state carried a name, its
 * electoral votes, two map coordinates and a lean; a district carried a seat code
 * and a lean. Four hundred and thirty-five constituencies distinguished by the
 * *output* of their politics standing in for the place.
 */

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ""} — ${a} is not within ${tol} of ${b}`);

// ---------------------------------------------------------------------------
// A place has people
// ---------------------------------------------------------------------------

test("every state has a coherent profile", () => {
  for (const code of Object.keys(STATES)) {
    const p = stateProfile(code);
    for (const axis of AXES) {
      assert.ok(Number.isFinite(p[axis.id]), `${code}.${axis.id} is not a number`);
    }
    near(p.rural + p.suburban + p.urban, 100, 0.5, `${code} settlement shares`);
  }
});

test("the profile never contradicts the politics it was derived from", () => {
  // A very Republican state should not read as a secular graduate city.
  const wv = stateProfile("WV");
  const ma = stateProfile("MA");
  assert.ok(wv.college < ma.college, "education tracks lean");
  assert.ok(wv.faith > ma.faith, "and so does observance");
});

test("geography is not ideology — Vermont and Wyoming are both rural", () => {
  // Deriving everything from lean put Vermont at 0% rural, which is a category
  // error: they vote 78 points apart and are both among the most rural states.
  const vt = stateProfile("VT");
  const wy = stateProfile("WY");
  assert.ok(vt.rural > 40, `Vermont is rural, got ${vt.rural}%`);
  assert.ok(wy.rural > 25, `Wyoming is rural, got ${wy.rural}%`);
  // And their politics still differ, through the axes that do track lean.
  assert.ok(vt.college > wy.college);
  assert.ok(vt.faith < wy.faith);
});

test("outliers the derivation cannot reach are corrected", () => {
  // Utah's religiosity is the most recognisable demographic fact about it and
  // deriving from lean alone put it at roughly half the real figure.
  assert.ok(stateProfile("UT").faith > 40, `Utah at ${stateProfile("UT").faith}%`);
});

test("a district is its own place, pulled toward its state", () => {
  const safe = districtProfile("OH-1", -40);
  const hostile = districtProfile("OH-2", 40);
  assert.ok(safe.college > hostile.college, "two seats in one state can differ sharply");
  assert.ok(safe.urban > hostile.urban);
});

test("the same seat is always the same place", () => {
  assert.deepEqual(districtProfile("OH-6", 14), districtProfile("OH-6", 14));
});

// ---------------------------------------------------------------------------
// The country in a given decade
// ---------------------------------------------------------------------------

test("the country is a different country in a different era", () => {
  const then = nationalProfile(1960);
  const now = nationalProfile(2025);
  assert.ok(then.college < now.college, "far fewer graduates");
  assert.ok(then.union > now.union, "far more union members");
  assert.ok(then.faith > now.faith, "far more observant");
  assert.ok(then.manufacturing > now.manufacturing);
});

test("the era table is interpolated, not stepped", () => {
  // Stepping left two disagreeing accounts of the same trend, which dragged
  // every seat in the game rightward by fifteen points over a career.
  const a = nationalProfile(2005);
  const b = nationalProfile(2010);
  const c = nationalProfile(2015);
  assert.ok(a.college < b.college && b.college < c.college, "smooth, not flat then jumping");
});

test("the national trend has exactly one source of truth", () => {
  const rate = nationalRate(2005);
  const implied = (nationalProfile(2006).college - nationalProfile(2005).college) / 12;
  near(rate.college, implied, 0.0001, "drift is derived from the era table");
});

// ---------------------------------------------------------------------------
// The country changes under you
// ---------------------------------------------------------------------------

test("a seat that merely keeps pace with the country does not move politically", () => {
  const base = profileFor({ lean: 0, year: 2005, seed: "average" });
  const p = { ...base };
  let year = 2005;
  for (let m = 0; m < 240; m++) { driftProfile(p, year); year += 1 / 12; }
  near(leanDriftFor(p, base, 2025, 2005), 0, 3, "an average seat riding the national tide");
});

test("college cities and mill towns pull apart, in the directions they really did", () => {
  const run = (seat, lean) => {
    const base = districtProfile(seat, lean, 2005);
    const p = { ...base };
    let year = 2005;
    for (let m = 0; m < 240; m++) { driftProfile(p, year); year += 1 / 12; }
    return { moved: leanDriftFor(p, base, 2025, 2005), base, p };
  };
  const city = run("CA-12", -40);
  const mill = run("OH-6", 14);

  assert.ok(city.moved < 0, `a college city should move left, moved ${city.moved}`);
  assert.ok(mill.moved > 0, `a mill town should move right, moved ${mill.moved}`);
  assert.ok(city.p.college > city.base.college, "graduates cluster with graduates");
  assert.ok(mill.p.manufacturing < mill.base.manufacturing, "and the factories keep closing");
});

test("drift accumulates rather than rounding away", () => {
  // Rounding to whole people at every step swallowed 0.02 a month for 20 years.
  const p = districtProfile("OH-6", 14, 2005);
  const before = p.college;
  for (let m = 0; m < 120; m++) driftProfile(p, 2010);
  assert.ok(p.college > before + 1, `${before} → ${p.college}`);
});

test("a career's seat changes under it, and the lean follows", () => {
  let s = createHouseCareer({ office: "house", presidentName: "M", party: "Democrat",
    startYear: 2005, ideology: "Social Democrat", ideologyAxis: -0.6, district: "OH-6", events: "classic" });
  const wasCollege = s.people.college;
  const wasLean = s.seat.lean;

  for (let m = 0; m < 24 * 5; m++) { const o = advanceHouseMonth(s); s = o.state; if (s.over) break; }
  assert.ok(s.people.college > wasCollege, "the district educated");
  assert.notEqual(s.seat.lean, wasLean, "and its politics followed");
  assert.equal(s.leanAtOath, wasLean, "while the record of what it was is kept");
});

test("a senator represents a whole state", () => {
  const s = createSenateCareer({ office: "senate", presidentName: "M", party: "Democrat",
    startYear: 2025, ideology: "Social Democrat", ideologyAxis: -0.6, seatState: "OH" });
  assert.ok(s.people?.college > 0);
  assert.deepEqual(s.people, s.peopleAtOath);
});

// ---------------------------------------------------------------------------
// Who a bill lands on
// ---------------------------------------------------------------------------

test("a bill hits different groups in different seats", () => {
  const mill = districtProfile("OH-6", 20);
  const city = districtProfile("CA-12", -40);
  const union = { title: "Organising Rights", axis: -0.48, domain: "economy" };

  const inMill = billImpact(mill, union).map((g) => g.id);
  const inCity = billImpact(city, union).map((g) => g.id);
  assert.ok(inMill.length && inCity.length);
  assert.notDeepEqual(inMill, inCity, "the same bill lands on different people");
});

test("a group only speaks about subjects it turns out for", () => {
  const p = districtProfile("OH-6", 14);
  const foreign = billImpact(p, { axis: 0.5, domain: "foreign" }).map((g) => g.id);
  assert.ok(!foreign.includes("seniors"), "pensioners are silent on a tariff");
});

test("who objects loudest is the biggest group the bill goes against", () => {
  const p = districtProfile("OH-6", 20);
  const hit = loudestObjection(p, { axis: -0.7, domain: "economy" });
  if (hit) {
    assert.ok(hit.share > 0);
    assert.match(hit.note, /% of this seat/);
  }
});

// ---------------------------------------------------------------------------
// Saying it out loud
// ---------------------------------------------------------------------------

test("a place can be described in words a member would use", () => {
  const d = describeProfile(stateProfile("WV"));
  assert.ok(d.length > 4);
  assert.ok(/rural|small-town/.test(d), `got "${d}"`);
});

test("the rows a screen renders are rounded, though the model is not", () => {
  const p = districtProfile("OH-6", 14);
  for (let m = 0; m < 30; m++) driftProfile(p, 2025);
  for (const row of profileRows(p)) {
    assert.ok(Number.isFinite(row.value));
    assert.ok(Number.isFinite(row.national));
  }
});

test("an old save with no people in it still plays", () => {
  const s = createHouseCareer({ office: "house", presidentName: "M", party: "Democrat",
    startYear: 2025, ideology: "Social Democrat", ideologyAxis: -0.6, district: "OH-6", events: "classic" });
  delete s.people;
  delete s.peopleAtOath;
  const { state } = advanceHouseMonth(s);
  assert.equal(state.month, 2);
  assert.deepEqual(billImpact(undefined, { axis: 0.5, domain: "economy" }), []);
});

// ---------------------------------------------------------------------------
// Census composition
//
// Without it the model cannot represent the American South: a poor rural
// district in Mississippi and one in West Virginia have near-identical incomes,
// education and churchgoing, and vote forty points apart.
// ---------------------------------------------------------------------------

test("composition is anchored, never derived from lean", () => {
  // Deriving it would report the most Republican states of the Deep South as
  // overwhelmingly white, which is exactly inverted.
  const ms = stateProfile("MS");
  const wv = stateProfile("WV");
  assert.ok(ms.black > 30, `Mississippi is ${ms.black}% Black`);
  assert.ok(wv.black < 8, `West Virginia is ${wv.black}% Black`);
  assert.ok(STATES.MS.lean > 0 && STATES.WV.lean > 0, "and both vote Republican");
});

test("it distinguishes two places nothing else in the profile can", () => {
  const ms = stateProfile("MS");
  const wv = stateProfile("WV");
  near(ms.income, wv.income, 12, "similar incomes");
  assert.ok(Math.abs(ms.black - wv.black) > 25, "and completely different constituencies");
});

test("the composition of every state adds up to a population", () => {
  for (const code of Object.keys(STATES)) {
    const p = stateProfile(code);
    const total = p.white + p.black + p.hispanic + p.asian;
    assert.ok(total > 80 && total <= 100, `${code} sums to ${total}`);
    for (const id of ["white", "black", "hispanic", "asian"]) {
      assert.ok(p[id] >= 0 && p[id] <= 100, `${code}.${id} is ${p[id]}`);
    }
  }
});

test("the known cases come out right", () => {
  assert.ok(stateProfile("NM").hispanic > 40, "New Mexico");
  assert.ok(stateProfile("HI").asian > 35, "Hawaii");
  assert.ok(stateProfile("MD").black > 22, "Maryland");
  assert.ok(stateProfile("VT").white > 85, "Vermont");
});

test("the country diversifies across the eras", () => {
  const then = nationalProfile(1960);
  const now = nationalProfile(2025);
  assert.ok(then.white > now.white + 20, "far whiter in 1960");
  assert.ok(then.hispanic < now.hispanic, "and far fewer Hispanic Americans");
});

test("a state keeps its distance from the country in every era", () => {
  // A 1960 California is much whiter than a modern one and still much less white
  // than a 1960 Iowa.
  const ca60 = stateProfile("CA", 1960);
  const ca25 = stateProfile("CA", 2025);
  const ia60 = stateProfile("IA", 1960);
  assert.ok(ca60.white > ca25.white, "California was whiter in 1960");
  assert.ok(ca60.white < ia60.white, "and still less white than Iowa was");
});

test("a district inherits its state's composition", () => {
  const seat = districtProfile("MS-2", -10);
  assert.ok(seat.black > 20, "a Mississippi seat cannot be composed of people the state lacks");
});

test("composition is not modelled as an interest group", () => {
  // The bill-impact groups are defined by a shared material stake in specific
  // legislation. A census category is not that, and modelling it as one would be
  // both worse political science and the thing worth avoiding.
  const ids = billImpact(stateProfile("MS"), { axis: -0.5, domain: "economy" }).map((g) => g.id);
  for (const id of ["white", "black", "hispanic", "asian"]) {
    assert.ok(!ids.includes(id), `${id} must not appear as a bill constituency`);
  }
});

test("a place is described the way a psephologist would describe it", () => {
  const d = describeProfile(stateProfile("MS"));
  assert.ok(/Black/.test(d), `got "${d}"`);
  assert.ok(!/vote|believe|want|prefer/i.test(d), "the description says what a place is, not what people think");
});

// ---------------------------------------------------------------------------
// Immigration law, which is the one lever that reaches composition
// ---------------------------------------------------------------------------

test("the era table has a forward anchor, or nothing drifts at all", () => {
  // Without one the interpolation had nothing to aim at past the last historical
  // row: nationalProfile(2025) and (2026) were identical, the derived rate was
  // zero, and every career starting in the modern era had no drift whatsoever.
  const rate = nationalRate(2025);
  assert.ok(Math.abs(rate.college) > 0, "the present must have a direction");
  assert.ok(Math.abs(rate.white) > 0);
});

test("only immigration bills touch the flow", () => {
  const flow = (title, brief, axis) => migrationEffect({ title, brief, axis });
  assert.ok(flow("Immigration Restriction Act", "Caps annual admissions.", 0.8) < 0);
  assert.ok(flow("Border Enforcement Act", "Funds barriers and detention.", 0.4) < 0);
  assert.ok(flow("Refugee Resettlement Expansion", "Raises the annual ceiling.", -0.7) > 0);
  assert.equal(flow("Growth and Investment Act", "Cuts corporate rates.", 0.45), 0);
  assert.equal(flow("Universal Coverage Act", "Extends health coverage.", -0.55), 0);
});

test("a moderate immigration bill still moves the flow", () => {
  // Scaling purely by conviction meant the bills that can actually pass a real
  // chamber moved it by four hundredths and a whole career changed nothing.
  assert.ok(Math.abs(migrationEffect({
    title: "Border Security Act", brief: "Funds additional agents.", axis: 0.2,
  })) > 0.08);
});

test("the flow is a setting that stays where the last statute left it", () => {
  const s = { migration: 1 };
  const bill = { title: "Immigration Restriction Act", brief: "Caps admissions.", axis: 0.5 };
  applyMigration(s, bill);
  const after = s.migration;
  assert.ok(after < 1);
  // Nothing decays it back; only another statute moves it.
  applyMigration(s, bill);
  assert.ok(s.migration < after);
});

test("the flow is bounded, so no regime abolishes or floods the country", () => {
  const s = { migration: 1 };
  const hard = { title: "Immigration Moratorium Act", brief: "Ends all admissions.", axis: 1 };
  for (let i = 0; i < 40; i++) applyMigration(s, hard);
  assert.ok(s.migration >= 0.1, `${s.migration}`);
});

test("sustained restriction changes the country's composition and ages it", () => {
  const country = seedCountry(2025);
  const restricted = seedCountry(2025);
  let year = 2025;
  for (let m = 0; m < 240; m++) {
    driftProfile(country, year, { migration: 1 });
    driftProfile(restricted, year, { migration: 0.4 });
    year += 1 / 12;
  }
  assert.ok(restricted.white > country.white + 1, "composition changes more slowly");
  assert.ok(restricted.hispanic < country.hispanic, "and so does the share that grows by arrival");
  // The people not arriving are the young ones.
  assert.ok(restricted.age > country.age, "restriction greys the country faster");
});

test("expansion runs both the other way", () => {
  const country = seedCountry(2025);
  const open = seedCountry(2025);
  let year = 2025;
  for (let m = 0; m < 240; m++) {
    driftProfile(country, year, { migration: 1 });
    driftProfile(open, year, { migration: 1.7 });
    year += 1 / 12;
  }
  assert.ok(open.white < country.white);
  assert.ok(open.age < country.age, "arrivals are younger than the resident population");
});

test("the country a career carries is stateful, not a function of the year", () => {
  const s = createHouseCareer({ office: "house", presidentName: "M", party: "Democrat",
    startYear: 2025, ideology: "Social Democrat", ideologyAxis: -0.6, district: "OH-6", events: "classic" });
  assert.ok(s.country, "national composition must be something legislation can reach");
  assert.deepEqual(s.country, s.countryAtOath);
  assert.equal(s.migration, 1);
});

test("an old save with no country or flow still rolls forward", () => {
  const s = createHouseCareer({ office: "house", presidentName: "M", party: "Democrat",
    startYear: 2025, ideology: "Social Democrat", ideologyAxis: -0.6, district: "OH-6", events: "classic" });
  delete s.country;
  delete s.migration;
  const { state } = advanceHouseMonth(s);
  assert.equal(state.month, 2);
});

// ---------------------------------------------------------------------------
// The presidency
//
// It already had society.js — how the country is *doing*. It had no composition
// at all, and the two share no field: one is the country's condition, the other
// is who lives in it.
// ---------------------------------------------------------------------------

test("the presidency carries a country, unconditionally", () => {
  const s = createGame({ presidentName: "A", party: "Democrat", startYear: 2025,
    ideology: "Social Democrat", ideologyAxis: -0.6, era: "Modern", startApproval: 52 });
  assert.ok(s.country, "composition is not an opt-in rule of play");
  assert.equal(s.migration, 1);
  assert.deepEqual(s.country, s.countryAtOath);
});

test("society and demographics share no field, so neither replaces the other", () => {
  const s = createGame({ presidentName: "A", party: "Democrat", startYear: 2025,
    ideology: "Social Democrat", ideologyAxis: -0.6, era: "Modern", startApproval: 52, society: true });
  for (const key of Object.keys(s.society)) {
    assert.ok(!(key in s.country), `${key} appears in both — they would fight`);
  }
});

test("a president's immigration posture is read from what they wrote", () => {
  const run = (policy) => {
    const s = { migration: 1 };
    applyMigrationPolicy(s, policy);
    return s.migration;
  };
  assert.ok(run("A moratorium on new admissions and enforcement at the border.") < 1);
  assert.ok(run("A path to citizenship for long-term residents and a higher refugee ceiling.") > 1);
  assert.equal(run("I am cutting the corporate tax rate and deregulating energy."), 1);
  // Mentioning the border in passing is not immigration law.
  assert.equal(run("Our foreign policy will secure trade routes; I will visit the border."), 1);
});

test("a sustained posture converges rather than ratcheting to the floor", () => {
  // A member votes on occasional statutes; a president writes policy monthly, and
  // a constant step pegged the flow inside a single term.
  const s = { migration: 1 };
  const policy = "A moratorium on new admissions and enforcement at the border.";
  for (let m = 0; m < 24; m++) applyMigrationPolicy(s, policy);
  const afterTwoYears = s.migration;
  for (let m = 0; m < 72; m++) applyMigrationPolicy(s, policy);
  near(s.migration, afterTwoYears, 0.1, "it settles at a steady state");
  assert.ok(s.migration > 0.3, "and does not peg at the floor");
});

test("the flow moves the population, at a step smaller than the display precision", () => {
  // Rounding to a tenth per month swallowed the entire effect — the same
  // accumulator bug as the demographic drift, in a second place.
  const restricted = { migration: 0.45, society: { population: 335 } };
  const open = { migration: 1.65, society: { population: 335 } };
  for (let m = 0; m < 96; m++) { migrationPopulation(restricted); migrationPopulation(open); }
  assert.ok(restricted.society.population < 333, `${restricted.society.population}M`);
  assert.ok(open.society.population > 337, `${open.society.population}M`);
});

test("a president's term changes the composition, slowly", () => {
  const base = () => ({ analysis: "", approvalChange: 0, economy: {}, stakeholders: [],
    press: [], stateEffects: [], arcs: [], ideologyFit: 0 });
  const sc = { presidentName: "A", party: "Democrat", startYear: 2025, ideology: "Social Democrat",
    ideologyAxis: -0.6, era: "Modern", startApproval: 52, society: true };

  let restrict = createGame(sc);
  for (let m = 0; m < 96; m++) {
    restrict = applyResult(restrict, "A moratorium on new admissions and enforcement at the border.", base());
  }
  let open = createGame(sc);
  for (let m = 0; m < 96; m++) {
    open = applyResult(open, "A path to citizenship for long-term residents and a higher refugee ceiling.", base());
  }
  assert.ok(restrict.country.white > open.country.white, "eight years is enough to see it");
  assert.ok(restrict.country.hispanic < open.country.hispanic);
});
