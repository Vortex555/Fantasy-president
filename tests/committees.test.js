import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMITTEES,
  RANKS,
  committeeById,
  assignCommittee,
  rankOf,
  rankIndex,
  evaluateLadder,
  inYourDomain,
  chairAction,
  whipCount,
  spendCapital,
  earnCapital,
  CAPITAL_PER_VOTE,
} from "../src/committees.js";
import { createHouseCareer, castVote } from "../src/house.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scenario = (o = {}) => ({
  office: "house", presidentName: "Dale Fairweather", party: "Democrat",
  startYear: 2025, ideologyAxis: -0.35, ideology: "Social Democrat", district: "OH-6", ...o,
});

const game = ({ scenario: sc, ...rest } = {}) => ({ ...createHouseCareer(scenario(sc)), ...rest });

/** A member with the standing and the years to be somebody. */
const senior = (o = {}) => game({
  leadership: 88, capital: 40,
  seat: { ...game().seat, seniority: 6 },
  congress: { houseD: 240, houseR: 195, senateD: 52, senateR: 48 },  // their party runs it
  ...o,
});

const bill = (axis, domain = "economy") => ({ id: `b-${domain}-${axis}`, title: "A Bill", axis, domain });

// ---------------------------------------------------------------------------
// Committees
// ---------------------------------------------------------------------------

test("the committees are real ones, and every bill domain has a home", () => {
  assert.ok(COMMITTEES.length >= 6);
  const covered = new Set(COMMITTEES.flatMap((c) => c.domains));
  for (const domain of ["economy", "health", "justice", "social", "security"]) {
    assert.ok(covered.has(domain), `no committee handles ${domain}`);
  }
  for (const c of COMMITTEES) {
    assert.ok(c.id && c.name && c.prestige >= 1 && c.prestige <= 5);
  }
});

test("a freshman is assigned somewhere, and it is not Ways and Means", () => {
  const s = game();
  const c = assignCommittee(s);
  assert.ok(committeeById(c));
  assert.ok(committeeById(c).prestige <= 3, "the good committees are not handed to freshmen");
});

test("clout gets you a better committee", () => {
  const junior = assignCommittee(game({ leadership: 30 }));
  const heavy = assignCommittee(senior());
  assert.ok(committeeById(heavy).prestige >= committeeById(junior).prestige);
});

test("assignment is stable — you do not wake up on a different committee", () => {
  const s = game();
  assert.equal(assignCommittee(s), assignCommittee(s));
});

