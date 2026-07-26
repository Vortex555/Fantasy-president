import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, tryParseModelJson } from "../src/ai/json.js";

/**
 * Every input here is a real failure shape from a small local model, not a
 * hypothetical. The hosted models never do any of this.
 */

test("clean JSON parses, obviously", () => {
  assert.deepEqual(parseModelJson('{"approvalChange":-2.5}'), { approvalChange: -2.5 });
});

test("a code fence is not part of the answer", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('```\n{"a":1}\n```'), { a: 1 });
});

test("commentary either side of the object is discarded", () => {
  assert.deepEqual(parseModelJson('Here is the JSON you asked for:\n{"a":1}\nHope that helps!'), { a: 1 });
});

test("a trailing comma does not lose the whole turn", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
});

test("smart quotes from a model that thinks it is writing prose", () => {
  assert.deepEqual(parseModelJson('{“a”:1}'), { a: 1 });
});

test("NaN is not a number as far as JSON is concerned", () => {
  assert.deepEqual(parseModelJson('{"a":NaN,"b":2}'), { a: null, b: 2 });
});

test("a response truncated mid-array still yields what arrived", () => {
  const cut = '{"approvalChange":-3,"press":[{"outlet":"The Ledger","lean":"left","headline":"A Bad Month"},{"outlet":"Wire"';
  const out = parseModelJson(cut);
  assert.equal(out.approvalChange, -3);
  assert.ok(Array.isArray(out.press));
  assert.equal(out.press[0].outlet, "The Ledger");
});

test("a response truncated mid-string does not take the object with it", () => {
  const cut = '{"analysis":"The administration began implementing the dir';
  const out = parseModelJson(cut);
  assert.equal(typeof out, "object");
});

test("newlines inside a string are tolerated", () => {
  const out = parseModelJson('{"analysis":"line one\nline two"}');
  assert.ok(/line one/.test(out.analysis));
});

test("genuine nonsense throws, so the caller can fall back", () => {
  assert.throws(() => parseModelJson("I'm sorry, I can't help with that."));
  assert.equal(tryParseModelJson("nope"), null);
});

test("an array is not an object and is not accepted as one", () => {
  assert.throws(() => parseModelJson("[1,2,3]"));
});
