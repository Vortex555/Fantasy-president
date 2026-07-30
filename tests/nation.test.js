import test from "node:test";
import assert from "node:assert/strict";

import {
  absoluteMonth,
  seedNation,
  advanceNation,
  setSituation,
  domainsActedOn,
  nationSummary,
  nationCard,
  situationFromPool,
  wantsWrittenSituation,
  MAX_NATIONAL_ARCS,
  steerDomain,
  recentNewsSubjects,
} from "../src/nation.js";
import { ARC_DOMAIN_IDS } from "../src/arcs.js";
import { createHouseCareer, advanceHouseMonth, castVote, docketSize } from "../src/house.js";
import { createSenateCareer, advanceSenateMonth } from "../src/senate.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A career carrying one problem, at whatever severity the test needs. */
const withProblem = (o = {}, arc = {}) => house({
  arcs: [{
    id: "arc_1", title: "The Gulf Refinery Fallout", brief: "Fuel prices remain elevated.",
    domain: "economy", severity: 2, bornMonth: 1, ignoredStreak: 0,
    lastAddressedMonth: null, status: "active", log: [], ...arc,
  }],
  ...o,
});

/** A roll call this chamber actually carried, in a given domain. */
const passedVote = (domain, o = {}) => ({
  id: "b1", title: "An Act", axis: -0.3, vote: "yes", domain,
  month: 1, term: 1, withDistrict: true, withParty: true, passed: true, ...o,
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

test("the country runs on a continuous clock, not the term's", () => {
  assert.equal(absoluteMonth({ office: "house", term: 1, month: 1 }), 1);
  assert.equal(absoluteMonth({ office: "house", term: 2, month: 1 }), 25);
  assert.equal(absoluteMonth({ office: "house", term: 3, month: 12 }), 60);
  // Six years a term, so a senator's second term opens in year seven.
  assert.equal(absoluteMonth({ office: "senate", term: 2, month: 1 }), 73);
});

// ---------------------------------------------------------------------------
// Being sworn in
// ---------------------------------------------------------------------------

test("nobody is sworn into an empty country", () => {
  const state = createHouseCareer(scenario());
  assert.ok(state.situation?.title, "a story should be dominating the news");
  assert.ok(state.situation?.brief);
  assert.equal(state.arcs.length, 1, "and one problem should already be outstanding");
  assert.equal(state.arcs[0].title, state.situation.title);
  assert.equal(state.arcs[0].status, "active");
});

test("a senator is sworn into the same country a member is", () => {
  const state = createSenateCareer(scenario({ office: "senate", seatState: "OH" }));
  assert.ok(state.situation?.title);
  assert.equal(state.arcs.length, 1);
});

test("the same career is always sworn into the same country", () => {
  const a = createHouseCareer(scenario());
  const b = createHouseCareer(scenario());
  assert.equal(a.situation.title, b.situation.title);
});

// ---------------------------------------------------------------------------
// Problems that nobody legislates about
// ---------------------------------------------------------------------------

test("a problem nobody touches gets worse, but not every month", () => {
  const first = advanceNation(withProblem({ month: 1 }));
  assert.equal(first.arcs[0].ignoredStreak, 1);
  assert.equal(first.arcs[0].severity, 2, "one ignored month is not enough");

  const second = advanceNation({ ...first, month: 2 });
  assert.equal(second.arcs[0].ignoredStreak, 2);
  assert.equal(second.arcs[0].severity, 3, "two is");
});

test("a problem cannot get worse than the scale allows", () => {
  // Ignored, but not on an escalation month — so it holds at the ceiling rather
  // than breaking open. Breaking open is its own lifecycle, tested below.
  const state = advanceNation(withProblem({ month: 1 }, { severity: 5, ignoredStreak: 0 }));
  assert.equal(state.arcs[0].severity, 5);
  assert.equal(state.detonation, null);
});

// ---------------------------------------------------------------------------
// What the chamber passing something actually does
// ---------------------------------------------------------------------------

test("a bill that passes eases the problem it was about", () => {
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("economy")],
  }, { severity: 3, ignoredStreak: 4 }));

  assert.equal(state.arcs[0].severity, 2, "real progress");
  assert.equal(state.arcs[0].ignoredStreak, 0, "the clock resets");
  assert.equal(state.arcs[0].lastAddressedMonth, 1);
});

