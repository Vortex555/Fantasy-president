import test from "node:test";
import assert from "node:assert/strict";

import { voiceFor } from "../src/bills.js";
import { partyLine, districtView } from "../src/house.js";
import { convictionView } from "../src/conviction.js";
import { factionLine } from "../src/factions.js";
import { validateVoices } from "../src/chamberAi.js";
import { chairAction } from "../src/committees.js";

/**
 * Who says what, and why.
 *
 * The four stance cards carried fixed strings — "the caucus is for it", "you
 * have spent your career arguing against this" — that fired identically whatever
 * the bill did. The position was computed with some care and then explained with
 * a sentence chosen from a set of two.
 *
 * So the model writes the sentence. It is emphatically not asked which way
 * anybody votes: it is *told* the positions the engine derived and asked to say
 * why, once, when the month's calendar is settled. The text is frozen on the
 * bill next to the position it was written for, and used only while that
 * position still holds — which makes it self-invalidating, since a bill amended
 * in committee moves and its old explanation stops matching.
 */

const state = (o = {}) => ({
  scenario: {
    party: "Republican", ideology: "Groyper",
    ideologyAxis: 0.95, ideologyLiberty: 0.5, presidentName: "T",
  },
  seat: { district: "WV-2", axis: 0.9, lean: 60 },
  caucus: "Republican",
  ...o,
});

const BILL = {
  id: "v1", title: "Warrant Requirement Act",
  axis: -0.1, liberty: 0.58, domain: "justice", support: "contested",
};

// ---------------------------------------------------------------------------
// The lookup itself
// ---------------------------------------------------------------------------

test("a frozen line is used only while the position it was written for holds", () => {
  const bill = { ...BILL, voices: { party: { position: "no", text: "Leadership promised the agencies." } } };
  assert.equal(voiceFor(bill, "party", "no"), "Leadership promised the agencies.");
  assert.equal(voiceFor(bill, "party", "yes"), null,
    "an explanation for the opposite vote is worse than no explanation");
});

test("a bill with nothing frozen on it asks for nothing", () => {
  assert.equal(voiceFor(BILL, "party", "no"), null);
  assert.equal(voiceFor(undefined, "party", "no"), null);
  assert.equal(voiceFor({ voices: { party: "a bare string" } }, "party", "no"), null);
});

// ---------------------------------------------------------------------------
// Each card prefers it, and falls back cleanly
// ---------------------------------------------------------------------------

test("every stance card uses the written line when there is one", () => {
  const s = state();
  const positions = {
    party: partyLine(s, BILL).position,
    district: districtView(s, BILL).position,
    conviction: convictionView(s, BILL).position,
    bloc: factionLine(s, BILL).position,
  };
  const bill = {
    ...BILL,
    voices: {
      party: { position: positions.party, text: "Leadership gave the agencies its word." },
      district: { position: positions.district, text: "WV-2 has other things on its mind." },
      conviction: { position: positions.conviction, text: "You have said this for years." },
      bloc: { position: positions.bloc, text: "They have wanted this since the last reauthorisation." },
    },
  };
  assert.equal(partyLine(s, bill).reason, "Leadership gave the agencies its word.");
  assert.equal(districtView(s, bill).reason, "WV-2 has other things on its mind.");
  assert.equal(convictionView(s, bill).reason, "You have said this for years.");
  assert.equal(factionLine(s, bill).reason, "They have wanted this since the last reauthorisation.");
});

test("with nothing written, the hand-written lines are exactly what they were", () => {
  const s = state();
  assert.equal(convictionView(s, BILL).reason, "This is what you came here to do.");
  assert.match(factionLine(s, BILL).reason, /whipping for it/);
  assert.match(districtView(s, BILL).reason, /WV-2/);
  assert.ok(partyLine(s, BILL).reason.length > 0);
});

test("the positions are the engine's, whatever the model wrote", () => {
  const s = state();
  const plain = convictionView(s, BILL);
  const dressed = convictionView(s, {
    ...BILL,
    voices: { conviction: { position: "no", text: "a line for the opposite vote" } },
  });
  assert.equal(dressed.position, plain.position, "prose must never move a stance");
  assert.equal(dressed.reason, plain.reason, "and a mismatched line is not used");
});

