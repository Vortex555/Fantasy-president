import test from "node:test";
import assert from "node:assert/strict";

import {
  LADDER, officeAt, isPresidentialYear, isMidtermYear, nextElectionYear,
  ballotsCollide, eligibleFor, ageAt,
  newCareer, foldOffice, fullRecord,
  districtsInState, earnRecognition, recognitionFor,
  WILDERNESS_CHOICES, enterWilderness, wildernessYear,
  seedFromCareer, nextChoices,
} from "../src/career.js";
import { createGame } from "../src/gameEngine.js";
import { createHouseCareer, advanceHouseMonth, HOUSE_TERM } from "../src/house.js";

/**
 * One career, across every office it passes through.
 *
 * The office modules build completely different states, and this is the layer
 * that survives between them — so most of what is tested here is arithmetic
 * about time, geography and fame rather than anything about how a month plays.
 */

// ---------------------------------------------------------------------------
// The ladder and the calendar
// ---------------------------------------------------------------------------

test("the ladder is a table, so later rungs are additions rather than rewrites", () => {
  assert.ok(LADDER.length >= 3);
  for (const rung of LADDER) {
    assert.ok(rung.id && rung.title && rung.termYears > 0);
    assert.ok(["district", "state", "nation"].includes(rung.constituency));
  }
  assert.equal(officeAt("senate").termYears, 6);
  assert.equal(officeAt("house").constituency, "district");
  assert.equal(officeAt("nonsense"), null);
});

test("the calendar is the real one", () => {
  assert.equal(isPresidentialYear(2028), true);
  assert.equal(isPresidentialYear(2030), false);
  assert.equal(isMidtermYear(2030), true);
  assert.equal(isMidtermYear(2028), false);
  // Every era the game ships sits correctly against it: each starts the year
  // after a presidential election, because that is when a term begins.
  for (const start of [1949, 1961, 1993, 2001, 2013, 2025]) {
    assert.equal(isPresidentialYear(start - 1), true, `${start} follows an election`);
  }
});

test("the next election for an office is the next year it is actually on the ballot", () => {
  assert.equal(nextElectionYear("house", 2029), 2030, "the whole House, every even year");
  assert.equal(nextElectionYear("house", 2030), 2030, "including the year you are standing in");
  assert.equal(nextElectionYear("president", 2029), 2032);
  assert.equal(nextElectionYear("president", 2032), 2032);
  // A third of the Senate each cycle, rotating through three classes.
  assert.equal(nextElectionYear("senate", 2029, 1), 2030);
  assert.equal(nextElectionYear("senate", 2031, 1), 2036);
  assert.equal(nextElectionYear("senate", 2029, 2), 2032);
  assert.equal(nextElectionYear("senate", 2029, 3), 2034);
});

// ---------------------------------------------------------------------------
// What reaching costs
// ---------------------------------------------------------------------------

test("you surrender your seat only when the ballots collide", () => {
  // A House member running for the Senate: both on the same even year, always.
  assert.equal(ballotsCollide({ holding: "house", targetOffice: "senate", year: 2030, seatClass: 1 }), true);
  // A senator elected in 2030, two years into six, reaching for the presidency
  // in 2032: their own seat is not up again until 2036, so nothing is at risk.
  assert.equal(ballotsCollide({ holding: "senate", seatClass: 1, targetOffice: "president", year: 2032 }), false);
  // A senator whose own class is up that same year: the famous hard choice.
  assert.equal(ballotsCollide({ holding: "senate", seatClass: 2, targetOffice: "president", year: 2032 }), true);
  // Holding nothing costs nothing.
  assert.equal(ballotsCollide({ holding: null, targetOffice: "senate", year: 2030 }), false);
});

test("the Constitution has age floors and the game honours them", () => {
  const young = { birthYear: 2004 };
  assert.equal(ageAt(young, 2030), 26);
  assert.equal(eligibleFor(young, "house", 2030).eligible, true);

  const senate = eligibleFor(young, "senate", 2030);
  assert.equal(senate.eligible, false);
  assert.match(senate.reason, /30/);
  assert.match(senate.reason, /26/, "and it says how old you actually are");

  assert.equal(eligibleFor(young, "president", 2030).eligible, false);
  assert.equal(eligibleFor({ birthYear: 1980 }, "president", 2030).eligible, true);
  assert.equal(eligibleFor({ birthYear: 1980 }, "nonsense", 2030).eligible, false);
});

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

const scenario = {
  presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, age: "40s",
};