test("a bill about something else does not count", () => {
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("justice")],
  }, { severity: 3, ignoredStreak: 1 }));

  assert.equal(state.arcs[0].severity, 4, "adjacency is not action; it escalated");
});

test("a bill that failed does not count either", () => {
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("economy", { passed: false })],
  }, { severity: 3, ignoredStreak: 1 }));

  assert.equal(state.arcs[0].severity, 4);
});

test("the chamber's record counts, not the member's vote", () => {
  // One of 435 people voted no and it carried anyway. The country does not care
  // which way you personally went — only what came out of the building.
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("economy", { vote: "no", withParty: false })],
  }, { severity: 3 }));

  assert.equal(state.arcs[0].severity, 2);
});

test("legislating a problem all the way down finishes it", () => {
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("economy")],
  }, { severity: 1 }));

  assert.equal(state.arcs.length, 0, "it is over");
  assert.equal(state.resolved.length, 1);
  assert.equal(state.resolved[0].title, "The Gulf Refinery Fallout");
});

test("only this month's votes are read", () => {
  const acted = domainsActedOn({
    month: 4, term: 1,
    voteLog: [passedVote("economy", { month: 3 }), passedVote("health", { month: 4 })],
  }, 4, 1);
  assert.deepEqual([...acted], ["health"]);
});

test("a vote from a previous term is not this term's work", () => {
  const acted = domainsActedOn({
    month: 1, term: 2,
    voteLog: [passedVote("economy", { month: 1, term: 1 })],
  }, 1, 2);
  assert.equal(acted.size, 0);
});

// ---------------------------------------------------------------------------
// The country the member cannot steer
// ---------------------------------------------------------------------------

test("the economy moves on its own", () => {
  const before = house({ month: 1 });
  const after = advanceNation(structuredClone(before));
  const moved = ["gdpGrowth", "unemployment", "inflation", "debt"]
    .some((k) => after.economy[k] !== before.economy[k]);
  assert.ok(moved, "a frozen economy was the whole problem");
});

test("unresolved economic problems drag the economy down", () => {
  const calm = advanceNation(withProblem({ month: 1 }, { severity: 1 }));
  const crisis = advanceNation(withProblem({ month: 1 }, { severity: 5 }));

  assert.ok(crisis.economy.gdpGrowth < calm.economy.gdpGrowth);
  assert.ok(crisis.economy.unemployment > calm.economy.unemployment);
});

test("a problem outside the economy does not move the economy", () => {
  const econ = advanceNation(withProblem({ month: 1 }, { severity: 5, domain: "economy" }));
  const justice = advanceNation(withProblem({ month: 1 }, { severity: 5, domain: "justice" }));
  assert.ok(justice.economy.gdpGrowth > econ.economy.gdpGrowth);
});

test("the President wears a country that is going badly", () => {
  const before = withProblem({ month: 1 }, { severity: 5 });
  const after = advanceNation(structuredClone(before));
  assert.ok(after.president.approval < before.president.approval);
});

test("a President with nothing outstanding is left alone", () => {
  const before = house({ month: 1, arcs: [] });
  const after = advanceNation(structuredClone(before));
  assert.equal(after.president.approval, before.president.approval);
});

// ---------------------------------------------------------------------------
// Next month's news
// ---------------------------------------------------------------------------

test("a new situation becomes a new problem", () => {
  const state = setSituation(house({ month: 2, arcs: [] }), {
    title: "The Grid Fails in a Cold Snap", brief: "Eleven million without power.", domain: "health",
  });
  assert.equal(state.situation.title, "The Grid Fails in a Cold Snap");
  assert.equal(state.arcs.length, 1);
  assert.equal(state.arcs[0].domain, "health");
});

test("the country carries only so many problems at once", () => {
  const full = house({
    month: 2,
    arcs: Array.from({ length: MAX_NATIONAL_ARCS }, (_, i) => ({
      id: `arc_${i + 1}`, title: `Problem ${i + 1}`, brief: "", domain: "social",
      severity: 2, bornMonth: 1, ignoredStreak: 0, status: "active", log: [],
    })),
  });
  const state = setSituation(full, { title: "One More Thing", brief: "", domain: "economy" });

  assert.equal(state.situation.title, "One More Thing", "it is still the news");
  assert.equal(state.arcs.length, MAX_NATIONAL_ARCS, "but it does not become a fourth problem");
});

