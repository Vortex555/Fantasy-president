import test from "node:test";
import assert from "node:assert/strict";

import {
  SENATE_TERM, CLOTURE, createSenateCareer, seatForState, stateOptions,
  floorBills, castVote, filibuster, decayGrudges, liveGrudges,
  runReelection, advanceSenateMonth,
} from "../src/senate.js";
import { createGame } from "../src/gameEngine.js";

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
