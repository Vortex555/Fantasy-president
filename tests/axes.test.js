import test from "node:test";
import assert from "node:assert/strict";

import { stanceFit, ISSUE_AXES, ISSUE_WEIGHT_CAP, CONSENSUS } from "../src/bills.js";
import { validateDocket } from "../src/chamberAi.js";
import { IDEOLOGIES, findIdeology, ideologyPosition } from "../public/js/data/ideologies.js";
import { convictionView } from "../src/conviction.js";
import { FACTIONS } from "../public/js/data/factions.js";

/**
 * Four axes, after the 8values model.
 *
 * One spectrum could only order the room by how far out each voice sat, which
 * cannot express a chamber where both ends vote together. Adding `liberty` fixed
 * that for one kind of fight and made the next gap obvious: a Groyper and a
 * Libertarian Conservative still came out neighbours, because what separates
 * them is not money and not quite state power either. It is nation against
 * globe, and tradition against progress, and neither existed.
 *
 *   economic    −1 equality   … +1 markets
 *   diplomatic  −1 globe      … +1 nation
 *   liberty     −1 authority  … +1 liberty      (8values calls this Civil)
 *   society     −1 progress   … +1 tradition
 *
 * `axis` survives all of it, because a district has one partisan lean and you
 * cannot get four numbers out of it. It stays the ordinary left–right composite
 * every voice has; the four are the richer description, used only where a bill
 * stakes a claim on them.
 */

const ALL = Object.entries(IDEOLOGIES).flatMap(([party, list]) => list.map((i) => ({ party, ...i })));
const find = (name) => ALL.find((i) => i.value === name);

// ---------------------------------------------------------------------------
// Every politics is placed on every axis
// ---------------------------------------------------------------------------

test("each axis is named once and carries a pole in each direction", () => {
  assert.equal(ISSUE_AXES.length, 5);
  for (const a of ISSUE_AXES) {
    assert.ok(a.id && a.low && a.high, `${a.id} is missing a pole`);
  }
  assert.deepEqual(ISSUE_AXES.map((a) => a.id).sort(),
    ["culture", "diplomatic", "economic", "liberty", "pluralism"]);
});

