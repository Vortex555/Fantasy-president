import test from "node:test";
import assert from "node:assert/strict";

import {
  isRealOutlet, guessesGender, inventedPress, namesRealOutlet, withoutRealOutlet,
} from "../src/ai/prose.js";

/**
 * Two rules every prompt in the game states and the model breaks anyway.
 *
 * Both were found by reading a month of real output from qwen2.5:14b rather
 * than a fixture, and both are the same class of failure as the language drift:
 * an instruction near the end of a long prompt that a small model drops under
 * load, with nothing downstream able to notice. Neither of them is a number,
 * which is exactly why they need catching here — a wrong axis eventually shows
 * up in a roll call somebody stares at, and a real newspaper in an invented
 * country just sits on the screen looking plausible.
 */

// ---------------------------------------------------------------------------
// Mastheads
// ---------------------------------------------------------------------------

test("the ones the model actually reached for", () => {
  // Both of these came back in one fallout. The first is the real paper of
  // record for the state the member represents.
  assert.equal(isRealOutlet("Charleston Gazette-Mail"), true);
  assert.equal(isRealOutlet("The Hill"), true);
});

test("and the rest of the ones a model stops inventing at", () => {
  for (const name of [
    "The New York Times", "Washington Post", "WSJ", "Politico", "Axios", "NPR",
    "Reuters", "Fox News", "MSNBC", "The Atlantic", "Breitbart", "ProPublica",
    "the associated press", "Bloomberg", "The Guardian",
  ]) {
    assert.equal(isRealOutlet(name), true, `should have been caught: ${name}`);
  }
});

/**
 * The half that matters more. Real papers are named out of the same small bag
 * of words as invented ones, so a guard that reads words instead of names would
 * eat the entire press pack.
 */
test("an invented paper made of ordinary newspaper words survives", () => {
  for (const name of [
    "The Wheeling Gazette", "Cabell County Register", "The Mountain State Ledger",
    "Kanawha Valley Post", "The Beckley Standard-Times", "Tri-State Chronicle",
    "The Ohio Valley Sentinel", "Coalfield Daily News",
  ]) {
    assert.equal(isRealOutlet(name), false, `wrongly caught: ${name}`);
  }
});

test("the definite article and the punctuation are not the name", () => {
  assert.equal(isRealOutlet("the new york times"), true);
  assert.equal(isRealOutlet("The  New York  Times"), true);
  assert.equal(isRealOutlet(""), false);
  assert.equal(isRealOutlet(null), false);
});

test("a real masthead is dropped, and the rest of the pack is untouched", () => {
  const press = inventedPress([
    { outlet: "The Wheeling Gazette", headline: "Tolpa Defends the Vote" },
    { outlet: "The Hill", headline: "GOP Splits on Ethics Bill" },
    { outlet: "Kanawha Valley Post", headline: "Nobody Here Is Surprised" },
  ]);
  assert.equal(press.length, 2);
  assert.deepEqual(press.map((p) => p.outlet), ["The Wheeling Gazette", "Kanawha Valley Post"]);
});

// ---------------------------------------------------------------------------
// A gender nobody stated
// ---------------------------------------------------------------------------

/**
 * Every chamber prompt says outright that the member's gender is not stated
 * anywhere and must not be guessed. This came back in a live fallout anyway.
 */
test("the quote that started it", () => {
  assert.equal(guessesGender(
    "Tolpa's vote was a mistake. It looks like he cares more about protecting certain folks "
    + "than the people of this state.", "Daniel Tolpa"), true);
});

test("naming them and then choosing for them, in either direction", () => {
  assert.equal(guessesGender("Tolpa said his piece and left.", "Daniel Tolpa"), true);
  assert.equal(guessesGender("Representative Tolpa lost her nerve.", "Daniel Tolpa"), true);
  assert.equal(guessesGender("Tolpa voted the way she always does.", "Daniel Tolpa"), true);
});

/**
 * And the half that would cost real lines. A constituent talking about her own
 * job in a quote that never mentions the member has decided nothing about
 * anybody, and the fallout is mostly made of quotes like that.
 */
test("somebody else's pronouns are somebody else's business", () => {
  for (const quote of [
    "My husband drove ninety minutes to that clinic and he still could not be seen.",
    "She has run the diner on Route 60 for thirty years and this will close it.",
    "I voted for him for governor and I would not do it again.",
  ]) {
    assert.equal(guessesGender(quote, "Daniel Tolpa"), false, `wrongly caught: ${quote}`);
  }
});

test("and writing about the member without deciding anything is fine", () => {
  assert.equal(guessesGender(
    "Tolpa voted no and will be asked about it at every town hall until November.",
    "Daniel Tolpa"), false);
  assert.equal(guessesGender("They held the line for the caucus.", "Daniel Tolpa"), false);
});

test("a member with no name to anchor on is not guessed about either way", () => {
  assert.equal(guessesGender("He voted no.", ""), false, "with nothing to anchor to, nothing is claimed");
  assert.equal(guessesGender("", "Daniel Tolpa"), false);
});

// ---------------------------------------------------------------------------
// A real employer standing next to an invented person
// ---------------------------------------------------------------------------

/**
 * The first live press briefing the model ever wrote came back with "Lena
 * Martinez from Reuters" and "James Taylor from CNN" — invented people, real
 * news organisations, in a prompt that says to invent every one of them. The
 * outlet is not in a field of its own here, so it has to be found inside the
 * line.
 */
test("a real newsroom is found inside a byline", () => {
  assert.equal(namesRealOutlet("Lena Martinez from Reuters"), true);
  assert.equal(namesRealOutlet("James Taylor from CNN"), true);
  assert.equal(namesRealOutlet("Priya Raman, Politico"), true);
});

test("and an invented one is not", () => {
  for (const who of [
    "Lena Martinez, The Wheeling Gazette",
    "James Taylor of the Capital Register",
    "Ada Osei, Beltway Wire Service",
    "The Chief of Staff",
    "A county chair",
  ]) {
    assert.equal(namesRealOutlet(who), false, `wrongly caught: ${who}`);
  }
});

test("the person keeps their question and loses their employer", () => {
  assert.equal(withoutRealOutlet("Lena Martinez from Reuters"), "Lena Martinez");
  assert.equal(withoutRealOutlet("James Taylor, CNN"), "James Taylor");
  assert.equal(withoutRealOutlet("Priya Raman (Politico)"), "Priya Raman");
  assert.equal(withoutRealOutlet("Ada Osei of the Associated Press"), "Ada Osei");
});

test("a byline that is nothing but a real newsroom leaves nothing behind", () => {
  assert.equal(withoutRealOutlet("Reuters"), "");
  assert.equal(withoutRealOutlet("CNN"), "");
});

test("and a clean byline is returned exactly as it came", () => {
  assert.equal(withoutRealOutlet("Lena Martinez, The Wheeling Gazette"), "Lena Martinez, The Wheeling Gazette");
  assert.equal(withoutRealOutlet("The Chief of Staff"), "The Chief of Staff");
});

/**
 * Caught in a live caucus room: "Rep. Emily Quinn, NYT reporter". The list had
 * "new york times" spelled out and not the abbreviation the model actually
 * reached for, which is the one a byline uses.
 */
test("the abbreviations are the form a byline actually takes", () => {
  assert.equal(withoutRealOutlet("Rep. Emily Quinn, NYT reporter"), "Rep. Emily Quinn");
  assert.equal(withoutRealOutlet("Ada Osei, WaPo"), "Ada Osei");
  assert.equal(withoutRealOutlet("Priya Raman of WSJ"), "Priya Raman");
});
