import test from "node:test";
import assert from "node:assert/strict";

import { BILL_TOPICS, reflexVote, rollCall, CONSENSUS } from "../src/bills.js";
import { IDEOLOGIES, findIdeology, ideologyPosition } from "../public/js/data/ideologies.js";
import { FACTIONS } from "../public/js/data/factions.js";
import { convictionView } from "../src/conviction.js";
import { factionLine } from "../src/factions.js";
import { validateDocket } from "../src/chamberAi.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

/**
 * Positions a politics holds regardless of how the bill is built.
 *
 * Five axes express *tendencies*, and a tendency is a direction with a
 * magnitude. What they cannot express is "always" — and a handful of the
 * positions that define an ideology are exactly that. A Groyper opposes a
 * mandate that platforms police speech because that mandate is how every figure
 * in the movement was removed from the internet; there is no bill construction
 * that makes them vote for it, and no combination of five coordinates that
 * reliably produces "never".
 *
 * Trying to produce it from coordinates is what moved this ideology's `liberty`
 * three times in one day. Each value was chosen to make one bill come out right
 * and broke a different reflex, because it was solving for the wrong kind of
 * thing.
 *
 * So the reflexes are stated. A bill names the actions it takes from a fixed
 * list, an ideology names the actions it will never or always vote for, and
 * where the two meet the reflex decides. Everywhere else — which is nearly
 * everywhere — the axes are untouched.
 */

const seat = (party, ideology) => ({
  scenario: { party, ideology, ...ideologyPosition(party, ideology) },
  seat: { district: "WV-2", axis: 0.9, lean: 60 },
  caucus: party === "Democrat" ? "Democrat" : "Republican",
});

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

test("every topic names an action with its direction already in it", () => {
  assert.ok(BILL_TOPICS.length >= 8);
  for (const t of BILL_TOPICS) {
    assert.match(t, /^[a-z_]+$/, "topics are ids, not prose");
  }
  // Both directions exist where a bill can genuinely go either way, so the model
  // never has to infer a sign — the failure mode that produced a police
  // accountability bill scored as an expansion of police power.
  assert.ok(BILL_TOPICS.includes("mandate_platform_moderation"));
  assert.ok(BILL_TOPICS.includes("protect_platform_speech"));
});

test("a reflex is only ever stated as a vote, never as a number", () => {
  const all = [...Object.entries(IDEOLOGIES).flatMap(([p, l]) => l.map((i) => ({ p, ...i }))), ...FACTIONS];
  let stated = 0;
  for (const entry of all) {
    for (const [topic, vote] of Object.entries(entry.reflex || {})) {
      stated += 1;
      assert.ok(BILL_TOPICS.includes(topic), `${entry.value || entry.id} names unknown topic ${topic}`);
      assert.ok(vote === "yes" || vote === "no", `${entry.value || entry.id}.${topic} is not a vote`);
    }
  }
  assert.ok(stated >= 8, "the table should carry the cases that prompted it");
});

test("most politics have no reflexes at all, which is the point", () => {
  const all = Object.entries(IDEOLOGIES).flatMap(([p, l]) => l);
  const withAny = all.filter((i) => Object.keys(i.reflex || {}).length);
  assert.ok(withAny.length < all.length / 2,
    "a reflex per ideology would be a lookup table, and the axes would stop meaning anything");
});

// ---------------------------------------------------------------------------
// The four that prompted this
// ---------------------------------------------------------------------------

test("a Groyper never votes for a mandate that platforms police speech", () => {
  const bill = { axis: 0.2, liberty: -0.6, topics: ["mandate_platform_moderation"],
    domain: "social", support: "contested" };
  assert.equal(convictionView(seat("Republican", "Groyper"), bill).position, "no");

  // And not because the axes happened to agree — flip them and it still holds.
  const inverted = { ...bill, axis: 0.95, liberty: -0.9, culture: 0.9, pluralism: -0.9 };
  assert.equal(convictionView(seat("Republican", "Groyper"), inverted).position, "no",
    "there is no construction of this bill they vote for");
});

test("and always votes to protect firearms, however the bill is built", () => {
  for (const axis of [0.2, 0.5, 0.9]) {
    const bill = { axis, liberty: 0.4, topics: ["protect_firearms"], domain: "justice", support: "contested" };
    assert.equal(convictionView(seat("Republican", "Groyper"), bill).position, "yes",
      `failed at axis ${axis}, which is the case that was marginal before`);
  }
});

