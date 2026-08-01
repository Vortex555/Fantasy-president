import test from "node:test";
import assert from "node:assert/strict";

import { rollCall, billById, consensusOf, CONSENSUS } from "../src/bills.js";
import { factionLine, factionRoll } from "../src/factions.js";
import { validateDocket } from "../src/chamberAi.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";
import { chairAction } from "../src/committees.js";

/**
 * A bloc breaking ranks, decided by the model and frozen on the bill.
 *
 * Two axes carry the cross-cutting fights that generalise — money and state
 * power. They cannot carry the ones that do not: a trade bill that splits both
 * parties, a crypto bill that scrambles everybody, an ag subsidy that unites the
 * two farm delegations against their own leaderships. There is no third number
 * that fixes those, because the thing they have in common is being particular.
 *
 * So the model — which has the bill in front of it and knows what it does — may
 * name a bloc that breaks from where its position would put it. It says so once,
 * when the bill is written; the engine validates it, freezes it on the bill, and
 * every downstream calculation stays a function of the bill exactly as before.
 * That is the whole design: the model decides what the bill *is*, and the engine
 * decides what that means for everyone.
 */

const state = (o = {}) => ({
  rosterSeed: "demo",
  office: "house",
  congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
  scenario: {
    party: "Republican", ideology: "Groyper",
    ideologyAxis: 0.95, ideologyLiberty: 0.5,
  },
  seat: { district: "WV-2", axis: 0.9, lean: 60 },
  ...o,
});

/** A trade bill: right on money, silent on state power, and it splits the room. */
const TRADE = {
  id: "t_trade", title: "Tariff Restoration Act", axis: 0.4, liberty: 0,
  domain: "economy", support: "contested",
};

const defecting = (extra = {}) => ({
  ...TRADE,
  defectors: [{
    faction: "freedom", position: "no",
    because: "they campaigned against every tariff this bill restores",
  }],
  ...extra,
});

const roster = (s = state()) => buildCongress(s, STATES).house;

// ---------------------------------------------------------------------------
// Nothing moves unless the model says so
// ---------------------------------------------------------------------------

test("a bill with no defectors votes exactly as it did before", () => {
  const plain = rollCall(roster(), TRADE, { consensus: CONSENSUS.contested });
  const empty = rollCall(roster(), { ...TRADE, defectors: [] }, { consensus: CONSENSUS.contested });
  assert.equal(plain.yes, empty.yes);
  assert.equal(factionLine(state(), TRADE).position,
    factionLine(state(), { ...TRADE, defectors: [] }).position);
});

// ---------------------------------------------------------------------------
// The card and the tally move together, which is the whole constraint
// ---------------------------------------------------------------------------

test("a named bloc breaks ranks on its own card, in the model's words", () => {
  const before = factionLine(state(), TRADE);
  const after = factionLine(state(), defecting());
  assert.equal(before.position, "yes", "the axes would have put them with the bill");
  assert.equal(after.position, "no");
  assert.equal(after.defected, true);
  assert.match(after.reason, /campaigned against every tariff/);
});

test("and the roll call moves the same way, or the panel is lying", () => {
  const plain = rollCall(roster(), TRADE, { consensus: CONSENSUS.contested });
  const broken = rollCall(roster(), defecting(), { consensus: CONSENSUS.contested });
  assert.ok(broken.yes < plain.yes,
    "the Freedom Caucus withdrew its votes and the tally did not notice");

  const bloc = factionRoll(state()).find((f) => f.id === "freedom");
  const lost = plain.yes - broken.yes;
  assert.ok(lost <= bloc.members,
    `a bloc of ${bloc.members} cannot move ${lost} votes`);
});

test("discipline decides how many follow, so a bloc is not a switch", () => {
  const bloc = factionRoll(state()).find((f) => f.id === "freedom");
  const plain = rollCall(roster(), TRADE, { consensus: CONSENSUS.contested });
  const broken = rollCall(roster(), defecting(), { consensus: CONSENSUS.contested });
  const lost = plain.yes - broken.yes;
  // 0.85 discipline: most of them go, and some of them do not.
  assert.ok(lost > 0 && lost < bloc.members,
    `all-or-nothing defection: ${lost} of ${bloc.members} moved`);
});

test("it is a function of the bill, so it gives the same answer every time", () => {
  const bill = defecting();
  const a = rollCall(roster(), bill, { consensus: CONSENSUS.contested });
  const b = rollCall(roster(), bill, { consensus: CONSENSUS.contested });
  assert.deepEqual(a, b);
  assert.deepEqual(factionLine(state(), bill), factionLine(state(), bill));
});

test("it survives the committee, because it belongs to the bill", () => {
  const chair = state({ rank: "chair", committee: "ways_means", month: 4, term: 1, leadership: 40, committeeLog: [] });
  const out = chairAction(chair, defecting(), "amend");
  assert.equal(out.result.bill.defectors[0].faction, "freedom",
    "amending a bill must not quietly discard who said they would vote against it");
});

// ---------------------------------------------------------------------------
// The engine trusts the model exactly as far as it trusts it on the axis
// ---------------------------------------------------------------------------

const docket = (bills) => validateDocket({ bills }, { term: 1, month: 4, arcs: [], voteLog: [] }, bills.length);

test("an invented bloc is dropped rather than believed", () => {
  const [bill] = docket([{
    title: "Tariff Act", brief: "b", axis: 0.4, domain: "economy",
    defectors: [{ faction: "the_squad", position: "no", because: "x" }],
  }]);
  assert.deepEqual(bill.defectors, []);
});

test("a position that is not yes or no is dropped", () => {
  const [bill] = docket([{
    title: "Tariff Act", brief: "b", axis: 0.4, domain: "economy",
    defectors: [{ faction: "freedom", position: "maybe", because: "x" }],
  }]);
  assert.deepEqual(bill.defectors, []);
});

test("no bill rewrites the whole chamber", () => {
  const [bill] = docket([{
    title: "Everything Act", brief: "b", axis: 0.4, domain: "economy",
    defectors: [
      { faction: "freedom", position: "no", because: "a" },
      { faction: "liberty", position: "no", because: "b" },
      { faction: "study_committee", position: "no", because: "c" },
      { faction: "main_street", position: "no", because: "d" },
    ],
  }]);
  assert.ok(bill.defectors.length <= 2,
    "a model that can flip four blocs at once is writing the roll call");
});

test("a bill that says nothing carries an empty list, not undefined", () => {
  const [bill] = docket([{ title: "Quiet Act", brief: "b", axis: 0.1, domain: "economy" }]);
  assert.deepEqual(bill.defectors, []);
});

test("the same bloc cannot be named twice", () => {
  const [bill] = docket([{
    title: "Tariff Act", brief: "b", axis: 0.4, domain: "economy",
    defectors: [
      { faction: "freedom", position: "no", because: "a" },
      { faction: "freedom", position: "yes", because: "b" },
    ],
  }]);
  assert.equal(bill.defectors.length, 1);
});
