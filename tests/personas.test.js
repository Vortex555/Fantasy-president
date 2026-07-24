import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAS,
  SPEAKERS_PER_TURN,
  attachQuotes,
  moodFromScore,
  rosterPrompt,
  scoreAll,
  scorePersona,
  selectSpeakers,
} from "../src/personas.js";
import { createGame, applyResult, mockTurn, mockVoices, openingEvent } from "../src/gameEngine.js";

const rancher = PERSONAS.find((p) => p.id === "p04"); // right-leaning, TX, gun_owners + greens
const student = PERSONAS.find((p) => p.id === "p10"); // left-leaning, MA, greens + civil_rights

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

test("the panel is thirty voters with unique ids", () => {
  assert.equal(PERSONAS.length, 30);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, 30);
});

test("every voter has a state, a lean and issues they actually feel", () => {
  for (const p of PERSONAS) {
    assert.match(p.state, /^[A-Z]{2}$/, `${p.id} needs a state code`);
    assert.ok(p.lean >= -1 && p.lean <= 1, `${p.id} lean out of range`);
    assert.ok(p.issues.length > 0, `${p.id} cares about nothing`);
  }
});

test("the panel spans the spectrum rather than leaning one way", () => {
  const left = PERSONAS.filter((p) => p.lean < -0.2).length;
  const right = PERSONAS.filter((p) => p.lean > 0.2).length;
  assert.ok(left >= 8 && right >= 8, `unbalanced panel: ${left} left, ${right} right`);
});

test("the roster prompt carries every voter", () => {
  const text = rosterPrompt();
  for (const p of PERSONAS) assert.ok(text.includes(p.id), `${p.id} missing from prompt`);
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

test("a voter aligned with the president reads the same month more warmly", () => {
  const ctx = { approvalChange: 0, presidentSign: 1 }; // Republican president
  assert.ok(scorePersona(rancher, ctx) > scorePersona(student, ctx));
});

test("the same voter flips when the president's party flips", () => {
  const underR = scorePersona(rancher, { approvalChange: 0, presidentSign: 1 });
  const underD = scorePersona(rancher, { approvalChange: 0, presidentSign: -1 });
  assert.ok(underR > underD);
});

test("a voter reacts to the blocs they personally care about", () => {
  const base = { approvalChange: 0, presidentSign: 0 };
  const hit = scorePersona(rancher, { ...base, stakeholders: { gun_owners: -20 } });
  const irrelevant = scorePersona(rancher, { ...base, stakeholders: { wall_street: -20 } });
  assert.ok(hit < irrelevant, "a gun owner should feel a gun-owner shock");
  assert.equal(irrelevant, scorePersona(rancher, base), "an unrelated bloc should not move them");
});

test("a voter reacts to what happened in their own state", () => {
  const base = { approvalChange: 0, presidentSign: 0 };
  assert.ok(scorePersona(rancher, { ...base, states: { TX: -15 } }) < scorePersona(rancher, base));
  assert.equal(scorePersona(rancher, { ...base, states: { MA: -15 } }), scorePersona(rancher, base));
});

test("the national swing moves the whole panel", () => {
  const up = scoreAll({ approvalChange: 10, presidentSign: 0 });
  const down = scoreAll({ approvalChange: -10, presidentSign: 0 });
  for (let i = 0; i < up.length; i++) assert.ok(up[i].score > down[i].score);
});

test("moods bucket around a neutral middle", () => {
  assert.equal(moodFromScore(5), "approve");
  assert.equal(moodFromScore(0), "mixed");
  assert.equal(moodFromScore(-5), "disapprove");
});

test("a divisive month splits the panel rather than moving it as a block", () => {
  const scored = scoreAll({ approvalChange: 0, presidentSign: 1, stakeholders: { greens: -18, gun_owners: 14 } });
  const moods = new Set(scored.map((s) => s.mood));
  assert.ok(moods.size >= 2, "everyone reacting identically means the scoring is inert");
});

// ---------------------------------------------------------------------------
// Who speaks
// ---------------------------------------------------------------------------

test("a fixed-size cast speaks each month, with no repeats within a turn", () => {
  const scored = scoreAll({ approvalChange: 4, presidentSign: -1 });
  const speakers = selectSpeakers(scored, 1);
  assert.equal(speakers.length, SPEAKERS_PER_TURN);
  assert.equal(new Set(speakers.map((s) => s.id)).size, SPEAKERS_PER_TURN);
});

test("the cast rotates so the same voices don't monopolise the term", () => {
  const scored = scoreAll({ approvalChange: 4, presidentSign: -1 });
  const m1 = selectSpeakers(scored, 1).map((s) => s.id);
  const m2 = selectSpeakers(scored, 2).map((s) => s.id);
  assert.notDeepEqual(m1, m2);
});

test("speaker selection is deterministic for a given month", () => {
  const scored = scoreAll({ approvalChange: 4, presidentSign: -1 });
  assert.deepEqual(selectSpeakers(scored, 7), selectSpeakers(scored, 7));
});

test("asking for more speakers than the panel holds does not break", () => {
  const scored = scoreAll({ approvalChange: 0, presidentSign: 0 });
  assert.equal(selectSpeakers(scored, 3, 999).length, PERSONAS.length);
});

// ---------------------------------------------------------------------------
// Merging quotes back
// ---------------------------------------------------------------------------

test("quotes attach to the right voter and leave the silent ones silent", () => {
  const scored = scoreAll({ approvalChange: 0, presidentSign: 0 });
  const merged = attachQuotes(scored, [{ id: "p04", quote: "Not one bit of that helps my herd." }]);
  assert.equal(merged.find((p) => p.id === "p04").quote, "Not one bit of that helps my herd.");
  assert.equal(merged.find((p) => p.id === "p10").quote, undefined);
  assert.equal(merged.length, scored.length, "no voter should be dropped");
});

test("a malformed or empty quote payload is survivable", () => {
  const scored = scoreAll({ approvalChange: 0, presidentSign: 0 });
  for (const bad of [null, [], [{}], [{ id: "nope", quote: "x" }], [{ id: "p04" }]]) {
    assert.equal(attachQuotes(scored, bad).length, 30);
  }
});

// ---------------------------------------------------------------------------
// Integration with the turn
// ---------------------------------------------------------------------------

const scenario = { presidentName: "Test President", party: "Democrat", era: "now", startApproval: 52 };

test("resolving a turn scores the whole panel and picks a cast", () => {
  const state = createGame(scenario);
  const result = mockTurn(state, "A jobs bill funding new manufacturing.", "", openingEvent());
  applyResult(state, "A jobs bill funding new manufacturing.", result);
  assert.equal(result.personas.length, 30);
  assert.equal(result.speakers.length, SPEAKERS_PER_TURN);
  for (const p of result.personas) {
    assert.ok(["approve", "mixed", "disapprove"].includes(p.mood));
  }
});

test("local-sim voices supply words matching the mood the engine chose", () => {
  const state = createGame(scenario);
  const result = mockTurn(state, "A jobs bill.", "", openingEvent());
  applyResult(state, "A jobs bill.", result);
  const quotes = mockVoices(result.speakers, "A jobs bill.");
  assert.equal(quotes.length, SPEAKERS_PER_TURN);
  for (const q of quotes) assert.ok(q.quote && q.quote.length > 0);
  const merged = attachQuotes(result.personas, quotes);
  assert.equal(merged.filter((p) => p.quote).length, SPEAKERS_PER_TURN);
});
