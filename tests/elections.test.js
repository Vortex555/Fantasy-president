import test from "node:test";
import assert from "node:assert/strict";

import {
  nationalEnvironment,
  houseRaces,
  senateCycle,
  senateRaces,
  runMidterms,
  runPresidential,
  fundraise,
  spendEffect,
  challengerFor,
  WAR_CHEST_START,
} from "../src/elections.js";
import {
  createGame, applyResult, finishMidterms, finishCampaign, createCampaign, pacing,
} from "../src/gameEngine.js";
import { STATE_CODES, STATES } from "../src/states.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function game(overrides = {}) {
  const state = createGame({
    presidentName: "Test President",
    party: "Democrat",
    startYear: 2025,
    startApproval: 52,
    ideologyAxis: -0.4,
    difficulty: "hard",
    ...(overrides.scenario || {}),
  });
  return {
    ...state,
    // Hand the president a working majority, so losing seats actually costs
    // them something and a wipeout has somewhere to fall from.
    congress: { houseD: 240, houseR: 195, senateD: 54, senateR: 46 },
    ...overrides,
    scenario: { ...state.scenario, ...(overrides.scenario || {}) },
  };
}

/** Force every state to the same approval, so a test can isolate one variable. */
function flat(state, approval) {
  const stateApproval = {};
  for (const code of STATE_CODES) stateApproval[code] = approval;
  return { ...state, approval, stateApproval };
}

// ---------------------------------------------------------------------------
// The national environment
// ---------------------------------------------------------------------------

test("the environment favours a popular president and punishes an unpopular one", () => {
  const good = nationalEnvironment(flat(game(), 62));
  const bad = nationalEnvironment(flat(game(), 33));
  assert.ok(good > 0, `expected a positive environment, got ${good}`);
  assert.ok(bad < 0, `expected a negative environment, got ${bad}`);
  assert.ok(good > bad);
});

test("midterms carry a thermostatic penalty the president has to outrun", () => {
  const state = flat(game(), 50);
  const general = nationalEnvironment(state);
  const midterm = nationalEnvironment(state, { midterm: true });
  assert.ok(midterm < general,
    "the president's party should be worse off at a midterm than at a general");
});

test("economic pain drags the environment down independently of approval", () => {
  const base = flat(game(), 50);
  const painful = { ...base, economy: { ...base.economy, unemployment: 9.5, inflation: 8.0 } };
  assert.ok(nationalEnvironment(painful) < nationalEnvironment(base));
});

test("unresolved situations drag on the president's party", () => {
  const base = flat(game(), 50);
  const festering = {
    ...base,
    arcs: [
      { id: "arc_1", status: "active", severity: 5, domain: "economy" },
      { id: "arc_2", status: "scarred", severity: 4, domain: "justice" },
    ],
  };
  assert.ok(nationalEnvironment(festering) < nationalEnvironment(base));
});

// ---------------------------------------------------------------------------
// The races themselves
// ---------------------------------------------------------------------------

test("the House is 435 districts, apportioned from the map", () => {
  const races = houseRaces(game());
  assert.equal(races.length, 435);
  // Every district belongs to a real state, and no district is in DC.
  for (const race of races) {
    assert.ok(STATES[race.state], `${race.state} is not a state`);
    assert.notEqual(race.state, "DC");
  }
});

test("a big state's districts span a wider range than its statewide lean", () => {
  const races = houseRaces(game()).filter((r) => r.state === "CA");
  const leans = races.map((r) => r.lean);
  assert.ok(races.length > 20, "California should have a large delegation");
  assert.ok(Math.max(...leans) - Math.min(...leans) > 20,
    "a large state should contain both safe and marginal districts");
});

test("only a third of the Senate is up in any one cycle", () => {
  const cycles = [1, 2, 3].map((c) => senateRaces(game(), c).length);
  assert.equal(cycles.reduce((a, b) => a + b, 0), 100, "all 100 seats across three cycles");
  for (const n of cycles) {
    assert.ok(n >= 30 && n <= 36, `a class should hold about a third of the Senate, got ${n}`);
  }
});