test("and always votes to weaken civil rights protections, which is the whole politics", () => {
  const bill = { axis: 0.8, liberty: 0.7, topics: ["weaken_civil_rights"], domain: "social", support: "contested" };
  assert.equal(convictionView(seat("Republican", "Groyper"), bill).position, "yes",
    "this came out backwards even after pluralism existed, when the model mis-coded the bill");
});

test("the Progressive Caucus will not fund incarceration", () => {
  const bill = { axis: -0.3, economic: -0.5, liberty: 0.3, pluralism: 0.5,
    topics: ["fund_incarceration"], domain: "justice", support: "contested" };
  const state = { ...seat("Democrat", "Progressive Firebrand"),
    rosterSeed: "demo", office: "house",
    congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 } };
  assert.equal(factionLine(state, bill).position, "no",
    "every axis says yes; the abolitionist objection is about where the money lands");
});

// ---------------------------------------------------------------------------
// Sparse, and consistent with the tally
// ---------------------------------------------------------------------------

test("a bill naming no topics is scored exactly as before", () => {
  const quiet = { axis: 0.2, liberty: -0.6, domain: "social", support: "contested" };
  const tagged = { ...quiet, topics: [] };
  const you = seat("Republican", "Groyper");
  assert.equal(convictionView(you, quiet).position, convictionView(you, tagged).position);
  assert.equal(convictionView(you, quiet).intensity, convictionView(you, tagged).intensity);
});

test("a topic nobody holds a reflex on changes nothing", () => {
  const you = seat("Republican", "Groyper");
  const bill = { axis: 0.2, liberty: -0.6, domain: "social", support: "contested" };
  assert.equal(convictionView(you, { ...bill, topics: ["fund_incarceration"] }).position,
    convictionView(you, bill).position);
});

test("reflexVote reports the vote and nothing when there is none", () => {
  const groyper = findIdeology("Republican", "Groyper");
  assert.equal(reflexVote(groyper, { topics: ["protect_firearms"] }), "yes");
  assert.equal(reflexVote(groyper, { topics: ["mandate_platform_moderation"] }), "no");
  assert.equal(reflexVote(groyper, { topics: ["fund_incarceration"] }), null);
  assert.equal(reflexVote(groyper, {}), null);
  assert.equal(reflexVote({}, { topics: ["protect_firearms"] }), null);
});

test("the chamber votes the same reflexes the cards show", () => {
  const state = { rosterSeed: "demo", office: "house",
    congress: { houseD: 213, houseR: 222, senateD: 47, senateR: 53 },
    scenario: { party: "Republican", ideology: "Groyper", ideologyAxis: 0.95 } };
  const roster = buildCongress(state, STATES).house;
  assert.ok(roster.every((m) => m.reflex !== undefined),
    "a member without their reflexes votes differently from the card describing them");

  /**
   * A reflex only moves a vote where it disagrees with the arithmetic, so the
   * bill has to be built against it: a firearms protection written far to the
   * left, which the members holding that reflex would otherwise vote down on
   * distance alone.
   */
  const bill = { axis: -0.8, topics: ["protect_firearms"], domain: "justice", support: "contested" };
  const plain = rollCall(roster, { ...bill, topics: [] }, { consensus: CONSENSUS.contested });
  const withReflex = rollCall(roster, bill, { consensus: CONSENSUS.contested });
  assert.ok(withReflex.yes > plain.yes,
    `the reflex moved no votes: ${plain.yes} -> ${withReflex.yes}`);
});

// ---------------------------------------------------------------------------
// The engine trusts the model exactly as far as it trusts it elsewhere
// ---------------------------------------------------------------------------

const docket = (extra) => validateDocket({ bills: [{
  title: "T", brief: "b", axis: 0.2, domain: "social", ...extra,
}] }, { term: 1, month: 4, arcs: [], voteLog: [] }, 1)[0];

test("an invented topic is dropped rather than believed", () => {
  assert.deepEqual(docket({ topics: ["burn_it_all_down"] }).topics, []);
});

test("real topics survive, and a bill naming none carries an empty list", () => {
  assert.deepEqual(docket({ topics: ["protect_firearms", "nonsense"] }).topics, ["protect_firearms"]);
  assert.deepEqual(docket({}).topics, []);
  assert.deepEqual(docket({ topics: "protect_firearms" }).topics, []);
});

test("no bill claims more topics than a bill plausibly has", () => {
  const many = docket({ topics: [...BILL_TOPICS] });
  assert.ok(many.topics.length <= 3, "a bill that is about everything is about nothing");
});
