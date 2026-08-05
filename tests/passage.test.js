import test from "node:test";
import assert from "node:assert/strict";

import {
  sendOnward, advancePassage, pushFarChamber, inFlight,
  overrideBills, resolveOverride, farChamberName, FAR_PRICE,
} from "../src/passage.js";
import { createHouseCareer, castVote, advanceHouseMonth } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";
import { domainsActedOn } from "../src/nation.js";

/**
 * What happens to a bill after it leaves your floor.
 *
 * The mode's oldest and largest lie was that nothing did: a bill that cleared
 * the House became law where it stood, the economy moved, the problem it was
 * about eased, and the other five hundred and thirty-four people in the
 * building might as well not have existed. A member could pass a party-line
 * statute through a chamber whose Senate was held by the other side and the
 * country would simply do as it was told.
 *
 * Everything below is the pipeline that replaced it: sent, killed, stalled,
 * gutted, signed, vetoed, overridden — and the one rule underneath all of them,
 * which is that only law changes the country.
 */

const scenario = (o = {}) => ({
  office: "house",
  presidentName: "Dale Fairweather",
  party: "Democrat",
  startYear: 2025,
  ideologyAxis: -0.35,
  ideology: "Social Democrat",
  district: "OH-6",
  ...o,
});

const house = (o = {}) => ({ ...createHouseCareer(scenario()), ...o });
const senate = (o = {}) => ({
  ...createSenateCareer(scenario({ office: "senate", seatState: "OH" })), ...o,
});

const BILL = { id: "b1", title: "An Act", axis: -0.3, domain: "economy", support: "partyline" };

/** A career whose ledger holds exactly one bill, in whatever state a test wants. */
const waiting = (state, over = {}, bill = BILL) => {
  const next = structuredClone(state);
  sendOnward(next, bill, { yours: false });
  Object.assign(next.inFlight[0], over);
  return next;
};

/** A President who will sign anything on the left, and refuse anything else. */
const potus = (state, party = "Democrat", axis = -0.35) => ({
  ...state, president: { name: "Fairweather", party, axis, approval: 50 },
});

// ---------------------------------------------------------------------------
// Leaving the room
// ---------------------------------------------------------------------------

test("a bill that carries is sent onward rather than made law", () => {
  const s = house({ month: 2 });
  const before = { ...s.society };
  const out = castVote(s, BILL, "yes");

  assert.deepEqual(out.state.society, before, "nothing has happened to the country");
  assert.deepEqual(out.result.moved, {});
  if (out.result.passed) {
    assert.equal(out.state.inFlight.length, 1);
    assert.equal(out.state.inFlight[0].stage, "far");
    assert.equal(out.result.onward.to, "the Senate");
  }
});

test("each chamber sends to the other one", () => {
  assert.equal(farChamberName(house()), "the Senate");
  assert.equal(farChamberName(senate()), "the House");
});

test("the record freezes the bill as it left, not as it was written", () => {
  const s = house();
  const next = structuredClone(s);
  const bill = { ...BILL, axis: -0.3 };
  sendOnward(next, bill, { yours: true });
  bill.axis = 0.9;                                  // amended afterwards, elsewhere
  assert.equal(next.inFlight[0].bill.axis, -0.3, "the far chamber votes on what it was sent");
});

// ---------------------------------------------------------------------------
// The far chamber
// ---------------------------------------------------------------------------

test("a bill the far chamber will not take is killed, and says so", () => {
  // Hard right, in a career whose Senate is nothing of the kind.
  const s = waiting(house({ month: 2 }), {}, { ...BILL, axis: 0.95 });
  const events = advancePassage(s);

  assert.equal(s.inFlight.length, 0, "it is finished");
  assert.equal(events.length, 1);
  assert.equal(events[0].k, "blocked");
  assert.deepEqual(domainsActedOn(s), new Set(), "and the country never hears of it");
});

