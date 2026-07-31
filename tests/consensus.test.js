import test from "node:test";
import assert from "node:assert/strict";

import { rollCall, consensusOf, CONSENSUS, CONSENSUS_TIERS, BILL_POOL } from "../src/bills.js";
import { createSenateCareer } from "../src/senate.js";
import { createHouseCareer, partyLine, districtView } from "../src/house.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

/**
 * The roll call had one dimension, so every bill was a party-line vote with the
 * cutline in a different place. The most bipartisan bill the engine could
 * produce got 39 votes in a hundred-seat Senate and failed; nothing could ever
 * pass 85-15. A $5bn cyber-defence bill in the month after an attack came back
 * 55-45 with no Democrat voting for it.
 */

const scenario = (o = {}) => ({
  office: "senate", presidentName: "Dale Fairweather", party: "Democrat",
  startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat", seatState: "OH", ...o,
});

const senate = () => createSenateCareer(scenario());
const bench = (s) => buildCongress(s, STATES).senate;

// ---------------------------------------------------------------------------
// The dimension exists and does something
// ---------------------------------------------------------------------------

test("a bipartisan bill reaches across the aisle; the same bill party-line does not", () => {
  const s = senate();
  const b = bench(s);
  const partisan = rollCall(b, 0.15, { consensus: CONSENSUS.partyline });
  const shared = rollCall(b, 0.15, { consensus: CONSENSUS.bipartisan });

  assert.ok(shared.yes > partisan.yes + 25, `${partisan.yes} → ${shared.yes}`);
  assert.ok(shared.dYes > 0 && shared.rYes > 0, "both parties, which was impossible before");
});

test("a chamber can now pass something overwhelmingly", () => {
  const s = senate();
  // The old ceiling for ANY bill was about 55 of 100.
  const best = rollCall(bench(s), 0.1, { consensus: CONSENSUS.unanimous });
  assert.ok(best.yes >= 90, `${best.yes} — a memorial resolution should be near-unanimous`);
});

test("consensus widens the window without moving it — a partisan bill stays partisan", () => {
  const s = senate();
  const b = bench(s);
  // A hard-right bill called consensual does not become a Democratic priority.
  const marked = rollCall(b, 0.5, { consensus: CONSENSUS.bipartisan });
  assert.ok(marked.dYes <= 25,
    `${marked.dYes} Democrats voted for a +0.5 bill — declaring consensus must not launder its politics`);
});

test("even an unanimous label cannot whip the whole chamber onto a slanted bill", () => {
  const s = senate();
  const slanted = rollCall(bench(s), 0.5, { consensus: CONSENSUS.unanimous });
  assert.ok(slanted.yes < 95, `${slanted.yes} — ideology still costs something`);
});

test("the tiers are ordered, and party-line is the same as before this existed", () => {
  const s = senate();
  const b = bench(s);
  const at = (c) => rollCall(b, 0.15, { consensus: c }).yes;
  assert.ok(at(CONSENSUS.partyline) < at(CONSENSUS.contested));
  assert.ok(at(CONSENSUS.contested) < at(CONSENSUS.bipartisan));
  assert.ok(at(CONSENSUS.bipartisan) <= at(CONSENSUS.unanimous));
  // The default must be identical to the one-dimensional behaviour.
  assert.equal(rollCall(b, 0.15).yes, at(CONSENSUS.partyline));
});

// ---------------------------------------------------------------------------
// Where a bill's consensus comes from
// ---------------------------------------------------------------------------

test("the written pool carries its own, and unmarked bills are party-line", () => {
  assert.equal(consensusOf({ id: "veterans_care" }), CONSENSUS.unanimous);
  assert.equal(consensusOf({ id: "infrastructure" }), CONSENSUS.bipartisan);
  assert.equal(consensusOf({ id: "tax_cuts" }), CONSENSUS.partyline);
  assert.equal(consensusOf({ id: "universal_care" }), CONSENSUS.partyline);
});

test("a model-written bill supplies a word and the engine owns what it is worth", () => {
  assert.equal(consensusOf({ id: null, support: "bipartisan" }), CONSENSUS.bipartisan);
  assert.equal(consensusOf({ id: null, support: "unanimous" }), CONSENSUS.unanimous);
  // Anything unrecognised is a party-line vote, which is the commonest truth.
  assert.equal(consensusOf({ id: null, support: "quite popular" }), 0);
  assert.equal(consensusOf({ id: null }), 0);
});

test("no fringe bill is ever a consensus, however it is labelled", () => {
  for (const f of BILL_POOL.filter((b) => b.fringe)) {
    assert.ok(!f.consensus, `${f.id} must stay a party-line vote`);
  }
});

test("every tier the model may return is one the engine knows", () => {
  for (const tier of CONSENSUS_TIERS) assert.ok(CONSENSUS[tier] != null);
  assert.deepEqual(CONSENSUS_TIERS.sort(), ["bipartisan", "contested", "partyline", "unanimous"]);
});

// ---------------------------------------------------------------------------
// The card must not contradict the roll call
// ---------------------------------------------------------------------------

test("a consensus bill does not show leadership opposing something that passes 90-10", () => {
  const s = { ...createHouseCareer(scenario({ office: "house", district: "OH-6" })), month: 2 };
  const bill = { id: null, title: "Emergency Relief", axis: 0.15, domain: "security" };

  const partisan = partyLine(s, { ...bill, support: "partyline" });
  const shared = partyLine(s, { ...bill, support: "unanimous" });
  assert.ok(shared.fit > partisan.fit, "the caucus moves with the chamber");

  const home = districtView(s, { ...bill, support: "unanimous" });
  assert.ok(home.fit > districtView(s, { ...bill, support: "partyline" }).fit,
    "and so do the people at home — nobody wants to be against disaster relief");
});

// ---------------------------------------------------------------------------
// The reported bug, end to end
// ---------------------------------------------------------------------------

test("the cyber-defence bill now passes like a cyber-defence bill", () => {
  const s = senate();
  const b = bench(s);
  const asShipped = rollCall(b, 0.5);                                        // what happened
  const corrected = rollCall(b, 0.15, { consensus: CONSENSUS.bipartisan });  // what should

  assert.equal(asShipped.dYes, 0, "as shipped: not one Democrat");
  assert.ok(corrected.dYes > 20 && corrected.rYes > 40, "corrected: both sides");
  assert.ok(corrected.yes > 80, `${corrected.yes} votes for defending the country after an attack`);
});
