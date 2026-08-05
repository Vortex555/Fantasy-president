import test from "node:test";
import assert from "node:assert/strict";

import {
  ROOMS, ROOM_IDS, roomBoard, roomState, applySession, tickRooms,
  breakChance, emptyRooms, SAFE_HEAT, MAX_BREAK_CHANCE,
} from "../src/rooms.js";
import {
  validateOpening, validateJudgement, writtenOpening, writtenJudgement, answersTheRoom,
} from "../src/roomsAi.js";
import { createGame } from "../src/gameEngine.js";
import { partyStanding } from "../public/js/data/party.js";

/**
 * The month, as a building rather than a button.
 *
 * A term used to be forty-eight repetitions of one gesture — read the
 * dashboard, press Play, write a policy — and every other part of the office
 * was met only in its consequences. You could serve four years without taking a
 * single question from a reporter.
 *
 * The six rooms are standing appointments and none of them is compulsory. What
 * is tested here is mostly the shape of the punishment for that: absence has to
 * be survivable often enough to be a real choice, and expensive often enough to
 * be a real risk.
 */

const president = (o = {}) => ({
  ...createGame({
    presidentName: "Dale Fairweather",
    party: "Democrat",
    ideology: "Social Democrat",
    era: "the present day",
    startYear: 2025,
    startApproval: 54,
  }),
  ...o,
});

const EVENT = { title: "A refinery fire on the Gulf", brief: "Fuel prices are climbing." };

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

test("every room offers something specific, every month", () => {
  const board = roomBoard(president(), EVENT);
  assert.equal(board.length, ROOMS.length);
  for (const room of board) {
    assert.ok(room.line.length > 10, `${room.id} had nothing to say`);
    assert.ok(room.urgency >= 0 && room.urgency <= 3);
    assert.equal(room.done, false);
  }
});

test("the Situation Room is about the month's situation, because that is what it is for", () => {
  const board = roomBoard(president(), EVENT);
  const situation = board.find((r) => r.id === "situation");
  assert.match(situation.line, /refinery/i);
  assert.equal(situation.urgency, 3);
});

/**
 * Caught by playing a month rather than by reading the code: the press room
 * offered "the usual — the economy, the schedule" in a month when protests had
 * reached the Mall. Every other room was reacting to the news; the press corps,
 * of all people, was not.
 */
test("the press room is about whatever the country is about", () => {
  const quiet = roomBoard(president(), null).find((r) => r.id === "press");
  const loud = roomBoard(president(), EVENT).find((r) => r.id === "press");

  assert.match(loud.line, /refinery/i, "they ask about the thing that happened");
  assert.ok(loud.urgency > quiet.urgency, "and missing it in that month costs more");
});

test("absence is reported in months, not in points", () => {
  const s = president();
  s.rooms = { ...emptyRooms(), press: { heat: 6, streak: 4, visited: 1, term: 1, done: false } };
  const press = roomBoard(s, EVENT).find((r) => r.id === "press");
  assert.match(press.since, /4 months/);
  assert.ok(press.risk > 0, "and four months of it is a real risk");
});

test("an old save has no schedule and must not crash for it", () => {
  const s = president();
  delete s.rooms;
  assert.equal(roomBoard(s, EVENT).length, ROOMS.length);
  assert.deepEqual(roomState(s, "press"), { heat: 0, streak: 0, visited: 0, term: 0, done: false });
});

// ---------------------------------------------------------------------------
// A session
// ---------------------------------------------------------------------------

test("a room takes what you said and moves what it is able to move", () => {
  const s = president();
  const before = s.approval;
  const out = applySession(s, "press", 2);

  assert.equal(out.score, 2);
  assert.ok(s.approval > before, "a briefing that went well is worth approval");
  assert.equal(out.moved.approval, 4.4);
  assert.equal(s.rooms.press.done, true, "and the room is finished for the month");
  assert.equal(s.rooms.press.heat, 0, "turning up clears what absence had built");
});

test("each room can only do to you what that room can do", () => {
  const press = president();
  const hill = president();
  applySession(press, "press", -2);
  applySession(hill, "hill", -2);

  assert.ok(press.approval < 54, "the press room costs approval");
  assert.equal(press.stability, 72, "and nothing else");
  assert.ok(partyStanding(hill) < partyStanding(president()), "the Hill costs you your own party");
});

/**
 * "Party stability" is not a field — it is derived from the blocs the
 * president's own politics brought with them. An earlier version of this wrote
 * to a `partyStability` that does not exist, which looked like it worked and
 * changed nothing on the screen.
 */
test("the party is moved where the party actually lives", () => {
  const s = president();
  const before = partyStanding(s);
  applySession(s, "road", 3);
  assert.ok(partyStanding(s) > before, `${partyStanding(s)} should beat ${before}`);
  assert.equal(s.partyStability, undefined, "there is no such field and there never was");
});