test("sixty is the bar over there, which is why the House passes so much that dies", () => {
  /**
   * The single number that gives the far chamber its character for a House
   * member. A bill with majority support in the Senate and nothing like sixty
   * is not defeated — it is simply never taken up, which is the fate of most
   * legislation and looked like nothing at all before this existed.
   */
  const s = waiting(house({ month: 2 }), {}, { ...BILL, axis: -0.42 });
  advancePassage(s);
  const record = s.inFlight[0];
  if (record) {
    assert.equal(record.stage, "far", "still over there");
    assert.match(record.note, /short|has not taken it up/);
  }
});

test("a bill nobody filibusters only needs a majority", () => {
  // The same bill, twice, differing in one word. Fifty-six senators is four
  // short of cloture and five clear of a majority, so the support tier the
  // docket already carries is the whole difference between a law and a bill
  // that is never taken up.
  const axis = 0.2;
  const contested = waiting(house({ month: 2 }), {}, { ...BILL, axis, support: "partyline" });
  const agreed = waiting(house({ month: 2 }), {}, { ...BILL, axis, support: "bipartisan" });
  advancePassage(contested);
  advancePassage(agreed);

  assert.equal(agreed.inFlight[0].stage, "desk", "a disaster bill is not held up at cloture");
  assert.equal(contested.inFlight[0].stage, "far", "and an ordinary one waits at sixty");
});

test("a bill that waits long enough is offered as something smaller", () => {
  const s = waiting(house({ month: 2 }), { waited: 2 }, { ...BILL, axis: -0.42 });
  const events = advancePassage(s);
  const record = s.inFlight[0];

  if (events.some((e) => e.k === "gutted")) {
    assert.equal(record.stage, "desk");
    assert.equal(record.gutted, true);
    assert.equal(record.strength, 0.5, "half the bill is half the effect");
    assert.ok(Math.abs(record.bill.axis) < 0.42, "dragged toward the other chamber");
  }
});

test("the far chamber gives up eventually rather than holding a bill forever", () => {
  const s = waiting(house({ month: 2 }), { waited: 4 }, { ...BILL, axis: -0.42 });
  advancePassage(s);
  assert.equal(s.inFlight.length, 0, "four months of nothing is an answer");
});

test("a Congress ending takes everything unfinished with it", () => {
  const s = waiting(house({ month: 2, term: 2 }), { sentTerm: 1 });
  const events = advancePassage(s);

  assert.equal(s.inFlight.length, 0);
  assert.equal(events[0].k, "blocked");
});

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

test("a president signs what is near their own politics", () => {
  const s = potus(waiting(house({ month: 2 }), { stage: "desk" }, { ...BILL, axis: -0.5 }));
  const events = advancePassage(s);

  assert.equal(events[0].k, "enacted");
  assert.equal(s.inFlight.length, 0);
  assert.equal(s.enacted.length, 1);
  assert.equal(s.enacted[0].title, "An Act");
});

test("and vetoes what is not", () => {
  const s = potus(waiting(house({ month: 2 }), { stage: "desk" }, { ...BILL, axis: 0.7 }));
  const events = advancePassage(s);

  assert.equal(events[0].k, "vetoed");
  assert.equal(s.inFlight[0].stage, "override", "it comes back to the floor it came from");
  assert.equal((s.enacted || []).length, 0);
});

test("nobody spends a veto on an argument they have already lost", () => {
  // Two thirds in the far chamber, and the pen is worth nothing.
  const s = potus(waiting(house({ month: 2 }), {
    stage: "desk", lastTally: { overrode: true },
  }, { ...BILL, axis: 0.7 }));
  const events = advancePassage(s);

  assert.equal(events[0].k, "enacted");
});

test("only law moves the country", () => {
  const s = potus(waiting(house({ month: 2 }), { stage: "desk" },
    { id: "universal_care", title: "Universal Coverage Act", axis: -0.55, domain: "health" }));
  const before = s.society.uninsured;
  advancePassage(s);

  assert.notEqual(s.society.uninsured, before);
  assert.deepEqual(domainsActedOn(s), new Set(["health"]),
    "and the problem it was about eases in the month it was signed");
});