test("the same story twice does not become two problems", () => {
  let state = setSituation(house({ month: 2, arcs: [] }),
    { title: "The Ports Go Out", brief: "Ninety thousand dockworkers walked.", domain: "economy" });
  state = setSituation(state,
    { title: "The Ports Go Out", brief: "Ninety thousand dockworkers walked.", domain: "economy" });
  assert.equal(state.arcs.length, 1);
});

test("a situation with no headline is not a situation", () => {
  const before = house({ month: 2 });
  const after = setSituation(structuredClone(before), { brief: "words", domain: "economy" });
  assert.equal(after.situation.title, before.situation.title);
});

test("the pool always has an answer, with or without a model", () => {
  const drawn = situationFromPool(house({ month: 3 }));
  assert.ok(drawn.title);
  assert.ok(drawn.brief);
});

// ---------------------------------------------------------------------------
// Which brain writes it
// ---------------------------------------------------------------------------

test("Classic never asks the model, even with one configured", () => {
  assert.equal(wantsWrittenSituation(house({ scenario: scenario({ events: "classic" }) }), true), false);
});

test("nothing asks the model when there is not one", () => {
  assert.equal(wantsWrittenSituation(house({ scenario: scenario({ events: "dynamic" }) }), false), false);
});

test("Dynamic always asks the model", () => {
  assert.equal(wantsWrittenSituation(house({ scenario: scenario({ events: "dynamic" }) }), true), true);
});

// ---------------------------------------------------------------------------
// Saying it out loud
// ---------------------------------------------------------------------------

test("the prompt block names the problems and how bad they are", () => {
  const text = nationSummary(withProblem({ month: 4 }, { severity: 4, ignoredStreak: 3 }));
  assert.match(text, /The Gulf Refinery Fallout/);
  assert.match(text, /severity 4\/5/);
  assert.match(text, /3 months since Congress last acted/);
  assert.match(text, /economy/);
});

test("the prompt block says who holds the chamber", () => {
  const text = nationSummary(house({ congress: { houseD: 200, houseR: 235, senateD: 48, senateR: 52 } }));
  assert.match(text, /Republicans hold this chamber/);
});

test("the floor card carries what the floor needs to show", () => {
  const card = nationCard(withProblem({ month: 2 }, { severity: 4 }));
  assert.ok(card.situation.title);
  assert.equal(card.problems.length, 1);
  assert.equal(card.problems[0].severity, 4);
  assert.equal(card.problems[0].word, "acute");
  assert.ok(card.economy);
});

// ---------------------------------------------------------------------------
// The month turning over, end to end
// ---------------------------------------------------------------------------

test("a House month leaves the country changed and the calendar spent", () => {
  const before = house({ month: 3, docket: { term: 1, month: 3, bills: [{ id: "x" }] } });
  const { state } = advanceHouseMonth(before);

  assert.equal(state.month, 4);
  assert.equal(state.docket, null, "last month's calendar is not this month's");
  assert.ok(state.arcs[0].ignoredStreak >= 1, "the country noticed nothing was done");
});

test("a Senate month does the same", () => {
  const before = { ...createSenateCareer(scenario({ office: "senate", seatState: "OH" })), month: 3 };
  before.docket = { term: 1, month: 3, bills: [] };
  const { state } = advanceSenateMonth(before);

  assert.equal(state.month, 4);
  assert.equal(state.docket, null);
});

test("a vote records what it was about, so the country can notice", () => {
  const state = house({ month: 2 });
  const bill = { id: "b1", title: "Bridges and Ports Act", axis: -0.05, domain: "economy" };
  const { state: after } = castVote(state, bill, "yes");

  assert.equal(after.voteLog[0].domain, "economy");
});

test("an old save with no country in it still rolls forward", () => {
  // Careers that predate any of this have no situation, no arcs and a frozen
  // economy. Nothing here may throw on them.
  const legacy = house({ month: 5 });
  delete legacy.situation;
  delete legacy.arcs;
  delete legacy.resolved;

  const { state } = advanceHouseMonth(legacy);
  assert.equal(state.month, 6);
  assert.deepEqual(state.arcs, []);
});

