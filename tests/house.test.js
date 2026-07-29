import test from "node:test";
import assert from "node:assert/strict";

import {
  HOUSE_TERM,
  createHouseCareer,
  districtOptions,
  districtAxis,
  seatFor,
  floorBills,
  partyLine,
  districtView,
  castVote,
  sponsorBill,
  SPONSOR_COOLDOWN,
  runReelection,
  advanceHouseMonth,
} from "../src/house.js";
import { createGame } from "../src/gameEngine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scenario = (o = {}) => ({
  office: "house",
  presidentName: "Dale Fairweather",   // the player's own name, whatever the office
  party: "Democrat",
  startYear: 2025,
  ideologyAxis: -0.35,
  ideology: "Social Democrat",
  difficulty: "hard",
  district: "OH-6",
  ...o,
});

/** `scenario` overrides feed the career; everything else overrides the state. */
const game = ({ scenario: sc, ...rest } = {}) => ({ ...createHouseCareer(scenario(sc)), ...rest });

// ---------------------------------------------------------------------------
// Getting a seat
// ---------------------------------------------------------------------------

test("createGame routes a House scenario to a House career", () => {
  const s = createGame(scenario());
  assert.equal(s.office, "house");
  assert.ok(s.seat, "a member has a seat");
});

test("the presidential game is untouched by the new mode", () => {
  const p = createGame({ presidentName: "Ruth Ellery", party: "Democrat", startYear: 2025,
    startApproval: 51, ideologyAxis: -0.35 });
  assert.equal(p.office, "president");
  assert.ok(p.cabinet && p.institutions && p.warChest != null);
});

test("a member holds one of the real 435 districts", () => {
  const s = game();
  assert.equal(s.seat.district, "OH-6");
  assert.equal(s.seat.state, "OH");
  assert.ok(Number.isFinite(s.seat.lean));
  assert.equal(s.seat.seniority, 1, "a freshman starts on their first term");
});

test("a district's lean converts to the same spectrum bills sit on", () => {
  assert.ok(districtAxis(60) > districtAxis(0));
  assert.ok(districtAxis(-60) < districtAxis(0));
  for (const lean of [-90, -30, 0, 30, 90]) {
    const a = districtAxis(lean);
    assert.ok(a >= -1 && a <= 1, `${lean} → ${a} is off the spectrum`);
  }
});

test("the picker offers a real choice of seat, not a list of 435", () => {
  const opts = districtOptions(game());
  assert.ok(opts.length >= 3 && opts.length <= 12);
  const kinds = new Set(opts.map((o) => o.kind));
  assert.ok(kinds.has("safe"), "a seat you cannot lose");
  assert.ok(kinds.has("marginal"), "a seat you can");
  assert.ok(kinds.has("hostile"), "a seat you should not hold at all");
  for (const o of opts) assert.ok(o.district && o.stateName && Number.isFinite(o.lean));
});

test("a member serves under a president who is somebody else", () => {
  const s = game();
  assert.ok(s.president?.name);
  assert.notEqual(s.president.name, s.scenario.presidentName);
  assert.ok(["Democrat", "Republican"].includes(s.president.party));
});

test("a member has a standing with their district and with their leadership", () => {
  const s = game();
  assert.ok(s.approval >= 0 && s.approval <= 100, "the district rates you");
  assert.ok(s.leadership >= 0 && s.leadership <= 100, "leadership rates you too");
});

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------

test("bills reach the floor, and never more than a month's worth", () => {
  for (let month = 1; month <= 12; month++) {
    const bills = floorBills({ ...game(), month });
    assert.ok(bills.length <= 3, `month ${month} put ${bills.length} bills on the floor`);
    for (const b of bills) assert.ok(b.id && b.title && Number.isFinite(b.axis));
  }
});