test("a bill is in your domain or it is not", () => {
  const s = { ...game(), committee: "judiciary" };
  assert.equal(inYourDomain(s, bill(-0.4, "justice")), true);
  assert.equal(inYourDomain(s, bill(-0.4, "economy")), false);
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test("the ladder runs from backbencher to Speaker", () => {
  assert.equal(RANKS[0].id, "member");
  assert.equal(RANKS[RANKS.length - 1].id, "speaker");
  for (const r of RANKS) assert.ok(r.title && r.power);
});

test("a freshman is a backbencher and nothing else", () => {
  assert.equal(rankOf(game()), "member");
});

test("you climb on seniority and standing together, not either alone", () => {
  const timeServer = game({ seat: { ...game().seat, seniority: 8 }, leadership: 25 });
  const striver = game({ seat: { ...game().seat, seniority: 1 }, leadership: 95 });
  assert.equal(rankOf(timeServer), "member", "years alone do not promote you");
  assert.equal(rankOf(striver), "member", "nor does being liked in your first term");
});

test("a senior loyalist in the majority runs something", () => {
  assert.ok(rankIndex(rankOf(senior())) >= rankIndex("chair"));
});

test("the top of the ladder needs your party to hold the House", () => {
  const majority = senior();
  const minority = senior({ congress: { houseD: 195, houseR: 240, senateD: 48, senateR: 52 } });
  assert.ok(rankIndex(rankOf(majority)) > rankIndex(rankOf(minority)),
    "you cannot chair a committee your party does not control");
});

test("promotion happens between terms, and is reported", () => {
  const before = { ...senior(), rank: "member" };
  const out = evaluateLadder(before);
  assert.notEqual(out.state.rank, "member");
  assert.ok(out.change.promoted);
  assert.ok(out.change.note.length > 10);
});

test("losing the majority costs you the gavel", () => {
  const chair = { ...senior(), rank: "chair" };
  const lost = { ...chair, congress: { houseD: 190, houseR: 245, senateD: 48, senateR: 52 } };
  const out = evaluateLadder(lost);
  assert.ok(rankIndex(out.state.rank) < rankIndex("chair"));
  assert.equal(out.change.promoted, false);
});

// ---------------------------------------------------------------------------
// What a gavel is actually for
// ---------------------------------------------------------------------------

test("a backbencher cannot touch a bill before the floor", () => {
  const s = { ...game(), committee: "judiciary", rank: "member" };
  assert.equal(chairAction(s, bill(-0.4, "justice"), "bury").rejected, true);
});

test("a chair can bury a bill in their own domain", () => {
  const s = { ...senior(), committee: "judiciary", rank: "chair" };
  const out = chairAction(s, bill(0.6, "justice"), "bury");
  assert.equal(out.rejected, undefined);
  assert.equal(out.result.buried, true);
  assert.ok(out.state.committeeLog.length === 1);
});

test("a chair cannot touch somebody else's committee", () => {
  const s = { ...senior(), committee: "judiciary", rank: "chair" };
  assert.equal(chairAction(s, bill(0.6, "economy"), "bury").rejected, true);
});

test("burying a bill your caucus wanted costs you with them", () => {
  const s = { ...senior(), committee: "judiciary", rank: "chair" };
  const out = chairAction(s, bill(-0.4, "justice"), "bury");   // a bill the party likes
  assert.ok(out.state.leadership < s.leadership);
});

test("amending a bill moves it toward you before anybody votes", () => {
  const s = { ...senior(), committee: "judiciary", rank: "chair" };
  const out = chairAction(s, bill(0.6, "justice"), "amend");
  assert.ok(Math.abs(out.result.bill.axis) < 0.6, "the bill moved toward the chair");
  assert.notEqual(out.result.bill.axis, 0.6);
});

// ---------------------------------------------------------------------------
// The whip count
// ---------------------------------------------------------------------------

test("only the whip and the Speaker see the count before the vote", () => {
  const backbencher = { ...game(), rank: "member" };
  const whip = { ...senior(), rank: "whip" };
  assert.equal(whipCount(backbencher, bill(-0.4)).visible, false);
  assert.equal(whipCount(whip, bill(-0.4)).visible, true);
});

test("the count says how it stands and how far off it is", () => {
  const w = whipCount({ ...senior(), rank: "whip" }, bill(-0.4));
  assert.ok(Number.isFinite(w.yes) && Number.isFinite(w.no));
  assert.equal(w.yes + w.no, w.total);
  assert.ok(Number.isFinite(w.shortBy));
});

test("capital buys votes, and you cannot spend what you have not got", () => {
  const w = { ...senior(), rank: "whip", capital: 30 };
  const out = spendCapital(w, bill(-0.4), 20);
  assert.ok(out.state.capital < 30);
  assert.ok(out.result.moved > 0);

  const broke = spendCapital({ ...w, capital: 2 }, bill(-0.4), 20);
  assert.equal(broke.rejected, true);
});

test("a backbencher has no favours to call in", () => {
  assert.equal(spendCapital({ ...game(), rank: "member", capital: 40 }, bill(-0.4), 10).rejected, true);
});

test("voting with your caucus earns the capital you later spend", () => {
  const s = { ...game(), capital: 0 };
  const loyal = castVote(s, bill(-0.5), "yes");
  assert.ok(earnCapital(s, loyal.result) > 0, "a party-line vote banks a favour");
  const rebel = castVote(s, bill(-0.5), "no");
  assert.ok(earnCapital(s, rebel.result) <= 0);
  assert.ok(CAPITAL_PER_VOTE > 0);
});

// ---------------------------------------------------------------------------
// The Speaker
// ---------------------------------------------------------------------------

test("the Speaker decides what the floor even votes on", () => {
  const speaker = { ...senior(), rank: "speaker", leadership: 96, seat: { ...senior().seat, seniority: 9 } };
  assert.equal(rankOf(speaker), "speaker");
  const power = RANKS.find((r) => r.id === "speaker").power;
  assert.ok(/floor|schedule/i.test(power));
});
