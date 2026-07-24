import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceArcs,
  acceptProposal,
  arcFromChecks,
  createArc,
  describeArcs,
  detonationEvent,
  inferDomain,
  mockJudgeArcs,
  normalizeDomain,
  nextArcId,
  ARC_DOMAINS,
  MAX_ACTIVE_ARCS,
  MAX_SEVERITY,
} from "../src/arcs.js";
import { createGame, applyResult } from "../src/gameEngine.js";

// createArc deliberately clamps birth severity, so build higher ones directly.
function makeArc(over = {}) {
  const base = createArc({
    id: "arc_1",
    title: "Refinery Fallout",
    brief: "Fuel prices stay elevated and truckers are threatening a slowdown.",
    domain: "economy",
    severity: 1,
    month: 1,
  });
  return { ...base, ...over };
}

const run = (arcs, verdicts, extra = {}) =>
  advanceArcs({ arcs, verdicts, month: 4, ...extra });

// ---------------------------------------------------------------------------
// The escalation ladder
// ---------------------------------------------------------------------------

test("an ignored arc escalates one step", () => {
  const out = run([makeArc({ severity: 2 })], [{ id: "arc_1", addressed: 0 }]);
  assert.equal(out.arcs[0].severity, 3);
  assert.equal(out.arcs[0].status, "active");
  assert.equal(out.arcs[0].ignoredStreak, 1);
  assert.equal(out.events[0].kind, "escalated");
});

test("an arc with no verdict at all is treated as ignored", () => {
  const out = run([makeArc({ severity: 2 })], []);
  assert.equal(out.arcs[0].severity, 3);
});

test("verdicts for unknown arc ids do not throw or leak", () => {
  const out = run([makeArc({ severity: 2 })], [{ id: "arc_99", addressed: 3 }]);
  assert.equal(out.arcs.length, 1);
  assert.equal(out.arcs[0].severity, 3, "the real arc was still ignored");
});

test("gesturing at an arc holds it steady and resets the streak", () => {
  const out = run([makeArc({ severity: 3, ignoredStreak: 2 })], [{ id: "arc_1", addressed: 1 }]);
  assert.equal(out.arcs[0].severity, 3);
  assert.equal(out.arcs[0].ignoredStreak, 0);
  assert.equal(out.events[0].kind, "holding");
});

test("meaningfully addressing an arc walks severity back down", () => {
  const out = run([makeArc({ severity: 4 })], [{ id: "arc_1", addressed: 2 }]);
  assert.equal(out.arcs[0].severity, 3);
  assert.equal(out.arcs[0].status, "active");
  assert.equal(out.events[0].kind, "eased");
});

test("working a severity-1 arc down to zero resolves it", () => {
  const out = run([makeArc({ severity: 1 })], [{ id: "arc_1", addressed: 2 }]);
  assert.equal(out.arcs[0].status, "resolved");
});

test("decisively resolving an arc pays out in proportion to what was cleared", () => {
  const small = run([makeArc({ severity: 1 })], [{ id: "arc_1", addressed: 3 }]);
  const big = run([makeArc({ severity: 4 })], [{ id: "arc_1", addressed: 3 }]);
  assert.equal(big.arcs[0].status, "resolved");
  assert.ok(big.approvalChange > small.approvalChange,
    "clearing a severity-4 arc should beat clearing a severity-1 arc");
});

test("severity is capped and never runs past the maximum", () => {
  const out = run([makeArc({ severity: MAX_SEVERITY })], [{ id: "arc_1", addressed: 1 }]);
  assert.equal(out.arcs[0].severity, MAX_SEVERITY);
});

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

test("a minor arc applies no monthly drag", () => {
  const out = run([makeArc({ severity: 1 })], [{ id: "arc_1", addressed: 1 }]);
  assert.equal(out.approvalChange, 0);
});

test("a serious arc bleeds approval every month it sits there", () => {
  const out = run([makeArc({ severity: 3 })], [{ id: "arc_1", addressed: 1 }]);
  assert.ok(out.approvalChange < 0, `expected drag, got ${out.approvalChange}`);
});

test("drag is capped so a pile-up cannot spiral", () => {
  const arcs = [1, 2, 3, 4].map((n) => makeArc({ id: `arc_${n}`, severity: MAX_SEVERITY }));
  const verdicts = arcs.map((a) => ({ id: a.id, addressed: 1 }));
  const out = run(arcs, verdicts);
  assert.ok(out.approvalChange >= -4, `drag should be capped, got ${out.approvalChange}`);
});

// ---------------------------------------------------------------------------
// Detonation and scarring
// ---------------------------------------------------------------------------

test("ignoring an arc at maximum severity detonates it", () => {
  const out = run([makeArc({ severity: MAX_SEVERITY })], [{ id: "arc_1", addressed: 0 }]);
  assert.equal(out.arcs[0].status, "detonated");
  assert.ok(out.detonation, "a detonation should be reported to the caller");
  assert.equal(out.events[0].kind, "detonated");
  assert.ok(out.approvalChange <= -6);
  assert.ok(out.stabilityChange < 0);
});