const houseState = () => ({
  office: "house", term: 3, month: 24, leadership: 78, rank: "chair",
  seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 3 },
  scenario,
  voteLog: [
    { id: "b1", title: "A Bill", axis: -0.4, vote: "yes", withParty: true, withDistrict: false, month: 4, term: 1 },
    { id: "b2", title: "Another", axis: 0.3, vote: "no", withParty: false, withDistrict: true, month: 9, term: 2 },
  ],
  sponsored: [{ title: "The Lakes Act", passed: true, month: 11, term: 2 }],
});

test("a new career starts empty, and knows who it is", () => {
  const c = newCareer(scenario);
  assert.equal(c.name, "Dale Fairweather");
  assert.equal(c.status, "in-office");
  assert.equal(c.warChest, 0);
  assert.equal(c.standing, 50);
  assert.deepEqual(c.offices, []);
  assert.deepEqual(c.record.votes, []);
  assert.ok(c.birthYear < 2025, "an age becomes a birth year that ages with the calendar");
});

test("folding an office preserves every vote, tagged with where it was cast", () => {
  const out = foldOffice(newCareer(scenario), houseState(), "sought-higher");
  assert.equal(out.record.votes.length, 2);
  for (const v of out.record.votes) assert.equal(v.office, "house");
  assert.equal(out.record.bills.length, 1);
  assert.equal(out.offices.length, 1);
  assert.equal(out.offices[0].seat, "OH-6");
  assert.equal(out.offices[0].terms, 3);
  assert.equal(out.offices[0].ending, "sought-higher");
});

test("the caucus's view this term moves the party's view of a career without replacing it", () => {
  // leadership 78 against a standing of 50: pulled 40% of the way, not all of it.
  const out = foldOffice(newCareer(scenario), houseState(), "sought-higher");
  assert.equal(out.standing, 61.2);
});

test("folding never mutates what it was handed", () => {
  const before = newCareer(scenario);
  const state = houseState();
  foldOffice(before, state, "retired");
  assert.deepEqual(before.offices, [], "the career it was given is untouched");
  assert.equal(state.voteLog.length, 2, "and so is the state");
  assert.equal(state.voteLog[0].office, undefined, "tagging happens on the copy");
});

test("the record is whatever has been archived plus whatever is still being cast", () => {
  // A reach happens before the office ends, so half the record is still live.
  const folded = foldOffice(newCareer(scenario), houseState(), "sought-higher");
  const senate = {
    office: "senate",
    voteLog: [{ id: "s1", title: "A Treaty", vote: "yes", month: 3, term: 1 }],
    sponsored: [],
  };
  const all = fullRecord(folded, senate);
  assert.equal(all.votes.length, 3, "two archived, one still on the floor");
  assert.equal(all.votes.at(-1).office, "senate", "the live ones are tagged too");
  assert.equal(fullRecord(folded, null).votes.length, 2);
  assert.equal(fullRecord(newCareer(scenario)).votes.length, 0);
});

// ---------------------------------------------------------------------------
// Recognition — the reason skipping a rung is hard
// ---------------------------------------------------------------------------

test("a state's delegation is its electoral votes minus its two senators", () => {
  assert.equal(districtsInState("OH"), 15);   // 17 EV
  assert.equal(districtsInState("CA"), 52);   // 54 EV
  assert.equal(districtsInState("WY"), 1);    // never below one
});

test("holding a seat makes you known in it, and rank makes you known beyond it", () => {
  const c = newCareer(scenario);
  const backbencher = earnRecognition(c, {
    office: "house", rank: "member", seat: { district: "OH-6", state: "OH", seniority: 1 },
  });
  assert.equal(backbencher.recognition.districts["OH-6"], 55, "an incumbent is known at home");
  assert.equal(backbencher.recognition.national, 0, "and nowhere else");

  const speaker = earnRecognition(c, {
    office: "house", rank: "speaker", seat: { district: "OH-6", state: "OH", seniority: 4 },
  });
  assert.ok(speaker.recognition.districts["OH-6"] > backbencher.recognition.districts["OH-6"]);
  assert.ok(speaker.recognition.national > backbencher.recognition.national,
    "a Speaker is known by people who cannot name their own member");
  assert.ok(speaker.recognition.districts["OH-6"] <= 95, "nobody is universally known");
});

