import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyJeopardy, tickJeopardy, removalVote, caseStrength, ARTICLE_SOURCES,
} from "../src/impeachment.js";
import { createGame, applyResult } from "../src/gameEngine.js";
import { dismiss } from "../src/institutions.js";
import { createArc } from "../src/arcs.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "../src/states.js";

function newState({ independence = 50, scandal = true, ...over } = {}) {
  const state = createGame({
    presidentName: "Test President",
    party: "Republican",
    ideologyAxis: 0.45,
    era: "A test era.",
    startApproval: 45,
    startYear: 2025,
    difficulty: "hard",
    congress: { house: 207, senate: 47 }, // the opposition holds both chambers
  });
  state.institutions.fbi = {
    vacant: false, appointedByYou: false, monthsRemaining: 100,
    holder: { name: "Director Vance", competence: 80, loyalty: 20, independence },
  };
  if (scandal) {
    state.arcs = [{
      ...createArc({ id: "arc_1", title: "Contracts Steered to a Donor",
        brief: "A donor got the contract.", domain: "justice", month: 1 }),
      severity: 4,
    }];
  }
  return { ...state, ...over };
}

const senateRoster = (s) => buildCongress(s, STATES).senate;

// --- The Bureau ------------------------------------------------------------

test("an independent Director investigates far faster than a loyalist", () => {
  const pace = (independence) => {
    let s = newState({ independence });
    for (let m = 0; m < 4; m++) s = applyResult(s, "Routine administration.", { approvalChange: 0, analysis: "" });
    return s.jeopardy.investigation?.progress ?? 100;
  };
  const loyalist = pace(15);
  const independent = pace(88);
  assert.ok(independent > loyalist * 1.5,
    `independence must matter: loyalist ${loyalist}, independent ${independent}`);
});

test("a completed investigation becomes an article", () => {
  let s = newState({ independence: 95 });
  let referred = false;
  for (let m = 0; m < 14 && !referred; m++) {
    s = applyResult(s, "Routine administration.", { approvalChange: 0, analysis: "" });
    referred = s.jeopardy.articles.some((a) => a.source === "investigation");
  }
  assert.ok(referred, "an investigation must eventually produce an article");
});

test("a clean, stable presidency is never investigated", () => {
  let s = newState({ scandal: false, independence: 95 });
  s.stability = 80;
  for (let m = 0; m < 12; m++) {
    s.stability = 80; // keep it healthy
    s = applyResult(s, "A quiet month of ordinary administration.", { approvalChange: 0, analysis: "" });
  }
  assert.equal(s.jeopardy.investigation, null);
  assert.equal(s.jeopardy.articles.filter((a) => a.source === "investigation").length, 0);
});

test("firing the Director mid-investigation is itself an article", () => {
  let s = newState({ independence: 90 });
  // Get an investigation open.
  for (let m = 0; m < 6 && !s.jeopardy.investigation; m++) {
    s = applyResult(s, "Routine administration.", { approvalChange: 0, analysis: "" });
  }
  assert.ok(s.jeopardy.investigation, "fixture needs a live investigation");

  const fired = dismiss(s, "fbi");
  assert.equal(fired.state.jeopardy.obstructed, true, "the dismissal must be flagged");

  const after = applyResult(fired.state, "Moving on.", { approvalChange: 0, analysis: "" });
  const obstruction = after.jeopardy.articles.find((a) => a.source === "obstruction");
  assert.ok(obstruction, "firing the investigator must produce an article");
  assert.equal(obstruction.weight, ARTICLE_SOURCES.obstruction.weight);
  assert.ok(obstruction.weight > ARTICLE_SOURCES.scandal.weight,
    "the cover-up should weigh more than the thing covered up");
});

// --- The votes -------------------------------------------------------------

test("the opposition convicts readily and your own party does not", () => {
  const s = newState();
  s.approval = 60;
  const vote = removalVote(senateRoster(s), s, 0.5);
  // The president's party holds 47 seats here, so 53 are opposition.
  assert.ok(vote.yes >= 45 && vote.yes <= 60, `expected roughly the opposition, got ${vote.yes}`);
  assert.ok(!vote.convicts, "the opposition alone cannot reach two thirds");
});

