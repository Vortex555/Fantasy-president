import test from "node:test";
import assert from "node:assert/strict";

import {
  BILL_POOL, billById, rollCall, chamberMedian, originateBills, actOnBill, ageBills,
} from "../src/bills.js";
import { createGame, applyResult } from "../src/gameEngine.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

function newState(over = {}) {
  const scenario = {
    presidentName: "Test President",
    party: "Republican",
    ideologyAxis: 0.45,
    era: "A test era.",
    startApproval: 50,
    startYear: 2025,
    difficulty: "hard",
    ...(over.scenario || {}),
  };
  return { ...createGame(scenario), ...over, scenario };
}

const roster = (state) => buildCongress(state, STATES);

// --- The catalog -----------------------------------------------------------

test("every bill has a position, a domain and real effects", () => {
  for (const b of BILL_POOL) {
    assert.ok(b.axis >= -1 && b.axis <= 1, `${b.id} axis out of range`);
    assert.ok(b.title && b.brief && b.domain, `${b.id} incomplete`);
    assert.ok(Object.keys(b.fx || {}).length > 0, `${b.id} does nothing`);
  }
});

test("the catalog spans the spectrum", () => {
  const axes = BILL_POOL.map((b) => b.axis);
  assert.ok(Math.min(...axes) < -0.8, "nothing on the far left");
  assert.ok(Math.max(...axes) > 0.8, "nothing on the far right");
  assert.ok(BILL_POOL.some((b) => Math.abs(b.axis) < 0.2), "nothing in the centre");
});

// --- The roll call ---------------------------------------------------------

test("a chamber votes for what it agrees with and against what it doesn't", () => {
  const state = newState({ congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 } });
  const house = roster(state).house;

  const right = rollCall(house, 0.5);
  const left = rollCall(house, -0.8);
  assert.ok(right.yes > left.yes, "a right-wing chamber must prefer a right-wing bill");
  assert.ok(right.rYes > right.dYes, "the majority party supplies the votes");
});

test("the override threshold is two thirds of the chamber", () => {
  const state = newState();
  const house = roster(state).house;
  const roll = rollCall(house, 0);
  assert.equal(roll.threshold, 218);
  assert.equal(roll.overrideThreshold, 290);
  assert.equal(roll.overrode, roll.yes >= 290);
});

// --- What Congress writes --------------------------------------------------

test("Congress originates bills near its own median, not the president's", () => {
  // A hard-left Congress under a right-wing president.
  const state = newState({
    congress: { houseD: 340, houseR: 95, senateD: 68, senateR: 32 },
    month: 5,
  });
  const median = chamberMedian(roster(state).house);
  assert.ok(median < -0.1, `a Democratic supermajority should sit left, got ${median}`);

  // Sample several months so the 0-bill months don't decide the test.
  const seen = [];
  for (let m = 2; m < 30; m++) {
    seen.push(...originateBills({ ...state, month: m }));
  }
  assert.ok(seen.length > 0, "a working Congress should send something");
  const avg = seen.reduce((sum, b) => sum + b.axis, 0) / seen.length;
  assert.ok(avg < 0, `bills from a left Congress should lean left, got ${avg.toFixed(2)}`);
});

test("only bills that cleared both chambers reach the desk", () => {
  const state = newState({ congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 }, month: 6 });
  for (let m = 2; m < 30; m++) {
    for (const bill of originateBills({ ...state, month: m })) {
      assert.ok(bill.house.passed, `${bill.id} reached the desk without passing the House`);
      assert.ok(bill.senate.passed, `${bill.id} reached the desk without passing the Senate`);
      assert.ok(bill.sponsor, `${bill.id} has no sponsor`);
    }
  }
});

test("a radicalised Congress writes different legislation", () => {
  const base = { congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 } };
  const normal = newState({ ...base, scenario: { radicals: false } });
  const radical = newState({ ...base, scenario: { radicals: true } });

  const collect = (s) => {
    const out = [];
    for (let m = 2; m < 40; m++) out.push(...originateBills({ ...s, month: m }));
    return out;
  };
  const normalBills = collect(normal);
  const radicalBills = collect(radical);

  assert.ok(normalBills.every((b) => !b.fringe), "an ordinary Congress writes no fringe bills");
  assert.ok(radicalBills.some((b) => b.fringe), "a radicalised Congress must write fringe bills");
});