// ---------------------------------------------------------------------------
// Amending a bill retires its explanations
// ---------------------------------------------------------------------------

test("a bill amended past its own explanation stops using it", () => {
  const s = state();
  const before = convictionView(s, BILL).position;
  const bill = { ...BILL, voices: { conviction: { position: before, text: "written for the old bill" } } };

  const chair = state({
    rank: "chair", committee: "judiciary", month: 4, term: 1,
    leadership: 40, committeeLog: [],
    scenario: { ...state().scenario, ideologyAxis: -0.9, ideologyLiberty: -0.9 },
  });
  const moved = chairAction(chair, bill, "amend").result.bill;
  const after = convictionView(s, moved);
  if (after.position !== before) {
    assert.notEqual(after.reason, "written for the old bill",
      "the committee moved the bill and the old sentence outlived it");
  }
});

// ---------------------------------------------------------------------------
// The engine trusts the prose as little as it trusts everything else
// ---------------------------------------------------------------------------

const bills = [{ id: "a", title: "Warrant Requirement Act" }, { id: "b", title: "Tariff Restoration Act" }];
const positions = {
  a: { party: "no", district: "no", conviction: "yes", bloc: "yes" },
  b: { party: "yes", district: "yes", conviction: "no", bloc: "no" },
};

test("lines are matched to bills by title and attached with their position", () => {
  const out = validateVoices({ voices: [
    { title: "Warrant Requirement Act", party: "Leadership gave its word.", conviction: "You have said this for years." },
  ] }, bills, positions);
  assert.equal(out.a.party.text, "Leadership gave its word.");
  assert.equal(out.a.party.position, "no", "frozen beside the stance it explains");
  assert.equal(out.a.conviction.position, "yes");
  assert.equal(out.b, undefined);
});

test("a line for a bill that is not on the floor is discarded", () => {
  const out = validateVoices({ voices: [{ title: "Some Other Act", party: "x" }] }, bills, positions);
  assert.deepEqual(out, {});
});

test("an unknown voice is ignored and empty text is not frozen", () => {
  const out = validateVoices({ voices: [
    { title: "Tariff Restoration Act", lobbyists: "not a card on the screen", party: "   ", district: "Real." },
  ] }, bills, positions);
  assert.equal(out.b.lobbyists, undefined);
  assert.equal(out.b.party, undefined);
  assert.equal(out.b.district.text, "Real.");
});

test("nonsense returns nothing rather than throwing", () => {
  assert.deepEqual(validateVoices(null, bills, positions), {});
  assert.deepEqual(validateVoices({ voices: "words" }, bills, positions), {});
  assert.deepEqual(validateVoices({ voices: [null, 7] }, bills, positions), {});
});

// ---------------------------------------------------------------------------
// A line that argues the other way
// ---------------------------------------------------------------------------

/**
 * The position check was a label check, and a label is not a meaning.
 *
 * A prison-funding bill came back with the Freedom Caucus marked YES and the
 * sentence "The Freedom Caucus opposes increased federal oversight and funding
 * for bureaucratic expansion" printed underneath it. The stored position matched
 * the computed one exactly — both said yes — so nothing retired the line. The
 * model had simply written for the opposite stance and said so in plain words.
 *
 * Smaller models drop instructions under load, and "never contradict the stated
 * position" is one of a dozen rules in that prompt. So the engine reads the
 * sentence rather than trusting the label, and a line that argues the other way
 * is dropped back to the hand-written one.
 */
test("a line that plainly argues the other way is not printed under the position", () => {
  const out = validateVoices({ voices: [{
    title: "Warrant Requirement Act",
    bloc: "The Freedom Caucus opposes increased federal oversight and funding for bureaucratic expansion.",
  }] }, [{ id: "a", title: "Warrant Requirement Act" }], { a: { bloc: "yes" } });
  assert.equal(out.a, undefined, "a YES card must not carry a sentence about opposing it");
});