test("leadership has a position on every bill, and so does the district", () => {
  const s = game();
  const bill = floorBills({ ...s, month: 2 })[0] || { axis: -0.5, id: "x", title: "T" };
  const party = partyLine(s, bill);
  const district = districtView(s, bill);
  assert.ok(["yes", "no"].includes(party.position));
  assert.ok(["yes", "no"].includes(district.position));
  assert.ok(party.reason && district.reason);
});

test("a bill your district loves and your party hates is the whole game", () => {
  // A Democrat in a heavily Republican seat, facing a bill from the right.
  const s = game({ scenario: { district: "WY-1" } });
  const bill = { id: "tax_cuts", title: "Growth and Investment Act", axis: 0.45, domain: "economy" };
  assert.equal(partyLine(s, bill).position, "no", "the party opposes it");
  assert.equal(districtView(s, bill).position, "yes", "the district wants it");
});

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

const billOf = (axis) => ({ id: `b${axis}`, title: "A Bill", axis, domain: "economy" });

test("voting with your district raises your standing there", () => {
  const s = game({ scenario: { district: "WY-1" } });   // a very Republican seat
  const up = castVote(s, billOf(0.45), "yes");
  const down = castVote(s, billOf(0.45), "no");
  assert.ok(up.state.approval > s.approval, "the district liked it");
  assert.ok(down.state.approval < s.approval, "the district did not");
});

test("voting with your party raises your standing with leadership", () => {
  const s = game({ scenario: { district: "WY-1" } });
  const loyal = castVote(s, billOf(-0.5), "yes");    // a Democrat bill, a Democrat member
  const rebel = castVote(s, billOf(-0.5), "no");
  assert.ok(loyal.state.leadership > s.leadership);
  assert.ok(rebel.state.leadership < s.leadership);
});

test("the classic bind: you cannot please both", () => {
  const s = game({ scenario: { district: "WY-1" } });
  const bill = billOf(0.45);                          // district yes, party no
  const withDistrict = castVote(s, bill, "yes");
  const withParty = castVote(s, bill, "no");
  assert.ok(withDistrict.state.approval > withParty.state.approval);
  assert.ok(withParty.state.leadership > withDistrict.state.leadership);
});

test("abstaining dodges nothing — both sides notice", () => {
  const s = game();
  const out = castVote(s, billOf(-0.5), "abstain");
  assert.ok(out.state.approval <= s.approval);
  assert.ok(out.state.leadership <= s.leadership);
});

test("your vote is recorded, because your record is what you run on", () => {
  const s = game();
  const out = castVote(s, billOf(-0.5), "yes");
  assert.equal(out.state.voteLog.length, 1);
  assert.equal(out.state.voteLog[0].vote, "yes");
  assert.ok(out.state.voteLog[0].title);
});

test("the chamber votes around you, and your one vote is counted in it", () => {
  const s = game();
  const out = castVote(s, billOf(-0.45), "yes");
  assert.ok(out.result.tally.total >= 435);
  assert.equal(typeof out.result.passed, "boolean");
  assert.ok(["yes", "no", "abstain"].includes(out.result.yourVote));
});

test("you cannot vote on the same bill twice", () => {
  const s = game();
  const first = castVote(s, billOf(-0.5), "yes");
  const second = castVote(first.state, billOf(-0.5), "no");
  assert.equal(second.rejected, true);
});

// ---------------------------------------------------------------------------
// Sponsoring
// ---------------------------------------------------------------------------

test("a freshman can sponsor a bill, and it usually goes nowhere", () => {
  const s = game();
  const out = sponsorBill(s, { title: "The Fairweather Act", axis: -0.4, domain: "economy" });
  assert.ok(out.state.sponsored.length === 1);
  assert.ok(typeof out.result.reachedFloor === "boolean");
  assert.ok(out.result.cosponsors >= 0);
});

test("seniority and leadership standing get a bill heard", () => {
  const nobody = { ...game(), seat: { ...game().seat, seniority: 1 }, leadership: 20 };
  const somebody = { ...game(), seat: { ...game().seat, seniority: 6 }, leadership: 88 };
  const a = sponsorBill(nobody, { title: "A", axis: -0.4, domain: "economy" });
  const b = sponsorBill(somebody, { title: "B", axis: -0.4, domain: "economy" });
  assert.ok(b.result.odds > a.result.odds, "clout is what gets a bill a hearing");
});

