import test from "node:test";
import assert from "node:assert/strict";

import {
  SENATE_TERM, CLOTURE, createSenateCareer, seatForState, stateOptions,
  floorBills, castVote, filibuster, decayGrudges, liveGrudges,
  runReelection, advanceSenateMonth,
} from "../src/senate.js";
import { createGame } from "../src/gameEngine.js";
import { runCongressionalCycle } from "../src/elections.js";
import { rankIndex } from "../src/committees.js";

const scenario = (o = {}) => ({
  office: "senate", presidentName: "Marguerite Vance", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, ideology: "Social Democrat", seatState: "OH", ...o,
});
const game = ({ scenario: sc, ...rest } = {}) => ({ ...createSenateCareer(scenario(sc)), ...rest });
const bill = (axis, domain = "economy") => ({ id: `b${axis}`, title: "A Bill", axis, domain });

// --- The seat ---------------------------------------------------------------

test("createGame routes a Senate scenario, and the other offices still work", () => {
  assert.equal(createGame(scenario()).office, "senate");
  assert.equal(createGame({ office: "house", presidentName: "X", party: "Democrat",
    startYear: 2025, ideologyAxis: -0.3, district: "OH-6" }).office, "house");
  assert.equal(createGame({ presidentName: "X", party: "Democrat", startYear: 2025,
    startApproval: 51, ideologyAxis: -0.3 }).office, "president");
});

test("a senator represents a whole state, not a district", () => {
  const s = game();
  assert.equal(s.seat.state, "OH");
  assert.equal(s.seat.stateName, "Ohio");
  assert.ok(Number.isFinite(s.seat.lean));
  assert.ok(s.seat.class >= 1 && s.seat.class <= 3, "the seat sits in a real class");
});

test("the District has no senators", () => {
  assert.equal(seatForState(game(), "DC"), null);
});

test("the picker offers safe, marginal and hostile states", () => {
  const kinds = new Set(stateOptions(game()).map((o) => o.kind));
  for (const k of ["safe", "marginal", "hostile"]) assert.ok(kinds.has(k));
});

test("a term is six years", () => {
  assert.equal(SENATE_TERM, 72);
});

// --- One vote in a hundred --------------------------------------------------

test("the chamber is a hundred, not four hundred and thirty-five", () => {
  const out = castVote(game(), bill(-0.45), "yes");
  assert.equal(out.result.tally.total, 100);
});

test("a vote your state hated becomes a grudge rather than a permanent wound", () => {
  const s = game({ scenario: { seatState: "WV" } });   // a hostile state
  const out = castVote(s, bill(-0.6), "yes");          // a bill the state loathes
  assert.ok(out.state.grudges.length === 1);
  assert.equal(out.state.grudges[0].id, "b-0.6");
  assert.ok(out.state.grudges[0].weight > 0);
});

test("a vote your state liked leaves nothing to forgive", () => {
  const s = game({ scenario: { seatState: "MA" } });
  const out = castVote(s, bill(-0.6), "yes");
  assert.equal(out.state.grudges.length, 0);
});

test("your vote is counted, and can be the one that decides it", () => {
  const out = castVote(game(), bill(-0.4), "yes");
  assert.equal(typeof out.result.passed, "boolean");
  assert.equal(typeof out.result.decisive, "boolean");
});

// --- The long memory --------------------------------------------------------

test("the state forgets, slowly", () => {
  let s = { ...game(), grudges: [{ id: "x", title: "X", weight: 8, month: 1, term: 1 }], approval: 40 };
  const before = s.grudges[0].weight;
  for (let m = 0; m < 24; m++) s = decayGrudges(s).state;
  assert.ok(s.grudges.length === 0 || s.grudges[0].weight < before * 0.5,
    "two years should take most of the sting out");
  assert.ok(s.approval > 40, "and give the standing back");
});

test("what the state has not forgotten still counts at the ballot box", () => {
  const clean = game();
  const grudged = { ...game(), grudges: [{ id: "x", title: "X", weight: 9, month: 60, term: 1 }] };
  assert.ok(runReelection(clean).margin > runReelection(grudged).margin);
  assert.ok(runReelection(grudged).remembered < 0);
});

test("early bravery is survivable in a way late bravery is not", () => {
    // The same vote a conservative state hates, taken in year one and in year six.
  const seat = { scenario: { seatState: "WV" } };
  const early = { ...game(seat), month: 1 };
  let a = castVote(early, bill(-0.75), "yes").state;
  assert.ok(a.grudges.length === 1, "the state took offence");
  for (let m = 1; m < 60; m++) a = decayGrudges(a).state;

  const late = { ...game(seat), month: 66 };
  const b = castVote(late, bill(-0.75), "yes").state;

  assert.ok(runReelection(a).margin > runReelection(b).margin,
    "six years of forgetting is the whole point of the chamber");
});

// --- The filibuster ---------------------------------------------------------

