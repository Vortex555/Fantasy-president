import test from "node:test";
import assert from "node:assert/strict";

import { driftedFromEnglish, foreignScript } from "../src/ai/english.js";

/**
 * The game is written in English and the model sometimes is not.
 *
 * A judicial ethics bill came back with three of its four stance cards in
 * Mandarin — "WV-2担心这会削弱法官的权威" printed under an English heading, beside
 * an English title, with every position correct and the JSON perfectly well
 * formed. Nothing in the game could see it, because nothing in the game read
 * prose; it checked shapes, positions and numbers, all of which were fine.
 *
 * Everything below is either that failure or a sentence that must survive it.
 * The second list matters more than the first: this is the one guard in the
 * game that can cost a player a whole month rather than a single line.
 */

// ---------------------------------------------------------------------------
// What drift looks like
// ---------------------------------------------------------------------------

test("the stance cards that started this", () => {
  const drifted = [
    "WV-2担心这会削弱法官的权威，影响地方案件判决。",
    "The Freedom Caucus认为这是对司法部门过度干预。",
    "Daniel Tolpa反对任何可能限制宪法赋予法官权力的法案。",
  ];
  for (const text of drifted) {
    assert.equal(driftedFromEnglish(text), true, `should have been caught: "${text}"`);
  }
});

test("it is not a list of scripts, so it catches the ones nobody thought of", () => {
  for (const text of [
    "Руководство считает это угрозой независимости судей.",   // Cyrillic
    "지도부는 이것이 사법 독립에 대한 위험이라고 본다.",              // Hangul
    "指導部はこれを司法の独立への脅威と見なしている。",                // Japanese
    "القيادة تعتبر هذا تهديدا لاستقلال القضاء.",                // Arabic
  ]) {
    assert.equal(driftedFromEnglish(text), true, `should have been caught: "${text}"`);
  }
});

test("a line that drifts partway through is still a line that drifted", () => {
  assert.equal(driftedFromEnglish("Leadership promised the agencies this renewal，但是他们改变了主意。"), true);
});

// ---------------------------------------------------------------------------
// And what it is not
// ---------------------------------------------------------------------------

test("ordinary lines from the floor screen are left alone", () => {
  const keep = [
    "Leadership promised the agencies this renewal in exchange for the budget deal.",
    "WV-2 grows no corn, so this reads as another region's bailout.",
    "They have wanted the platforms broken up since the caucus was still defending them.",
    "",
  ];
  for (const text of keep) {
    assert.equal(driftedFromEnglish(text), false, `wrongly caught: "${text}"`);
  }
});

test("accents are Latin, and so are the names the game invents", () => {
  for (const text of [
    "Representative José Salas will not thank you for it.",
    "The café owners in Wheeling have been calling the district office all week.",
    "Señora Okonjo's district office fielded 400 calls.",
  ]) {
    assert.equal(driftedFromEnglish(text), false, `wrongly caught: "${text}"`);
  }
});

test("punctuation, numbers, currency and symbols are not letters", () => {
  for (const text of [
    "A $12bn authorisation — 54–46, with the filibuster broken at 2 a.m.",
    "“Leadership is whipping hard against it,” one aide said.",
    "Approval fell 3.5% and the caucus noticed ⚑",
  ]) {
    assert.equal(driftedFromEnglish(text), false, `wrongly caught: "${text}"`);
  }
});

// ---------------------------------------------------------------------------
// Our own words coming back
// ---------------------------------------------------------------------------

/**
 * The bug this had until it was run against the real model instead of a stub.
 *
 * qwen2.5:14b was asked to explain a bill whose title was Chinese. It wrote
 * four sentences of perfectly good English and copied the title back exactly as
 * the prompt demands — the title is how the engine matches an explanation to
 * its bill. Nine characters of our own material, handed straight back, read as
 * drift; the reply was discarded, the retry copied the title back too, and the
 * whole call was lost.
 *
 * Titles, district names and the president's free-written policy are all echoed
 * somewhere, so one drifted title stored on a bill would have made every later
 * call about that bill fail forever.
 */
test("a title the model was told to copy back is not the model drifting", () => {
  const given = 'THIS MONTH\'S BILLS:\n- "司法问责与诚信法案" — 对联邦法官实施新的道德准则。';
  const reply = JSON.stringify({ voices: [{
    title: "司法问责与诚信法案",
    party: "Leadership sees this as a chance to reform the courts before the recess.",
    district: "WV-2 hears it as Washington policing its own and calling it reform.",
  }] });

  assert.equal(driftedFromEnglish(reply, given), false, "every word it wrote was English");
  assert.equal(driftedFromEnglish(reply), true,
    "and without knowing what was asked, this is exactly what went wrong");
});

test("a name in the player's own policy does not cost them the turn", () => {
  const given = "THE PRESIDENT'S POLICY:\n\"\"\"Open talks with 中国海洋石油 over the platform seizure.\"\"\"";
  const reply = JSON.stringify({
    analysis: "The talks buy a fortnight and the platform stays where it is. 中国海洋石油 has "
      + "already briefed its own regulator, and the Navy is drafting a freedom-of-navigation option.",
  });
  assert.equal(driftedFromEnglish(reply, given), false);
});

test("but a foreign sentence the model invented is still drift, prompt or no prompt", () => {
  const given = 'THIS MONTH\'S BILLS:\n- "司法问责与诚信法案" — 对联邦法官实施新的道德准则。';
  const reply = JSON.stringify({ voices: [{
    title: "司法问责与诚信法案",
    district: "WV-2担心这会削弱法官的权威，影响地方案件判决。",
  }] });
  assert.equal(driftedFromEnglish(reply, given), true,
    "the title was ours; that sentence was not");
});

test("a foreign run that merely contains one of ours is the model's own", () => {
  // Echoing "北京" is our word back. Writing a sentence around it is not.
  const given = "The situation names 北京 as the counterparty.";
  assert.equal(driftedFromEnglish("They said 北京", given), false);
  assert.equal(driftedFromEnglish("他们说北京不会让步的", given), true);
});

/**
 * The threshold is a floor, not a hair trigger. A single stray character in a
 * turn that is otherwise entirely English is not worth throwing the turn away
 * over — this guard is the only one that can cost a player a whole month.
 */
test("one stray character does not cost a player their month", () => {
  const turn = "The appropriation clears the House but the Senate hold survives, and the "
    + "governor's office is already drafting the waiver request. 円 was in the wire copy.";
  assert.equal(driftedFromEnglish(turn), false);
});

test("a short field drifts on fewer characters than a long one", () => {
  // Two characters is nothing in a paragraph and everything in a stance card.
  assert.equal(driftedFromEnglish("是的"), true);
  assert.equal(driftedFromEnglish(
    "Leadership counted the votes twice and came up two short, which is why the "
    + "rule went to the floor before the bill did and why the whip office spent "
    + "the weekend on the phone to the freshmen. 是的"), false);
});

// ---------------------------------------------------------------------------
// What the warning gets to say
// ---------------------------------------------------------------------------

test("the reading is reportable, because a silent guard is how this happened", () => {
  const seen = foreignScript("WV-2担心这会削弱法官的权威。");
  assert.ok(seen.count >= 4, "counts the characters that are not ours");
  assert.ok(seen.share > 0.5, "and how much of the answer they were");
  assert.match(seen.sample, /担心/, "and shows some, so the log names the language");
});
