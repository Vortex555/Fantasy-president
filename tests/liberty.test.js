import test from "node:test";
import assert from "node:assert/strict";

import { stanceFit, rollCall, billById, scheduledBill, BILL_POOL, CONSENSUS } from "../src/bills.js";
import { FACTIONS, factionFor, factionLine } from "../src/factions.js";
import { convictionView } from "../src/conviction.js";
import { partyLine, districtView, createHouseCareer, floorBills as houseFloorBills } from "../src/house.js";
import { IDEOLOGIES, findIdeology, ideologyPosition } from "../public/js/data/ideologies.js";
import { buildCongress } from "../public/js/data/government.js";
import { validateDocket } from "../src/chamberAi.js";
import { STATES } from "../src/states.js";

/**
 * The second axis.
 *
 * Every voice in the chamber was a single number between −1 and 1, so the room
 * could only ever be ordered by how far out it sat. That cannot express the
 * commonest cross-cutting fight in a real legislature — the one where both ends
 * of the chamber vote together against both leaderships — and the case that
 * exposed it was surveillance: the engine put the Freedom Caucus against a bill
 * limiting government surveillance, which is the bloc that in life whips hardest
 * for exactly that.
 *
 * `liberty` is that missing dimension. +1 is "the state may not", −1 is "the
 * state must", and it is deliberately sparse: a bill that says nothing about
 * state power carries 0 and every calculation behaves exactly as it did before.
 */

/**
 * Read from the ideology table rather than hand-supplied.
 *
 * This used to pass `ideologyLiberty: 0.5` inline, so it pinned a number the
 * test itself had chosen and went on passing when the table underneath it was
 * changed to the opposite sign. A fixture that supplies the value under test
 * proves nothing about the data.
 */
const positionOf = (party, ideology) => {
  const found = findIdeology(party, ideology);
  return { ideologyAxis: found.axis, ideologyLiberty: found.liberty };
};

const seat = (o = {}) => createHouseCareer({
  office: "house", presidentName: "M", party: "Republican", startYear: 2025,
  ideology: "Groyper", ...positionOf("Republican", "Groyper"),
  district: "WV-2", events: "classic", ...o,
});

/** The bill from the report: limits government surveillance, mildly left on money. */
const PRIVACY = { id: "t_privacy", title: "Digital Privacy Protection Act",
  axis: -0.1, liberty: 0.85, domain: "justice", support: "contested" };

/** Its mirror: the state asking for more of the same power. */
const POWERS = { id: "t_powers", title: "Surveillance Authorities Act",
  axis: 0.2, liberty: -0.85, domain: "justice", support: "contested" };

// ---------------------------------------------------------------------------
// The regression that started it
// ---------------------------------------------------------------------------

test("the Freedom Caucus is for a bill that limits government surveillance", () => {
  const state = seat();
  const line = factionLine(state, PRIVACY);
  assert.equal(line.id, "freedom");
  assert.equal(line.position, "yes",
    "the bloc that fought FISA reauthorisation does not whip against a privacy bill");
});

test("and against one that expands it", () => {
  assert.equal(factionLine(seat(), POWERS).position, "no");
});

/**
 * Corrected twice, which is worth leaving on the record.
 *
 * This first asserted a Groyper votes FOR a warrant requirement, on the grounds
 * that the movement is loudly against the agencies investigating it. Then it
 * asserted the opposite, on the grounds that a movement wanting mass deportation
 * and a policed moral order is authoritarian and the single number had to answer
 * for all of it.
 *
 * The second reading was a double-count, and only became visible once there were
 * axes to hold the other halves. Deportation is `pluralism`. A policed moral
 * order is `culture`. What is left for `liberty` alone is state coercion of the
 * person, and there the movement's actual legislative demands are anti-state —
 * so it votes for the warrant bill after all, and the ugly part of the politics
 * is carried where it belongs instead of smuggled onto this axis.
 */