test("a bill cut in half does half as much", () => {
  const full = potus(waiting(house({ month: 2 }), { stage: "desk" },
    { id: "universal_care", title: "Universal Coverage Act", axis: -0.55, domain: "health" }));
  const cut = potus(waiting(house({ month: 2 }), { stage: "desk", gutted: true, strength: 0.5 },
    { id: "universal_care", title: "Universal Coverage Act", axis: -0.55, domain: "health" }));

  const before = full.society.uninsured;
  advancePassage(full);
  advancePassage(cut);

  const whole = Math.abs(full.society.uninsured - before);
  const half = Math.abs(cut.society.uninsured - before);
  assert.ok(half < whole, `${half} should be less than ${whole}`);
  assert.equal(cut.enacted[0].gutted, true, "and the record says which it was");
});

// ---------------------------------------------------------------------------
// The override
// ---------------------------------------------------------------------------

test("a vetoed bill goes back on your own calendar", () => {
  const s = waiting(house({ month: 2 }), { stage: "override" });
  const [bill] = overrideBills(s);

  assert.ok(bill, "it is scheduled");
  assert.equal(bill.override, true);
  assert.equal(bill.overrideKey, s.inFlight[0].key);
});

/**
 * Found by playing two years of a career rather than by reading the code.
 *
 * The already-voted guard is by bill id within a Congress, and an override
 * carries the id of the bill it is trying to rescue, because it *is* that bill.
 * So the one vote this whole pipeline exists to produce was refused every time
 * it reached the floor: offered three times, votable never, and gone two months
 * later with nothing on screen ever saying why.
 */
test("you may vote on the same bill twice when the second one is the override", () => {
  const s = house({ month: 2 });
  const bill = { ...BILL, axis: -0.3 };
  const first = castVote(s, bill, "yes");
  assert.equal(first.rejected, undefined);
  assert.equal(castVote(first.state, bill, "yes").rejected, true, "an ordinary re-vote is still refused");

  const returned = waiting(first.state, { stage: "override" }, bill);
  const [override] = overrideBills(returned);
  const out = castVote(returned, override, "yes");
  assert.equal(out.rejected, undefined, "the override is a different vote and must be takeable");
  assert.equal(out.state.voteLog.at(-1).override, true, "and reads back as one");
});

test("an override needs two thirds, not a majority", () => {
  const s = waiting(house({ month: 2 }), { stage: "override" }, { ...BILL, axis: -0.3 });
  const [bill] = overrideBills(s);
  const out = castVote(s, bill, "yes");

  assert.equal(out.result.tally.bar, out.result.tally.overrideThreshold);
  assert.ok(out.result.tally.bar > out.result.tally.threshold,
    "the whole point of a veto is that a majority is not enough");
});