test("you cannot file a bill every month", () => {
  const s = game();
  const first = sponsorBill(s, { title: "A", axis: -0.4, domain: "economy" });
  const second = sponsorBill(first.state, { title: "B", axis: -0.4, domain: "economy" });
  assert.equal(second.rejected, true);
  const later = sponsorBill({ ...first.state, month: first.state.month + SPONSOR_COOLDOWN },
    { title: "C", axis: -0.4, domain: "economy" });
  assert.equal(later.rejected, undefined);
});

// ---------------------------------------------------------------------------
// Re-election
// ---------------------------------------------------------------------------

test("the House runs every two years", () => {
  assert.equal(HOUSE_TERM, 24);
});

test("a safe seat survives what a marginal one does not", () => {
  const safe = { ...game({ scenario: { district: "MA-1" } }), approval: 44 };
  const marginal = { ...game({ scenario: { district: "OH-6" } }), approval: 44 };
  const a = runReelection({ ...safe, month: HOUSE_TERM });
  const b = runReelection({ ...marginal, month: HOUSE_TERM });
  assert.ok(a.margin > b.margin, "a safe district forgives more");
});

test("your own standing in the district decides a close race", () => {
  const loved = { ...game(), approval: 68 };
  const loathed = { ...game(), approval: 26 };
  assert.ok(runReelection(loved).margin > runReelection(loathed).margin);
});

test("a national wave against your president drags you down with them", () => {
  const s = game();
  const calm = { ...s, president: { ...s.president, party: s.scenario.party, approval: 58 } };
  const wave = { ...s, president: { ...s.president, party: s.scenario.party, approval: 24 } };
  assert.ok(runReelection(calm).margin > runReelection(wave).margin,
    "a member of the president's party runs on the president's record");
});

test("winning starts another term and adds to your seniority", () => {
  const s = { ...game({ scenario: { district: "MA-1" } }), approval: 70, month: HOUSE_TERM };
  const out = advanceHouseMonth(s);
  if (out.state.reelection?.won) {
    assert.equal(out.state.seat.seniority, 2);
    assert.equal(out.state.month, 1);
    assert.equal(out.state.over, false);
  }
});

test("losing your seat ends the career", () => {
  const doomed = { ...game({ scenario: { district: "WY-1" } }), approval: 12, month: HOUSE_TERM };
  const out = advanceHouseMonth(doomed);
  if (!out.state.reelection?.won) {
    assert.equal(out.state.over, true);
    assert.equal(out.state.ending.type, "unseated");
  }
});

test("a re-election is deterministic — the same district votes the same way", () => {
  const s = { ...game(), month: HOUSE_TERM };
  assert.deepEqual(runReelection(s).margin, runReelection(s).margin);
});

// --- What setup actually promised -------------------------------------------

test("the chamber you chose in setup is the chamber you arrive in", () => {
  // The setup screen offers a congressional composition and the House career
  // used to seed Congress from a dice roll and ignore it entirely.
  const strong = createHouseCareer(
    scenario({ party: "Democrat", district: "MA-4", congress: { house: 255, senate: 58 } }));
  assert.equal(strong.congress.houseD, 255);
  assert.equal(strong.congress.houseR, 180);
  assert.equal(strong.congress.senateD, 58);
  assert.equal(strong.congress.senateR, 42);

  // Expressed from your own caucus's side, whichever side that is.
  const republican = createHouseCareer(
    scenario({ party: "Republican", district: "TX-1", congress: { house: 255, senate: 58 } }));
  assert.equal(republican.congress.houseR, 255);
  assert.equal(republican.congress.houseD, 180);
});

