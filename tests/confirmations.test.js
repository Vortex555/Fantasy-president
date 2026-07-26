import test from "node:test";
import assert from "node:assert/strict";

import {
  POSTS,
  CONFIRM_THRESHOLD,
  emptyNomination,
  tickNomination,
  nominationPending,
  nominationStance,
  confirmationTally,
  resolveConfirmation,
  confirmVote,
  postAvailable,
} from "../src/confirmations.js";
import { createSenateCareer, advanceSenateMonth, SENATE_TERM } from "../src/senate.js";
import { createHouseCareer } from "../src/house.js";
import { historicalHouseVerdict } from "../src/houseVerdict.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scenario = (o = {}) => ({
  office: "senate", presidentName: "Clay Mercer", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, ideology: "Social Democrat", seatState: "OH", ...o,
});

const game = ({ scenario: sc, ...rest } = {}) => ({ ...createSenateCareer(scenario(sc)), ...rest });

/** A senator whose President shares their party, and one whose does not. */
const ally = (o = {}) => {
  const s = game(o);
  return { ...s, president: { ...s.president, party: "Democrat", axis: -0.4, approval: 50 } };
};
const opponent = (o = {}) => {
  const s = game(o);
  return { ...s, president: { ...s.president, party: "Republican", axis: 0.45, approval: 50 } };
};

const nominee = (o = {}) => ({
  name: "Beatriz Halloran", party: "Democrat", axis: -0.4,
  competence: 78, independence: 50, unqualified: false, ...o,
});

const withNomination = (state, post = POSTS[0], nom = nominee()) => ({
  ...state,
  nomination: { post, nominee: nom, month: state.month, term: state.term || 1 },
});

// ---------------------------------------------------------------------------
// The offices
// ---------------------------------------------------------------------------

test("the posts are real ones, and the lifetime ones are marked as such", () => {
  assert.ok(POSTS.length >= 6);
  for (const p of POSTS) {
    assert.ok(p.id && p.title && p.remit, `${p.id} is incomplete`);
    assert.equal(typeof p.lifetime, "boolean");
    assert.ok(p.weight > 0, "every office carries some political weight");
  }
  assert.ok(POSTS.some((p) => p.lifetime), "some of these are for life");
  assert.ok(POSTS.some((p) => !p.lifetime));
});

test("advice and consent belongs to the Senate alone", () => {
  const member = createHouseCareer({
    presidentName: "Clay Mercer", party: "Democrat", startYear: 2025,
    ideologyAxis: -0.35, district: "OH-6",
  });
  const out = tickNomination({ ...member, month: 7 });
  assert.equal(nominationPending(out.state), false);
  assert.equal(out.event, null);
});

// ---------------------------------------------------------------------------
// Vacancies
// ---------------------------------------------------------------------------

test("a career sees vacancies, and never two at once", () => {
  let s = { ...game(), nomination: emptyNomination() };
  let seen = 0;
  for (let m = 1; m <= SENATE_TERM; m++) {
    s = { ...s, month: m };
    const out = tickNomination(s);
    s = out.state;
    if (out.event) {
      seen += 1;
      assert.ok(nominationPending(s), "the event and the pending nomination agree");
      // Resolve it, so the next month can bring another.
      s = { ...s, nomination: null };
    }
  }
  assert.ok(seen >= 2, `a six-year term should bring a few vacancies, saw ${seen}`);
  assert.ok(seen <= 14, `it should not be a monthly occurrence, saw ${seen}`);
});

test("a pending nomination is not replaced by a fresher one", () => {
  const held = withNomination({ ...game(), month: 5 });
  const out = tickNomination(held);
  assert.deepEqual(out.state.nomination, held.nomination);
  assert.equal(out.event, null);
});

test("a nomination names the office, the nominee, and what they would run", () => {
  let s = { ...game(), nomination: emptyNomination() };
  let found = null;
  for (let m = 1; m <= 96 && !found; m++) {
    const out = tickNomination({ ...s, month: m });
    if (out.event) found = out.state.nomination;
  }
  assert.ok(found, "a vacancy turns up eventually");
  assert.ok(found.post.title.length > 3);
  assert.ok(found.nominee.name.includes(" "));
  assert.ok(found.nominee.competence >= 0 && found.nominee.competence <= 100);
  assert.ok(Math.abs(found.nominee.axis) <= 1);
});

test("vacancies are seeded — the same career gets the same bench", () => {
  const s = { ...game(), month: 9, nomination: emptyNomination() };
  assert.deepEqual(tickNomination(s).state.nomination, tickNomination(s).state.nomination);
});

// ---------------------------------------------------------------------------
// The bind
// ---------------------------------------------------------------------------

test("your caucus is for the nominee only when the President is yours", () => {
  const forIt = nominationStance(withNomination(ally()));
  const againstIt = nominationStance(withNomination(opponent(), POSTS[0], nominee({ party: "Republican", axis: 0.45 })));
  assert.equal(forIt.party.position, "yes");
  assert.equal(againstIt.party.position, "no");
  assert.ok(forIt.party.reason.length > 10);
  assert.ok(againstIt.party.reason.length > 10);
});