test("a state's two senators never sit in the same class", () => {
  const byState = {};
  for (const cycle of [1, 2, 3]) {
    for (const race of senateRaces(game(), cycle)) {
      byState[race.state] = byState[race.state] || [];
      byState[race.state].push(cycle);
    }
  }
  for (const [code, cycles] of Object.entries(byState)) {
    assert.equal(new Set(cycles).size, cycles.length,
      `${code} has both seats in the same class`);
  }
});

test("the cycle advances with the term, so a second midterm is a different map", () => {
  assert.notEqual(senateCycle({ term: 1 }), senateCycle({ term: 2 }));
});

// ---------------------------------------------------------------------------
// Midterms
// ---------------------------------------------------------------------------

test("an unpopular president loses seats and a popular one does not", () => {
  const before = game().congress;
  const wipeout = runMidterms(flat(game(), 28));
  const triumph = runMidterms(flat(game(), 68));
  assert.ok(wipeout.congress.houseD < before.houseD,
    "a president at 28% should lose House seats");
  assert.ok(triumph.congress.houseD > wipeout.congress.houseD,
    "a popular president should do better than an unpopular one");
});

test("the chambers stay whole however the night goes", () => {
  for (const approval of [12, 30, 50, 70, 92]) {
    const { congress } = runMidterms(flat(game(), approval));
    assert.equal(congress.houseD + congress.houseR, 435, `House broken at ${approval}%`);
    assert.equal(congress.senateD + congress.senateR, 100, `Senate broken at ${approval}%`);
    for (const seats of Object.values(congress)) {
      assert.ok(seats >= 0, `negative seat count at ${approval}%`);
    }
  }
});

test("a wipeout hands the House to the other party", () => {
  const { congress, control } = runMidterms(flat(game(), 22));
  assert.ok(congress.houseR > congress.houseD, "the opposition should take the House");
  assert.equal(control.house, "Republican");
});

test("the night names the seats that actually changed hands", () => {
  const result = runMidterms(flat(game(), 30));
  assert.ok(result.flips.length > 0, "a wipeout should flip named seats");
  for (const flip of result.flips.slice(0, 10)) {
    assert.ok(flip.state && flip.seat, "a flip needs a seat");
    assert.ok(flip.from !== flip.to, "a flip changes party");
    assert.ok(["house", "senate"].includes(flip.chamber));
  }
});

test("the Senate moves less than the House, because only a third of it votes", () => {
  const before = game().congress;
  const after = runMidterms(flat(game(), 25)).congress;
  const houseLoss = before.houseD - after.houseD;
  const senateLoss = before.senateD - after.senateD;
  assert.ok(senateLoss < houseLoss, "the Senate is the slower chamber");
  assert.ok(senateLoss <= senateRaces(game(), senateCycle(game())).length,
    "you cannot lose a seat that was not on the ballot");
});

test("a midterm is deterministic — the same country votes the same way", () => {
  const state = flat(game(), 41);
  assert.deepEqual(runMidterms(state).congress, runMidterms(state).congress);
});

test("money defends seats", () => {
  const state = flat(game(), 36);
  const bare = runMidterms(state);
  const funded = runMidterms({ ...state, warChest: 600 },
    { spend: Object.fromEntries(STATE_CODES.map((c) => [c, 12])) });
  assert.ok(funded.congress.houseD >= bare.congress.houseD,
    "spending everywhere should not cost you seats");
});

test("a dissolved Congress holds no midterms", () => {
  const result = runMidterms({ ...flat(game(), 30), congressDissolved: true });
  assert.equal(result.held, false);
  assert.equal(result.flips.length, 0);
});

// ---------------------------------------------------------------------------
// The presidential election
// ---------------------------------------------------------------------------

test("every electoral vote is allocated, and they add to 538", () => {
  const result = runPresidential(flat(game(), 51));
  assert.equal(result.ev.you + result.ev.them, 538);
  assert.equal(result.states.length, STATE_CODES.length);
});

test("a president loved everywhere wins, and one hated everywhere loses", () => {
  assert.equal(runPresidential(flat(game(), 70)).won, true);
  assert.equal(runPresidential(flat(game(), 30)).won, false);
});

