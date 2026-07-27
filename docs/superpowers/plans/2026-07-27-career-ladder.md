# Career Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One continuous political career that spans offices — your record, name recognition, war chest and party standing follow you, reaching past a rung is hard rather than blocked, and losing a reach puts you in the wilderness instead of ending the save.

**Architecture:** A `career` envelope stored alongside the existing per-office `state`, which is not restructured. Two new pure modules (`src/career.js`, `src/ladderRace.js`) hold all the new logic; existing office modules gain one hook each at their term boundary. Everything is seeded and deterministic, matching the rest of the codebase.

**Tech Stack:** Node 20+ ESM, `node:test` + `node:assert/strict`, Express 5, vanilla browser JS with `localStorage`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-career-ladder-design.md`

## Global Constraints

- No new npm dependencies.
- Every function is pure and deterministic; randomness uses `seeded()` from `src/rng.js`, never `Math.random()`.
- Immutability: return new objects, never mutate arguments (`structuredClone` is the established idiom for state).
- Numbers exposed to the UI are rounded with `round1` from `src/rng.js`; percentages clamp with `clamp`.
- Test names are prose sentences describing behaviour, matching the existing suite.
- Existing saves must keep loading and playing. No office may play differently month to month.
- Files stay focused; `src/career.js` and `src/ladderRace.js` must each stay under 400 lines.
- Run `npm test` before every commit. The suite is currently 449 passing.

---

### Task 1: The ladder table and the election calendar

**Files:**
- Create: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `LADDER` (array), `officeAt(id)`, `isPresidentialYear(year)`, `isMidtermYear(year)`, `nextElectionYear(officeId, fromYear, seatClass)` → `number`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { LADDER, officeAt, isPresidentialYear, isMidtermYear, nextElectionYear } from "../src/career.js";

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
  // Every era the game ships sits correctly against it.
  for (const start of [1949, 1961, 1993, 2001, 2013, 2025]) {
    assert.equal(isPresidentialYear(start - 1), true, `${start} follows an election`);
  }
});

test("the next election for an office is the next year it is actually on the ballot", () => {
  assert.equal(nextElectionYear("house", 2029), 2030, "the whole House, every even year");
  assert.equal(nextElectionYear("president", 2029), 2032);
  // A third of the Senate each cycle: class 1 in 2030, class 2 in 2032, class 3 in 2034.
  assert.equal(nextElectionYear("senate", 2029, 1), 2030);
  assert.equal(nextElectionYear("senate", 2031, 1), 2036);
  assert.equal(nextElectionYear("senate", 2029, 2), 2032);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `Cannot find module '../src/career.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { clamp, round1, seeded } from "./rng.js";

/**
 * One political career, across every office it passes through.
 *
 * The office modules build completely different states — a House career has a
 * seat and a voting record, a presidency has a cabinet and fifty state polls —
 * and this is the layer that survives between them. Nothing here knows how an
 * office plays; it knows who you are, where you have been, and what that is
 * worth to the next electorate.
 */

/**
 * The rungs. A table rather than a switch, because the whole point of this
 * sub-project is that the six offices below the House are additions here rather
 * than rewrites everywhere.
 */
export const LADDER = [
  { id: "house", title: "US Representative", termYears: 2, constituency: "district", minAge: 25 },
  { id: "senate", title: "US Senator", termYears: 6, constituency: "state", minAge: 30 },
  { id: "president", title: "President", termYears: 4, constituency: "nation", minAge: 35 },
];

export const officeAt = (id) => LADDER.find((o) => o.id === id) || null;
export const rungOf = (id) => LADDER.findIndex((o) => o.id === id);

/** Presidential elections land on years divisible by four; midterms between. */
export const isPresidentialYear = (year) => year % 4 === 0;
export const isMidtermYear = (year) => year % 2 === 0 && year % 4 !== 0;
export const isElectionYear = (year) => year % 2 === 0;

/**
 * When this office is next on the ballot.
 *
 * The Senate is the only one that needs more than the calendar: a state's two
 * seats sit in different classes, so which year a given seat is contested
 * depends on the class it belongs to. Classes rotate 1, 2, 3 across consecutive
 * even years, which is the same rotation `senateCycle` already uses.
 */