test("any senator can hold the floor, however junior", () => {
  const out = filibuster(game(), bill(0.5));
  assert.equal(out.rejected, undefined);
  assert.equal(out.state.filibusters.length, 1);
  assert.equal(out.result.cloture, CLOTURE);
});

test("a filibustered bill needs sixty, not fifty-one", () => {
  const held = filibuster(game(), bill(-0.45)).state;
  const out = castVote(held, bill(-0.45), "no");
  assert.equal(out.result.filibustered, true);
  assert.equal(out.result.bar, CLOTURE);
});

test("filibustering your own caucus costs far more than filibustering theirs", () => {
  const s = game();
  const ownSide = filibuster(s, bill(-0.4));    // a Democrat bill, a Democrat senator
  const theirs = filibuster(s, bill(0.6));
  assert.ok(ownSide.state.leadership < theirs.state.leadership);
  assert.equal(ownSide.result.againstCaucus, true);
});

test("you cannot filibuster the same bill twice, or one already voted on", () => {
  const once = filibuster(game(), bill(0.5));
  assert.equal(filibuster(once.state, bill(0.5)).rejected, true);
  const voted = castVote(game(), bill(0.5), "no").state;
  assert.equal(filibuster(voted, bill(0.5)).rejected, true);
});

// --- Six years --------------------------------------------------------------

test("a senator faces the voters once every six years", () => {
  let s = game();
  let elections = 0;
  for (let i = 0; i < SENATE_TERM * 2; i++) {
    const out = advanceSenateMonth(s);
    s = out.state;
    if (out.reelection) elections++;
    if (s.over) break;
  }
  assert.ok(elections <= 2, `two terms should mean at most two elections, got ${elections}`);
});

test("winning clears the slate; the state genuinely starts over", () => {
  const ready = { ...game({ scenario: { seatState: "MA" } }), month: SENATE_TERM, approval: 68,
    grudges: [{ id: "x", title: "X", weight: 6, month: 20, term: 1 }] };
  const out = advanceSenateMonth(ready);
  if (out.reelection?.won) {
    assert.equal(out.state.grudges.length, 0);
    assert.equal(out.state.seat.seniority, 2);
    assert.equal(out.state.month, 1);
  }
});

test("losing ends the career, and says how many years it was", () => {
  const doomed = { ...game({ scenario: { seatState: "WV" } }), month: SENATE_TERM, approval: 14 };
  const out = advanceSenateMonth(doomed);
  if (!out.reelection?.won) {
    assert.equal(out.state.over, true);
    assert.equal(out.state.ending.type, "unseated");
    assert.ok(/years in the Senate/.test(out.state.ending.reason));
  }
});

test("bills still reach the floor, at a chamber's pace", () => {
  let total = 0;
  for (let m = 1; m <= 36; m++) total += floorBills({ ...game(), month: m }).length;
  assert.ok(total > 5, "the Senate does eventually do something");
});

// --- The country goes to the polls without you -------------------------------
//
// A six-year term contains three congressional elections and a senator is on
// the ballot for one of them. The other two still happen, and used to not: the
// chamber a career was handed in its first month was the chamber it died in.

test("the chamber is elected every two years, whether or not you are", () => {
  const s = { ...game(), month: 24 };
  const out = advanceSenateMonth(s);
  assert.ok(out.cycle, "a congressional election was held");
  assert.equal(out.reelection, null, "but not yours — your class is not up");
  assert.equal(out.state.month, 25, "and the month still turns over");
  assert.notDeepEqual(out.state.congress, s.congress, "the seat counts moved");
});

test("nothing is elected in an ordinary month", () => {
  const out = advanceSenateMonth({ ...game(), month: 11 });
  assert.equal(out.cycle, undefined);
});

test("a mid-term election can take the gavel off you", () => {
  // A chair whose party is about to be swept out of the majority.
  const chair = {
    ...game(), month: 24, rank: "chair", leadership: 90,
    seat: { ...game().seat, seniority: 3 },
    congress: { houseD: 220, houseR: 215, senateD: 51, senateR: 49 },
    president: { ...game().president, party: "Democrat", approval: 24 },
    economy: { gdpGrowth: -2.4, unemployment: 9.5, inflation: 7.2, debt: 41 },
  };
  const out = advanceSenateMonth(chair);
  assert.ok(out.cycle);
  if (out.state.congress.senateD <= out.state.congress.senateR) {
    assert.ok(rankIndex(out.state.rank) < rankIndex("chair"),
      "you cannot chair a committee your party no longer runs");
    assert.ok(out.ladder, "and you are told about it");
  }
});

test("the President's standing moves over a career that outlasts the news", () => {
  let s = game();
  const started = s.president.approval;
  const seen = new Set([started]);
  for (let m = 0; m < 30; m++) {
    s = advanceSenateMonth(s).state;
    seen.add(s.president.approval);
  }
  assert.ok(seen.size > 4, "a static president makes every election night identical");
  assert.ok(s.president.approval >= 0 && s.president.approval <= 100);
});