test("a judgement outside the scale is brought back onto it", () => {
  const s = president();
  assert.equal(applySession(s, "press", 11).score, 3);
  assert.equal(applySession(president(), "press", -40).score, -3);
  assert.equal(applySession(president(), "press", "rubbish").score, 0);
});

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

test("one skipped month is free, always", () => {
  const s = president();
  const events = tickRooms(s, EVENT);
  assert.deepEqual(events, [], "nothing breaks on the first month of anything");
  for (const id of ROOM_IDS) assert.ok(s.rooms[id].heat <= SAFE_HEAT);
});

test("a room in crisis builds exposure faster than a quiet one", () => {
  const s = president();
  tickRooms(s, EVENT);
  assert.ok(s.rooms.situation.heat > s.rooms.hill.heat,
    "skipping the Situation Room in a crisis is not the same as skipping the Hill in a quiet month");
});

test("turning up clears it, and the clock starts again", () => {
  const s = president();
  tickRooms(s, EVENT);
  tickRooms(s, EVENT);
  assert.ok(s.rooms.press.heat > 0);
  applySession(s, "press", 0);
  assert.equal(s.rooms.press.heat, 0);
  assert.equal(s.rooms.press.streak, 0);
});

test("attending is remembered until the month turns over", () => {
  const s = president();
  applySession(s, "press", 1);
  assert.equal(s.rooms.press.done, true);
  tickRooms(s, EVENT);
  assert.equal(s.rooms.press.done, false, "a new month is a new appointment");
  assert.equal(s.rooms.press.streak, 0, "and attending it does not count as missing it");
});

test("the odds climb with neglect and stop well short of certain", () => {
  assert.equal(breakChance(0), 0);
  assert.equal(breakChance(SAFE_HEAT), 0, "the safe line is safe");
  assert.ok(breakChance(SAFE_HEAT + 2) > 0);
  assert.ok(breakChance(SAFE_HEAT + 2) < breakChance(SAFE_HEAT + 6), "it climbs");
  assert.equal(breakChance(400), MAX_BREAK_CHANCE, "and then it stops");
  assert.ok(MAX_BREAK_CHANCE < 0.5, "no amount of neglect is ever more likely than not");
});

/**
 * The whole mechanic, measured rather than asserted.
 *
 * The first version of this ran to a 0.55 ceiling and gained heat far too fast:
 * a president who ignored everything for two years ate twenty catastrophes,
 * which is not a risk, it is a schedule. These are the numbers that make
 * absence a bet.
 */
test("the punishment curve is a bet, not a bill", () => {
  /**
   * `rotate` walks a different set of rooms each month, which is how a busy
   * president actually plays: everything gets seen eventually. `fixed` always
   * takes the same ones, which is how a president with blind spots plays. The
   * two must not cost the same, and getting them the same way round is the
   * whole design.
   */
  const run = (attend, rotate) => {
    let breaks = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const s = president();
      s.scenario = { ...s.scenario, presidentName: `President ${seed}` };
      for (let month = 1; month <= 24; month += 1) {
        s.month = month;
        const start = rotate ? (month * attend) % ROOM_IDS.length : 0;
        for (let i = 0; i < attend; i += 1) {
          applySession(s, ROOM_IDS[(start + i) % ROOM_IDS.length], 0);
        }
        breaks += tickRooms(s, EVENT).length;
      }
    }
    return breaks / 6;
  };

  assert.equal(run(6, false), 0, "a president who does the whole job is never punished for absence");
  assert.ok(run(4, true) < 2, `four rooms a month, spread around, should be a quiet term — got ${run(4, true)}`);
  assert.ok(run(0, false) > 8, `ignoring the entire office should be ruinous — got ${run(0, false)}`);
});

/**
 * The failure this test was written to catch is the one that got past me first
 * time: four rooms a month sounds diligent, and if they are the same four every
 * month then two rooms have gone two years without a president in them. That
 * has to cost, or the whole mechanic is satisfied by a habit.
 */
test("a blind spot is punished even when the rest of the month is diligent", () => {
  let breaks = 0;
  for (let seed = 0; seed < 6; seed += 1) {
    const s = president();
    s.scenario = { ...s.scenario, presidentName: `President ${seed}` };
    for (let month = 1; month <= 24; month += 1) {
      s.month = month;
      for (const id of ROOM_IDS.slice(0, 4)) applySession(s, id, 0);
      breaks += tickRooms(s, EVENT).length;
    }
  }
  assert.ok(breaks / 6 > 2,
    `two rooms ignored for two years must bite — got ${(breaks / 6).toFixed(1)} a term`);
});