test("the same sentence under the position it actually argues is kept", () => {
  const out = validateVoices({ voices: [{
    title: "Warrant Requirement Act",
    bloc: "The Freedom Caucus opposes increased federal oversight and funding for bureaucratic expansion.",
  }] }, [{ id: "a", title: "Warrant Requirement Act" }], { a: { bloc: "no" } });
  assert.match(out.a.bloc.text, /opposes increased federal oversight/);
});

test("it works the other way too", () => {
  const out = validateVoices({ voices: [{
    title: "Warrant Requirement Act", party: "Leadership strongly supports the measure.",
  }] }, [{ id: "a", title: "Warrant Requirement Act" }], { a: { party: "no" } });
  assert.equal(out.a, undefined);
});

test("a sentence carrying both sides is left alone, because it is probably fine", () => {
  // "backs it despite opposition from the base" is coherent, not contradictory.
  const out = validateVoices({ voices: [{
    title: "Warrant Requirement Act",
    party: "Leadership backs it despite loud opposition from the base.",
  }] }, [{ id: "a", title: "Warrant Requirement Act" }], { a: { party: "yes" } });
  assert.match(out.a.party.text, /backs it despite/);
});

test("an ordinary reason with no stance verb at all is kept", () => {
  const out = validateVoices({ voices: [{
    title: "Warrant Requirement Act",
    district: "WV-2 grows no corn, so this reads as another region's bailout.",
  }] }, [{ id: "a", title: "Warrant Requirement Act" }], { a: { district: "no" } });
  assert.match(out.a.district.text, /another region/);
});

// ---------------------------------------------------------------------------
// The one voice that may not defer
// ---------------------------------------------------------------------------

/**
 * "Tolpa is aligned with the bloc's stance, believing such regulation infringes
 * upon First Amendment rights."
 *
 * The conviction card exists to say what the member themselves believes, and it
 * is the one voice on the floor whose whole job is to be capable of disagreeing
 * with the other three. A sentence that answers "why do you vote this way" with
 * "because my caucus does" has not answered it, and on a screen laid out to show
 * a three-way bind it quietly removes one of the three.
 *
 * The other cards may name institutions freely — the bloc card naming its own
 * caucus is the point of it.
 */
test("the conviction card may not explain itself by another voice's position", () => {
  const bills = [{ id: "a", title: "Social Responsibility Act" }];
  const positions = { a: { conviction: "no", bloc: "no", party: "no", district: "no" } };

  const deferring = [
    "Tolpa is aligned with the bloc's stance on this one.",
    "They agree with leadership that it goes too far.",
    "Sides with the caucus, as they usually do.",
    "In line with the Freedom Caucus position.",
    "They follow the party on procedural votes like this.",
  ];
  for (const text of deferring) {
    const out = validateVoices({ voices: [{ title: "Social Responsibility Act", conviction: text }] },
      bills, positions);
    assert.equal(out.a, undefined, `should have been refused: "${text}"`);
  }
});

test("but a conviction of their own that happens to mention a caucus is kept", () => {
  const bills = [{ id: "a", title: "Social Responsibility Act" }];
  const positions = { a: { conviction: "no" } };
  const out = validateVoices({ voices: [{ title: "Social Responsibility Act",
    conviction: "They have wanted the platforms broken up since the caucus was still defending them." }] },
    bills, positions);
  assert.match(out.a.conviction.text, /broken up/);
});

test("and the other three cards may name institutions freely", () => {
  const bills = [{ id: "a", title: "Social Responsibility Act" }];
  const positions = { a: { bloc: "no", party: "no", district: "no" } };
  const out = validateVoices({ voices: [{
    title: "Social Responsibility Act",
    bloc: "The Freedom Caucus is aligned with leadership for once.",
    party: "Leadership agrees with the caucus on the timetable.",
    district: "WV-2 sides with the party here.",
  }] }, bills, positions);
  assert.equal(Object.keys(out.a).length, 3, "only the conviction card is held to this");
});