test("a district converts to its share of the state, which is why skipping hurts", () => {
  let c = newCareer(scenario);
  c = earnRecognition(c, {
    office: "house", rank: "member", seat: { district: "OH-6", state: "OH", seniority: 3 },
  });
  const statewide = recognitionFor(c, "state", "OH");
  // 67 in one of Ohio's fifteen districts, transferring at 0.8 → about 3.6.
  assert.ok(statewide > 2 && statewide < 9,
    `three terms in a fifteen-district state is not statewide fame: got ${statewide}`);
  assert.ok(recognitionFor(c, "district", "OH-6") > 60, "at home, though, you are known");
});

test("a statewide office converts to national at its share of the college", () => {
  let c = newCareer(scenario);
  c = earnRecognition(c, {
    office: "senate", rank: "member", seat: { state: "OH", stateName: "Ohio", seniority: 2 },
  });
  assert.ok(c.recognition.states.OH > 55);
  const national = recognitionFor(c, "nation");
  // Ohio is 17 of 538, so a well-known senator is barely a national figure.
  assert.ok(national > 0.5 && national < 6, `got ${national}`);
});

test("fame flows upward only — being known nationally makes you known everywhere", () => {
  const famous = { ...newCareer(scenario), recognition: { national: 70, states: {}, districts: {} } };
  assert.equal(recognitionFor(famous, "state", "OH"), 70);
  assert.equal(recognitionFor(famous, "district", "OH-6"), 70);
});

test("a stranger is a stranger", () => {
  assert.equal(recognitionFor(newCareer(scenario), "state", "OH"), 0);
  assert.equal(recognitionFor(newCareer(scenario), "nation"), 0);
  assert.equal(recognitionFor(newCareer(scenario), "district", "OH-6"), 0);
});

test("earning recognition never mutates the career it was handed", () => {
  const before = newCareer(scenario);
  earnRecognition(before, { office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 } });
  assert.deepEqual(before.recognition.districts, {});
});

// ---------------------------------------------------------------------------
// The wilderness
// ---------------------------------------------------------------------------

const known = () => {
  const c = earnRecognition(newCareer(scenario), {
    office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 },
  });
  return { ...c, warChest: 4, standing: 60, recognition: { ...c.recognition, national: 40 } };
};

test("losing a reach puts you out of office, not out of the game", () => {
  const out = enterWilderness(known(), { lostTo: "Gov. Whitfield", office: "senate" });
  assert.equal(out.status, "wilderness");
  assert.notEqual(out.over, true, "the career is not finished");
  assert.match(out.wilderness.lostTo, /Whitfield/);
  assert.equal(out.wilderness.office, "senate");
});

test("out of office, the country forgets you and the donors drift", () => {
  const before = enterWilderness(known(), { lostTo: "X", office: "senate" });
  const { career: after } = wildernessYear(before, "nothing");
  assert.ok(after.recognition.national < before.recognition.national, "fame decays");
  assert.ok(after.warChest < before.warChest, "money dries up");
  assert.equal(after.year, before.year + 1, "a year at a time out here");
});

test("every choice out of office is a trade", () => {
  assert.ok(WILDERNESS_CHOICES.length >= 4);
  for (const c of WILDERNESS_CHOICES) assert.ok(c.id && c.label && c.note);

  const start = enterWilderness(known(), { lostTo: "X", office: "senate" });
  const lobby = wildernessYear(start, "lobby").career;
  const clean = wildernessYear(start, "nonprofit").career;
  assert.ok(lobby.warChest > clean.warChest, "lobbying pays");
  assert.equal(lobby.tainted, true, "and it is on your record forever");
  assert.notEqual(clean.tainted, true);

  const news = wildernessYear(start, "media").career;
  assert.ok(news.recognition.national > clean.recognition.national,
    "television keeps you visible in a way a foundation does not");
});

test("a comeback is reachable — you do not decay to nothing before the next ballot", () => {
  let c = enterWilderness(known(), { lostTo: "X", office: "senate" });
  c = wildernessYear(c, "party").career;
  c = wildernessYear(c, "party").career;
  assert.ok(c.recognition.national > 15, "two years out is a setback, not an erasure");
  assert.ok(c.standing > 60, "working the party circuit is how you get forgiven");
});

test("a year in the wilderness never mutates the career it was handed", () => {
  const before = enterWilderness(known(), { lostTo: "X", office: "senate" });
  const snapshot = JSON.parse(JSON.stringify(before));
  wildernessYear(before, "lobby");
  assert.deepEqual(before, snapshot);
});

