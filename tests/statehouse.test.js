import test from "node:test";
import assert from "node:assert/strict";

import {
  STATE_HOUSE, STATE_SENATE, STATE_BILLS, chamberFor, senateFor, inSession, dayJob,
  buildChamber, buildStateSenate, chamberSplit, budgetOf, applyBudget, seatsIn,
  districtOptions, stateFloor, stateRollCall, buildGovernor, stateBillById,
  throughTheBuilding, applyStateVote,
} from "../src/statehouse.js";
import { LADDER, officeAt, rungOf } from "../src/career.js";
import { STATES } from "../src/states.js";

/**
 * The bottom rung.
 *
 * A career used to begin in the United States House of Representatives, which
 * almost none of them do. It begins in a chamber nobody outside the state has
 * heard of, sitting three or four months a year, paying an amount of money that
 * decides who can afford to serve in it at all.
 *
 * Everything asserted here is a real fact about a real legislature, because the
 * whole reason to model this rung is that its constraints are nothing like
 * Congress's and are the more interesting for it.
 */

const seat = (code = "OH", o = {}) => ({
  office: "statehouse",
  rosterSeed: `test|${code}`,
  month: 2,
  term: 1,
  seat: { state: code, stateName: STATES[code].name, district: `${code}-3`, lean: STATES[code].lean },
  scenario: { party: "Republican", presidentName: "Daniel Tolpa", ideologyAxis: 0.6 },
  ...o,
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test("the ladder now starts where careers actually start", () => {
  assert.equal(LADDER[0].id, "statehouse");
  assert.equal(rungOf("statehouse") < rungOf("house"), true);
  assert.equal(officeAt("statehouse").minAge, 21, "twenty-one is the commonest floor");
  assert.equal(officeAt("statehouse").termYears, 2);
});

// ---------------------------------------------------------------------------
// Real chambers
// ---------------------------------------------------------------------------

test("every state has a lower chamber and none of them is the same size", () => {
  for (const code of Object.keys(STATES)) {
    if (code === "DC") continue;
    const chamber = STATE_HOUSE[code];
    assert.ok(chamber, `${code} has no chamber`);
    assert.ok(chamber.seats > 0 && chamber.seats <= 400);
    assert.ok(chamber.term === 2 || chamber.term === 4);
  }
});

test("the sizes are the real sizes, which is most of the point", () => {
  // New Hampshire has four hundred representatives and pays them $100 a year.
  assert.equal(STATE_HOUSE.NH.seats, 400);
  assert.equal(STATE_HOUSE.NH.pay, 100);
  // Delaware has forty-one. Nebraska has forty-nine and no second chamber.
  assert.equal(STATE_HOUSE.DE.seats, 41);
  assert.equal(STATE_HOUSE.NE.unicameral, true);
  assert.equal(STATE_HOUSE.NE.nonpartisan, true, "and no party labels on the ballot");
  // Texas legislates for five months every two years and pays $7,200.
  assert.equal(STATE_HOUSE.TX.pay, 7200);
});

test("a chamber of four hundred and a chamber of forty-one are not the same institution", () => {
  const nh = chamberSplit(buildChamber(seat("NH")));
  const de = chamberSplit(buildChamber(seat("DE")));
  assert.equal(nh.total, 400);
  assert.equal(de.total, 41);
});

test("state legislatures are far more lopsided than Congress", () => {
  // A safe state routinely produces a two-to-one chamber, which is the single
  // most important fact about legislating in one.
  const wv = chamberSplit(buildChamber(seat("WV")));
  const bigger = Math.max(wv.R, wv.D);
  const smaller = Math.min(wv.R, wv.D);
  assert.ok(bigger > smaller * 1.5, `${bigger} to ${smaller} is not a supermajority`);
});

test("Nebraska's chamber has no parties in it at all", () => {
  const ne = chamberSplit(buildChamber(seat("NE")));
  assert.equal(ne.N, 49);
  assert.equal(ne.R + ne.D, 0);
});

// ---------------------------------------------------------------------------
// It is part-time, which is the job
// ---------------------------------------------------------------------------

test("the legislature is not sitting most of the year", () => {
  const texas = seat("TX");
  const sitting = [];
  for (let month = 1; month <= 12; month += 1) {
    if (inSession({ ...texas, month })) sitting.push(month);
  }
  assert.deepEqual(sitting, [1, 2, 3, 4, 5], "Texas sits January to May and then goes home");
  assert.ok(sitting.length < 12);
});

test("and the full-time ones genuinely are", () => {
  const pa = seat("PA");
  let sitting = 0;
  for (let month = 1; month <= 12; month += 1) if (inSession({ ...pa, month })) sitting += 1;
  assert.equal(sitting, 12);
  assert.equal(dayJob(pa), null, "nobody in Pennsylvania has a second job on $106,000");
});

test("out of session you are at the job that pays, and the game says what it pays", () => {
  const job = dayJob(seat("NH"));
  assert.ok(job.what.length > 5);
  assert.match(job.note, /\$100 a year/);

  const texas = dayJob(seat("TX"));
  assert.match(texas.note, /cannot live on it/);
});

// ---------------------------------------------------------------------------
// The budget has to balance
// ---------------------------------------------------------------------------

test("a state cannot print money, so every bill comes out of another line", () => {
  const s = seat("OH", { budget: 40 });
  const moved = applyBudget(s, stateBillById("s_medicaid"));

  assert.ok(moved < 0, "expansion costs money");
  assert.equal(s.budget, 40 - 62);
  assert.equal(budgetOf(s).balanced, false);
  assert.match(budgetOf(s).note, /deficit/);
});

test("and some bills pay for themselves by cutting something", () => {
  const s = seat("OH", { budget: 0 });
  applyBudget(s, stateBillById("s_sentencing"));
  assert.ok(s.budget > 0, "not funding two new prison wings is money");
});

test("the budget bill is the one that has to pass, and it comes at the end", () => {
  // Ohio sits all year, so the session closes in December.
  const s = seat("OH", { month: 12, voteLog: [] });
  const floor = stateFloor(s);
  assert.equal(floor.length, 1);
  assert.equal(floor[0].id, "s_budget");
});

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

test("there is no floor at all when the chamber is not sitting", () => {
  assert.deepEqual(stateFloor(seat("TX", { month: 8 })), []);
  assert.ok(stateFloor(seat("TX", { month: 3 })).length > 0);
});

test("nothing on the docket is a national issue, and all of it is a state's business", () => {
  assert.ok(STATE_BILLS.length >= 12);
  for (const bill of STATE_BILLS) {
    assert.ok(bill.brief.length > 30, `${bill.id} does not say what it does`);
    assert.ok(Number.isFinite(bill.cost), `${bill.id} has no effect on a budget that must balance`);
    assert.ok(Math.abs(bill.axis) <= 1);
  }
  // The things a state legislature actually fights about.
  const ids = STATE_BILLS.map((b) => b.id);
  for (const expected of ["s_roads", "s_teacher_pay", "s_medicaid", "s_licensing", "s_budget"]) {
    assert.ok(ids.includes(expected), `no ${expected}`);
  }
});

test("a bill already voted on does not come back", () => {
  const s = seat("OH", { month: 3, voteLog: STATE_BILLS.slice(0, 14).map((b) => ({ id: b.id })) });
  const floor = stateFloor(s);
  for (const bill of floor) assert.equal(bill.id, "s_budget");
});

/**
 * A live session produced a coal-subsidy bill whose caucus card said YES and
 * whose roll call came back 15-85 — because the card is computed by `stanceFit`,
 * which reads the issue axes, and this roll call had invented its own
 * arithmetic on the partisan axis alone. Two halves of one screen disagreeing
 * about the same vote is the exact failure this codebase has fixed twice
 * before, so the state chamber is now counted by the same engine that counts
 * Congress.
 */
test("the count and the stance cards are computed by the same engine", () => {
  const s = seat("WV");
  const members = buildChamber(s);
  // A bill whose partisan axis and economics point opposite ways is precisely
  // the case that pulled the two apart.
  const awkward = { id: "t", title: "Coal Grants", axis: 0.6, economic: -0.4, domain: "economy" };
  const out = stateRollCall(s, awkward, members);

  assert.equal(out.yes + out.no, out.total);
  assert.ok(out.yes > out.total / 2,
    "a Republican bill in an 84-16 Republican chamber has to carry, whatever its economics field says");
});

test("the roll call is the chamber's arithmetic, at the chamber's real size", () => {
  const s = seat("WV");
  const members = buildChamber(s);
  const out = stateRollCall(s, stateBillById("s_permitless"), members);

  assert.equal(out.total, 100);
  assert.equal(out.threshold, 51);
  assert.equal(out.yes + out.no, out.total);
  assert.equal(out.passed, out.yes >= out.threshold);
});

test("a bill the chamber's own politics likes carries there and fails elsewhere", () => {
  const wv = buildChamber(seat("WV"));
  const ca = buildChamber(seat("CA"));
  const carry = stateBillById("s_permitless");

  const here = stateRollCall(seat("WV"), carry, wv);
  const there = stateRollCall(seat("CA"), carry, ca);
  assert.ok(here.yes / here.total > there.yes / there.total,
    "constitutional carry does better in West Virginia than in California");
});

// ---------------------------------------------------------------------------
// The seat, and the governor
// ---------------------------------------------------------------------------

test("a state seat is small, and the number in the name is all anybody knows about it", () => {
  const seats = seatsIn("NH");
  assert.ok(seats.length > 1);
  assert.match(seats[0].seat, /^NH-\d+$/);
  assert.ok(seats[0].people < 10000, "a New Hampshire seat is about 3,300 people");
  assert.ok(seatsIn("CA")[0].people > 30000);
});

test("there are three seats worth choosing between, as everywhere else", () => {
  const options = districtOptions("OH");
  assert.ok(options.length >= 2);
  assert.ok(options.every((o) => o.seat && o.stateName));
});

test("the governor is drawn from the state, and often is not of its party", () => {
  const parties = new Set();
  for (const code of ["WV", "CA", "OH", "MA", "TX", "VT", "KS", "MD"]) {
    parties.add(buildGovernor(seat(code)).party);
  }
  assert.equal(parties.size, 2, "governors run ahead of their states constantly");
  const g = buildGovernor(seat("WV"));
  assert.ok(g.name.includes(" "));
  assert.ok(g.approval >= 30 && g.approval <= 70);
});

test("the same state produces the same chamber and the same governor every time", () => {
  assert.equal(buildGovernor(seat("WV")).name, buildGovernor(seat("WV")).name);
  assert.deepEqual(chamberSplit(buildChamber(seat("WV"))), chamberSplit(buildChamber(seat("WV"))));
});

// ---------------------------------------------------------------------------
// The rest of the building
// ---------------------------------------------------------------------------

/**
 * The mode shipped with a bill going from this floor straight to the governor,
 * which is how legislating works in exactly one state. Forty-nine of them have
 * a second chamber, and the whole passage pipeline built for Congress applies
 * here for the same reasons.
 */
test("every state but one has a second chamber, and it is much smaller", () => {
  for (const code of Object.keys(STATE_HOUSE)) {
    if (code === "NE" || code === "DC") continue;
    const senate = STATE_SENATE[code];
    assert.ok(senate, `${code} has no senate`);
    assert.ok(senate.seats < STATE_HOUSE[code].seats,
      `${code}'s senate is not smaller than its house`);
  }
  // Twenty-four senators against four hundred representatives.
  assert.equal(STATE_SENATE.NH.seats, 24);
  assert.equal(STATE_SENATE.TX.seats, 31);
});

test("Nebraska has no second chamber to send anything to", () => {
  assert.equal(senateFor("NE"), null);
  const s = seat("NE", { governor: { name: "G", party: "Republican" } });
  const out = throughTheBuilding(s, { id: "x", axis: 0.5, domain: "economy" });
  assert.equal(out.senate, null, "there is nowhere for it to go but the desk");
  assert.equal(out.enacted, true);
});

test("a bill that carries here can still die in the state senate", () => {
  const s = seat("VT", { governor: { name: "G", party: "Democrat" } });
  // Hard right in Vermont: the house might carry it in a fluke, the senate will not.
  const out = throughTheBuilding(s, { id: "x", axis: 0.9, domain: "economy" });
  if (!out.enacted && out.stage === "senate") {
    assert.match(out.note, /died in the state senate/);
    assert.ok(out.senate.no > out.senate.yes);
  }
});

/**
 * The most under-appreciated number in American government. A veto falls to a
 * simple majority in six states, which means the governor can be overridden by
 * exactly the vote that passed the bill — and those governorships are weak for
 * that reason and no other.
 */
test("a veto is worth far less in West Virginia than in Texas", () => {
  assert.equal(STATE_SENATE.WV.override, 0.5);
  assert.equal(STATE_SENATE.KY.override, 0.5);
  assert.equal(STATE_SENATE.TX.override, 2 / 3);
  assert.equal(STATE_SENATE.OH.override, 0.6);

  const bill = { id: "x", axis: 0.5, domain: "economy" };
  const hostileGovernor = { name: "G", party: "Democrat" };
  const wv = throughTheBuilding(seat("WV", { governor: hostileGovernor }), bill);

  assert.equal(wv.override.share, 0.5, "a simple majority overrides here");
  if (wv.enacted) assert.match(wv.note, /worth so little/);
});

test("the override threshold is the state's own, and the note says which", () => {
  const bill = { id: "x", axis: 0.6, domain: "economy" };
  const gov = { name: "G", party: "Democrat" };
  const tx = throughTheBuilding(seat("TX", { governor: gov }), bill);
  const wv = throughTheBuilding(seat("WV", { governor: gov }), bill);

  if (tx.override && wv.override) {
    assert.ok(tx.override.need / 150 > wv.override.need / 100,
      "Texas needs a far larger share of its chamber than West Virginia does");
  }
});

test("only a bill that clears every gate moves the budget", () => {
  const bill = { id: "s_medicaid", title: "Medicaid", axis: -0.55, domain: "health", cost: 62 };
  const stances = {
    party: { position: "yes", intensity: 40 },
    district: { position: "yes", intensity: 40 },
    conviction: { position: "yes", intensity: 40 },
  };
  const s = seat("WV", { approval: 50, leadership: 50, budget: 0, voteLog: [] });
  s.governor = { name: "G", party: "Republican" };
  const out = applyStateVote(s, bill, "yes", stances);

  assert.ok(out.note.length > 20, "and the note says which gate it died at");
  if (out.enacted) {
    assert.equal(s.budget, -62, "a law costs the state what the bill said it would");
  } else {
    assert.equal(s.budget, 0, "a bill that never became law costs nothing");
    assert.equal(out.budget.moved, 0);
  }
});
