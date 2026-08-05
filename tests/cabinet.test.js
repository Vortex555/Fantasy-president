import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCTRINES, doctrineById, candidatesFor, appointments, appointable, sanitiseTransition,
} from "../src/cabinet.js";
import { createGame } from "../src/gameEngine.js";
import { advisorsFor } from "../src/rooms.js";
import { writtenOptions, validateOpening, toppedUp } from "../src/roomsAi.js";

/**
 * The government you appoint, rather than the one you are handed.
 *
 * A president arrived in office with eleven strangers already at the table,
 * generated off the hash of their own name, and the only post they had ever
 * chosen was the Vice President. That was survivable while the cabinet was
 * something you occasionally consulted. It stopped being survivable when the
 * rooms began asking those people for plans, because a plan is only as good as
 * whoever you appointed — which is the whole reason this exists.
 */

const scenario = (o = {}) => ({
  presidentName: "Dale Fairweather",
  party: "Democrat",
  ideology: "Social Democrat",
  era: "the present day",
  startYear: 2025,
  startApproval: 54,
  ...o,
});

const cabinetOf = (o = {}) => createGame(scenario(o)).cabinet
  .filter((m) => m.id !== "vp" && m.id !== "spouse");

const mean = (list, key) => list.reduce((sum, m) => sum + m[key], 0) / list.length;

// ---------------------------------------------------------------------------
// The doctrine
// ---------------------------------------------------------------------------

test("each doctrine is a different bargain, and every one of them is a real trade", () => {
  for (const d of DOCTRINES) {
    assert.ok(d.blurb.length > 40, `${d.id} does not say what it costs`);
    assert.ok(d.loyalty[1] > d.loyalty[0] && d.competence[1] > d.competence[0]);
    assert.ok(d.loyalty[1] - d.loyalty[0] >= 20,
      `${d.id} is too narrow — a cabinet where everyone is the same number is not a cabinet`);
  }
  assert.equal(doctrineById("nonsense").id, "balanced", "an unknown doctrine falls to the middle");
});

test("loyalists are loyal and cannot run a department; rivals are the other way round", () => {
  const loyal = cabinetOf({ cabinetDoctrine: "loyalists" });
  const rivals = cabinetOf({ cabinetDoctrine: "rivals" });

  assert.ok(mean(loyal, "loyalty") > mean(rivals, "loyalty") + 20);
  assert.ok(mean(rivals, "competence") > mean(loyal, "competence") + 15);
});

test("a doctrine staffs every appointable post and touches neither of the other two", () => {
  const full = createGame(scenario({ cabinetDoctrine: "professionals" })).cabinet;
  for (const role of appointable()) {
    assert.ok(full.find((m) => m.id === role.id), `${role.id} was never filled`);
  }
  assert.ok(full.find((m) => m.id === "vp"), "the VP is elected with you");
  assert.ok(full.find((m) => m.id === "spouse"), "and the spouse is not an appointment");
});

// ---------------------------------------------------------------------------
// The individual arguments
// ---------------------------------------------------------------------------

test("three ways to fill one post, and they are genuinely different people", () => {
  const slate = candidatesFor(scenario(), "defense");
  assert.equal(slate.length, 3);
  const loyalist = slate.find((c) => c.key === "loyalist");
  const professional = slate.find((c) => c.key === "professional");

  assert.ok(loyalist.loyalty > professional.loyalty);
  assert.ok(professional.competence > loyalist.competence);
  for (const c of slate) assert.ok(c.pitch.length > 40, `${c.key} does not say what it costs`);
});

test("a post you argued about overrides the house style", () => {
  const picked = createGame(scenario({
    cabinetDoctrine: "loyalists", cabinetPicks: { defense: "professional" },
  })).cabinet.find((m) => m.id === "defense");
  const slate = candidatesFor(scenario(), "defense").find((c) => c.key === "professional");

  assert.equal(picked.name, slate.name);
  assert.equal(picked.competence, slate.competence, "you get the person you picked, not their band");
});

test("the same transition twice is the same cabinet", () => {
  const a = cabinetOf({ cabinetDoctrine: "balanced" });
  const b = cabinetOf({ cabinetDoctrine: "balanced" });
  assert.deepEqual(a.map((m) => `${m.name}${m.loyalty}${m.competence}`),
    b.map((m) => `${m.name}${m.loyalty}${m.competence}`));
});

/**
 * Every save made before today has no doctrine on its scenario, and has to
 * open on exactly the cabinet it was playing with yesterday.
 */
test("a career that predates all of this is untouched", () => {
  assert.equal(appointments(scenario()), null);
  const before = cabinetOf();
  const after = cabinetOf();
  assert.deepEqual(before.map((m) => m.name), after.map((m) => m.name));
});

// ---------------------------------------------------------------------------
// Crossing the wire
// ---------------------------------------------------------------------------