test("a Groyper is against being silenced, which is all this axis says", () => {
  /**
   * Positive, after three attempts to make it negative. Every one of them was
   * reasoning from a real observation — the movement wants blasphemy and
   * obscenity prosecuted — and every one put the conclusion on the wrong axis.
   * `culture` carries that at +0.9. What this axis answers for is who may be
   * silenced, and there the movement is the most deplatformed constituency in
   * the game and votes accordingly.
   */
  const liberty = (name) => findIdeology("Republican", name).liberty;
  assert.ok(liberty("Groyper") > 0);
  assert.ok(liberty("Constitutionalist") - liberty("Groyper") > 0.5,
    "though it holds the position out of grievance, not principle");

  // The case that decided it: a mandate that platforms police content.
  const platforms = { axis: 0.2, liberty: -0.6, domain: "social", support: "contested" };
  assert.equal(convictionView({
    scenario: { party: "Republican", ideology: "Groyper", ...ideologyPosition("Republican", "Groyper") },
    seat: { district: "WV-2", axis: 0.9, lean: 60 },
  }, platforms).position, "no", "content moderation is how every one of its figures was banned");
});

test("and it is still nobody's libertarian, on the axes that actually divide them", () => {
  const groyper = findIdeology("Republican", "Groyper");
  for (const name of ["Libertarian Conservative", "Constitutionalist", "Techno-Libertarian"]) {
    const lib = findIdeology("Republican", name);
    // Not `liberty` — they broadly agree there, and always did. The distance is
    // on who the law protects and on who gets what.
    assert.ok(lib.pluralism - groyper.pluralism > 0.5,
      `${name} and a Groyper should be far apart on who the law is for`);
    assert.ok(lib.economic - groyper.economic > 0.5,
      `${name} and a Groyper should be far apart on markets`);
  }
});

test("leadership is the one on the other side, which is the real shape of the fight", () => {
  // Both parties' leaderships defend the security state; the wings do not.
  assert.equal(partyLine(seat(), PRIVACY).position, "no");
  assert.equal(partyLine(seat(), POWERS).position, "yes");
});

test("both ends of the chamber meet, which a single axis can never produce", () => {
  const left = seat({ party: "Democrat", ideology: "Progressive Firebrand",
    ideologyAxis: -0.7, ideologyLiberty: 0.4, district: "OR-3" });
  const right = seat();
  assert.equal(factionLine(left, PRIVACY).id, "progressive");
  assert.equal(factionLine(right, PRIVACY).id, "freedom");
  assert.equal(factionLine(left, PRIVACY).position, factionLine(right, PRIVACY).position,
    "the horseshoe is the entire reason this dimension exists");
});

// ---------------------------------------------------------------------------
// The bloc stops being a copy of the member
// ---------------------------------------------------------------------------

test("a faction can now differ from its own most extreme member", () => {
  // Law & Order Conservative sits in the same bloc and is its opposite on state power.
  const authoritarian = seat({ ideology: "Law & Order Conservative",
    ideologyAxis: 0.6, ideologyLiberty: -0.9 });
  assert.equal(factionFor("Republican", "Law & Order Conservative").id, "study_committee");

  const hardliner = seat({ ideology: "Constitutionalist",
    ideologyAxis: 0.7, ideologyLiberty: 0.85 });
  assert.notEqual(
    convictionView(authoritarian, PRIVACY).position,
    convictionView(hardliner, PRIVACY).position,
    "two right-wing members must be able to disagree about state power");
});

// ---------------------------------------------------------------------------
// The cards and the roll call cannot disagree
// ---------------------------------------------------------------------------

test("the chamber votes on the same two axes the cards are drawn from", () => {
  const state = seat();
  const roster = buildCongress(state, STATES);
  const call = rollCall(roster.house, PRIVACY, { consensus: CONSENSUS.contested });

  // Every member the roll call counted must have been scored on liberty too,
  // or the panel and the tally are reading different bills.
  assert.ok(roster.house.every((m) => typeof m.liberty === "number"),
    "a member with no liberty position is invisible to half the bill");
  assert.ok(call.yes > 0 && call.yes < call.total);
});

