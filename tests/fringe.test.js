import test from "node:test";
import assert from "node:assert/strict";

import {
  createHouseCareer, floorBills, docketSize, fringeMonth, fringeSide, fringeBillFor, seatFringe,
} from "../src/house.js";
import {
  createSenateCareer, floorBills as senateFloor, docketSize as senateSize,
} from "../src/senate.js";
import { FRINGE_CHANCE, FRINGE_BILLS, fringeChance } from "../src/bills.js";
import { validateDocket } from "../src/chamberAi.js";

/**
 * The fringe gets floor time at a stated rate: about one month in twenty
 * normally, one in two under a radicalised government. Before this it was
 * never at all without the toggle, and at an unmeasured rate with it.
 */

const scenario = (o = {}) => ({
  office: "house", presidentName: "Dale Fairweather", party: "Democrat",
  startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat", district: "OH-6", ...o,
});

const house = (o = {}, sc = {}) => ({ ...createHouseCareer(scenario(sc)), ...o });

/** How often a fringe bill actually reaches the floor, across many careers. */
function rate(make, floor, size, radicals, careers = 400) {
  let months = 0, hits = 0, extras = 0;
  const sides = { left: 0, right: 0 };
  for (let s = 0; s < careers; s++) {
    const base = make({ presidentName: `Member ${s}`, radicals });
    for (let m = 1; m <= 24; m++) {
      const st = { ...base, term: 1, month: m };
      if (!size(st)) continue;          // an empty floor cannot seat anything
      months++;
      const f = floor(st).filter((b) => b.fringe);
      if (f.length) {
        hits++;
        extras += f.length - 1;
        sides[f[0].axis < 0 ? "left" : "right"]++;
      }
    }
  }
  return { pct: (hits / months) * 100, extras, sides };
}

const HOUSE = (o) => createHouseCareer(scenario(o));
const SENATE = (o) => createSenateCareer(scenario({ office: "senate", seatState: "OH", ...o }));

// ---------------------------------------------------------------------------
// The rate
// ---------------------------------------------------------------------------

test("an ordinary chamber gives the fringe about one month in twenty", () => {
  const { pct } = rate(HOUSE, floorBills, docketSize, false);
  assert.ok(pct > 3.5 && pct < 7, `${pct.toFixed(1)}% should be near 5%`);
});

test("a radicalised chamber gives it half of them", () => {
  const { pct } = rate(HOUSE, floorBills, docketSize, true);
  assert.ok(pct > 45 && pct < 55, `${pct.toFixed(1)}% should be near 50%`);
});

test("the Senate is held to the same rate as the House", () => {
  assert.ok(rate(SENATE, senateFloor, senateSize, false).pct < 7);
  const radical = rate(SENATE, senateFloor, senateSize, true).pct;
  assert.ok(radical > 45 && radical < 55, `${radical.toFixed(1)}%`);
});

test("the stated rates are what the code actually uses", () => {
  assert.equal(fringeChance(house({}, { radicals: false })), FRINGE_CHANCE.normal);
  assert.equal(fringeChance(house({}, { radicals: true })), FRINGE_CHANCE.radical);
  assert.equal(FRINGE_CHANCE.normal, 0.05);
  assert.equal(FRINGE_CHANCE.radical, 0.5);
});

// ---------------------------------------------------------------------------
// What reaches the floor
// ---------------------------------------------------------------------------

test("never more than one on a calendar", () => {
  for (const radicals of [false, true]) {
    assert.equal(rate(HOUSE, floorBills, docketSize, radicals).extras, 0);
  }
});

test("both ends of the spectrum get their turn", () => {
  const { sides } = rate(HOUSE, floorBills, docketSize, true);
  const total = sides.left + sides.right;
  assert.ok(sides.left / total > 0.3 && sides.left / total < 0.7,
    `left ${sides.left} / right ${sides.right} — neither end should be shut out`);
});