/**
 * The bug this feature actually shipped with, found on the first live run and
 * invisible to every test above.
 *
 * Nothing reaches `createGame` that the server's scenario sanitiser has not
 * copied across, and it copied neither field: the doctrine was chosen, the
 * override was picked, the request carried both, and the president was sworn in
 * with the same eleven strangers as always. The tests all passed because they
 * all called `createGame` directly and never crossed the wire the feature
 * travels on. So the sanitising lives here now, next to the thing it describes,
 * where it can be tested.
 */
test("the transition survives the journey from a browser", () => {
  const out = sanitiseTransition({ cabinetDoctrine: "rivals", cabinetPicks: { defense: "professional" } });
  assert.equal(out.cabinetDoctrine, "rivals");
  assert.deepEqual(out.cabinetPicks, { defense: "professional" });
});

test("and nothing else does", () => {
  const out = sanitiseTransition({
    cabinetDoctrine: "nonsense",
    cabinetPicks: {
      defense: "professional",
      vp: "loyalist",              // not an appointment
      dogcatcher: "loyalist",      // not a post
      state: "the good one",       // not a candidate
    },
  });
  assert.equal(out.cabinetDoctrine, "balanced", "an unknown doctrine falls to the middle");
  assert.deepEqual(out.cabinetPicks, { defense: "professional" });
});

test("a president who skipped the transition entirely carries nothing", () => {
  assert.deepEqual(sanitiseTransition({}), {});
  assert.deepEqual(sanitiseTransition(null), {});
  assert.deepEqual(sanitiseTransition({ cabinetPicks: { defense: "professional" } }), {},
    "picks without a doctrine are a half-finished transition, not a cabinet");
});

// ---------------------------------------------------------------------------
// Which is the whole point: it reaches the rooms
// ---------------------------------------------------------------------------

test("a room is advised by the people whose brief it actually is", () => {
  const state = createGame(scenario({ cabinetDoctrine: "balanced" }));
  const situation = advisorsFor(state, "situation").map((a) => a.id);
  const press = advisorsFor(state, "press").map((a) => a.id);

  assert.equal(situation.length, 3);
  assert.ok(situation.includes("defense"), "the Situation Room hears from Defense");
  assert.ok(press.includes("press"), "and the briefing room from the Press Secretary");
  assert.equal(new Set(situation).size, 3, "and never the same person twice");
});

test("the month's crisis brings the department that owns it to the table", () => {
  const state = createGame(scenario({ cabinetDoctrine: "balanced" }));
  const health = advisorsFor(state, "situation", { domain: "health" }).map((a) => a.id);
  assert.ok(health.includes("hhs"), "a health crisis is Health's meeting");
});

test("the plan you are offered is only as good as the person you appointed", () => {
  const loyal = createGame(scenario({ cabinetDoctrine: "loyalists" }));
  const rivals = createGame(scenario({ cabinetDoctrine: "rivals" }));

  const band = (state) => writtenOptions(state, "situation")
    .map((o) => o.plan);
  // Offline, the plan text is chosen by competence and loyalty band, so two
  // differently-staffed governments must not be offering the same three plans.
  assert.notDeepEqual(band(loyal), band(rivals));
});

test("a recommendation attributed to somebody who is not in the room is dropped", () => {
  const advisors = [{ id: "defense", role: "Secretary of Defense", name: "Okafor", emoji: "🪖" }];
  const out = validateOpening({
    scene: "s", asks: "a",
    options: [
      { id: "defense", plan: "Move the money first and argue about the authority afterwards." },
      { id: "treasury", plan: "A plan from somebody who is not at this meeting." },
      { id: "defense", plan: "A second plan from the same person, which is padding." },
      { id: "defense", plan: "short" },
    ],
  }, advisors);

  assert.equal(out.options.length, 1);
  assert.equal(out.options[0].who, "Secretary of Defense Okafor");
});

/**
 * Seen live: a 14b holding a scene, two questions, an ask and three plans in one
 * JSON object returned exactly one plan. The room then had a single advisor in
 * it and the player had no way to tell that from a cabinet with nothing to say.
 */
test("a model that returns one recommendation still fills the room", () => {
  const state = createGame(scenario({ cabinetDoctrine: "balanced" }));
  const advisors = advisorsFor(state, "situation");
  const partial = [{
    id: advisors[0].id,
    who: `${advisors[0].role} ${advisors[0].name}`,
    plan: "Move the money first and argue about the authority afterwards.",
  }];

  const full = toppedUp(partial, state, "situation");
  assert.equal(full.length, 3);
  assert.equal(full[0].plan, partial[0].plan, "what the model wrote is kept");
  assert.deepEqual(full.map((o) => o.id), advisors.map((a) => a.id),
    "and the two who were dropped are the two who speak");
});