test("popularity is armour", () => {
  const s = newState();
  const popular = { ...s, approval: 70 };
  const collapsed = { ...s, approval: 20 };
  const roster = senateRoster(s);
  assert.ok(removalVote(roster, collapsed, 0.9).yes > removalVote(roster, popular, 0.9).yes,
    "a collapsed presidency must lose its own party");
});

test("conviction is reachable, but needs a collapsed presidency and a real case", () => {
  const s = newState();
  const roster = senateRoster(s);
  assert.ok(!removalVote(roster, { ...s, approval: 60 }, 0.4).convicts, "a weak case must not convict");
  assert.ok(!removalVote(roster, { ...s, approval: 22 }, 0.8).convicts, "a strong case alone must not convict");
  assert.ok(removalVote(roster, { ...s, approval: 22 }, 1.0).convicts,
    "a collapsed presidency with an overwhelming case must be removable");
});

test("a caucus does not flip as one block", () => {
  // The failure this guards against: every senator crossing at the same
  // instant, so the tally jumps from opposition-only straight to unanimous.
  const s = newState();
  const roster = senateRoster(s);
  const tallies = [0.5, 0.7, 0.85, 1.0].map((strength) =>
    removalVote(roster, { ...s, approval: 25 }, strength).yes);
  const jumps = tallies.slice(1).map((v, i) => v - tallies[i]);
  assert.ok(Math.max(...jumps) < 40, `a caucus flipped as a block: ${tallies.join(" → ")}`);
  assert.ok(tallies.at(-1) > tallies[0], "a stronger case must peel off more votes");
});

// --- The pipeline ----------------------------------------------------------

test("enough articles force a House vote", () => {
  const s = newState();
  s.jeopardy = emptyJeopardy();
  s.jeopardy.articles = [
    { source: "investigation", title: "x", detail: "x", weight: 3, month: 1, term: 1 },
    { source: "scandal", title: "y", detail: "y", weight: 2, month: 2, term: 1 },
  ];
  assert.equal(caseStrength(s.jeopardy), 0.5);

  const events = tickJeopardy(s, "Routine administration.");
  assert.ok(s.jeopardy.houseVote, "the House must actually vote");
  assert.ok(events.some((e) => e.kind === "impeached" || e.kind === "house_failed"));
});

test("an impeached president is tried, and acquittal costs but does not end it", () => {
  const s = newState();
  s.approval = 55;
  s.jeopardy = { ...emptyJeopardy(), status: "impeached", trialMonth: s.month,
    articles: [{ source: "scandal", title: "x", detail: "x", weight: 5, month: 1, term: 1 }] };

  const before = s.approval;
  const events = tickJeopardy(s, "Routine administration.");
  assert.ok(s.jeopardy.senateVote, "the Senate must vote");

  if (s.jeopardy.senateVote.convicts) {
    assert.equal(s.over, true);
    assert.equal(s.ending.type, "removed");
    return;
  }
  assert.equal(s.over, false, "an acquitted president stays in office");
  assert.equal(s.jeopardy.status, "acquitted");
  assert.equal(s.jeopardy.acquittals, 1);
  assert.deepEqual(s.jeopardy.articles, [], "the articles are spent");
  assert.ok(s.approval < before, "surviving is not free");
  assert.ok(events.some((e) => e.kind === "acquitted"));
});

test("a dissolved Congress cannot impeach anybody", () => {
  const s = newState({ congressDissolved: true });
  s.jeopardy = { ...emptyJeopardy(), articles: [
    { source: "obstruction", title: "x", detail: "x", weight: 4, month: 1, term: 1 },
    { source: "scandal", title: "y", detail: "y", weight: 2, month: 1, term: 1 },
  ] };
  tickJeopardy(s, "Rule by decree.");
  assert.equal(s.jeopardy.houseVote, null, "there is no House left to vote");
});

test("taking the vote from half the country is an article on its own", () => {
  const s = newState({ scandal: false });
  s.electorate = { excluded: "f", since: 4 };
  tickJeopardy(s, "Routine administration.");
  assert.ok(s.jeopardy.articles.some((a) => a.source === "franchise"));
});
