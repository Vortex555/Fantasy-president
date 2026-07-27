import test from "node:test";
import assert from "node:assert/strict";

import { runLadderRace } from "../src/ladderRace.js";
import { newCareer, earnRecognition } from "../src/career.js";

/**
 * A race for an office you do not hold.
 *
 * The point of every test here is the same: a career is worth points, and a
 * stranger asking for a promotion is not. What is being checked is that the
 * four things a career carries actually show up in the margin, and that the
 * result decomposes into bars the existing election screen can draw.
 */

const scenario = {
  presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025,
  ideologyAxis: -0.35, age: "40s",
};

const opponent = { name: "Gov. Whitfield", party: "Republican", recognition: 71, axis: 0.45 };

const base = {
  office: "house", scenario,
  economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3, debt: 34 },
  arcs: [], voteLog: [], sponsored: [],
  president: { party: "Republican", approval: 47 },
};

const stranger = () => newCareer(scenario);

const veteran = () => {
  let c = earnRecognition(newCareer(scenario), {
    office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 },
  });
  return { ...c, warChest: 12, standing: 82, recognition: { ...c.recognition, national: 22 } };
};

const run = (career, extra = {}) => runLadderRace(career, base, {
  target: "senate", where: "OH", opponent, runOn: "record", spend: {}, ...extra,
});

test("a stranger loses a statewide race to somebody the state has heard of", () => {
  const out = run(stranger());
  assert.equal(out.won, false);
  assert.ok(out.recognition < 0, "being unknown is a cost, and the bar shows it");
});

test("a career is worth real points against the same governor", () => {
  const nobody = run(stranger());
  const somebody = run(veteran(), { spend: { OH: 12 } });

  assert.ok(somebody.margin > nobody.margin + 5,
    `three terms, money and the party should be worth something: ${nobody.margin} → ${somebody.margin}`);
  assert.ok(somebody.recognition > nobody.recognition, "they have heard of you now");
  assert.ok(somebody.money > 0, "money moves the margin");
  assert.ok(somebody.establishment > 0, "so does the establishment");
});

test("a race breaks down into named factors the election screen can already draw", () => {
  const out = run(stranger());
  for (const key of ["margin", "won", "ground", "recognition", "record", "money", "establishment", "wave", "incumbency"]) {
    assert.ok(key in out, `missing ${key}`);
    if (key !== "won") assert.ok(Number.isFinite(out[key]), `${key} is not a number`);
  }
  assert.equal(typeof out.won, "boolean");
});

test("the ground under a race is the constituency's own politics", () => {
  // Ohio leans Republican, so a Democrat starts behind and a Republican ahead.
  const dem = run(stranger());
  const rep = runLadderRace({ ...stranger(), party: "Republican" }, base,
    { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  assert.ok(dem.ground < 0);
  assert.ok(rep.ground > 0);
});

test("a party that does not want you makes you win a primary first", () => {
  const out = run({ ...stranger(), standing: 21 });
  assert.equal(out.primary.contested, true);
  assert.ok(out.primary.note.length > 10);
  assert.equal(run(veteran()).primary.contested, false);
});

test("what you run on changes what your record is worth", () => {
  // A record that suits the new electorate should help more when you run on it.
  const withRecord = {
    ...base,
    voteLog: [
      { id: "a", title: "A", axis: 0.4, vote: "yes", month: 2, term: 1 },
      { id: "b", title: "B", axis: 0.3, vote: "yes", month: 5, term: 1 },
    ],
  };
  const onRecord = runLadderRace(veteran(), withRecord,
    { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  const onThem = runLadderRace(veteran(), withRecord,
    { target: "senate", where: "OH", opponent, runOn: "opponent", spend: {} });
  assert.notEqual(onRecord.record, onThem.record);
  assert.ok(Math.abs(onRecord.record) > Math.abs(onThem.record),
    "running on your record leans on it harder, for good or ill");
});

test("you only carry incumbency into a race you did not have to resign for", () => {
  const reaching = run(veteran());
  assert.equal(reaching.incumbency, 0, "the Senate seat is not yours to be incumbent in");

  const defending = runLadderRace(veteran(), { ...base, office: "senate", seat: { seniority: 2 } },
    { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  assert.ok(defending.incumbency > 0);
});

test("a race is deterministic — the same career runs the same race twice", () => {
  const c = veteran();
  assert.deepEqual(run(c), run(c));
});

test("money's first job is introducing you, not persuading anybody", () => {
  // The design claim: 95% of the state has never heard of you, and closing that
  // gap is what the war chest is for.
  const broke = run(veteran());
  const funded = run(veteran(), { spend: { OH: 12 } });
  // A serious statewide campaign should close a real share of the gap between
  // what the state knows of you and what it knows of the other candidate.
  const gap = funded.theirs - broke.mine;
  assert.ok(funded.mine - broke.mine > gap * 0.3,
    `a statewide campaign should make you known: ${broke.mine} → ${funded.mine} against a gap of ${gap}`);
  assert.ok(funded.mine < funded.theirs,
    "but no amount of money makes a newcomer a household name overnight");
  assert.ok(funded.recognition > broke.recognition, "and the gap closing shows in the margin");
});

test("the ladder is climbable — there is a route that actually wins", () => {
  // If this ever fails, advancement has become impossible and the mode is dead.
  const friendly = { name: "State Sen. Reyes", party: "Republican", recognition: 38 };
  const out = runLadderRace({ ...veteran(), standing: 70 }, base, {
    target: "senate", where: "IL", opponent: friendly, runOn: "record", spend: { IL: 10 },
  });
  assert.equal(out.won, true,
    `a serious candidate on friendly ground against a weak opponent must be able to win: ${out.margin}`);
});

test("hostile ground against a household name is meant to be lost", () => {
  // The mirror of the test above: the ladder is climbable, not a formality.
  const out = run({ ...veteran(), standing: 82 }, { spend: { OH: 12 } });
  assert.equal(out.won, false);
  assert.ok(out.margin > -6, "but close enough to be worth having run");
});