test("winning takes 270, not a plurality", () => {
  const result = runPresidential(flat(game(), 62));
  assert.equal(result.won, result.ev.you >= 270);
});

test("the popular vote and the electoral college can disagree", () => {
  // Bank huge margins in a few big states and lose everywhere else narrowly:
  // the popular vote follows the blowout, the college follows the count.
  const state = flat(game(), 49);
  const stateApproval = { ...state.stateApproval, CA: 92, NY: 90, IL: 88 };
  const result = runPresidential({ ...state, stateApproval });
  assert.ok(result.popular.you > 50, "landslides in big states carry the popular vote");
  assert.equal(result.won, false, "and still lose the college");
  assert.equal(result.split, true, "the result should be flagged as a split");
});

test("the two popular-vote shares are a real split of the vote", () => {
  const result = runPresidential(flat(game(), 55));
  assert.ok(Math.abs(result.popular.you + result.popular.them - 100) < 0.05);
});

test("a strong debate moves states, a weak one loses them", () => {
  const state = flat(game(), 50);
  const strong = runPresidential(state, { swing: 9 });
  const weak = runPresidential(state, { swing: -9 });
  assert.ok(strong.ev.you > weak.ev.you, "the debate should be worth electoral votes");
});

test("the election is deterministic — the same country votes the same way", () => {
  const state = flat(game(), 50.5);
  assert.deepEqual(runPresidential(state).ev, runPresidential(state).ev);
});