test("an unknown choice is treated as doing nothing, not as a crash", () => {
  const start = enterWilderness(known(), { lostTo: "X", office: "senate" });
  const { career, note } = wildernessYear(start, "become-a-pirate");
  assert.equal(career.year, start.year + 1);
  assert.ok(note.length > 5);
});

// ---------------------------------------------------------------------------
// Arriving in a new office with a career behind you
// ---------------------------------------------------------------------------

test("a Senate seat reached from three House terms starts warmer than a stranger's", () => {
  const veteran = { ...known(), standing: 78 };
  const sc = { ...scenario, office: "senate", seatState: "OH" };

  const stranger = createGame(sc);
  const reached = createGame(sc, veteran);

  assert.ok(reached.leadership > stranger.leadership,
    "the caucus knows who you are before you arrive");
  assert.equal(reached.careerId, veteran.id);
  assert.equal(stranger.careerId, undefined);
});

test("arriving with a poor reputation is worse than arriving unknown", () => {
  const disliked = { ...known(), standing: 12 };
  const sc = { ...scenario, office: "senate", seatState: "OH" };
  assert.ok(createGame(sc, disliked).leadership < createGame(sc).leadership);
});

test("seeding never invents a career where there is none", () => {
  const sc = { ...scenario, office: "senate", seatState: "OH" };
  assert.deepEqual(createGame(sc), createGame(sc, null));
  assert.deepEqual(seedFromCareer({ leadership: 50 }, null), { leadership: 50 });
});

test("the presidency is still built the way it always was", () => {
  const p = createGame({ presidentName: "Ruth Ellery", party: "Democrat", startYear: 2025, startApproval: 51, ideologyAxis: -0.35 });
  assert.equal(p.office, "president");
  assert.ok(p.cabinet && p.institutions && p.warChest != null);
});

// ---------------------------------------------------------------------------
// The end of a term
// ---------------------------------------------------------------------------

test("at the end of a term you may run again, reach, or retire", () => {
  const career = { ...newCareer(scenario), year: 2030 };
  const state = { office: "house", term: 3, seat: { district: "OH-6", state: "OH", seniority: 3 } };
  const choices = nextChoices(career, state);
  const ids = choices.map((c) => c.id);

  assert.ok(ids.includes("re-elect"));
  assert.ok(ids.includes("retire"));
  assert.ok(ids.includes("reach:senate"));
  assert.ok(ids.includes("reach:president"));
  assert.ok(!ids.includes("reach:house"), "you cannot reach for the seat you hold");

  const senate = choices.find((c) => c.id === "reach:senate");
  assert.equal(senate.collides, true, "a House seat and a Senate seat share a ballot");
  assert.match(senate.label, /Senator from Ohio/);
  assert.equal(senate.where, "OH", "you run statewide from where you already are");
});

test("a reach you are too young for is offered with the reason, not hidden", () => {
  // Twenty in 2025 is twenty-five in 2030: old enough for the House, not the Senate.
  const young = { ...newCareer({ ...scenario, customAge: "20" }), year: 2030 };
  const state = { office: "house", term: 1, seat: { district: "OH-6", state: "OH", seniority: 1 } };
  const senate = nextChoices(young, state).find((c) => c.id === "reach:senate");
  assert.equal(senate.eligible, false);
  assert.match(senate.reason, /30/);
});

test("a senator reaching mid-term is told their seat is not at risk", () => {
  const career = { ...newCareer(scenario), year: 2032 };
  const state = { office: "senate", term: 1, seat: { state: "OH", stateName: "Ohio", seniority: 1, class: 1 } };
  const president = nextChoices(career, state).find((c) => c.id === "reach:president");
  assert.equal(president.collides, false, "class 1 is not up in 2032");
});

test("the House still ends a term the way it always did, and now offers the ladder too", () => {
  const s = {
    ...createHouseCareer({ ...scenario, office: "house", district: "OH-6" }),
    month: HOUSE_TERM, approval: 74,
    career: { ...newCareer(scenario), year: 2026 },
  };
  const out = advanceHouseMonth(s);
  assert.ok(out.reelection, "the district still answers");
  if (out.reelection.won) {
    assert.ok(Array.isArray(out.choices), "and the ladder is offered at the boundary");
    assert.ok(out.choices.some((c) => c.id.startsWith("reach:")));
  }
});

test("a career-less state still advances exactly as before", () => {
  const s = { ...createHouseCareer({ ...scenario, office: "house", district: "OH-6" }), month: HOUSE_TERM, approval: 74 };
  const out = advanceHouseMonth(s);
  assert.equal(out.choices, null, "no career, no ladder — and no crash");
});