test("a liberty bill draws its yes votes from both parties", () => {
  const roster = buildCongress(seat(), STATES);
  const call = rollCall(roster.house, PRIVACY, { consensus: CONSENSUS.contested });
  assert.ok(call.dYes > 0 && call.rYes > 0,
    "a cross-cutting bill that splits on party lines has not cross-cut anything");
});

// ---------------------------------------------------------------------------
// Sparse by design: nothing that came before moves
// ---------------------------------------------------------------------------

test("a bill with no liberty content behaves exactly as it always did", () => {
  const before = { axis: 0.45, domain: "economy", support: "partyline" };
  const voice = { axis: 0.45, liberty: 0.9 };
  // Same voice, same bill, liberty absent: pure axis agreement plus consensus.
  assert.equal(stanceFit(voice, before), 1);
  assert.equal(stanceFit(voice, { ...before, liberty: 0 }), 1);
});

test("a voice with no view on state power is judged on the axis alone", () => {
  // Districts are this case: a seat's partisan lean says nothing about where its
  // voters stand on surveillance, and the game does not invent a number for them.
  const indifferent = { axis: 0.9, liberty: null };
  const committed = { axis: 0.9, liberty: 0.9 };
  assert.equal(stanceFit(indifferent, PRIVACY), stanceFit(indifferent, { ...PRIVACY, liberty: 0 }));
  assert.notEqual(stanceFit(committed, PRIVACY), stanceFit(committed, { ...PRIVACY, liberty: 0 }));
});

test("the district card is unchanged by a dimension the district has no view on", () => {
  const state = seat();
  const withLiberty = districtView(state, PRIVACY);
  const without = districtView(state, { ...PRIVACY, liberty: 0 });
  assert.equal(withLiberty.position, without.position);
  assert.equal(withLiberty.intensity, without.intensity);
});

// ---------------------------------------------------------------------------
// The data itself
// ---------------------------------------------------------------------------

test("every ideology states where it stands on state power", () => {
  const missing = [];
  for (const [party, list] of Object.entries(IDEOLOGIES)) {
    for (const i of list) {
      if (typeof i.liberty !== "number" || i.liberty < -1 || i.liberty > 1) {
        missing.push(`${party}/${i.value}`);
      }
    }
  }
  assert.deepEqual(missing, [], "an ideology with no liberty value is half a politics");
});

test("every faction states it too", () => {
  const missing = FACTIONS.filter(
    (f) => typeof f.liberty !== "number" || f.liberty < -1 || f.liberty > 1);
  assert.deepEqual(missing.map((f) => f.id), []);
});

test("the ones whose own description names it are on the right side of zero", () => {
  // These sub-lines already said "−Surveillance state" and "−Federal power" in
  // prose. The numbers now agree with the words.
  assert.ok(findIdeology("Independent", "Digital Rights / Pirate").liberty > 0.5);
  assert.ok(findIdeology("Republican", "Sovereigntist").liberty > 0.5);
  assert.ok(findIdeology("Democrat", "Civil Libertarian").liberty > 0.5);
  assert.ok(findIdeology("Republican", "Constitutionalist").liberty > 0.5);
  // And the authoritarians are on the other side of it.
  assert.ok(findIdeology("Republican", "Caesarist").liberty < -0.5);
  assert.ok(findIdeology("Independent", "Military Junta").liberty < -0.5);
  assert.ok(findIdeology("Republican", "Law & Order Conservative").liberty < -0.5);
});

test("character creation carries the second number the way it carries the first", () => {
  const pos = ideologyPosition("Republican", "Constitutionalist");
  assert.equal(typeof pos.ideologyLiberty, "number");
  assert.ok(pos.ideologyLiberty > 0.5);
});