test("a close national result produces states nobody can call", () => {
  const result = runPresidential(flat(game(), 50));
  assert.ok(result.states.some((s) => s.tooClose),
    "a 50-50 country should leave states inside the margin");
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("a president raises more when they are popular and their backers are warm", () => {
  const warm = flat(game(), 64);
  const cold = {
    ...flat(game(), 34),
    stakeholders: Object.fromEntries(Object.keys(warm.stakeholders).map((k) => [k, 18])),
  };
  assert.ok(fundraise(warm) > fundraise(cold));
  assert.ok(fundraise(cold) >= 0, "fundraising never goes negative");
});

test("a career opens with a war chest to build on", () => {
  assert.ok(WAR_CHEST_START >= 0);
});

test("money has diminishing returns", () => {
  const first = spendEffect(20, 10);
  const second = spendEffect(40, 10);
  assert.ok(second > first, "more money does more");
  assert.ok(second < first * 2, "but not proportionally more");
});

test("money is worth more in a small state than a large one", () => {
  assert.ok(spendEffect(20, 3) > spendEffect(20, 40));
});

test("spending nothing does nothing", () => {
  assert.equal(spendEffect(0, 10), 0);
});

// ---------------------------------------------------------------------------
// The challenger
// ---------------------------------------------------------------------------

test("the challenger exists from day one and never changes identity", () => {
  const state = game();
  const a = challengerFor(state);
  const b = challengerFor({ ...state, month: 40 });
  assert.equal(a.name, b.name);
  assert.ok(a.name && a.party && a.attack);
});

test("the challenger comes from the other party", () => {
  assert.equal(challengerFor(game({ scenario: { party: "Democrat" } })).party, "Republican");
  assert.equal(challengerFor(game({ scenario: { party: "Republican" } })).party, "Democrat");
});

// ---------------------------------------------------------------------------
// Wiring: the midterms and election night as the game actually reaches them
// ---------------------------------------------------------------------------

/** A minimal turn result, so a month can be advanced without a model. */
const quietTurn = () => ({
  analysis: "Nothing much happened.",
  approvalChange: 0,
  economy: {}, stakeholders: [], press: [], stateEffects: [],
  arcs: [], nextEvent: { title: "Another Month", brief: "..." }, flags: {},
});

/** Walk a career forward to a given month without touching the model. */
function advanceTo(state, month) {
  let s = state;
  while (s.month < month && !s.over && !s.phase) {
    s = applyResult(s, "We continue the work of the administration.", quietTurn());
  }
  return s;
}

test("a career starts with money in the bank and raises more every month", () => {
  const start = game();
  assert.equal(start.warChest, WAR_CHEST_START);
  const after = applyResult(start, "We invest in infrastructure.", quietTurn());
  assert.ok(after.warChest > start.warChest, "a month should raise money");
});

test("month 24 stops the game and holds the midterms", () => {
  const state = advanceTo(game(), pacing(game()).midterm);
  assert.equal(state.month, pacing(game()).midterm);
  assert.equal(state.phase, "midterms", "the midterm should be its own phase, not a silent number");
  assert.ok(state.midtermCampaign.challenger.name);
});

test("holding the midterms changes Congress, banks the record and clears the phase", () => {
  const before = advanceTo(game(), pacing(game()).midterm);
  const { state, result } = finishMidterms(before, {});

  assert.equal(state.phase, null);
  assert.equal(state.midtermTerm, state.term);
  assert.equal(result.held, true);
  assert.notDeepEqual(state.congress, before.congress, "a midterm should move seats");
  assert.equal(state.midterms.length, 1);
  assert.ok(state.history.some((h) => h.midterm), "the night belongs in the record");
});

test("the midterms are held once per term, not once per visit", () => {
  const before = advanceTo(game(), pacing(game()).midterm);
  const { state } = finishMidterms(before, {});
  const next = applyResult(state, "Back to work.", quietTurn());
  assert.notEqual(next.phase, "midterms", "the midterm should not re-trigger the same term");
});

test("midterm spending is deducted from the war chest and capped by it", () => {
  const before = { ...advanceTo(game(), pacing(game()).midterm), warChest: 50 };
  const { state } = finishMidterms(before, { PA: 300, MI: 300 });
  assert.ok(state.warChest >= 0, "a campaign cannot go into debt");
  assert.ok(state.warChest < 50, "money spent is money gone");
});

test("election night decides on the map, and the map is kept", () => {
  const state = { ...game(), month: 46, campaign: createCampaign(game()) };
  const done = finishCampaign(state, 0, {});

  // A win rolls straight into the next term, so `ending` is cleared — but the
  // night itself has to survive either way for the results screen to render it.
  assert.ok(done.election, "the night should be preserved");
  assert.equal(done.election.states.length, STATE_CODES.length);
  assert.equal(done.election.ev.you + done.election.ev.them, 538);
  assert.equal(done.election.won, done.election.ev.you >= 270);
  assert.ok(done.election.challenger?.name, "the night names who you beat, or who beat you");
});

test("a losing election reports the popular vote alongside the college", () => {
  const losing = flat({ ...game(), month: 46, campaign: createCampaign(game()) }, 32);
  const done = finishCampaign(losing, -6, {});
  assert.equal(done.over, true);
  assert.equal(done.ending.type, "defeated");
  assert.ok(typeof done.ending.popular === "number");
  assert.ok(done.election.states.length === STATE_CODES.length);
});

test("winning still begins the next term, with the map that won it", () => {
  const winning = flat({ ...game(), month: 46, campaign: createCampaign(game()) }, 62);
  const done = finishCampaign(winning, 6, {});
  assert.equal(done.over, false, "a win starts a second term rather than ending the career");
  assert.equal(done.term, 2);
  assert.equal(done.elections.length, 1);
});

test("a second term gets its own midterms on a different Senate map", () => {
  const winning = flat({ ...game(), month: 46, campaign: createCampaign(game()) }, 62);
  const second = finishCampaign(winning, 6, {});
  assert.equal(second.midtermTerm, null, "the second term has not held its midterms yet");
  assert.notEqual(senateCycle(second), senateCycle({ term: 1 }));
});

test("the challenger the debate faces is the one the country has had all term", () => {
  const state = game();
  assert.equal(createCampaign(state).opponent.name, challengerFor(state).name);
});

test("campaign spending moves states on election night", () => {
  const base = flat({ ...game(), month: 46, campaign: createCampaign(game()), warChest: 900 }, 48);
  const bare = runPresidential(base);
  const funded = runPresidential(base, { spend: { PA: 120, MI: 120, WI: 120, NV: 120 } });
  assert.ok(funded.ev.you > bare.ev.you, "money in the right states should be worth electoral votes");
});