// --- The cycle itself --------------------------------------------------------

test("an unpopular president costs their own party seats", () => {
  const base = {
    ...game(),
    congress: { houseD: 230, houseR: 205, senateD: 53, senateR: 47 },
    arcs: [],
  };
  const sinking = runCongressionalCycle({
    ...base,
    president: { ...base.president, party: "Democrat", approval: 26 },
    economy: { gdpGrowth: -1.8, unemployment: 8.9, inflation: 6.5, debt: 40 },
  }, { index: 1 });
  const soaring = runCongressionalCycle({
    ...base,
    president: { ...base.president, party: "Democrat", approval: 68 },
    economy: { gdpGrowth: 3.6, unemployment: 3.4, inflation: 2.1, debt: 32 },
  }, { index: 1 });

  assert.ok(sinking.houseSwing < soaring.houseSwing,
    "the President's record lands on their own party's seats");
  assert.ok(sinking.congress.houseD < base.congress.houseD);
});

test("a cycle keeps both chambers whole and tells you who runs them", () => {
  const out = runCongressionalCycle(game(), { index: 2 });
  assert.equal(out.congress.houseD + out.congress.houseR, 435);
  assert.equal(out.congress.senateD + out.congress.senateR, 100);
  assert.ok(["Republican", "Democrat"].includes(out.control.house));
  assert.ok(["Republican", "Democrat"].includes(out.control.senate));
  assert.equal(typeof out.note, "string");
  assert.ok(out.note.length > 10);
  assert.equal(out.year, 2025 + 2 * 2 - 1, "the third election of the career is 2028");
});

test("only a third of the Senate is ever on the ballot", () => {
  const seen = new Set();
  for (const index of [1, 2, 3, 4]) seen.add(runCongressionalCycle(game(), { index }).cycle);
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test("midterms and presidential years alternate", () => {
  assert.equal(runCongressionalCycle(game(), { index: 1 }).midterm, true);
  assert.equal(runCongressionalCycle(game(), { index: 2 }).midterm, false);
  assert.equal(runCongressionalCycle(game(), { index: 3 }).midterm, true);
});

test("a cycle is deterministic — the same night twice is the same night", () => {
  const s = game();
  assert.deepEqual(runCongressionalCycle(s, { index: 1 }), runCongressionalCycle(s, { index: 1 }));
});

/**
 * The swing each cycle is measured against a neutral map, so applying it to
 * last cycle's result compounds it: a president 15 points under water costs
 * their party the same 20 seats over and over until the chamber reads 0–435.
 * It has to be applied to the chamber the career was handed, with a memory.
 */
const disaster = (s) => ({
  ...s,
  president: { ...s.president, party: "Democrat", approval: 22 },
  economy: { gdpGrowth: -2.6, unemployment: 9.8, inflation: 7.4, debt: 44 },
});

test("a bad presidency costs seats without emptying the chamber", () => {
  let s = disaster({ ...game(), congress: { houseD: 230, houseR: 205, senateD: 53, senateR: 47 } });
  const counts = [];
  for (let index = 1; index <= 8; index++) {
    const out = runCongressionalCycle(s, { index });
    s = { ...s, congress: out.congress, congressStart: out.congressStart, congressDrift: out.congressDrift };
    counts.push(out.congress.houseD);
  }
  assert.ok(counts[0] < 230, "the first bad night costs real seats");
  assert.ok(Math.min(...counts) >= 120,
    `eight bad nights should not leave 435 seats one-sided: ${counts.join(", ")}`);
  // And it settles rather than sliding: the last two nights are close together.
  assert.ok(Math.abs(counts[7] - counts[6]) < Math.abs(counts[1] - counts[0]) + 1);
});

test("a wave that passes is a wave that recedes", () => {
  const base = { ...game(), congress: { houseD: 230, houseR: 205, senateD: 53, senateR: 47 } };
  let s = disaster(base);
  let out = runCongressionalCycle(s, { index: 1 });
  const trough = out.congress.houseD;

  // The presidency recovers, and the seats come back with it.
  s = {
    ...base,
    congressStart: out.congressStart, congressDrift: out.congressDrift, congress: out.congress,
    president: { ...base.president, party: "Democrat", approval: 64 },
    economy: { gdpGrowth: 3.4, unemployment: 3.6, inflation: 2.2, debt: 33 },
  };
  out = runCongressionalCycle(s, { index: 2 });
  assert.ok(out.congress.houseD > trough,
    `seats should return when the weather does: ${trough} → ${out.congress.houseD}`);
});

test("a career remembers which chamber it was handed", () => {
  const s = { ...game(), congress: { houseD: 230, houseR: 205, senateD: 53, senateR: 47 } };
  const out = runCongressionalCycle(s, { index: 1 });
  assert.deepEqual(out.congressStart, s.congress);
  assert.ok(Number.isFinite(out.congressDrift.house));
  assert.ok(Number.isFinite(out.congressDrift.senate));
});
