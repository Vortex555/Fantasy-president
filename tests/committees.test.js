import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMITTEES,
  SENATE_COMMITTEES,
  RANKS,
  committeeById,
  committeesFor,
  ranksFor,
  rankById,
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
import { createHouseCareer, castVote, sponsorBill, sponsorCooldown } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";

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

/**
 * A backbencher can call in favours now, and could not before.
 *
 * The old rule was that only a Whip or a Speaker could spend them at all, which
 * meant every other member banked a currency on every party-line vote and was
 * told "nobody owes you anything yet" if they ever tried to use it. Rank decides
 * how far your debts reach, not whether you have any.
 */
test("a backbencher can lean on the colleagues who owe them personally", () => {
  const out = spendCapital({ ...game(), rank: "member", capital: 40 }, bill(-0.4), 30);
  assert.equal(out.rejected, undefined);
  assert.ok(out.result.moved >= 1, "a couple of votes, which is what a backbencher has");
  assert.ok(out.result.moved <= 3, "and no more than that");
});

test("a whip's debts reach very much further than a backbencher's", () => {
  const asMember = spendCapital({ ...game(), rank: "member", capital: 200 }, bill(-0.4), 200);
  const asWhip = spendCapital({ ...game(), rank: "whip", capital: 200 }, bill(-0.4), 200);
  assert.ok(asWhip.result.moved > asMember.result.moved * 3,
    `whip ${asWhip.result.moved} vs member ${asMember.result.moved}`);
});