test("detonation damage lands on the arc's own domain, not everywhere", () => {
  const out = run([makeArc({ severity: MAX_SEVERITY, domain: "economy" })], [{ id: "arc_1", addressed: 0 }]);
  for (const id of ARC_DOMAINS.economy.stakeholders) {
    assert.ok(out.stakeholders[id] < 0, `${id} should have been hit`);
  }
  assert.equal(out.stakeholders.greens, undefined, "an unrelated bloc should be untouched");
  for (const code of ARC_DOMAINS.economy.states) {
    assert.ok(out.states[code] < 0, `${code} should have been hit`);
  }
});

test("an arc below maximum severity does not detonate", () => {
  const out = run([makeArc({ severity: 4 })], [{ id: "arc_1", addressed: 0 }]);
  assert.equal(out.detonation, null);
  assert.equal(out.arcs[0].status, "active");
});

test("a detonated arc always scars, however well it was handled", () => {
  for (const addressed of [0, 1, 2, 3]) {
    const out = run([makeArc({ severity: MAX_SEVERITY, status: "detonated" })], [{ id: "arc_1", addressed }]);
    assert.equal(out.arcs[0].status, "scarred", `addressed=${addressed} should still scar`);
  }
});

test("handling the detonation well makes the scar smaller", () => {
  const fumbled = run([makeArc({ severity: MAX_SEVERITY, status: "detonated" })], [{ id: "arc_1", addressed: 0 }]);
  const handled = run([makeArc({ severity: MAX_SEVERITY, status: "detonated" })], [{ id: "arc_1", addressed: 3 }]);
  assert.ok(handled.approvalChange > fumbled.approvalChange);
  assert.ok(handled.stakeholders.labor > fumbled.stakeholders.labor,
    "a well-handled detonation should leave less permanent damage");
});

test("a scar is permanent drag and never returns to active", () => {
  const out = run([makeArc({ status: "scarred" })], []);
  assert.equal(out.arcs[0].status, "scarred");
  assert.ok(out.approvalChange < 0, "scars keep costing you");
});

test("a resolved arc stays resolved and stops costing anything", () => {
  const out = run([makeArc({ status: "resolved" })], []);
  assert.equal(out.arcs[0].status, "resolved");
  assert.equal(out.approvalChange, 0);
});

test("the detonation briefing names the arc and how long it was left", () => {
  const out = run([makeArc({ severity: MAX_SEVERITY })], [{ id: "arc_1", addressed: 0 }]);
  const event = detonationEvent(out.detonation);
  assert.match(event.title, /Refinery Fallout/);
  assert.equal(event.detonated, true);
  assert.equal(event.fromArc, "arc_1");
});

// ---------------------------------------------------------------------------
// Births and the cap
// ---------------------------------------------------------------------------

test("the simulation's proposed arc is accepted when there is room", () => {
  const out = run([], [], { proposal: { title: "Border Standoff", brief: "It festers.", domain: "security" } });
  assert.equal(out.arcs.length, 1);
  assert.equal(out.arcs[0].domain, "security");
  assert.equal(out.events[0].kind, "opened");
});

test("a proposed arc is rejected once the desk is full", () => {
  const full = [1, 2, 3, 4].map((n) => makeArc({ id: `arc_${n}`, severity: 1 }));
  const out = run(full, full.map((a) => ({ id: a.id, addressed: 1 })), {
    proposal: { title: "One More Thing", brief: "No room.", domain: "social" },
  });
  assert.equal(out.arcs.length, MAX_ACTIVE_ARCS);
});

test("a proposed arc cannot be born already critical", () => {
  const out = run([], [], { proposal: { title: "Instant Crisis", brief: "x", domain: "economy", severity: 5 } });
  assert.ok(out.arcs[0].severity <= 2);
});

test("a garbage proposal is dropped rather than creating a junk arc", () => {
  assert.equal(acceptProposal([], null, 3), null);
  assert.equal(acceptProposal([], { brief: "no title" }, 3), null);
});

test("a bill killed in Congress leaves the problem behind as an arc", () => {
  const arc = arcFromChecks([], { congress: { status: "blocked" }, court: { status: "none" } }, "a bill funding new jobs programs", 5);
  assert.ok(arc);
  assert.equal(arc.domain, "economy");
});

test("a policy struck down by the Court leaves an arc", () => {
  const arc = arcFromChecks([], { congress: { status: "executive" }, court: { status: "struck_down" } }, "an executive order", 5);
  assert.ok(arc);
  assert.equal(arc.domain, "justice");
});

test("two blocked bills in different areas produce distinguishable arcs", () => {
  const first = arcFromChecks([], { congress: { status: "blocked" } }, "a bill funding new jobs programs", 5);
  const second = arcFromChecks([first], { congress: { status: "blocked" } }, "a bill deploying troops to the border", 6);
  assert.ok(second, "a defeat in a different area is a different problem");
  assert.notEqual(first.title, second.title);
  assert.notEqual(first.domain, second.domain);
});