test("it takes a slot rather than adding one, so the chamber's workload is unchanged", () => {
  let checked = 0;
  for (let s = 0; s < 200 && checked < 40; s++) {
    const base = createHouseCareer(scenario({ presidentName: `M${s}`, radicals: true }));
    for (let m = 1; m <= 24; m++) {
      const st = { ...base, term: 1, month: m };
      const size = docketSize(st);
      if (!size) continue;
      assert.equal(floorBills(st).length, size);
      checked++;
    }
  }
  assert.ok(checked >= 40);
});

test("on a one-bill month the extremist bill is the whole month", () => {
  const bills = seatFringe(house({ month: 3 }, { radicals: true }), [
    { id: "infrastructure", title: "Bridges and Ports Act", axis: -0.05, domain: "economy" },
  ]);
  assert.equal(bills.length, 1);
});

test("what it seats is a real bill the engine can run", () => {
  const bill = fringeBillFor(house({ month: 3 }, { radicals: true }));
  assert.ok(bill.id && bill.title && bill.brief);
  assert.equal(typeof bill.axis, "number");
  assert.ok(Math.abs(bill.axis) >= 0.8, "it is genuinely at the end of the spectrum");
  assert.equal(bill.fringe, true);
  assert.ok(FRINGE_BILLS.some((f) => f.id === bill.id));
});

test("the side it comes from is deterministic, like everything else", () => {
  const state = house({ month: 5 }, { radicals: true });
  assert.equal(fringeSide(state), fringeSide(state));
  assert.equal(fringeMonth(state), fringeMonth(state));
  assert.ok(["left", "right"].includes(fringeSide(state)));
});

test("an ordinary draw never contains one by accident", () => {
  // The only route to the floor is the roll. A radicalised chamber used to also
  // draw them from the ordinary pool, which stacked the two routes.
  let seen = 0;
  for (let s = 0; s < 120; s++) {
    const base = createHouseCareer(scenario({ presidentName: `M${s}`, radicals: true }));
    for (let m = 1; m <= 24; m++) {
      const st = { ...base, term: 1, month: m };
      if (fringeMonth(st)) continue;              // not this month's route
      seen += floorBills(st).filter((b) => b.fringe).length;
    }
  }
  assert.equal(seen, 0);
});

// ---------------------------------------------------------------------------
// A written calendar is held to the same rule
// ---------------------------------------------------------------------------

const written = (o = {}) => ({
  title: "Federal Reserve Abolition Act", brief: "Winds up the central bank.",
  axis: 0.9, domain: "economy", extremist: true, ...o,
});

test("a model-written extremist bill is marked when it was asked for", () => {
  const [out] = validateDocket({ bills: [written()] }, house(), 1, { fringe: "right" });
  assert.equal(out.fringe, true);
});

test("a model calling an ordinary bill extremist is not believed", () => {
  const [out] = validateDocket({ bills: [written({ axis: 0.3 })] }, house(), 1, { fringe: "right" });
  assert.equal(out.fringe, false, "the position it gave does not back the claim");
});

test("an extremist bill from the wrong end is not the one that was asked for", () => {
  const [out] = validateDocket({ bills: [written({ axis: -0.9 })] }, house(), 1, { fringe: "right" });
  assert.equal(out.fringe, false);
});

test("nothing is marked on a month the fringe was not given a slot", () => {
  const [out] = validateDocket({ bills: [written()] }, house(), 1, { fringe: null });
  assert.equal(out.fringe, false);
});

test("a hard-left bill is not automatically the fringe", () => {
  // nationalise_rail sits at -0.92 and is ordinary politics; max_income at -0.88
  // is not. The distinction is editorial and the model must claim it explicitly.
  const [out] = validateDocket({
    bills: [written({ title: "Rail Nationalisation Act", axis: -0.92, extremist: false })],
  }, house(), 1, { fringe: "left" });
  assert.equal(out.fringe, false);
});