test("a nominee your state cannot stand is a different vote from one it likes", () => {
  const home = ally({ scenario: { seatState: "WV" } });      // a state well to the right
  const hostileToState = nominationStance(withNomination(home, POSTS[0], nominee({ axis: -0.9 })));
  const easyForState = nominationStance(withNomination(home, POSTS[0], nominee({ axis: 0.35 })));
  assert.equal(hostileToState.district.position, "no");
  assert.equal(easyForState.district.position, "yes");
});

test("competence is the third axis, and it can move your own side", () => {
  const good = nominationStance(withNomination(ally(), POSTS[0], nominee({ competence: 92 })));
  const hack = nominationStance(withNomination(ally(), POSTS[0],
    nominee({ competence: 24, unqualified: true })));
  assert.ok(hack.party.intensity < good.party.intensity,
    "a caucus whips less hard for somebody indefensible");
  assert.ok(hack.qualification.note.length > 10);
  assert.equal(hack.qualification.unqualified, true);
});

// ---------------------------------------------------------------------------
// The roll call
// ---------------------------------------------------------------------------

test("a majority confirms, and the Vice President breaks a tie", () => {
  assert.equal(CONFIRM_THRESHOLD, 51);
  const tied = resolveConfirmation(50);
  assert.equal(tied.confirmed, true);
  assert.equal(tied.brokenByVp, true);
  assert.equal(resolveConfirmation(49).confirmed, false);
  assert.equal(resolveConfirmation(51).confirmed, true);
  assert.equal(resolveConfirmation(51).brokenByVp, false);
  assert.equal(resolveConfirmation(50).no, 50);
});

test("a hundred senators vote, and you are one of them", () => {
  const t = confirmationTally(withNomination(ally()), "yes");
  assert.equal(t.yes + t.no, 100);
  assert.ok(t.yes >= 0 && t.yes <= 100);
});

test("a consensus nominee is confirmed by more than one party", () => {
  const s = withNomination(ally(), POSTS[0], nominee({ competence: 96, axis: -0.05 }));
  const t = confirmationTally(s, "yes");
  assert.ok(t.crossed > 0, "somebody from the other side voted for them");
  assert.equal(t.confirmed, true);
});

test("a nominee nobody can defend loses the President's own party", () => {
  const solid = confirmationTally(withNomination(ally(), POSTS[0],
    nominee({ competence: 88, axis: -0.35 })), "yes");
  const indefensible = confirmationTally(withNomination(ally(), POSTS[0],
    nominee({ competence: 18, unqualified: true, axis: -0.85 })), "yes");
  assert.ok(indefensible.defected > solid.defected,
    "the President's own senators walk away from an indefensible nominee");
  assert.ok(indefensible.yes < solid.yes);
});

// ---------------------------------------------------------------------------
// Casting it
// ---------------------------------------------------------------------------

test("you cannot vote on a nomination that is not before the chamber", () => {
  assert.equal(confirmVote({ ...game(), nomination: null }, "yes").rejected, true);
  assert.equal(confirmVote(withNomination(ally()), "maybe").rejected, true);
});

test("a confirmation your state hated becomes a grudge, not a permanent wound", () => {
  const s = withNomination(ally({ scenario: { seatState: "WV" } }), POSTS[0], nominee({ axis: -0.95 }));
  const out = confirmVote(s, "yes");
  assert.equal(out.rejected, undefined);
  assert.ok(out.result.district.delta < 0);
  assert.equal(out.state.grudges.length, 1);
  assert.match(out.state.grudges[0].title, /Justice|Chair|Director|Secretary|Judge/);
});

test("breaking with your caucus on a nomination costs you with them", () => {
  const s = withNomination(ally());
  const loyal = confirmVote(s, "yes");
  const rebel = confirmVote(s, "no");
  assert.ok(loyal.state.leadership > s.leadership);
  assert.ok(rebel.state.leadership < s.leadership);
});

test("abstaining on a confirmation is read as an answer", () => {
  const out = confirmVote(withNomination(ally()), "abstain");
  assert.ok(out.state.leadership < ally().leadership);
  assert.match(out.result.note, /did not vote|abstain/i);
});

test("a lifetime appointment says how long you have just decided", () => {
  const lifetime = POSTS.find((p) => p.lifetime);
  const out = confirmVote(withNomination(ally(), lifetime), "yes");
  if (out.result.confirmed) {
    assert.match(out.result.note, /life|decades|years/i);
  }
});