test("a second defeat in the same area does not duplicate the arc", () => {
  const first = arcFromChecks([], { congress: { status: "blocked" } }, "a bill funding new jobs programs", 5);
  assert.equal(
    arcFromChecks([first], { congress: { status: "blocked" } }, "another bill on taxes and the deficit", 6),
    null,
  );
});

test("a resolved defeat can be spawned again later", () => {
  const first = arcFromChecks([], { congress: { status: "blocked" } }, "a jobs bill", 5);
  const done = { ...first, status: "resolved" };
  assert.ok(arcFromChecks([done], { congress: { status: "blocked" } }, "another jobs bill", 20));
});

test("the Court cannot stack duplicate struck-down arcs", () => {
  const first = arcFromChecks([], { court: { status: "struck_down" } }, "an executive order", 5);
  assert.equal(arcFromChecks([first], { court: { status: "struck_down" } }, "another order", 6), null);
});

test("a policy that passed cleanly leaves no arc", () => {
  assert.equal(arcFromChecks([], { congress: { status: "passed" }, court: { status: "none" } }, "a bill", 5), null);
  assert.equal(arcFromChecks([], null, "a bill", 5), null);
});

test("arc ids stay unique as arcs come and go", () => {
  assert.equal(nextArcId([]), "arc_1");
  assert.equal(nextArcId([{ id: "arc_1" }, { id: "arc_7" }]), "arc_8");
});

// ---------------------------------------------------------------------------
// Domains, prompt text, local-sim judging
// ---------------------------------------------------------------------------

test("an unknown domain falls back rather than breaking damage lookup", () => {
  assert.equal(normalizeDomain("nonsense"), "social");
  assert.equal(normalizeDomain(undefined), "social");
  const out = run([makeArc({ severity: MAX_SEVERITY, domain: "nonsense" })], [{ id: "arc_1", addressed: 0 }]);
  assert.ok(Object.keys(out.stakeholders).length > 0);
});

test("domains are inferred from the language of a policy", () => {
  assert.equal(inferDomain("deploy troops and weapons to the border"), "security");
  assert.equal(inferDomain("cut taxes and reduce the deficit"), "economy");
  assert.equal(inferDomain("negotiate a new treaty with our NATO allies"), "foreign");
});

test("the prompt block lists live arcs and flags detonated ones", () => {
  const text = describeArcs([
    makeArc({ id: "arc_1", severity: 4 }),
    makeArc({ id: "arc_2", status: "detonated" }),
    makeArc({ id: "arc_3", status: "resolved" }),
  ]);
  assert.match(text, /arc_1/);
  assert.match(text, /DETONATED/);
  assert.ok(!text.includes("arc_3"), "resolved arcs should not clutter the prompt");
  assert.match(describeArcs([]), /none/);
});

test("local-sim judging rewards a policy that actually engages the arc", () => {
  const arcs = [makeArc()];
  const engaged = mockJudgeArcs(arcs, "I will rebuild the refinery, cap fuel prices, and meet the truckers threatening a slowdown.");
  const unrelated = mockJudgeArcs(arcs, "I will nominate a new ambassador to Denmark.");
  assert.ok(engaged[0].addressed > unrelated[0].addressed);
  assert.equal(unrelated[0].addressed, 0);
});

// ---------------------------------------------------------------------------
// Integration with the turn loop
// ---------------------------------------------------------------------------

const scenario = { presidentName: "Test President", party: "Democrat", era: "now", startApproval: 52 };

test("a new game starts with a clear desk", () => {
  assert.deepEqual(createGame(scenario).arcs, []);
});

test("applyResult advances arcs and reports what moved", () => {
  const state = { ...createGame(scenario), arcs: [makeArc({ severity: 2 })] };
  const next = applyResult(state, "An unrelated policy about schools.", {
    analysis: "…",
    approvalChange: 0,
    arcs: [{ id: "arc_1", addressed: 0 }],
    nextEvent: { title: "Something Else", brief: "…" },
  });
  assert.equal(next.arcs[0].severity, 3);
});

test("a detonation seizes next month's briefing", () => {
  const state = { ...createGame(scenario), arcs: [makeArc({ severity: MAX_SEVERITY })] };
  const result = {
    analysis: "…",
    approvalChange: 0,
    arcs: [{ id: "arc_1", addressed: 0 }],
    nextEvent: { title: "A Quiet Month", brief: "Nothing much." },
  };
  const next = applyResult(state, "An unrelated policy about schools.", result);
  assert.equal(next.arcs[0].status, "detonated");
  assert.match(result.nextEvent.title, /Refinery Fallout/);
  assert.equal(result.nextEvent.detonated, true);
  assert.ok(next.approval < state.approval, "detonation should cost approval");
});

test("games saved before arcs existed still resolve a turn", () => {
  const legacy = createGame(scenario);
  delete legacy.arcs;
  const next = applyResult(legacy, "A policy.", { analysis: "…", approvalChange: 1, nextEvent: { title: "x", brief: "y" } });
  assert.ok(Array.isArray(next.arcs));
});