test("an independent gets the chamber the seed deals, because they have no bloc", () => {
  const indie = createHouseCareer(
    scenario({ party: "Independent", district: "VT-1", congress: null }));
  assert.equal(indie.congress.houseD + indie.congress.houseR, 435);
  assert.equal(indie.congress.senateD + indie.congress.senateR, 100);
});

// --- The rest of the ballot --------------------------------------------------

test("the chamber you serve in is re-elected alongside you", () => {
  const s = { ...game(), month: HOUSE_TERM, approval: 74 };
  const out = advanceHouseMonth(s);
  if (out.reelection?.won) {
    assert.ok(out.cycle, "the other 434 races happened too");
    assert.notDeepEqual(out.state.congress, s.congress);
    assert.equal(out.state.congress.houseD + out.state.congress.houseR, 435);
  }
});

test("who runs the chamber is not decided once and then frozen for twenty years", () => {
  // Play out five terms and see whether control ever moves. It used to be
  // impossible: `congress` was written at career creation and never again, so
  // the gavel a member was handed in month one was theirs until they retired.
  let s = { ...game({ scenario: { district: "MA-4" } }), approval: 82, leadership: 80 };
  const seen = new Set();
  for (let term = 0; term < 5 && !s.over; term++) {
    for (let m = 0; m < HOUSE_TERM; m++) {
      const out = advanceHouseMonth(s);
      s = out.state;
      if (s.over) break;
    }
    seen.add(`${s.congress.houseD}-${s.congress.senateD}`);
  }
  assert.ok(seen.size > 1, "the composition of Congress never moved across five terms");
});

// --- The floor does not run out ---------------------------------------------

test("the floor keeps scheduling bills into a second term and beyond", () => {
  // The bug: `voted` excluded every bill ever cast across a whole career, and
  // the pool is 21 bills against roughly 1.2 a month — so it emptied inside the
  // first term and every month afterwards was blank, forever.
  let s = game({ scenario: { district: "MD-1" } });
  const perTerm = [];

  for (let term = 1; term <= 3 && !s.over; term++) {
    let seen = 0;
    for (let m = 1; m <= HOUSE_TERM; m++) {
      const bills = floorBills(s);
      seen += bills.length;
      for (const b of bills) {
        const out = castVote(s, b, "yes");
        if (!out.rejected) s = out.state;
      }
      const adv = advanceHouseMonth(s);
      s = adv.state;
      if (s.over) break;
    }
    perTerm.push(seen);
  }

  for (const [i, count] of perTerm.entries()) {
    assert.ok(count > 8, `term ${i + 1} only saw ${count} bills: ${perTerm.join(", ")}`);
  }
});

test("a new Congress reintroduces what died in the last one", () => {
  // Two years is a whole Congress. Bills that never got a vote come back, which
  // is both how it works and why the floor cannot run dry.
  const everything = game();
  const early = { ...everything, term: 1, month: 3 };
  const later = { ...everything, term: 2, month: 3,
    voteLog: floorBills(early).map((b) => ({ ...b, vote: "yes", month: 3, term: 1 })) };
  assert.ok(floorBills(later).length > 0,
    "a bill voted on in the last Congress must not block the new one");
});

test("the floor and the vote agree on what counts as already decided", () => {
  // If the floor offers a reintroduced bill the vote then refuses, the month
  // deadlocks — the card is there and nothing you click does anything.
  const s = game();
  const b = { id: "tax_cuts", title: "A Bill", axis: 0.4, domain: "economy" };
  const log = [{ id: "tax_cuts", title: "A Bill", vote: "yes", month: 5, term: 1 }];

  const sameCongress = { ...s, term: 1, month: 8, voteLog: log };
  assert.equal(castVote(sameCongress, b, "yes").rejected, true,
    "within one Congress, once is once");

  const newCongress = { ...s, term: 2, month: 3, voteLog: log };
  assert.equal(castVote(newCongress, b, "yes").rejected, undefined,
    "a new Congress may vote on it again — the floor offers it, so the vote must take it");
});