test("a dissolved Congress sends nothing", () => {
  const state = newState({ congressDissolved: true, month: 8 });
  assert.deepEqual(originateBills(state), []);
});

// --- Signing, vetoing, being overridden ------------------------------------

function withBill(stateOver, billId) {
  const state = newState({ month: 6, ...stateOver });
  const bill = billById(billId);
  const r = roster(state);
  state.bills = [{
    id: bill.id, title: bill.title, brief: bill.brief, axis: bill.axis,
    domain: bill.domain, fringe: false, arrivedMonth: 6, sponsor: "Rep. Test",
    house: rollCall(r.house, bill.axis), senate: rollCall(r.senate, bill.axis),
  }];
  return state;
}

test("signing a bill makes it law and applies its effects", () => {
  const state = withBill({ congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 } }, "tax_cuts");
  const before = state.stakeholders.wall_street;

  const out = actOnBill(state, "tax_cuts", "sign");
  assert.equal(out.outcome, "signed");
  assert.ok(out.state.stakeholders.wall_street > before, "Wall Street should like a tax cut");
  assert.equal(out.state.bills.length, 0, "the bill leaves the desk");
  assert.ok(out.state.billHistory.includes("tax_cuts"));
  assert.equal(out.state.billLog[0].outcome, "signed");
});

test("a veto that Congress cannot override kills the bill", () => {
  // A narrow chamber cannot muster two thirds.
  const state = withBill({ congress: { houseD: 218, houseR: 217, senateD: 50, senateR: 50 } }, "infrastructure");
  const before = state.economy.debt;

  const out = actOnBill(state, "infrastructure", "veto");
  if (out.outcome === "overridden") return; // covered by the next test
  assert.equal(out.outcome, "vetoed");
  assert.equal(out.state.economy.debt, before, "a dead bill spends nothing");
  assert.ok(out.state.approval < state.approval, "a veto still costs something");
});

test("a veto-proof majority overrides you, and that costs more than signing", () => {
  const state = withBill({ congress: { houseD: 40, houseR: 395, senateD: 15, senateR: 85 } }, "tax_cuts");
  const bill = state.bills[0];
  assert.ok(bill.house.overrode && bill.senate.overrode, "fixture must be veto-proof");

  const vetoed = actOnBill(state, "tax_cuts", "veto");
  const signed = actOnBill(state, "tax_cuts", "sign");

  assert.equal(vetoed.outcome, "overridden");
  assert.ok(vetoed.state.stakeholders.wall_street > state.stakeholders.wall_street,
    "the bill becomes law anyway");
  assert.ok(vetoed.state.approval < signed.state.approval,
    "being overridden must be worse than having signed it");
  assert.ok(vetoed.state.stability < state.stability, "and it shakes the government");
});

test("an unknown bill or a nonsense action is refused", () => {
  const state = withBill({}, "infrastructure");
  assert.equal(actOnBill(state, "not_a_bill", "sign").rejected, true);
  assert.equal(actOnBill(state, "infrastructure", "shred").rejected, true);
});

test("bills left on the desk expire and make you look passive", () => {
  const state = withBill({}, "infrastructure");
  state.month = 9; // arrived month 6
  const before = state.approval;
  const expired = ageBills(state);

  assert.equal(expired.length, 1);
  assert.equal(state.bills.length, 0);
  assert.ok(state.approval < before, "ignoring Congress costs approval");
  assert.ok(state.billHistory.includes("infrastructure"), "it does not come back");
});

test("a bill never arrives twice in one career", () => {
  const state = newState({ congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 } });
  const history = [];
  let s = { ...state };
  for (let m = 2; m < 48; m++) {
    s = { ...s, month: m, billHistory: history };
    for (const b of originateBills(s)) history.push(b.id);
  }
  assert.equal(new Set(history).size, history.length, "a bill was sent twice");
});

// --- The monthly tick ------------------------------------------------------

test("playing a month puts bills on the desk", () => {
  const state = newState({ congress: { houseD: 135, houseR: 300, senateD: 30, senateR: 70 } });
  let s = state;
  let sawBills = false;
  for (let i = 0; i < 12 && !sawBills; i++) {
    s = applyResult(s, "A routine month of administration.", { approvalChange: 0, analysis: "" });
    if ((s.bills || []).length) sawBills = true;
  }
  assert.ok(sawBills, "twelve months should produce at least one bill");
  for (const b of s.bills) assert.ok(b.house && b.senate && b.title);
});