export function nextElectionYear(officeId, fromYear, seatClass = 1) {
  const year = Math.ceil(fromYear);
  if (officeId === "president") {
    return year % 4 === 0 && year >= fromYear ? year : year + (4 - (year % 4 || 4)) % 4 || year + 4;
  }
  if (officeId === "senate") {
    // Class 1 is contested in years ≡ 0 (mod 6) offset by the class index.
    const target = ((seatClass - 1) * 2) % 6;
    for (let y = year % 2 === 0 ? year : year + 1; ; y += 2) {
      if (y >= fromYear && y % 6 === target % 6) return y;
    }
  }
  return year % 2 === 0 && year >= fromYear ? year : year + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/career.test.js`
Expected: PASS, 3 tests. If `nextElectionYear("president", 2029)` returns anything but 2032, simplify the presidential branch to `return year + ((4 - (year % 4)) % 4 || 4)` and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/career.js tests/career.test.js
git commit -m "feat: the ladder table and the election calendar"
```

---

### Task 2: Ballot collision and the constitutional age gates

**Files:**
- Modify: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: `officeAt`, `nextElectionYear`, `LADDER` from Task 1.
- Produces: `ballotsCollide({ holding, seatClass, targetOffice, year })` → `boolean`; `ageAt(career, year)` → `number`; `eligibleFor(career, officeId, year)` → `{ eligible, reason }`.

- [ ] **Step 1: Write the failing test**

```js
import { ballotsCollide, eligibleFor, ageAt } from "../src/career.js";

test("you surrender your seat only when the ballots collide", () => {
  // A House member running for the Senate: both on the same even year, always.
  assert.equal(ballotsCollide({ holding: "house", targetOffice: "senate", year: 2030, seatClass: 1 }), true);
  // A senator two years into six, reaching for the presidency: nothing at risk.
  assert.equal(ballotsCollide({ holding: "senate", seatClass: 2, targetOffice: "president", year: 2032 }), false);
  // A senator whose own class is up that year: the famous hard choice.
  assert.equal(ballotsCollide({ holding: "senate", seatClass: 1, targetOffice: "president", year: 2036 }), true);
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
  assert.equal(eligibleFor(young, "president", 2030).eligible, false);
  assert.equal(eligibleFor({ birthYear: 1980 }, "president", 2030).eligible, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `ballotsCollide is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/**
 * Does reaching for this office cost you the seat you hold?
 *
 * Only when both are on the same ballot, which is exactly how it works: you
 * cannot appear twice on one November. A House member is therefore always
 * gambling — their term ends the same even year every Senate race is held — and
 * a senator or governor reaching mid-term is risking nothing but time. That
 * asymmetry is why governors run for president so often, and it falls out of
 * the calendar rather than being asserted.
 */
export function ballotsCollide({ holding, seatClass = 1, targetOffice, year }) {
  if (!holding) return false;
  const mine = nextElectionYear(holding, year, seatClass);
  const theirs = nextElectionYear(targetOffice, year, seatClass);
  return mine === theirs;
}

export const ageAt = (career, year) => year - (career?.birthYear ?? year - 50);

/** The constitutional floors, which are real and cheap to honour. */
export function eligibleFor(career, officeId, year) {
  const office = officeAt(officeId);
  if (!office) return { eligible: false, reason: "No such office." };
  const age = ageAt(career, year);
  if (age < office.minAge) {
    return {
      eligible: false,
      reason: `The Constitution sets ${office.minAge} as the minimum age for ${office.title}. You are ${age}.`,
    };
  }
  return { eligible: true, reason: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/career.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/career.js tests/career.test.js
git commit -m "feat: ballot collision and constitutional age gates"
```

---

### Task 3: The envelope — creating a career and folding an office into it

**Files:**
- Modify: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: Task 1–2.
- Produces: `newCareer(scenario)` → career; `foldOffice(career, state, ending)` → career; `fullRecord(career, state)` → `{ votes, bills, confirmations }`.

- [ ] **Step 1: Write the failing test**

```js
import { newCareer, foldOffice, fullRecord } from "../src/career.js";

const scenario = { presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025, ideologyAxis: -0.35, age: "40s" };

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

test("the caucus's opinion this term moves the party's opinion of a career, but does not replace it", () => {
  // leadership 78 against a standing of 50: pulled 40% of the way, not all of it.
  const out = foldOffice(newCareer(scenario), houseState(), "sought-higher");
  assert.equal(out.standing, 61.2);
});

test("the record is whatever has been archived plus whatever is still being cast", () => {
  // A reach happens before the office ends, so half the record is still live.
  const folded = foldOffice(newCareer(scenario), houseState(), "sought-higher");
  const senate = { office: "senate", voteLog: [{ id: "s1", title: "A Treaty", vote: "yes", month: 3, term: 1 }], sponsored: [] };
  const all = fullRecord(folded, senate);
  assert.equal(all.votes.length, 3, "two archived, one still on the floor");
  assert.equal(all.votes.at(-1).office, "senate", "the live ones are tagged too");
  assert.equal(fullRecord(folded, null).votes.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `newCareer is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/** Turn the character profile's age band into a birth year that ages with time. */
const AGE_BANDS = { "30s": 35, "40s": 45, "50s": 55, "60s": 62, "70s": 71 };
function birthYearFrom(scenario) {
  const explicit = Number(scenario?.customAge);
  const age = Number.isFinite(explicit) && explicit > 0 ? explicit : AGE_BANDS[scenario?.age] || 50;
  return (scenario?.startYear || 2025) - age;
}

export function newCareer(scenario) {
  return {
    id: `career-${scenario?.presidentName || "unnamed"}-${scenario?.startYear || 2025}`,
    name: scenario?.presidentName || "Unnamed",
    party: scenario?.party || "Independent",
    gender: scenario?.gender || "unspecified",
    ideologyAxis: Number(scenario?.ideologyAxis) || 0,
    birthYear: birthYearFrom(scenario),
    year: scenario?.startYear || 2025,
    status: "in-office",
    offices: [],
    record: { votes: [], bills: [], confirmations: [] },
    recognition: { national: 0, states: {}, districts: {} },
    warChest: 0,
    standing: 50,
  };
}

/** How far one office's caucus standing moves the national party's view. */
const STANDING_PULL = 0.4;

/**
 * Close an office out into the career.
 *
 * This is the only place a record leaves `state` and enters the archive, which
 * is what keeps one source of truth while an office is being played.
 */
export function foldOffice(career, state, ending) {
  const office = state.office || "house";
  const tag = (rows) => (rows || []).map((row) => ({ ...row, office }));
  const seat = state.seat || {};
  const termYears = officeAt(office)?.termYears ?? 2;
  const terms = seat.seniority || state.term || 1;
  const to = career.year;

  return {
    ...career,
    offices: [...career.offices, {
      office,
      seat: seat.district || seat.state || "national",
      stateName: seat.stateName || null,
      terms,
      from: to - terms * termYears,
      to,
      rank: state.rank || null,
      ending,
      verdict: state.verdict || null,
    }],
    record: {
      votes: [...career.record.votes, ...tag(state.voteLog)],
      bills: [...career.record.bills, ...tag(state.sponsored)],
      confirmations: [...career.record.confirmations, ...tag(state.confirmations)],
    },
    standing: round1(clamp(
      career.standing + ((state.leadership ?? 50) - career.standing) * STANDING_PULL)),
  };
}

/**
 * The whole record — archived plus whatever is still being cast.
 *
 * A reach happens while you still hold the seat, so the votes that will decide
 * the race are split across two places. Every caller asks here so that none of
 * them can accidentally see half a career.
 */
export function fullRecord(career, state = null) {
  const live = state && state.office
    ? {
        votes: (state.voteLog || []).map((v) => ({ ...v, office: state.office })),
        bills: (state.sponsored || []).map((b) => ({ ...b, office: state.office })),
        confirmations: (state.confirmations || []).map((c) => ({ ...c, office: state.office })),
      }
    : { votes: [], bills: [], confirmations: [] };

  return {
    votes: [...career.record.votes, ...live.votes],
    bills: [...career.record.bills, ...live.bills],
    confirmations: [...career.record.confirmations, ...live.confirmations],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/career.test.js`
Expected: PASS, 9 tests. `standing` should be exactly `61.2` — `50 + (78 − 50) × 0.4`.

- [ ] **Step 5: Commit**

```bash
git add src/career.js tests/career.test.js
git commit -m "feat: the career envelope, folding an office, and the full record"
```

---

### Task 4: Recognition, and how it converts upward

**Files:**
- Modify: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: Task 3; `STATES` from `src/states.js`.
- Produces: `districtsInState(code)` → `number`; `earnRecognition(career, state)` → career; `recognitionFor(career, constituency, where)` → `number`.

- [ ] **Step 1: Write the failing test**

```js
import { districtsInState, earnRecognition, recognitionFor } from "../src/career.js";

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
  c = earnRecognition(c, { office: "house", rank: "member", seat: { district: "OH-6", state: "OH", seniority: 3 } });
  const statewide = recognitionFor(c, "state", "OH");
  // ~73 in one of Ohio's fifteen districts, transferring at 0.8 → about 4.
  assert.ok(statewide > 2 && statewide < 9,
    `three terms in a fifteen-district state is not statewide fame: got ${statewide}`);
  assert.ok(recognitionFor(c, "district", "OH-6") > 60, "at home you are known");
});

test("a stranger is a stranger", () => {
  assert.equal(recognitionFor(newCareer(scenario), "state", "OH"), 0);
  assert.equal(recognitionFor(newCareer(scenario), "nation"), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `districtsInState is not a function`

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/career.js`:

```js
import { STATES } from "./states.js";
```

Then append:

```js
/**
 * Recognition, held geographically, which is the whole reason skipping a rung
 * is hard without any difficulty setting existing.
 *
 * A member of the House is famous in one district and unknown in the other
 * fourteen. Converting that to a statewide race is arithmetic, not judgement:
 * a district is worth about its share of the state, and that share is real —
 * a delegation is a state's electoral votes minus its two senators.
 */
export const districtsInState = (code) => Math.max(1, (STATES[code]?.ev ?? 3) - 2);

const BASE_RECOGNITION = 55;      // an incumbent is known at home
const PER_TERM = 6;
const PER_RANK = 8;
const RECOGNITION_CAP = 95;
const TRANSFER = 0.8;             // media spill into the neighbouring seats
const EV_TOTAL = 538;

const RANKS_BY_HEIGHT = ["member", "subchair", "chair", "whip", "speaker"];

export function earnRecognition(career, state) {
  const seat = state.seat || {};
  const terms = seat.seniority || state.term || 1;
  const rankHeight = Math.max(0, RANKS_BY_HEIGHT.indexOf(state.rank || "member"));
  const earned = clamp(BASE_RECOGNITION + (terms - 1) * PER_TERM + rankHeight * PER_RANK, 0, RECOGNITION_CAP);

  const next = {
    ...career,
    recognition: {
      ...career.recognition,
      districts: { ...career.recognition.districts },
      states: { ...career.recognition.states },
    },
  };

  const office = state.office || "house";
  if (office === "house" && seat.district) {
    next.recognition.districts[seat.district] = Math.max(
      next.recognition.districts[seat.district] || 0, round1(earned));
  } else if (office === "senate" && seat.state) {
    next.recognition.states[seat.state] = Math.max(
      next.recognition.states[seat.state] || 0, round1(earned));
  } else if (office === "president") {
    next.recognition.national = Math.max(next.recognition.national, round1(earned));
  }

  // Rank is national on its own terms: a Speaker is known by people who could
  // not name their own member, and so is anybody who decided an impeachment.
  if (rankHeight >= 3) {
    next.recognition.national = Math.max(next.recognition.national, round1(rankHeight * PER_RANK));
  }
  return next;
}

/**
 * What this electorate has heard of you. Fame flows upward only — being known
 * nationally makes you known in every state, but not the reverse.
 */
export function recognitionFor(career, constituency, where = null) {
  const r = career.recognition;
  if (constituency === "district") {
    const own = r.districts[where] || 0;
    const fromState = (r.states[STATES[where?.split("-")[0]] ? where.split("-")[0] : ""] || 0);
    return round1(Math.max(own, fromState, r.national));
  }
  if (constituency === "state") {
    const own = r.states[where] || 0;
    // Every district you have held inside this state contributes its share.
    let fromDistricts = 0;
    for (const [district, value] of Object.entries(r.districts)) {
      if (district.split("-")[0] !== where) continue;
      fromDistricts += (value / districtsInState(where)) * TRANSFER;
    }
    return round1(Math.max(own, r.national) + fromDistricts);
  }
  // National: a statewide office converts at its share of the electoral college.
  let fromStates = 0;
  for (const [code, value] of Object.entries(r.states)) {
    fromStates += (value * ((STATES[code]?.ev ?? 3) / EV_TOTAL)) * TRANSFER;
  }
  return round1(r.national + fromStates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/career.test.js`
Expected: PASS, 13 tests. If the statewide assertion fails, print the value — three terms gives `55 + 2×6 = 67`, and `67/15 × 0.8 ≈ 3.6`, which is inside the 2–9 band.

- [ ] **Step 5: Commit**

```bash
git add src/career.js tests/career.test.js
git commit -m "feat: geographic recognition, and converting it upward"
```

---

### Task 5: Scoring a reach

**Files:**
- Create: `src/ladderRace.js`
- Test: `tests/ladderRace.test.js`

**Interfaces:**
- Consumes: `recognitionFor`, `fullRecord`, `officeAt` from `src/career.js`; `spendEffect`, `nationalEnvironment` from `src/elections.js`; `STATES` from `src/states.js`.
- Produces: `runLadderRace(career, state, { target, where, opponent, runOn, spend })` → `{ margin, won, ground, recognition, record, money, establishment, wave, incumbency, primary }`.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runLadderRace } from "../src/ladderRace.js";
import { newCareer, earnRecognition } from "../src/career.js";

const scenario = { presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025, ideologyAxis: -0.35, age: "40s" };
const opponent = { name: "Gov. Whitfield", party: "Republican", recognition: 71, axis: 0.45 };
const base = { office: "house", scenario, economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3, debt: 34 }, arcs: [], voteLog: [], sponsored: [], president: { party: "Republican", approval: 47 } };

test("a stranger loses a statewide race to somebody the state has heard of", () => {
  const out = runLadderRace(newCareer(scenario), base,
    { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  assert.equal(out.won, false);
  assert.ok(out.recognition < 0, "being unknown is a cost, and the bar shows it");
});

test("three terms, money and the establishment beat the same governor", () => {
  let career = newCareer(scenario);
  career = earnRecognition(career, { office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 } });
  career = { ...career, warChest: 12, standing: 82, recognition: { ...career.recognition, national: 22 } };
  const out = runLadderRace(career, base,
    { target: "senate", where: "OH", opponent, runOn: "record", spend: { OH: 12 } });
  assert.ok(out.money > 0);
  assert.ok(out.establishment > 0);
  assert.ok(out.margin > -5, `a serious candidate should be competitive: ${JSON.stringify(out)}`);
});

test("a race breaks down into named factors the election screen can already draw", () => {
  const out = runLadderRace(newCareer(scenario), base,
    { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  for (const key of ["margin", "won", "ground", "recognition", "record", "money", "establishment", "wave", "incumbency"]) {
    assert.ok(key in out, `missing ${key}`);
  }
  assert.equal(typeof out.won, "boolean");
});

test("a party that does not want you makes you win a primary first", () => {
  const weak = { ...newCareer(scenario), standing: 21 };
  const out = runLadderRace(weak, base, { target: "senate", where: "OH", opponent, runOn: "record", spend: {} });
  assert.equal(out.primary.contested, true);
  assert.ok(out.primary.note.length > 10);
});

test("a race is deterministic — the same career runs the same race twice", () => {
  const c = newCareer(scenario);
  const args = { target: "senate", where: "OH", opponent, runOn: "record", spend: {} };
  assert.deepEqual(runLadderRace(c, base, args), runLadderRace(c, base, args));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ladderRace.test.js`
Expected: FAIL — `Cannot find module '../src/ladderRace.js'`

- [ ] **Step 3: Write minimal implementation**

```js
import { clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { spendEffect, nationalEnvironment } from "./elections.js";
import { officeAt, recognitionFor, fullRecord } from "./career.js";

/**
 * One race for an office you do not hold.
 *
 * It returns the same shape `runReelection` does — a margin plus a named
 * contribution per factor — so the existing election screen draws it as factor
 * bars without learning anything new. The difference is which factors exist: a
 * re-election turns on the ground and your own standing, and a reach turns on
 * whether anybody has heard of you.
 */

const RECOGNITION_WEIGHT = 0.12;
const ESTABLISHMENT_WEIGHT = 0.08;
const RECORD_WEIGHT = 0.9;
const PRIMARY_THRESHOLD = 35;

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/** The partisan ground under this constituency, from the player's side. */
function groundFor(constituency, where, party) {
  const sign = partySign(party) || -1;
  if (constituency === "nation") return 0;
  const lean = constituency === "state"
    ? STATES[where]?.lean ?? 0
    : STATES[where?.split("-")[0]]?.lean ?? 0;
  return round1(sign * lean * 0.42);
}

/**
 * What your record is worth to an electorate that is not the one that elected
 * you. Every vote is scored against the new constituency's politics: the ones
 * that suit it help, the ones that do not are what the other side will be
 * running in October.
 */
function recordDrag(career, state, constituency, where, runOn) {
  const votes = fullRecord(career, state).votes;
  if (!votes.length) return 0;
  const sign = partySign(career.party) || -1;
  const lean = constituency === "state" ? (STATES[where]?.lean ?? 0) : 0;
  // A negative axis is a left-wing vote; a positive lean is a right-wing state.
  const electorate = clamp(lean / 90, -1, 1);
  let fit = 0;
  for (const v of votes) {
    if (v.vote === "abstain") continue;
    const axis = Number(v.axis) || 0;
    const cast = v.vote === "yes" ? axis : -axis;
    fit += 1 - Math.abs(cast - electorate);
  }
  const average = fit / votes.length - 0.5;          // −0.5…+0.5
  const emphasis = runOn === "record" ? 1.4 : runOn === "opponent" ? 0.5 : 0.8;
  return round1(average * 2 * RECORD_WEIGHT * emphasis * (sign === 0 ? 0.5 : 1));
}

export function runLadderRace(career, state, { target, where, opponent, runOn = "record", spend = {} }) {
  const office = officeAt(target);
  const constituency = office?.constituency || "state";
  const ev = constituency === "state" ? (STATES[where]?.ev ?? 3) : 538;

  const mine = recognitionFor(career, constituency, where);
  const theirs = Number(opponent?.recognition) || 50;
  const recognition = round1((mine - theirs) * RECOGNITION_WEIGHT);

  const ground = groundFor(constituency, where, career.party);
  const record = recordDrag(career, state, constituency, where, runOn);
  const money = round1(spendEffect(spend?.[where] ?? 0, ev));
  const establishment = round1((career.standing - 50) * ESTABLISHMENT_WEIGHT);

  const sameParty = career.party === state.president?.party;
  const env = nationalEnvironment({
    approval: state.president?.approval ?? 50,
    economy: state.economy, arcs: state.arcs || [], scenario: { party: state.president?.party },
  }, { midterm: sameParty });
  const wave = round1(sameParty ? env : -env * 0.45);

  // You only carry incumbency into a race you did not have to resign for.
  const incumbency = state.office === target ? round1(3 + Math.min(state.seat?.seniority || 1, 6) * 0.9) : 0;

  const margin = round1(ground + recognition + record + money + establishment + wave + incumbency);

  return {
    margin, won: margin > 0,
    ground, recognition, record, money, establishment, wave, incumbency,
    mine, theirs, opponent, target, where, runOn,
    primary: {
      contested: career.standing < PRIMARY_THRESHOLD,
      note: career.standing < PRIMARY_THRESHOLD
        ? `The party has a candidate it prefers. You are in a primary before you meet the other side.`
        : `The establishment is not going to fight you for this.`,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ladderRace.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ladderRace.js tests/ladderRace.test.js
git commit -m "feat: score a race for an office you do not hold"
```

---

### Task 6: The wilderness

**Files:**
- Modify: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: Task 3–4.
- Produces: `WILDERNESS_CHOICES` (array of `{ id, label, note }`); `enterWilderness(career, { lostTo, office })` → career; `wildernessYear(career, choiceId)` → `{ career, note }`.

- [ ] **Step 1: Write the failing test**

```js
import { WILDERNESS_CHOICES, enterWilderness, wildernessYear } from "../src/career.js";

const known = () => {
  let c = newCareer(scenario);
  c = earnRecognition(c, { office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 } });
  return { ...c, warChest: 4, standing: 60, recognition: { ...c.recognition, national: 40 } };
};

test("losing a reach puts you out of office, not out of the game", () => {
  const out = enterWilderness(known(), { lostTo: "Gov. Whitfield", office: "senate" });
  assert.equal(out.status, "wilderness");
  assert.equal(out.over, undefined, "the career is not finished");
  assert.match(out.wilderness.lostTo, /Whitfield/);
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
  assert.ok(lobby.tainted === true, "and it is on your record forever");
  assert.equal(clean.tainted, undefined);

  const news = wildernessYear(start, "media").career;
  assert.ok(news.recognition.national >= start.recognition.national * 0.95, "television keeps you visible");
});

test("a comeback is reachable — you do not decay to nothing before the next ballot", () => {
  let c = enterWilderness(known(), { lostTo: "X", office: "senate" });
  c = wildernessYear(c, "party").career;
  c = wildernessYear(c, "party").career;
  assert.ok(c.recognition.national > 15, "two years out is a setback, not an erasure");
  assert.ok(c.standing > 55, "working the party circuit is how you get forgiven");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `enterWilderness is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/**
 * Out of office.
 *
 * A fall is a chapter rather than an ending, which is the only version of a
 * career game where reaching is worth the risk. Time moves a year at a time and
 * everything decays — but what you do with those years decides which of the
 * four assets you keep, and every option costs one of the others.
 */
export const WILDERNESS_CHOICES = [
  { id: "lobby", label: "Take the lobbying job",
    note: "The money is real and so is the stain. Nobody who does this is ever quite clean again." },
  { id: "media", label: "Sign the cable news contract",
    note: "You stay visible, and you harden into whatever your side needs you to be." },
  { id: "nonprofit", label: "Run a foundation",
    note: "The country forgets you at full speed. Your reputation survives intact." },
  { id: "party", label: "Work the party circuit",
    note: "Fundraisers in other people's districts. The establishment remembers who showed up." },
  { id: "nothing", label: "Wait",
    note: "Everything decays and nothing is owed to you." },
];

const DECAY = { recognition: 0.8, money: 0.75, standingPull: 0.15 };

export function enterWilderness(career, { lostTo, office }) {
  return {
    ...career,
    status: "wilderness",
    wilderness: { lostTo: lostTo || "the other candidate", office, since: career.year },
  };
}

const scaleRecognition = (recognition, factor) => ({
  national: round1(recognition.national * factor),
  states: Object.fromEntries(Object.entries(recognition.states).map(([k, v]) => [k, round1(v * factor)])),
  districts: Object.fromEntries(Object.entries(recognition.districts).map(([k, v]) => [k, round1(v * factor)])),
});

export function wildernessYear(career, choiceId) {
  const choice = WILDERNESS_CHOICES.find((c) => c.id === choiceId) || WILDERNESS_CHOICES.at(-1);
  const effect = {
    lobby: { fame: DECAY.recognition, money: 2.5, standing: 6, tainted: true },
    media: { fame: 0.97, money: 0.9, standing: -2 },
    nonprofit: { fame: 0.75, money: 0.85, standing: 1 },
    party: { fame: 0.88, money: 0.95, standing: 9 },
    nothing: { fame: DECAY.recognition, money: DECAY.money, standing: 0 },
  }[choice.id];

  const next = {
    ...career,
    year: career.year + 1,
    recognition: scaleRecognition(career.recognition, effect.fame),
    warChest: round1(effect.money > 1.5
      ? career.warChest * DECAY.money + effect.money
      : career.warChest * effect.money),
    standing: round1(clamp(
      career.standing + (50 - career.standing) * DECAY.standingPull + effect.standing)),
  };
  if (effect.tainted) next.tainted = true;

  return { career: next, note: choice.note };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/career.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/career.js tests/career.test.js
git commit -m "feat: the wilderness, where a fall is a chapter rather than an ending"
```

---

### Task 7: Seeding a new office from the career

**Files:**
- Modify: `src/gameEngine.js:149-152`
- Modify: `src/career.js`
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: Task 3–4.
- Produces: `seedFromCareer(state, career)` → state. `createGame(scenario, career)` gains an optional second parameter.

- [ ] **Step 1: Write the failing test**

```js
import { createGame } from "../src/gameEngine.js";

test("a Senate seat reached from three House terms starts warmer than a stranger's", () => {
  let veteran = newCareer(scenario);
  veteran = earnRecognition(veteran, { office: "house", rank: "chair", seat: { district: "OH-6", state: "OH", seniority: 3 } });
  veteran = { ...veteran, warChest: 9, standing: 78 };

  const sc = { ...scenario, office: "senate", seatState: "OH" };
  const stranger = createGame(sc);
  const reached = createGame(sc, veteran);

  assert.ok(reached.leadership > stranger.leadership,
    "the caucus knows who you are before you arrive");
  assert.equal(reached.careerId, veteran.id);
  assert.equal(stranger.careerId, undefined);
});

test("seeding never invents a career where there is none", () => {
  const sc = { ...scenario, office: "senate", seatState: "OH" };
  assert.deepEqual(createGame(sc), createGame(sc, null));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `reached.leadership` equals `stranger.leadership`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/**
 * What arriving with a career is worth.
 *
 * Deliberately small: it buys you a caucus that already has an opinion and a
 * seat that starts a little warmer, not a head start on the job. The real value
 * of a career is spent at the ballot box, in `runLadderRace`, not here.
 */
export function seedFromCareer(state, career) {
  if (!career) return state;
  const standing = clamp(50 + (career.standing - 50) * 0.6);
  return {
    ...state,
    careerId: career.id,
    leadership: round1(clamp((state.leadership ?? 50) * 0.4 + standing * 0.6)),
  };
}
```

In `src/gameEngine.js`, change the routing block at line 149:

```js
export function createGame(scenario, career = null) {
  if (scenario?.office === "house") return seedFromCareer(createHouseCareer(scenario), career);
  if (scenario?.office === "senate") return seedFromCareer(createSenateCareer(scenario), career);
```

and add to its imports:

```js
import { seedFromCareer } from "./career.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 19 new tests, and all 449 existing tests still green. `createGame(sc)` with no career must be byte-identical to before.

- [ ] **Step 5: Commit**

```bash
git add src/career.js src/gameEngine.js tests/career.test.js
git commit -m "feat: seed a new office from the career that reached it"
```

---

### Task 8: The term-boundary hook

**Files:**
- Modify: `src/house.js` (the term rollover inside `advanceHouseMonth`)
- Modify: `src/senate.js` (the term rollover inside `advanceSenateMonth`)
- Test: `tests/career.test.js`

**Interfaces:**
- Consumes: Task 1–2.
- Produces: `nextChoices(career, state)` → `[{ id, office, where, label, collides, eligible, reason }]`, exported from `src/career.js`. Both `advance*Month` return an extra `choices` field on the term-end result.

- [ ] **Step 1: Write the failing test**

```js
import { nextChoices } from "../src/career.js";
import { advanceHouseMonth, createHouseCareer, HOUSE_TERM } from "../src/house.js";

test("at the end of a term you may run again, reach, or retire", () => {
  const career = { ...newCareer(scenario), year: 2030 };
  const state = { office: "house", term: 3, seat: { district: "OH-6", state: "OH", seniority: 3 } };
  const choices = nextChoices(career, state);
  const ids = choices.map((c) => c.id);
  assert.ok(ids.includes("re-elect"));
  assert.ok(ids.includes("retire"));
  assert.ok(ids.includes("reach:senate"));

  const senate = choices.find((c) => c.id === "reach:senate");
  assert.equal(senate.collides, true, "a House seat and a Senate seat share a ballot");
  assert.match(senate.label, /Senate/);
});

test("a reach you are too young for is offered with the reason, not hidden", () => {
  const young = { ...newCareer({ ...scenario, customAge: "26" }), year: 2030 };
  const state = { office: "house", term: 1, seat: { district: "OH-6", state: "OH", seniority: 1 } };
  const senate = nextChoices(young, state).find((c) => c.id === "reach:senate");
  assert.equal(senate.eligible, false);
  assert.match(senate.reason, /30/);
});

test("the House still ends a term the way it always did, and now offers the ladder too", () => {
  const s = { ...createHouseCareer({ ...scenario, office: "house", district: "OH-6" }), month: HOUSE_TERM, approval: 70 };
  const out = advanceHouseMonth(s);
  if (out.reelection?.won) {
    assert.ok(Array.isArray(out.choices), "the ladder is offered at the boundary");
    assert.ok(out.choices.some((c) => c.id.startsWith("reach:")));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/career.test.js`
Expected: FAIL — `nextChoices is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/**
 * What a member may do at the end of a term.
 *
 * Nothing is hidden. A rung you cannot reach is still listed, with the reason —
 * being told the Constitution says thirty is part of the game, and silently
 * omitting the option would read as a bug.
 */
export function nextChoices(career, state) {
  const holding = state.office;
  const year = career.year;
  const seatClass = state.seat?.class || 1;
  const home = state.seat?.state || null;

  const choices = [
    { id: "re-elect", office: holding, where: state.seat?.district || home,
      label: `Run for re-election`, collides: false, eligible: true, reason: null },
  ];

  for (const rung of LADDER) {
    if (rung.id === holding) continue;
    if (rungOf(rung.id) <= rungOf(holding)) continue;      // this sub-project climbs only
    const { eligible, reason } = eligibleFor(career, rung.id, year);
    const where = rung.constituency === "state" ? home : null;
    choices.push({
      id: `reach:${rung.id}`,
      office: rung.id,
      where,
      label: `Run for ${rung.title}${where ? ` from ${STATES[where]?.name || where}` : ""}`,
      collides: ballotsCollide({ holding, seatClass, targetOffice: rung.id, year }),
      eligible,
      reason,
    });
  }

  choices.push({ id: "retire", office: null, where: null,
    label: "Retire, and let the record close", collides: false, eligible: true, reason: null });
  return choices;
}
```

In `src/house.js`, add the import and attach choices at the term rollover. Find the `return { state: ladder.state, reelection: result, ladder: ladder.change, cycle };` line at the end of `advanceHouseMonth` and change it to:

```js
  return {
    state: ladder.state, reelection: result, ladder: ladder.change, cycle,
    choices: next.career ? nextChoices(next.career, ladder.state) : null,
  };
```

with `import { nextChoices } from "./career.js";` at the top. Make the identical change to the matching return in `src/senate.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The third test is conditional on winning re-election, which is correct — it asserts nothing when the member loses.

- [ ] **Step 5: Commit**

```bash
git add src/career.js src/house.js src/senate.js tests/career.test.js
git commit -m "feat: offer the ladder at every term boundary"
```

---

### Task 9: The save shape, and migrating what already exists

**Files:**
- Modify: `public/js/store.js`
- Test: `tests/careerStore.test.js` (create)

**Interfaces:**
- Consumes: `newCareer`, `foldOffice` from `src/career.js`.
- Produces: `migrateSave(saved)` → `{ career, state }`, exported from `src/career.js` so it is testable in Node without a DOM.

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { migrateSave } from "../src/career.js";
import { createHouseCareer } from "../src/house.js";

const scenario = { presidentName: "Dale Fairweather", party: "Democrat", startYear: 2025, ideologyAxis: -0.35, age: "40s", office: "house", district: "OH-6" };

test("a save from before the ladder existed still loads, and can start climbing", () => {
  const old = { state: { ...createHouseCareer(scenario), term: 2, seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 2 } } };
  const out = migrateSave(old);
  assert.ok(out.career, "an envelope is synthesised around it");
  assert.equal(out.career.name, "Dale Fairweather");
  assert.equal(out.career.status, "in-office");
  assert.equal(out.state.seat.district, "OH-6", "the state itself is untouched");
  assert.ok(out.career.year >= 2025);
});

test("a save that already has a career is left exactly alone", () => {
  const already = { career: { id: "x", name: "Someone", year: 2031, offices: [], record: { votes: [], bills: [], confirmations: [] }, recognition: { national: 5, states: {}, districts: {} }, warChest: 1, standing: 55, status: "in-office" }, state: { office: "senate" } };
  assert.deepEqual(migrateSave(already), already);
});

test("recognition is inferred from the seat already held, so a migrated career is not a stranger", () => {
  const old = { state: { ...createHouseCareer(scenario), term: 4, seat: { district: "OH-6", state: "OH", stateName: "Ohio", seniority: 4 }, rank: "chair" } };
  const out = migrateSave(old);
  assert.ok(out.career.recognition.districts["OH-6"] > 55,
    "four terms and a gavel is not anonymity");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/careerStore.test.js`
Expected: FAIL — `migrateSave is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/career.js`:

```js
/**
 * Wrap a pre-ladder save in an envelope.
 *
 * Saves in the wild are a bare `state` with no career. Rather than start those
 * players from nothing, the envelope is inferred from what the save already
 * knows — the office, the seat, the terms served and the rank — so a career in
 * progress can begin climbing from where it actually stands.
 */
export function migrateSave(saved) {
  if (!saved || saved.career) return saved;
  const state = saved.state || saved;
  const scenario = state.scenario || {};
  const termYears = officeAt(state.office)?.termYears ?? 2;
  const served = (state.seat?.seniority || state.term || 1) - 1;

  let career = newCareer(scenario);
  career = { ...career, year: (scenario.startYear || 2025) + served * termYears };
  career = earnRecognition(career, state);
  return { ...saved, career, state };
}
```

Then in `public/js/store.js`, run every load through it. Find `loadCareer` and the read of `CAREERS_KEY`, and wrap the restored entry:

```js
import { migrateSave } from "../../src/career.js";
// …where a saved career is restored into G:
const restored = migrateSave({ career: c.career, state: c.state });
G.career = restored.career;
G.state = restored.state;
```

and in `saveCareer`, persist `career: G.career` alongside the existing `state: s`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Then load the app in a browser with an existing save and confirm it still opens: `FP_PROVIDER=off PORT=3111 node src/server.js`.

- [ ] **Step 5: Commit**

```bash
git add src/career.js public/js/store.js tests/careerStore.test.js
git commit -m "feat: carry a career in the save, and migrate the ones that predate it"
```

---

### Task 10: Server endpoints for the ladder

**Files:**
- Modify: `src/server.js`
- Test: manual via `curl`, per the pattern used for the existing congressional endpoints.

**Interfaces:**
- Consumes: `nextChoices`, `enterWilderness`, `wildernessYear`, `WILDERNESS_CHOICES`, `foldOffice` from `src/career.js`; `runLadderRace` from `src/ladderRace.js`.
- Produces: `POST /api/ladder/choices`, `POST /api/ladder/race`, `POST /api/ladder/wilderness`.

- [ ] **Step 1: Add the endpoints**

```js
import {
  nextChoices, foldOffice, enterWilderness, wildernessYear, WILDERNESS_CHOICES,
} from "./career.js";
import { runLadderRace } from "./ladderRace.js";

/** What a member may do at the end of a term. */
app.post("/api/ladder/choices", (req, res) => {
  try {
    const { career, state } = req.body || {};
    if (!career || !state) return res.status(400).json({ error: "career and state are required." });
    res.json({ choices: nextChoices(career, state), wilderness: WILDERNESS_CHOICES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The ballot could not be read." });
  }
});

/** Run for something you do not hold. */
app.post("/api/ladder/race", (req, res) => {
  try {
    const { career, state, target, where, opponent, runOn, spend } = req.body || {};
    if (!career || !state || !target) {
      return res.status(400).json({ error: "career, state and target are required." });
    }
    res.json({ result: runLadderRace(career, state, { target, where, opponent, runOn, spend }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The race could not be run." });
  }
});

/** A year out of office. */
app.post("/api/ladder/wilderness", (req, res) => {
  try {
    const { career, choice } = req.body || {};
    if (!career) return res.status(400).json({ error: "career is required." });
    res.json(wildernessYear(career, String(choice || "nothing")));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The year could not pass." });
  }
});
```

- [ ] **Step 2: Verify each endpoint answers**

```bash
FP_PROVIDER=off PORT=3111 node src/server.js &
sleep 2
curl -s -X POST localhost:3111/api/ladder/choices -H 'Content-Type: application/json' \
  -d '{"career":{"birthYear":1980,"year":2030,"party":"Democrat","standing":50,"recognition":{"national":0,"states":{},"districts":{}},"record":{"votes":[],"bills":[],"confirmations":[]},"offices":[],"warChest":0,"status":"in-office"},"state":{"office":"house","term":3,"seat":{"district":"OH-6","state":"OH","seniority":3}}}' | head -c 300
```

Expected: a `choices` array containing `re-elect`, `reach:senate`, `reach:president` and `retire`.

- [ ] **Step 3: Guard against a missing body**

```bash
curl -s -X POST localhost:3111/api/ladder/race -H 'Content-Type: application/json' -d '{}'
```

Expected: `{"error":"career, state and target are required."}` with HTTP 400.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, unchanged count — these endpoints add no unit tests, only routes.

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "feat: ladder endpoints for choices, races and the wilderness"
```

---

### Task 11: The three client screens

**Files:**
- Create: `public/js/ladder/next.js`, `public/js/ladder/race.js`, `public/js/ladder/wilderness.js`
- Modify: `public/index.html` (three screen shells), `public/js/api.js`, `public/js/main.js`
- Test: browser walkthrough

**Interfaces:**
- Consumes: the three endpoints from Task 10.
- Produces: `renderNextChoice(hooks, choices)`, `renderLadderRace(hooks, race)`, `renderWilderness(hooks)`.

- [ ] **Step 1: Add the API calls**

In `public/js/api.js`:

```js
export const ladderChoices = (career, state) => post("/api/ladder/choices", { career, state });
export const ladderRace = (career, state, opts) => post("/api/ladder/race", { career, state, ...opts });
export const ladderWilderness = (career, choice) => post("/api/ladder/wilderness", { career, choice });
```

- [ ] **Step 2: Add the screen shells**

In `public/index.html`, beside the existing `screen-district` section:

```html
<section id="screen-next" class="screen">
  <div class="shell shell--menu"><div class="panel">
    <div class="screen-head"><div>
      <h1 class="display display--xl">What Next?</h1>
      <p class="lede" id="nextLede">Your term is up. So is the rest of the ballot.</p>
    </div></div>
    <div id="nextBody"></div>
  </div></div>
</section>

<section id="screen-race" class="screen">
  <div class="shell shell--menu"><div class="panel"><div id="raceBody"></div></div></div>
</section>

<section id="screen-wilderness" class="screen">
  <div class="shell shell--menu"><div class="panel">
    <div class="screen-head"><div>
      <h1 class="display display--xl">Out of Office</h1>
      <p class="lede" id="wildernessLede">You hold nothing. The years pass anyway.</p>
    </div></div>
    <div id="wildernessBody"></div>
  </div></div>
</section>
```

- [ ] **Step 3: Write the "what next" screen**

`public/js/ladder/next.js` renders one row per choice, showing the collision warning and the ineligibility reason:

```js
"use strict";
import { $, show, escapeHtml, loader } from "../util.js";
import { G } from "../store.js";
import { ladderChoices } from "../api.js";

export async function renderNextChoice(hooks) {
  loader(true, "The filing deadline approaches…");
  let data;
  try {
    data = await ladderChoices(G.career, G.state);
  } catch (err) {
    alert("The ballot could not be read: " + err.message);
    return hooks.onFloor();
  } finally { loader(false); }

  $("nextBody").innerHTML = `<div class="rows">
    ${data.choices.map((c) => `
      <button class="career office" data-choice="${escapeHtml(c.id)}" ${c.eligible ? "" : "disabled"}>
        <span class="office__text">
          <span class="office__title">${escapeHtml(c.label)}</span>
          <span class="office__lede">${c.collides
            ? "⚠️ Same ballot as your seat — you cannot do both. Lose and you are out of office."
            : c.id.startsWith("reach:") ? "Your seat is not up. Lose and you go back to it."
            : ""}</span>
          ${c.reason ? `<span class="office__detail">${escapeHtml(c.reason)}</span>` : ""}
        </span>
        <span class="career__go">▸</span>
      </button>`).join("")}
  </div>`;

  $("nextBody").onclick = (e) => {
    const btn = e.target.closest("[data-choice]");
    if (!btn || btn.disabled) return;
    hooks.onChoice(data.choices.find((c) => c.id === btn.dataset.choice));
  };
  show("next");
}
```

- [ ] **Step 4: Wire the router and walk it in a browser**

In `public/js/main.js`, import the three renderers and route: at a term boundary, if `data.choices` is present, call `renderNextChoice`; `reach:*` goes to `renderLadderRace`; a lost reach with a collision goes to `renderWilderness`.

```bash
FP_PROVIDER=off PORT=3111 node src/server.js &
```

Walk it: start a House career, play to month 24, confirm the "What Next?" screen lists re-election, both reaches and retirement, that the Senate row carries the collision warning, and that choosing it opens the race screen.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/api.js public/js/main.js public/js/ladder/
git commit -m "feat: the what-next, race and wilderness screens"
```

---

## Self-Review

**Spec coverage:** envelope → Task 3; record and `fullRecord` → Task 3; recognition and conversion → Task 4; money and establishment → Task 5 (carried in the envelope from Task 3, spent in the race); ladder table and calendar → Task 1; collision → Task 2; age gates → Task 2; campaign screen → Task 11; race scoring → Task 5; wilderness → Tasks 6 and 11; `createGame` seeding → Task 7; the term-boundary hook → Task 8; migration → Task 9; server → Task 10.

**Not covered by a task, deliberately:** the spec's line that a vacated seat is filled by somebody else is descriptive rather than mechanical in this sub-project — the seat simply is not yours, and running for it again is an ordinary reach at `rungOf` equal to your own. That is why `nextChoices` currently climbs only; returning to a lower rung is the first thing to add when the wilderness gets its own comeback race, and it is called out in the plan rather than silently dropped.

**Type consistency:** `career.recognition.{national,states,districts}` is used identically in Tasks 4, 6, 9 and 11. `runLadderRace` returns the same key names asserted in Task 5 and rendered in Task 11. `nextChoices` returns `{ id, office, where, label, collides, eligible, reason }` in Task 8 and is consumed with exactly those keys in Task 11. `foldOffice(career, state, ending)` has one signature throughout.

**Placeholder scan:** clean — every step carries the code it needs.