test("the vote goes into the record the chamber remembers", () => {
  const out = confirmVote(withNomination(ally()), "yes");
  assert.equal(out.state.nomination, null, "the seat is filled and the floor moves on");
  assert.equal(out.state.confirmations.length, 1);
  assert.equal(out.state.confirmations[0].vote, "yes");
  const logged = out.state.voteLog.at(-1);
  assert.equal(logged.confirmation, true);
  assert.ok(logged.title.length > 5);
  assert.equal(typeof logged.withParty, "boolean");
});

test("the floor moves on — a decided nomination cannot be voted on again", () => {
  const out = confirmVote(withNomination(ally()), "yes");
  assert.equal(confirmVote(out.state, "no").rejected, true);
});

test("a seat that has been filled does not fall vacant again", () => {
  const fed = POSTS.find((p) => p.id === "fed");
  const done = confirmVote(withNomination(ally(), fed), "yes").state;
  if (!done.confirmations[0].confirmed) return;   // rejected seats do come back
  for (let m = 1; m <= 120; m++) {
    const out = tickNomination({ ...done, month: m, nomination: null });
    assert.notEqual(out.state.nomination?.post?.id, "fed",
      "the Fed chair was confirmed once and cannot be confirmed again");
  }
});

test("a rejected seat comes back, but not the following month", () => {
  const fed = POSTS.find((p) => p.id === "fed");
  // Reject one, then look at what the President is allowed to send up next.
  const rejected = {
    ...ally(), month: 10, nomination: null,
    confirmations: [{ postId: "fed", confirmed: false, vote: "no", month: 10, term: 1 }],
  };
  for (let m = 11; m < 19; m++) {
    const out = tickNomination({ ...rejected, month: m, nomination: null });
    assert.notEqual(out.state.nomination?.post?.id, "fed",
      `the President re-nominated for the same seat after ${m - 10} months`);
  }
  // But the seat is still empty, so it is eligible again once they have looked.
  assert.equal(postAvailable({ ...rejected, month: 18 }, fed), false);
  assert.equal(postAvailable({ ...rejected, month: 19 }, fed), true);
  // And a confirmed seat is gone for good, however long you wait.
  const filled = { ...rejected, confirmations: [{ postId: "fed", confirmed: true, vote: "yes", month: 10, term: 1 }] };
  assert.equal(postAvailable({ ...filled, month: 70, term: 4 }, fed), false);
});

test("a party-line nominee is confirmed by whoever runs the chamber", () => {
  const s = ally({ congress: { houseD: 230, houseR: 205, senateD: 55, senateR: 45 } });
  const theirs = ally({ congress: { houseD: 205, houseR: 230, senateD: 45, senateR: 55 } });
  const nom = nominee({ axis: -0.45, competence: 80 });
  assert.equal(confirmationTally(withNomination(s, POSTS[0], nom), "yes").confirmed, true);
  assert.equal(confirmationTally(withNomination(theirs, POSTS[0], nom), "yes").confirmed, false);
});

test("an indefensible nominee loses about a dozen friends, not fifty", () => {
  const s = withNomination(ally({ congress: { houseD: 230, houseR: 205, senateD: 55, senateR: 45 } }),
    POSTS[0], nominee({ axis: -0.85, competence: 18, unqualified: true }));
  const t = confirmationTally(s, "yes");
  assert.ok(t.defected >= 4 && t.defected <= 20,
    `a party that abandoned its President this completely would not have nominated them: ${t.defected}`);
  assert.equal(t.confirmed, false, "and it is enough to sink them");
});

test("a confirmation vote is deterministic", () => {
  const s = withNomination(ally());
  assert.deepEqual(confirmVote(s, "yes").result, confirmVote(s, "yes").result);
});

// ---------------------------------------------------------------------------
// What it is worth at the end
// ---------------------------------------------------------------------------

test("the people you put on the bench are part of the record", () => {
  const justice = POSTS.find((p) => p.lifetime);
  let s = withNomination(ally(), justice);
  s = confirmVote(s, "yes").state;
  const verdict = historicalHouseVerdict({ ...s, over: true });
  const text = verdict.findings.map((f) => f.text).join(" ");
  assert.match(text, /confirm|bench|nomination/i);
});

test("advice and consent never shows up in a House verdict", () => {
  const member = createHouseCareer({
    presidentName: "Clay Mercer", party: "Democrat", startYear: 2025,
    ideologyAxis: -0.35, district: "OH-6",
  });
  const verdict = historicalHouseVerdict({ ...member, over: true });
  const text = verdict.findings.map((f) => f.text).join(" ");
  assert.ok(!/confirm/i.test(text), text);
});

// ---------------------------------------------------------------------------
// In the month
// ---------------------------------------------------------------------------

test("nominations arrive through the ordinary passage of a senate month", () => {
  let s = game();
  let sawOne = false;
  for (let m = 0; m < SENATE_TERM - 1 && !sawOne; m++) {
    const out = advanceSenateMonth(s);
    s = out.state;
    if (out.nomination || nominationPending(s)) sawOne = true;
  }
  assert.ok(sawOne, "a six-year term brings somebody to confirm");
});