test("every ideology states a position on all four", () => {
  const missing = [];
  for (const i of ALL) {
    for (const { id } of ISSUE_AXES) {
      const v = i[id];
      if (typeof v !== "number" || v < -1 || v > 1) missing.push(`${i.party}/${i.value}.${id}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("so does every faction, and both party anchors reach the floor with them", () => {
  for (const f of FACTIONS) {
    for (const { id } of ISSUE_AXES) {
      assert.equal(typeof f[id], "number", `${f.id} has no ${id}`);
    }
  }
  const pos = ideologyPosition("Republican", "Groyper");
  for (const { id } of ISSUE_AXES) {
    const key = `ideology${id[0].toUpperCase()}${id.slice(1)}`;
    assert.equal(typeof pos[key], "number", `character creation drops ${key}`);
  }
});

// ---------------------------------------------------------------------------
// The distinctions one axis could not draw
// ---------------------------------------------------------------------------

/** How far apart two politics sit across the four, as plain Euclidean distance. */
const apart = (a, b) => Math.hypot(...ISSUE_AXES.map(({ id }) => a[id] - b[id]));

test("a Groyper is not a libertarian with the dial turned up", () => {
  const groyper = find("Groyper");
  for (const name of ["Libertarian Conservative", "Techno-Libertarian", "Anarcho-Capitalist"]) {
    assert.ok(apart(groyper, find(name)) > 1.5,
      `${name} and a Groyper are still neighbours at ${apart(groyper, find(name)).toFixed(2)}`);
  }
  // And specifically: nationalist, exclusionary, traditional, and no marketeer.
  assert.ok(groyper.diplomatic > 0.6, "its whole politics is nation over globe");
  assert.ok(groyper.pluralism < -0.8, "this is the axis it actually lives on");
  assert.ok(groyper.culture > 0.6, "it is a reaction, not a programme");
  assert.ok(groyper.economic < 0.5, "it takes no corporate money and says so");
  /**
   * Its distance from the libertarians is on `pluralism` and `economic`, never
   * on `liberty` — they broadly agree there and always did. Three separate
   * attempts to encode "it is authoritarian really" on the liberty axis each
   * made it support a mandate that platforms police speech, which is the one
   * thing that politics exists to fight. Its authoritarianism is on `culture`
   * and `pluralism`, where it belongs.
   */
  assert.ok(groyper.pluralism < -0.8 && groyper.culture > 0.8,
    "its authoritarianism is recorded, just not on the axis about being silenced");
});

test("a neoconservative and a paleoconservative split on the axis they actually hate each other over", () => {
  const neo = find("Neoconservative");
  const paleo = find("Paleoconservative");
  assert.ok(neo.diplomatic < 0, "neoconservatism is the interventionist wing");
  assert.ok(paleo.diplomatic > 0.5, "paleoconservatism is the isolationist one");
  assert.ok(Math.abs(neo.economic - paleo.economic) < 0.6,
    "and they are not far apart on money, which is why the split is invisible without this axis");
});

test("the globalist and the left nationalist are opposites, not near-copies", () => {
  const globalist = find("Cosmopolitan Globalist");
  const nationalist = find("Left Nationalist");
  assert.ok(globalist.diplomatic < -0.4);
  assert.ok(nationalist.diplomatic > 0.4);
});

test("tradition and progress separate politics that share an economics", () => {
  // Both hard left on money; opposite on how society should be ordered.
  const religious = find("Religious Left");
  const identitarian = find("New Left / Identitarian");
  assert.ok(religious.culture > identitarian.culture + 0.5,
    "a Religious Left member and an identitarian are not the same politics");
});

// ---------------------------------------------------------------------------
// Sparse by design, exactly as the single axis was
// ---------------------------------------------------------------------------

const voice = (o = {}) => ({ axis: 0.45, economic: 0.5, diplomatic: 0, liberty: 0, culture: 0, ...o });

test("a bill silent on all four is scored on the composite alone", () => {
  const quiet = { axis: 0.45, domain: "economy", support: "partyline" };
  assert.equal(stanceFit(voice(), quiet), 1);
});

test("a bill that stakes one axis behaves exactly as it did when there was only one", () => {
  // The single-axis formula: (1-w)*axisFit + w*issueFit, w = |bill value|.
  const bill = { axis: -0.1, liberty: 0.58, domain: "justice", support: "contested" };
  const v = voice({ axis: 0.79, liberty: 0.55 });
  const w = 0.58;
  const expected = (1 - w) * (1 - Math.abs(0.79 - -0.1) / 2)
    + w * (1 - Math.abs(0.55 - 0.58) / 2)
    + CONSENSUS.contested * 0.22;
  assert.ok(Math.abs(stanceFit(v, bill) - expected) < 1e-9,
    "adding three unused axes must not move a bill that uses one");
});

test("two axes share the weight rather than stacking past it", () => {
  const bill = { axis: 0, economic: 0.8, diplomatic: 0.8, domain: "economy", support: "partyline" };
  const agrees = voice({ axis: 0, economic: 0.8, diplomatic: 0.8 });
  const differs = voice({ axis: 0, economic: -0.8, diplomatic: -0.8 });
  assert.ok(stanceFit(agrees, bill) <= 1 + 1e-9, "a fit above 1 means the weights ran away");
  assert.ok(stanceFit(differs, bill) >= 0, "and below 0 means the same in the other direction");
  assert.ok(stanceFit(agrees, bill) > stanceFit(differs, bill));
});

test("the composite never loses all of its say", () => {
  const shouty = { axis: 1, economic: 1, diplomatic: 1, liberty: 1, culture: 1 };
  const v = voice({ axis: 1, economic: 1, diplomatic: 1, liberty: 1, culture: 1 });
  const w = ISSUE_WEIGHT_CAP;
  assert.ok(w < 1, "the partisan composite has to keep a share, or a district stops mattering");
  // Perfect agreement on all four, total disagreement on the composite.
  const worst = { ...v, axis: -1 };
  assert.ok(stanceFit(worst, shouty) < stanceFit(v, shouty));
});

test("a voice with no view on an axis is judged without it", () => {
  // Districts are this case on all four: a seat's partisan lean says nothing
  // about where its voters stand on nation, state power or moral order.
  const bill = { axis: 0.2, diplomatic: 0.7, domain: "foreign", support: "contested" };
  const seat = { axis: 0.9, economic: null, diplomatic: null, liberty: null, culture: null };
  assert.equal(stanceFit(seat, bill), stanceFit(seat, { ...bill, diplomatic: 0 }));
});

// ---------------------------------------------------------------------------
// The fifth: who the law is for
// ---------------------------------------------------------------------------

/**
 * Four axes and none of them could see a bill about discrimination.
 *
 * A bill weakening racial anti-discrimination protections reached the floor and
 * the engine read it as a *liberty* question — religious exemption, freedom from
 * a state mandate — which is a defensible reading of the mechanism and says
 * nothing about the politics. A Groyper came out against it, and the floor
 * printed a sentence crediting them with declining to weaken civil rights.
 *
 * The number that should have decided it was sitting in the file the whole time.
 * `fx.civil_rights` is -32 on that ideology, the most extreme value it carries
 * and the single thing that defines it, and no stance had ever read it. Money,
 * sovereignty, state power and moral order are four real questions and none of
 * them is *who the law protects*.
 */

test("every politics states where it stands on who the law is for", () => {
  const missing = ALL.filter((i) => typeof i.pluralism !== "number"
    || i.pluralism < -1 || i.pluralism > 1);
  assert.deepEqual(missing.map((i) => `${i.party}/${i.value}`), []);
  assert.ok(ISSUE_AXES.some((a) => a.id === "pluralism"));
});

test("the ideologies whose own bloc effects shout it are on the right side of zero", () => {
  for (const name of ["Groyper", "Ethnonationalist", "Christian Nationalist", "Nativist"]) {
    assert.ok(find(name).pluralism < -0.5, `${name} should be well below zero`);
  }
  for (const name of ["Abolitionist Left", "New Left / Identitarian", "Civil Libertarian"]) {
    assert.ok(find(name).pluralism > 0.5, `${name} should be well above zero`);
  }
});

test("it separates a traditionalism that protects people from one that does not", () => {
  // Both far up the culture axis; opposite on who the moral order is for. This
  // is the confusion that produced the laughable card.
  const religiousLeft = find("Religious Left");
  const christianNationalist = ALL.find(
    (i) => i.value === "Christian Nationalist" && i.party === "Republican");
  assert.ok(religiousLeft.pluralism > 0.3);
  assert.ok(christianNationalist.pluralism < -0.5);
});

test("a Groyper is for a bill that weakens anti-discrimination law, and says so", () => {
  /**
   * Coded the way the docket prompt asks for it: the substance is `pluralism`,
   * and `liberty` is weak because the state declining to protect one person from
   * another is not the state letting a person alone.
   *
   * The fixture used to carry `liberty: 0.7` — the model's own reading, lifted
   * straight out of a live floor — and passed only because the ideology had been
   * bent to +0.2 to survive it. Compensating for a mis-coded bill by mis-coding
   * an ideology fixes one screen and corrupts every other vote that ideology
   * ever casts. See the next test for what that mis-coding still costs.
   */
  const bill = {
    axis: 0.8, liberty: 0.2, culture: 0.4, pluralism: -0.8,
    domain: "social", support: "contested",
  };
  const seatFor = (ideology) => ({
    scenario: { party: "Republican", ideology, ...ideologyPosition("Republican", ideology) },
    seat: { district: "WV-2", axis: 0.9, lean: 60 }, caucus: "Republican",
  });
  assert.equal(convictionView(seatFor("Groyper"), bill).position, "yes",
    "the engine read this as a liberty question and got the politics backwards");
  assert.equal(convictionView(seatFor("Rockefeller Republican"), bill).position, "no");
});

/**
 * The cost of the honest value, stated rather than hidden.
 *
 * A model that reads "religious exemption" as a liberty bill and leaves
 * `pluralism` at 0 — which qwen2.5:14b did on a live floor — will put a Groyper
 * against a bill narrowing civil rights protections, because on that coding the
 * only axis speaking is the one they genuinely disagree on. That is a bill
 * classification failure and the fix belongs in the prompt, which now says so
 * outright. It is recorded here so nobody quietly "fixes" it again by moving the
 * ideology.
 */
test("a mis-coded bill still gets it wrong, and that is the prompt's problem", () => {
  const miscoded = { axis: 0.8, liberty: -0.7, culture: 0.4, domain: "social", support: "contested" };
  const groyper = {
    scenario: { party: "Republican", ideology: "Groyper", ...ideologyPosition("Republican", "Groyper") },
    seat: { district: "WV-2", axis: 0.9, lean: 60 },
  };
  assert.equal(convictionView(groyper, miscoded).position, "no");
  assert.equal(convictionView(groyper, { ...miscoded, liberty: 0.2, pluralism: -0.8 }).position, "yes",
    "the same bill classified correctly comes out right");
});

test("and a bill that says nothing about it is scored as though the axis were not there", () => {
  const voice5 = { axis: 0.45, economic: 0.5, diplomatic: 0, liberty: 0, culture: 0, pluralism: -0.9 };
  const quiet = { axis: 0.45, economic: 0.5, domain: "economy", support: "partyline" };
  assert.equal(stanceFit(voice5, quiet), stanceFit({ ...voice5, pluralism: 0.9 }, quiet));
});


// ---------------------------------------------------------------------------
// The label is a checksum on the sign, not a replacement for the value
// ---------------------------------------------------------------------------

/**
 * A 14B model gets the *sign* wrong on bills whose wording cuts both ways.
 * "Stricter oversight of the police" restrains coercion and is positive;
 * "stricter enforcement by the police" builds it out and is negative. It read
 * the first as the second and put a Groyper on the wrong side of a police
 * accountability bill.
 *
 * The repo already knew the answer and wrote it down on `support`: a small model
 * picks from a list far more reliably than it calibrates a scale. But replacing
 * the numbers with labels outright measurably costs something — snapping the
 * pool to five buckets changes 5.5% of votes and drifts intensity by seven
 * points — so the label does not replace the number. It checks it.
 */

const docketOf = (bill) =>
  validateDocket({ bills: [{ title: "T", brief: "b", axis: 0.2, domain: "justice", ...bill }] },
    { term: 1, month: 4, arcs: [], voteLog: [] }, 1)[0];

test("a number that agrees with its label is kept exactly", () => {
  const bill = docketOf({ liberty: 0.43, liberty_side: "liberty" });
  assert.equal(bill.liberty, 0.43, "granularity is the whole reason not to use labels alone");
});

test("a number that contradicts its label loses to the label", () => {
  // The police accountability case: the model says "restrains" and then writes
  // a negative number, having pattern-matched on the word "stricter".
  const bill = docketOf({ liberty: -0.5, liberty_side: "liberty" });
  assert.ok(bill.liberty > 0, "the sign the model described in words is the one it meant");
});

test("a label on its own supplies a sensible magnitude", () => {
  const bill = docketOf({ pluralism_side: "hierarchy" });
  assert.ok(bill.pluralism < 0 && bill.pluralism >= -0.6);
});

test("a number on its own behaves exactly as it did before labels existed", () => {
  assert.equal(docketOf({ diplomatic: 0.65 }).diplomatic, 0.65);
  assert.equal(docketOf({ culture: -0.4 }).culture, -0.4);
});

test("a label nobody recognises is ignored rather than believed", () => {
  const bill = docketOf({ economic: 0.7, economic_side: "sideways" });
  assert.equal(bill.economic, 0.7);
});

test("saying nothing on an axis still says nothing", () => {
  const bill = docketOf({});
  for (const { id } of ISSUE_AXES) assert.equal(bill[id], 0);
});