test("carrying the override is the one vote that makes law in the room", () => {
  const s = waiting(house({ month: 2 }), { stage: "override" },
    { id: "universal_care", title: "Universal Coverage Act", axis: -0.55, domain: "health" });
  const before = s.society.uninsured;
  const out = resolveOverride(s, { overrideKey: s.inFlight[0].key }, true);

  assert.equal(out.enacted, true);
  assert.notEqual(s.society.uninsured, before);
  assert.equal(s.inFlight.length, 0);
  assert.match(out.note, /over the President's veto/);
});

test("and losing it ends the bill for good", () => {
  const s = waiting(house({ month: 2 }), { stage: "override" });
  const before = { ...s.society };
  const out = resolveOverride(s, { overrideKey: s.inFlight[0].key }, false);

  assert.equal(out.enacted, false);
  assert.equal(s.inFlight.length, 0);
  assert.deepEqual(s.society, before);
  assert.match(out.note, /veto stands/);
});

test("an override nobody takes up dies in the window", () => {
  const s = waiting(house({ month: 2 }), { stage: "override", waited: 2 });
  const events = advancePassage(s);

  assert.equal(s.inFlight.length, 0);
  assert.equal(events[0].k, "blocked");
});

// ---------------------------------------------------------------------------
// Working your own bill
// ---------------------------------------------------------------------------

test("you can work your own bill across the building", () => {
  const s = waiting(house({ month: 2, capital: 40 }), { yours: true });
  const out = pushFarChamber(s, s.inFlight[0].key, 12);

  assert.equal(out.rejected, undefined, out.note);
  assert.equal(out.result.bought, 4, "at three favours a vote");
  assert.equal(out.state.capital, 28);
  assert.equal(out.state.inFlight[0].bought, 4);
  assert.equal(s.inFlight[0].bought, 0, "and the original state is untouched");
});

test("but not somebody else's", () => {
  const s = waiting(house({ month: 2, capital: 40 }), { yours: false });
  const out = pushFarChamber(s, s.inFlight[0].key, 12);

  assert.equal(out.rejected, true);
  assert.match(out.note, /no standing/);
});

test("nor a bill that has already left the far chamber", () => {
  const s = waiting(house({ month: 2, capital: 40 }), { yours: true, stage: "desk" });
  const out = pushFarChamber(s, s.inFlight[0].key, 12);
  assert.equal(out.rejected, true);
});

test("favours you do not have, and favours too few to matter", () => {
  const s = waiting(house({ month: 2, capital: 4 }), { yours: true });
  assert.equal(pushFarChamber(s, s.inFlight[0].key, 40).rejected, true);
  const cheap = pushFarChamber(s, s.inFlight[0].key, FAR_PRICE - 1);
  assert.equal(cheap.rejected, true);
  assert.match(cheap.note, /starts at/);
});

test("the votes bought are counted by the far chamber", () => {
  const bill = { ...BILL, axis: -0.42 };
  const alone = waiting(house({ month: 2 }), { yours: true }, bill);
  const worked = waiting(house({ month: 2 }), { yours: true, bought: 40 }, bill);
  advancePassage(alone);
  advancePassage(worked);

  const stage = (s) => s.inFlight[0]?.stage ?? "gone";
  assert.notEqual(stage(worked), "gone", "forty votes should not lose a bill");
  assert.ok(stage(worked) === "desk" || stage(alone) !== "desk",
    `working it must never do worse: alone ${stage(alone)}, worked ${stage(worked)}`);
});

// ---------------------------------------------------------------------------
// What the screen is told
// ---------------------------------------------------------------------------

test("the ledger says where each bill is and who may touch it", () => {
  const s = waiting(house({ month: 2 }), { yours: true, waited: 2 });
  const [row] = inFlight(s);

  assert.equal(row.title, "An Act");
  assert.equal(row.where, "the Senate");
  assert.equal(row.yours, true);
  assert.equal(row.waited, 2);
});

test("an old save with no ledger is not a crash", () => {
  const s = house({ month: 2 });
  delete s.inFlight;
  assert.deepEqual(inFlight(s), []);
  assert.deepEqual(advancePassage(s), []);
  assert.deepEqual(overrideBills(s), []);
});

// ---------------------------------------------------------------------------
// A career, end to end
// ---------------------------------------------------------------------------

/**
 * The property that matters more than any single verdict: a bill can only ever
 * change the country once, and only after every gate. Run a career and count.
 */
test("nothing is enacted twice, and nothing is enacted early", () => {
  let s = house({ month: 1 });
  const bills = [
    { id: "universal_care", title: "Coverage", axis: -0.55, domain: "health" },
    { id: "tax_cuts", title: "Growth", axis: 0.45, domain: "economy" },
    { id: "infrastructure", title: "Bridges", axis: -0.05, domain: "economy" },
  ];

  for (const bill of bills) {
    const out = castVote(s, { ...bill }, "yes");
    s = out.state;
    assert.deepEqual(out.result.moved, {}, "no roll call enacts anything");
    s = advanceHouseMonth(s).state ?? advanceHouseMonth(s);
  }
  for (let i = 0; i < 8; i += 1) s = advanceHouseMonth(s).state ?? advanceHouseMonth(s);

  const enacted = s.enacted || [];
  const keys = enacted.map((e) => `${e.id}|${e.month}|${e.term}`);
  assert.equal(new Set(keys).size, keys.length, "no bill became law twice");
  assert.ok(enacted.length <= bills.length, "and nothing became law that was never sent");
  assert.equal((s.inFlight || []).every((r) => r.stage !== "far" || r.waited <= 4), true,
    "nothing sits over there for ever");
});