test("a spend too small to move anybody is refused, with the price", () => {
  const out = spendCapital({ ...game(), rank: "member", capital: 40 }, bill(-0.4), 1);
  assert.equal(out.rejected, true);
  assert.match(out.note, /would need about \d+/);
  assert.equal(out.state.capital, 40, "and it costs nothing to be told so");
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

// ---------------------------------------------------------------------------
// The other chamber
//
// All of this machinery is shared with the Senate, and every piece of it used
// to answer House questions on a senator's behalf — which produced a Speaker of
// the House who had never been elected to it, a gavel that depended on the
// wrong chamber, and a whip count of 435 in a room of 100.
// ---------------------------------------------------------------------------

const senScenario = (o = {}) => ({
  office: "senate", presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, ideology: "Social Democrat", seatState: "OH", ...o,
});
const senate = (o = {}) => ({ ...createSenateCareer(senScenario()), ...o });

/** A senator with the years and the standing to run something. */
const seniorSenator = (o = {}) => senate({
  leadership: 92, capital: 40,
  seat: { ...senate().seat, seniority: 4 },
  // Their party runs the Senate and does not run the House.
  congress: { houseD: 190, houseR: 245, senateD: 55, senateR: 45 },
  ...o,
});

test("the Senate committees are Senate committees", () => {
  const names = SENATE_COMMITTEES.map((c) => c.name);
  assert.ok(names.some((n) => /Foreign Relations/.test(n)), "the Senate has the committee the House does not");
  assert.ok(!names.some((n) => /Ways and Means/.test(n)), "Ways and Means is a House committee");

  const covered = new Set(SENATE_COMMITTEES.flatMap((c) => c.domains));
  for (const domain of ["economy", "health", "justice", "social", "security"]) {
    assert.ok(covered.has(domain), `no Senate committee handles ${domain}`);
  }
  // A freshman has to be able to be put somewhere.
  assert.ok(SENATE_COMMITTEES.some((c) => c.prestige <= 2));
});

test("which committees exist depends on which chamber you sit in", () => {
  assert.notDeepEqual(committeesFor(senate()), committeesFor(game()));
  assert.equal(committeesFor(game()), COMMITTEES);
});

test("a senator is never assigned a House committee", () => {
  const c = committeeById(assignCommittee(senate()));
  assert.ok(c, "the assignment resolves to a real committee");
  assert.ok(SENATE_COMMITTEES.includes(c), `a senator was put on ${c.name}`);
});

test("a senator's ladder tops out at Majority Leader, not the Speakership", () => {
  const senateRanks = ranksFor("senate");
  const top = senateRanks[senateRanks.length - 1];
  assert.equal(top.id, "speaker", "the rung is the same rung");
  assert.match(top.title, /Majority Leader/);
  assert.ok(!/Speaker/.test(top.title), "there is no Speaker of the Senate");
  assert.ok(!/House/.test(top.power), "and nothing about the House");
  assert.equal(rankById("speaker", "senate").title, top.title);
  assert.match(rankById("speaker", "house").title, /Speaker/);
});

test("a senator's gavel depends on who runs the Senate, not the House", () => {
  const runsSenate = seniorSenator();
  const runsHouseOnly = seniorSenator({
    congress: { houseD: 245, houseR: 190, senateD: 45, senateR: 55 },
  });
  assert.ok(rankIndex(rankOf(runsSenate)) >= rankIndex("chair"),
    "a senior senator in the Senate majority runs something");
  assert.ok(rankIndex(rankOf(runsHouseOnly)) < rankIndex("chair"),
    "the House majority buys a senator nothing");
});

test("the Senate ladder is climbed in six-year terms, not two", () => {
  // Four terms is twenty-four years. Requiring the House's five would mean
  // thirty, which no senate career reaches.
  const leader = seniorSenator({ leadership: 95, seat: { ...senate().seat, seniority: 4 } });
  assert.equal(rankOf(leader), "speaker");
  const secondTerm = seniorSenator({ leadership: 68, seat: { ...senate().seat, seniority: 2 } });
  assert.ok(rankIndex(rankOf(secondTerm)) >= rankIndex("chair"));
});

test("a Majority Leader is not handed the House Rules Committee", () => {
  const out = evaluateLadder({ ...seniorSenator({ leadership: 96 }), rank: "whip" });
  assert.equal(out.state.rank, "speaker");
  const c = committeeById(out.state.committee);
  assert.ok(SENATE_COMMITTEES.includes(c), `the Senate leader ended up on ${c.name}`);
  assert.ok(!/Speaker|House/.test(out.change.note), out.change.note);
});

test("a senator who loses the majority is told which chamber they lost", () => {
  const chair = { ...seniorSenator(), rank: "chair" };
  const lost = { ...chair, congress: { houseD: 245, houseR: 190, senateD: 45, senateR: 55 } };
  const out = evaluateLadder(lost);
  assert.ok(rankIndex(out.state.rank) < rankIndex("chair"));
  assert.match(out.change.note, /Senate/);
});

test("an old career that turns up on the wrong chamber's committee is moved", () => {
  // Saved careers predate the split, so a senator can be sitting on Ways and Means.
  const out = evaluateLadder({ ...senate(), committee: "ways_means" });
  assert.ok(SENATE_COMMITTEES.includes(committeeById(out.state.committee)));
});

test("the count a senator sees is a hundred votes, not four hundred and thirty-five", () => {
  const w = whipCount({ ...seniorSenator(), rank: "whip" }, bill(-0.4));
  assert.equal(w.visible, true);
  assert.equal(w.total, 100);
  assert.equal(w.threshold, 51);
  assert.equal(w.yes + w.no, 100);
});

test("a senator's own bill is counted in the Senate", () => {
  const out = sponsorBill({ ...seniorSenator(), sponsored: [] },
    { title: "A Senate Act", axis: -0.3, domain: "economy" });
  assert.equal(out.rejected, undefined);
  assert.equal(out.result.tally.total, 100);
  assert.ok(!/House/.test(out.result.note), out.result.note);
  assert.match(out.result.note, /Senate|committee/);
});

test("the Senate files less often than the House", () => {
  assert.equal(sponsorCooldown(game()), 4);
  assert.equal(sponsorCooldown(senate()), 6);
  const filed = { ...senate(), month: 3, sponsored: [{ title: "One", month: 1, term: 1 }] };
  assert.equal(sponsorBill(filed, { title: "Two", axis: 0, domain: "economy" }).rejected, true);
});
