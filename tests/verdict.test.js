import test from "node:test";
import assert from "node:assert/strict";

import { historicalVerdict } from "../src/verdict.js";
import { createGame } from "../src/gameEngine.js";

const game = (o = {}) => ({
  ...createGame({
    presidentName: "Ruth Ellery", party: "Democrat", startYear: 2025,
    startApproval: 51, ideologyAxis: -0.35, ideology: "Social Democrat",
  }), ...o,
});

test("a verdict is scored, ranked and evidenced", () => {
  const v = historicalVerdict(game());
  assert.ok(v.score >= 0 && v.score <= 100);
  assert.ok(v.title && v.summary);
  assert.ok(Array.isArray(v.findings));
});

test("closing situations out beats leaving them to fester", () => {
  const closer = game({ arcs: [1, 2, 3].map((i) => ({ id: `a${i}`, status: "resolved" })) });
  const leaver = game({ arcs: [1, 2, 3].map((i) => ({ id: `a${i}`, status: "scarred" })) });
  assert.ok(historicalVerdict(closer).score > historicalVerdict(leaver).score);
});

test("history cares less about being liked than about what you fixed", () => {
  const liked = game({ approval: 70, arcs: [] });
  const effective = game({ approval: 38, arcs: [1, 2, 3, 4].map((i) => ({ id: `a${i}`, status: "resolved" })) });
  assert.ok(historicalVerdict(effective).score > historicalVerdict(liked).score);
});

test("dissolving Congress is the first line of the obituary", () => {
  const v = historicalVerdict(game({ congressDissolved: true }));
  assert.ok(v.score < 20);
  assert.ok(v.findings.some((f) => /Dissolved Congress/.test(f.text)));
});

test("taking the vote from people is never forgiven", () => {
  const v = historicalVerdict(game({ electorate: { excluded: true } }));
  assert.ok(v.findings.some((f) => /took the vote/i.test(f.text)));
  assert.ok(v.score < historicalVerdict(game()).score);
});

test("winning elections counts for something", () => {
  const won = game({ elections: [{ term: 1 }, { term: 2 }] });
  assert.ok(historicalVerdict(won).score > historicalVerdict(game()).score);
});

test("a midterm rout and a cabinet revolt both appear in the record", () => {
  const v = historicalVerdict(game({
    midterms: [{ term: 1, houseSwing: -44, senateSwing: -6 }],
    twentyFifthSurvived: 1,
  }));
  assert.ok(v.findings.some((f) => /rout/.test(f.text)));
  assert.ok(v.findings.some((f) => /unfit/.test(f.text)));
});

test("statehouses in revolt are part of the verdict", () => {
  const codes = Object.keys(game().governors);
  const v = historicalVerdict(game({ governors: Object.fromEntries(codes.map((c) => [c, 90])) }));
  assert.ok(v.findings.some((f) => /revolt/.test(f.text)));
});

test("every finding points at something specific, never at nothing", () => {
  const v = historicalVerdict(game({
    arcs: [{ id: "a", status: "resolved" }, { id: "b", status: "scarred" }],
    elections: [{ term: 1 }],
    billLog: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, outcome: "signed" })),
  }));
  for (const f of v.findings) {
    assert.ok(/\d/.test(f.text), `finding has no specifics: ${f.text}`);
    assert.equal(typeof f.good, "boolean");
  }
});

test("the verdict is deterministic", () => {
  const s = game({ approval: 44 });
  assert.deepEqual(historicalVerdict(s), historicalVerdict(s));
});
