import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyArticles, tickArticles, articlesReady, articlesStance, voteArticles,
} from "../src/articles.js";
import { historicalHouseVerdict } from "../src/houseVerdict.js";
import { createHouseCareer } from "../src/house.js";

const scenario = (o = {}) => ({
  office: "house", presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, ideology: "Social Democrat", district: "OH-6", ...o,
});
const game = ({ scenario: sc, ...rest } = {}) => ({ ...createHouseCareer(scenario(sc)), ...rest });

/** A president in enough trouble that the House has to vote. */
const ready = (o = {}) => ({
  ...game(o),
  jeopardy: {
    articles: [{ id: "obstruction", weight: 4, title: "Obstruction" }, { id: "finance", weight: 3, title: "Finance" }],
    weight: 7, status: "ready", voted: false, houseVote: null,
  },
});

// --- The president's own trouble -------------------------------------------

test("a career starts with no articles against anybody", () => {
  const j = emptyArticles();
  assert.equal(j.articles.length, 0);
  assert.equal(articlesReady({ jeopardy: j }), false);
});

test("a weak president leaks and a strong one does not", () => {
  const count = (approval) => {
    let s = { ...game(), president: { ...game().president, approval } };
    let opened = 0;
    for (let m = 1; m <= 48; m++) {
      const out = tickArticles({ ...s, month: m });
      s = out.state;
      if (out.event) opened++;
    }
    return opened;
  };
  assert.ok(count(22) > count(62), "trouble finds an unpopular president");
});

test("enough articles put it on the floor", () => {
  let s = { ...game(), president: { ...game().president, approval: 20 } };
  for (let m = 1; m <= 48; m++) s = tickArticles({ ...s, month: m }).state;
  if (s.jeopardy.weight >= 5) assert.equal(s.jeopardy.status, "ready");
});

// --- Where everyone stands --------------------------------------------------

test("your caucus position is simply whether the President is theirs", () => {
  const s = ready();
  const own = { ...s, president: { ...s.president, party: s.scenario.party } };
  const other = { ...s, president: { ...s.president, party: "Republican", axis: 0.5 } };
  assert.equal(articlesStance(own).party.position, "no");
  assert.equal(articlesStance(other).party.position, "yes");
});

test("a district that voted for the President does not want them impeached", () => {
  const s = ready({ scenario: { district: "WV-2" } });   // a very Republican seat
  const stance = articlesStance({ ...s, president: { ...s.president, party: "Republican", axis: 0.5 } });
  assert.equal(stance.district.position, "no");
});

test("the vote splits caucus from district, which is the point", () => {
  const s = ready({ scenario: { district: "WV-2" } });
  const stance = articlesStance({ ...s, president: { ...s.president, party: "Republican", axis: 0.5 } });
  assert.notEqual(stance.party.position, stance.district.position);
});

// --- Casting it -------------------------------------------------------------

test("you can only vote when there is something to vote on", () => {
  assert.equal(voteArticles(game(), "yes").rejected, true);
  assert.equal(voteArticles(ready(), "maybe").rejected, true);
});

test("the vote moves both numbers, hard", () => {
  const s = ready();
  const out = voteArticles(s, "yes");
  assert.ok(Math.abs(out.state.approval - s.approval) > 3, "this is not an ordinary bill");
  assert.ok(Math.abs(out.state.leadership - s.leadership) > 3);
});

test("the House reaches a verdict and it goes on your record forever", () => {
  const out = voteArticles(ready(), "yes");
  assert.equal(typeof out.result.impeached, "boolean");
  assert.equal(out.state.jeopardy.voted, true);
  const entry = out.state.voteLog.slice(-1)[0];
  assert.equal(entry.impeachment, true);
  assert.ok(/Impeachment of President/.test(entry.title));
});

test("you cannot vote twice on the same articles", () => {
  const first = voteArticles(ready(), "yes");
  assert.equal(voteArticles(first.state, "no").rejected, true);
});

test("abstaining is read as an answer", () => {
  const out = voteArticles(ready(), "abstain");
  assert.ok(/not vote/.test(out.result.note));
  assert.ok(out.state.approval < ready().approval);
});

// --- The verdict on a member ------------------------------------------------

test("a member is judged as a member, not as a president", () => {
  const v = historicalHouseVerdict(game());
  assert.ok(v.score >= 0 && v.score <= 100);
  assert.ok(v.title && v.summary && v.ending);
  assert.ok(!/presiden/i.test(v.summary), "a member never had a presidency");
  assert.ok(v.district && v.terms >= 1);
});

test("longevity, legislation and rank all count", () => {
  const nobody = game();
  const somebody = {
    ...game(),
    seat: { ...game().seat, seniority: 7 },
    rank: "speaker", committee: "rules",
    sponsored: [{ passed: true, reachedFloor: true }, { passed: true, reachedFloor: true }],
    voteLog: Array.from({ length: 40 }, (_, i) => ({ withDistrict: i % 2 === 0, withParty: i % 3 === 0 })),
  };
  assert.ok(historicalHouseVerdict(somebody).score > historicalHouseVerdict(nobody).score);
  assert.ok(historicalHouseVerdict(somebody).findings.some((f) => /Speaker/.test(f.text)));
});

test("holding hostile ground is worth more than holding a safe seat", () => {
  const base = { ...game({ scenario: { district: "WV-2" } }), seat: { ...game({ scenario: { district: "WV-2" } }).seat, seniority: 4 } };
  const safe = { ...game({ scenario: { district: "MA-1" } }), seat: { ...game({ scenario: { district: "MA-1" } }).seat, seniority: 4 } };
  assert.ok(historicalHouseVerdict(base).score > historicalHouseVerdict(safe).score);
});

test("the impeachment vote leads the record it belongs to", () => {
  const s = { ...game(), voteLog: [{ impeachment: true, vote: "yes", withParty: false, withDistrict: true }] };
  assert.ok(historicalHouseVerdict(s).findings.some((f) => /President of the United States/.test(f.text)));
});

test("every finding is about something that happened", () => {
  const v = historicalHouseVerdict({ ...game(), seat: { ...game().seat, seniority: 3 },
    sponsored: [{ passed: true, reachedFloor: true }],
    voteLog: [{ withDistrict: true, withParty: true }] });
  for (const f of v.findings) assert.ok(f.text.length > 12);
});

test("the verdict is deterministic", () => {
  const s = game();
  assert.deepEqual(historicalHouseVerdict(s), historicalHouseVerdict(s));
});