// ---------------------------------------------------------------------------
// Bills that come from the model
// ---------------------------------------------------------------------------

test("an AI bill may state a liberty position, and is trusted no further than the axis", () => {
  const state = { term: 1, month: 4, arcs: [], voteLog: [] };
  const [bill] = validateDocket({ bills: [{
    title: "Warrant Requirement Act", brief: "b", axis: -0.1, liberty: 0.8,
    domain: "justice", support: "contested",
  }] }, state, 1);
  assert.equal(bill.liberty, 0.8);

  const [silent] = validateDocket({ bills: [{
    title: "Highway Funding Act", brief: "b", axis: 0.1, domain: "economy",
  }] }, state, 1);
  assert.equal(silent.liberty, 0, "a bill that says nothing about state power says nothing");

  const [junk] = validateDocket({ bills: [{
    title: "Nonsense Act", brief: "b", axis: 0.1, liberty: "very", domain: "economy",
  }] }, state, 1);
  assert.equal(junk.liberty, 0, "an unparseable claim is not a claim");

  const [wild] = validateDocket({ bills: [{
    title: "Overreach Act", brief: "b", axis: 0.1, liberty: 9, domain: "justice",
  }] }, state, 1);
  assert.equal(wild.liberty, 1, "clamped like everything else the model volunteers");
});

test("the pool carries the case that exposed the gap", () => {
  const reform = billById("surveillance_reform");
  const powers = billById("surveillance_powers");
  assert.ok(reform && powers, "both directions, so the dimension is visible in play");
  assert.ok(reform.liberty > 0.5);
  assert.ok(powers.liberty < -0.5);
});

// ---------------------------------------------------------------------------
// A field on a bill has to reach the vote
// ---------------------------------------------------------------------------

/**
 * Four separate places built the on-floor shape of a pool bill by hand, listing
 * the fields each happened to know about, and every one of them dropped
 * `liberty` the day it was added. So a Border Enforcement Act written at -0.5
 * arrived on the floor at 0, and the entire dimension was inert for every
 * hand-written bill in the game — visible only in months the model wrote, and
 * only when the model bothered to set it.
 *
 * Nothing failed. The bills were there, the cards drew, the roll call ran, and
 * the second axis quietly did not exist.
 */
test("every pool bill reaches the floor carrying the position it was written at", () => {
  const marked = BILL_POOL.filter((b) => b.liberty);
  assert.ok(marked.length >= 10, "the pool should have a decent number to check");

  for (const source of marked) {
    const scheduled = scheduledBill(source);
    assert.equal(scheduled.liberty, source.liberty,
      `${source.id} lost its liberty position on the way to the floor`);
    assert.equal(scheduled.axis, source.axis, `${source.id} lost its axis`);
    assert.equal(scheduled.domain, source.domain, `${source.id} lost its domain`);
  }
});

test("the offline House and Senate floors serve bills with both axes intact", () => {
  const base = {
    rosterSeed: "liberty-check",
    congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
    scenario: { party: "Republican", ideology: "Groyper", ideologyAxis: 0.95, ideologyLiberty: 0.5 },
    seat: { district: "WV-2", axis: 0.9, lean: 60, seniority: 1 },
    rank: "member", term: 1, arcs: [], voteLog: [],
  };

  // Sweep months so the seeded docket size lands on something more than once.
  let seen = 0;
  for (let month = 1; month <= 24; month++) {
    for (const bill of houseFloorBills({ ...base, month })) {
      const source = BILL_POOL.find((b) => b.id === bill.id);
      if (!source) continue;                 // a model-written or fringe insert
      seen += 1;
      assert.equal(bill.liberty ?? 0, source.liberty ?? 0,
        `${bill.id} reached the House floor with the wrong liberty`);
    }
  }
  assert.ok(seen > 0, "no pool bills were scheduled at all, so nothing was checked");
});