// ---------------------------------------------------------------------------
// Pacing stays the engine's business
// ---------------------------------------------------------------------------

test("how busy the floor is does not depend on who writes the bills", () => {
  const state = house({ month: 7 });
  assert.equal(docketSize(state), docketSize(state), "and it is deterministic");
  assert.ok(docketSize(state) >= 0 && docketSize(state) <= 4);
});

// ---------------------------------------------------------------------------
// Naming the problem a bill answers
//
// Matching on domain alone let a bank rescue tagged "security" ease nothing at
// all, silently, while the problem escalated as though Congress had ignored it.
// ---------------------------------------------------------------------------

test("a bill that names the problem it answers eases that problem", () => {
  const state = advanceNation(withProblem({
    month: 1,
    // Tagged the wrong domain on purpose — the id is what should carry it.
    voteLog: [passedVote("security", { addresses: "arc_1" })],
  }, { severity: 3, domain: "economy", ignoredStreak: 2 }));

  assert.equal(state.arcs[0].severity, 2);
  assert.equal(state.arcs[0].ignoredStreak, 0);
});

test("a bill naming nothing still eases by domain, so the pool keeps working", () => {
  // Hand-written pool bills have no `addresses` and never will.
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("economy", { addresses: null })],
  }, { severity: 3, domain: "economy" }));

  assert.equal(state.arcs[0].severity, 2);
});

test("naming a problem that is not this one does not ease this one", () => {
  const state = advanceNation(withProblem({
    month: 1, voteLog: [passedVote("justice", { addresses: "arc_9" })],
  }, { severity: 3, domain: "economy", ignoredStreak: 1 }));

  assert.equal(state.arcs[0].severity, 4, "it escalated, as an ignored problem should");
});

// ---------------------------------------------------------------------------
// Problems accumulate rather than churn
// ---------------------------------------------------------------------------

test("a new problem is born worth two bills, not one", () => {
  // At severity 1 the country churned: every problem was one vote from over,
  // so severity never passed 2 and the escalation mechanic never engaged.
  const state = setSituation(house({ month: 2, arcs: [] }), {
    title: "A Cluster in Three Cities", brief: "A respiratory illness.", domain: "health",
  });
  assert.equal(state.arcs[0].severity, 2);

  const after = advanceNation({ ...state, month: 2, voteLog: [passedVote("health", { month: 2 })] });
  assert.equal(after.arcs.length, 1, "one bill eases it");
  assert.equal(after.arcs[0].severity, 1, "it does not finish it");

  // And a second one does.
  const done = advanceNation({ ...after, month: 3, voteLog: [passedVote("health", { month: 3 })] });
  assert.equal(done.arcs.length, 0);
});

// ---------------------------------------------------------------------------
// Changing the subject
//
// Six straight months of one story is what a small model writes when asked to
// grow the next one out of the last. The engine takes the choice away from it.
// ---------------------------------------------------------------------------

test("the news is steered off the subject it is already on", () => {
  const stuck = house({
    month: 4,
    situation: { title: "Banks Offline", brief: "", domain: "economy" },
    newsLog: [
      { title: "Cyber Attack Shuts Down Banks", domain: "economy" },
      { title: "Banks Remain Offline", domain: "economy" },
      { title: "Banks Offline", domain: "economy" },
    ],
  });
  assert.notEqual(steerDomain(stuck), "economy",
    "three months on one subject must not produce a fourth");
});

test("the steer is deterministic", () => {
  const state = house({ month: 6 });
  assert.equal(steerDomain(state), steerDomain(state));
});

test("the steer always names a domain the game knows", () => {
  const seen = new Set();
  for (let m = 1; m <= 24; m++) seen.add(steerDomain(house({ month: m })));
  for (const d of seen) assert.ok(ARC_DOMAIN_IDS.includes(d), `${d} is a real domain`);
});

test("across a term the news covers real ground", () => {
  // The defect being guarded: one subject for the whole career.
  let state = house({ month: 1 });
  const domains = new Set();
  for (let m = 1; m <= 18; m++) {
    state = { ...state, month: m };
    const d = steerDomain(state);
    domains.add(d);
    state = setSituation(state, { title: `Story ${m}`, brief: "", domain: d });
  }
  assert.ok(domains.size >= 4, `covered ${domains.size} domains in 18 months`);
});

