import test from "node:test";
import assert from "node:assert/strict";

import { createHouseCareer, floorBills, castVote, advanceHouseMonth, sponsorBill } from "../src/house.js";
import { createSenateCareer, advanceSenateMonth } from "../src/senate.js";
import { effectsOf, applyConsequence, applyDetonationDamage } from "../src/consequence.js";
import { thenAndNow, turningPoints, series, EVENT } from "../src/chronicle.js";
import { chamberMedian } from "../src/bills.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

/**
 * A congressional career used to leave no trace on the country: the statistics
 * on the day you retired were the ones you were sworn in with, because nothing
 * a chamber did was ever applied to them. These are the tests that this is no
 * longer true.
 */

const scenario = (o = {}) => ({
  office: "house", presidentName: "Dale Fairweather", party: "Democrat",
  startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat",
  district: "OH-6", events: "classic", ...o,
});

const house = (o = {}) => ({ ...createHouseCareer(scenario()), ...o });

/** Play a career out, optionally filing bills of your own each time you may. */
function play({ sponsor = null, months = 24, vote = "yes" } = {}) {
  let s = createHouseCareer(scenario());
  s.rank = "chair"; s.leadership = 78; s.seat = { ...s.seat, seniority: 6 };
  for (let m = 0; m < months; m++) {
    for (const b of floorBills(s)) {
      const out = castVote(s, b, vote);
      if (!out.rejected) s = out.state;
    }
    if (sponsor) {
      const out = sponsorBill(s, sponsor);
      if (!out.rejected) s = out.state;
    }
    const adv = advanceHouseMonth(s);
    s = adv.state;
    if (s.over) break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The country exists at all
// ---------------------------------------------------------------------------

test("a member is sworn into a country with statistics, at the era's baseline", () => {
  const s = createHouseCareer(scenario({ startYear: 1995 }));
  assert.ok(s.society, "society was absent from chamber careers entirely");
  assert.ok(s.society.poverty > 0);
  assert.ok(s.society.lifeExpectancy > 40);
  // 1995 is a different country from 2025 and the baselines know it.
  const modern = createHouseCareer(scenario({ startYear: 2025 }));
  assert.notEqual(s.society.crime, modern.society.crime);
});

test("a senator gets the same country", () => {
  const s = createSenateCareer(scenario({ office: "senate", seatState: "OH" }));
  assert.ok(s.society?.poverty > 0);
  assert.ok(s.baseline?.poverty > 0);
});

// ---------------------------------------------------------------------------
// Bills change it
// ---------------------------------------------------------------------------

test("a bill from the pool uses the effects a human wrote for it", () => {
  // universal_care is authored as -6 uninsured, +0.4 life expectancy.
  const fx = effectsOf({ id: "universal_care", axis: -0.55, domain: "health" });
  assert.equal(fx.uninsured, -6);
  assert.equal(fx.lifeExpectancy, 0.4);
});

test("a model-written bill has its effects derived from its own politics", () => {
  const left = effectsOf({ id: null, axis: -0.8, domain: "health" });
  const right = effectsOf({ id: null, axis: 0.8, domain: "health" });
  assert.ok(left.uninsured < 0, "a left health bill covers people");
  assert.ok(right.uninsured > 0, "a right one does the opposite");
});

test("a centrist bill barely touches the country", () => {
  const centre = effectsOf({ id: null, axis: 0.05, domain: "economy" });
  assert.deepEqual(centre, {}, "nobody has to be brave about it and nothing changes");
});

test("conviction scales the effect", () => {
  const mild = effectsOf({ id: null, axis: -0.3, domain: "economy" });
  const hard = effectsOf({ id: null, axis: -0.9, domain: "economy" });
  assert.ok(Math.abs(hard.poverty) > Math.abs(mild.poverty));
});

test("applying an effect reports what actually landed, not what was asked", () => {
  const s = house();
  s.society.uninsured = 0.5;                       // almost nobody left to cover
  const moved = applyConsequence(s, { id: "universal_care", axis: -0.55, domain: "health" });
  assert.ok(Math.abs(moved.uninsured) < 6, "clamped at the floor, and says so");
  assert.ok(s.society.uninsured >= 0.3);
});

test("a passed bill moves the country; a failed one does not", () => {
  const s = house({ month: 2 });
  const before = { ...s.society };
  const bill = { id: "universal_care", title: "Universal Coverage Act", axis: -0.55, domain: "health" };

  const out = castVote(s, bill, "yes");
  if (out.result.passed) {
    assert.notEqual(out.state.society.uninsured, before.uninsured);
    assert.ok(Object.keys(out.result.moved).length);
  } else {
    assert.equal(out.state.society.uninsured, before.uninsured);
    assert.deepEqual(out.result.moved, {});
  }
});

test("your own bill passing leaves a mark on the country", () => {
  const s = house({ month: 2, rank: "chair", leadership: 90 });
  s.seat = { ...s.seat, seniority: 8 };
  const median = chamberMedian(buildCongress(s, STATES).house);
  const out = sponsorBill(s, { title: "Rural Clinics Act", axis: median, domain: "health" });

  if (out.result.passed) {
    assert.ok(Object.keys(out.result.moved).length,
      "a law with your name on it must do something to the nation");
  }
});

// ---------------------------------------------------------------------------
// A member's agency is real
// ---------------------------------------------------------------------------

test("legislating leaves a different country from only turning up to vote", () => {
  const probe = createHouseCareer(scenario());
  const median = chamberMedian(buildCongress(probe, STATES).house);

  const legislator = play({ sponsor: { title: "Rural Clinics Act", axis: median, domain: "health" } });
  const backbencher = play({});

  const a = thenAndNow(legislator).rows;
  const b = thenAndNow(backbencher).rows;
  const differ = a.filter((row, i) => row.to !== b[i].to);
  assert.ok(differ.length, "the two countries must not be identical");
});

test("a problem left to break open takes its own bite out of the country", () => {
  const s = house();
  const before = { ...s.society };
  const moved = applyDetonationDamage(s, "justice");
  assert.ok(moved.crime > 0 && moved.unrest > 0);
  assert.ok(s.society.crime > before.crime);
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test("every month leaves an entry", () => {
  const s = play({ months: 10 });
  assert.equal(s.chronicle.length, 10);
  assert.ok(s.chronicle[0].e, "the economy of that month");
  assert.ok(s.chronicle[0].s, "and the country's statistics");
});

test("a senate month is recorded too", () => {
  let s = createSenateCareer(scenario({ office: "senate", seatState: "OH" }));
  s = advanceSenateMonth(s).state;
  assert.equal(s.chronicle.length, 1);
});

test("then-and-now compares the whole career and knows which way is better", () => {
  const s = play({ months: 12 });
  const c = thenAndNow(s);
  assert.equal(c.months, 12);
  assert.ok(c.rows.length >= 10, "eight statistics and four economic figures");

  for (const row of c.rows) {
    assert.ok(["better", "worse", "flat"].includes(row.direction));
    assert.equal(row.series.length, 12);
  }
  // Crime falling is good; home ownership falling is not. The direction is not
  // merely the sign of the change.
  const crime = c.rows.find((r) => r.id === "crime");
  if (crime && crime.change < 0) assert.equal(crime.direction, "better");
});

test("the turning points name what moved the country and how you voted", () => {
  const s = play({ months: 24 });
  const points = turningPoints(s, 6);
  assert.ok(points.length, "24 months should produce something worth pointing at");

  for (const p of points) {
    assert.ok(p.title || p.kind === EVENT.ELECTION);
    assert.ok(typeof p.absolute === "number");
  }
  // Ranked by how far they pushed things, so the first is at least as heavy.
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i - 1].weight >= points[i].weight);
  }
});

test("a chart series is thinned rather than handed over whole", () => {
  const s = play({ months: 24 });
  assert.ok(series(s, "poverty", 8).length <= 8);
  assert.equal(series(s, "poverty", 100).length, 24);
});

test("the record survives an empty career without throwing", () => {
  const fresh = house();
  assert.equal(thenAndNow(fresh), null);
  assert.deepEqual(turningPoints(fresh), []);
  assert.deepEqual(series(fresh, "poverty"), []);
});

test("an old save with no country on it still rolls forward", () => {
  const legacy = house({ month: 4 });
  delete legacy.society;
  delete legacy.baseline;
  delete legacy.chronicle;
  const { state } = advanceHouseMonth(legacy);
  assert.equal(state.month, 5);
  assert.equal(state.chronicle.length, 1);
});

test("the record stays a sensible size for a long career", () => {
  const s = play({ months: 24 });
  const bytes = JSON.stringify(s.chronicle).length;
  assert.ok(bytes / 24 < 600, `${Math.round(bytes / 24)} bytes a month is too much to carry`);
});