test("a break costs something, says what it was, and spends the exposure", () => {
  const s = president();
  // Enough neglect that something is going to give.
  s.rooms = Object.fromEntries(ROOM_IDS.map((id) => [id, { heat: 40, streak: 12, visited: 0, term: 1, done: false }]));
  const before = { approval: s.approval, stability: s.stability };
  const events = tickRooms(s, EVENT);

  assert.ok(events.length, "forty months of exposure has to produce something eventually");
  for (const event of events) {
    assert.ok(event.note.length > 30, "a break the player cannot read is a number changing on its own");
    assert.equal(s.rooms[event.room].heat, 0, "it has happened; the exposure is spent");
  }
  assert.ok(s.approval < before.approval || s.stability < before.stability);
});

test("the same month rolls the same way twice, because a career is not a slot machine", () => {
  const a = president();
  const b = president();
  a.rooms = b.rooms = undefined;
  const first = tickRooms(a, EVENT);
  const second = tickRooms(b, EVENT);
  assert.deepEqual(first.map((e) => e.room), second.map((e) => e.room));
});

// ---------------------------------------------------------------------------
// What the model is allowed to hand back
// ---------------------------------------------------------------------------

test("an opening is trimmed to what the screen can hold", () => {
  const out = validateOpening({
    scene: "x".repeat(2000),
    voices: [{ who: "A", line: "B" }, { line: "no name" }, { who: "C" }, { who: "D", line: "E" }, { who: "F", line: "G" }],
    asks: "What are you doing about it?",
  });
  assert.equal(out.scene.length, 700);
  assert.equal(out.voices.length, 3, "a voice with nothing to say is not a voice");
  assert.equal(out.asks, "What are you doing about it?");
});

test("the judgement is the only number, and it is on a scale", () => {
  assert.equal(validateJudgement({ judgement: 9 }).judgement, 3);
  assert.equal(validateJudgement({ judgement: -9 }).judgement, -3);
  assert.equal(validateJudgement({ judgement: 1.6 }).judgement, 2);
  assert.equal(validateJudgement({}).judgement, 0, "a missing score resolves at neutral");
  assert.equal(validateJudgement(null).judgement, 0);
});

/**
 * From a live session on a 14b: the room was a cyber attack on the power and
 * water utilities, and the answer released forty million barrels from the
 * strategic reserve and put the Coast Guard on containment. It scored +2. The
 * model rewards a crisp, specific, well-staffed decision and does not reliably
 * check what the decision is *about* — and saying so in the prompt did not fix
 * it, so the engine checks instead.
 */
test("an answer to a different crisis is not an answer", () => {
  const opening = {
    asks: "What immediate action should be taken to address the cyber attack on critical infrastructure?",
    scene: "The screen shows outages across the energy and water utilities of four states.",
  };
  const refineries = "Release forty million barrels from the strategic reserve today. Coast Guard "
    + "takes the containment lead, EPA stays on air quality only. I want both refinery operators "
    + "in this building by Thursday.";

  assert.equal(answersTheRoom(opening, refineries), false);
});

test("and one that engages with it is left to the model to judge", () => {
  const opening = {
    asks: "What immediate action should be taken to address the cyber attack on critical infrastructure?",
    scene: "The screen shows outages across the energy and water utilities of four states.",
  };
  const engaged = "Emergency authority over the affected utilities tonight, and the Guard's cyber "
    + "units into the three worst states by morning. Attribution can wait; water cannot.";

  assert.equal(answersTheRoom(opening, engaged), true);
});

test("the check stands down when there is nothing to check", () => {
  // A short answer is a legitimate move — "no comment" is sometimes the right
  // one — and an opening with nothing in it cannot be answered wrongly.
  assert.equal(answersTheRoom({ asks: "What are you doing about it?" }, "No comment."), true);
  assert.equal(answersTheRoom({}, "A long and detailed answer about absolutely anything at all."), true);
});

test("every room has a written version, so a sleeping model is not a cancelled meeting", () => {
  for (const room of ROOMS) {
    const written = writtenOpening(room.id);
    assert.ok(written.scene.length > 40, `${room.id} has no written scene`);
    assert.ok(written.asks.length > 5, `${room.id} asks nothing`);
  }
});

test("and an offline score that rewards saying something over saying nothing", () => {
  const s = president();
  const nothing = writtenJudgement(s, "press", "no comment");
  const something = writtenJudgement(s, "press",
    "We knew in March. The Inspector General will publish the timeline this week, the deputy "
    + "secretary resigned this morning, and I am not going to pretend the department covered "
    + "itself in glory. The families will be contacted directly before any of it is briefed out.");
  assert.ok(something.judgement > nothing.judgement,
    `${something.judgement} should beat ${nothing.judgement}`);
});