test("the subjects already used are handed back for the prompt to avoid", () => {
  let state = house({ month: 1, newsLog: [] });
  state = setSituation(state, { title: "The Ports Go Out", brief: "", domain: "economy" });
  state = setSituation(state, { title: "A Cluster in Three Cities", brief: "", domain: "health" });

  assert.deepEqual(recentNewsSubjects(state).slice(-2),
    ["The Ports Go Out", "A Cluster in Three Cities"]);
});

test("the news log does not grow without bound", () => {
  let state = house({ month: 1, newsLog: [] });
  for (let i = 0; i < 20; i++) {
    state = setSituation(state, { title: `Story ${i}`, brief: "", domain: "social" });
  }
  assert.ok(state.newsLog.length <= 6);
});

// ---------------------------------------------------------------------------
// A problem left alone until it breaks open
//
// Without this the country saturates: severity caps at 5, three problems is the
// whole slate, and a chamber that legislates about none of them ends up with
// three permanent crises that can never resolve and never make room.
// ---------------------------------------------------------------------------

const maxed = (o = {}, arc = {}) => withProblem(o, { severity: 5, ignoredStreak: 1, ...arc });

test("a problem at the top of the scale, ignored again, blows up", () => {
  const state = advanceNation(maxed({ month: 9 }));

  assert.equal(state.arcs.length, 0, "it is no longer a live problem");
  assert.ok(state.detonation, "it is now an event");
  assert.equal(state.detonation.arc.title, "The Gulf Refinery Fallout");
  assert.equal(state.scars.length, 1, "and it is on the record permanently");
});

test("blowing up frees the slot it was occupying", () => {
  const full = house({
    month: 9,
    arcs: Array.from({ length: MAX_NATIONAL_ARCS }, (_, i) => ({
      id: `arc_${i + 1}`, title: `Problem ${i + 1}`, brief: "", domain: "social",
      severity: i === 0 ? 5 : 2, bornMonth: 1, ignoredStreak: 1, status: "active", log: [],
    })),
  });
  const state = advanceNation(full);
  assert.equal(state.arcs.length, MAX_NATIONAL_ARCS - 1);

  // Which means the country can take on something new again.
  const withNew = setSituation(state, { title: "A New Thing", brief: "", domain: "economy" });
  assert.equal(withNew.arcs.length, MAX_NATIONAL_ARCS);
});

test("it does not blow up on a month it was not due to escalate", () => {
  const state = advanceNation(maxed({ month: 9 }, { ignoredStreak: 0 }));
  assert.equal(state.detonation, null);
  assert.equal(state.arcs.length, 1);
  assert.equal(state.arcs[0].severity, 5);
});

test("a problem the chamber is working on never blows up", () => {
  const state = advanceNation(maxed({
    month: 1, voteLog: [passedVote("economy")],
  }));
  assert.equal(state.detonation, null);
  assert.equal(state.arcs[0].severity, 4, "it came down instead");
});

test("it costs the country, not the member", () => {
  const before = maxed({ month: 9 });
  const approval = before.approval;
  const leadership = before.leadership;
  const after = advanceNation(structuredClone(before));

  assert.ok(after.president.approval < before.president.approval, "the President wears it");
  assert.ok(after.economy.unemployment > before.economy.unemployment);
  assert.equal(after.approval, approval, "the member holds one vote of 435 and is not charged for this");
  assert.equal(after.leadership, leadership);
});

test("what blew up does not come straight back as a fresh problem", () => {
  const blown = advanceNation(maxed({ month: 9 }));
  const state = setSituation(blown, {
    title: "The Gulf Refinery Fallout — It Blows Up", brief: "…", domain: "economy", detonated: true,
  });

  assert.equal(state.arcs.length, 0, "it is a scar, not a new problem");
  assert.match(state.situation.title, /Blows Up/);
});

test("the floor is shown what was left to break open", () => {
  const card = nationCard(advanceNation(maxed({ month: 9 })));
  assert.equal(card.scars.length, 1);
  assert.equal(card.scars[0].title, "The Gulf Refinery Fallout");
  assert.ok(card.scars[0].monthsActive >= 1);
});
