import test from "node:test";
import assert from "node:assert/strict";

import { CHAMBER_ROOMS, chamberStaff, chamberAdvisors } from "../src/chamberRooms.js";
import {
  ROOMS, registryFor, roomBoard, applySession, tickRooms, roomById, roomIdsFor,
} from "../src/rooms.js";
import { createHouseCareer, advanceHouseMonth } from "../src/house.js";
import { createSenateCareer } from "../src/senate.js";
import { writtenOpening, writtenOptions } from "../src/roomsAi.js";

/**
 * A member's month, as a building.
 *
 * The presidency got a schedule and the chambers did not, which left two thirds
 * of the game playing the way the whole game used to: one long scrolling screen
 * with every lever on it and a button at the bottom that ended the month.
 * Everything a member does already existed — casework, hearings, the whip — and
 * none of it was ever *waiting* for them, so none of it could be neglected.
 *
 * The engine below is the presidency's, unchanged. What is tested here is that
 * it is pointed at the right building, and that the five rooms cost a member
 * the things a member actually has.
 */

const member = (o = {}) => ({
  ...createHouseCareer({
    office: "house", presidentName: "Daniel Tolpa", party: "Republican",
    startYear: 2025, ideologyAxis: 0.9, ideology: "Groyper", district: "WV-2",
  }),
  ...o,
});

const senator = () => createSenateCareer({
  office: "senate", presidentName: "Daniel Tolpa", party: "Republican",
  startYear: 2025, ideologyAxis: 0.9, ideology: "Groyper", seatState: "WV",
});

// ---------------------------------------------------------------------------
// Which building
// ---------------------------------------------------------------------------

test("the registry follows the office, so one engine serves both", () => {
  assert.equal(registryFor(member()), CHAMBER_ROOMS);
  assert.equal(registryFor(senator()), CHAMBER_ROOMS);
  assert.equal(registryFor({ office: "president" }), ROOMS);
  assert.equal(registryFor(undefined), ROOMS, "an unknown career is a presidency, as everywhere");
});

test("a member's five rooms are a member's, and a president's six are not", () => {
  assert.deepEqual(roomIdsFor(member()), ["district", "committee", "caucus", "cloakroom", "localpress"]);
  assert.ok(roomIdsFor({ office: "president" }).includes("situation"));
  assert.equal(roomById("district").name, "The District Office");
  assert.equal(roomById("situation").name, "The Situation Room");
});

test("every room offers a member something specific", () => {
  for (const room of roomBoard(member(), null)) {
    assert.ok(room.line.length > 10, `${room.id} had nothing to say`);
    assert.ok(room.urgency >= 0 && room.urgency <= 3);
    assert.ok(room.who.length > 3, `${room.id} has nobody in it`);
  }
});

test("the size of the waiting room is what makes the district office urgent", () => {
  // Derived per month from the seat, so some months are a surgery and some are
  // a queue out of the door. Across a term both have to happen.
  const urgencies = new Set();
  for (let month = 1; month <= 24; month += 1) {
    urgencies.add(roomBoard(member({ month }), null).find((r) => r.id === "district").urgency);
  }
  assert.ok(urgencies.size > 1, "every month of a career cannot be equally busy");
});

// ---------------------------------------------------------------------------
// What a room can do to a member
// ---------------------------------------------------------------------------

test("the rooms move the things a member has, not the things a president has", () => {
  const s = member({ capital: 10, casework: 30, profile: 20 });
  const before = { approval: s.approval, leadership: s.leadership };

  const district = applySession(structuredClone(s), "district", 2);
  assert.ok(district.moved.approval > 0, "the district office is worth standing at home");
  assert.ok(district.moved.casework > 0, "and it closes cases");

  const caucus = applySession(structuredClone(s), "caucus", 2);
  assert.ok(caucus.moved.leadership > 0);
  assert.ok(caucus.moved.capital > 0, "leadership pays in favours");

  assert.equal(before.approval, s.approval, "and nothing is applied to the state you passed in");
});

/**
 * `casework` is a career total of cases *handled* and only ever goes up — the
 * counter `doCasework` feeds and the thing a member points at in a re-election
 * ad. Reading it as a backlog, which the first version of this room did, gave a
 * freshly sworn-in member a district office advertising "0 cases open" and a
 * session that quietly undid their own record.
 */
test("a session in the district office adds to the cases you have handled", () => {
  const s = member({ casework: 40 });
  applySession(s, "district", 3);
  assert.ok(s.casework > 40, `${s.casework} should be above 40`);
});

test("and the waiting room is never empty, because a congressional office never is", () => {
  for (const month of [1, 7, 19]) {
    const line = roomBoard(member({ month }), null).find((r) => r.id === "district").line;
    assert.doesNotMatch(line, /^0 /, `month ${month} advertised an empty office: ${line}`);
    assert.match(line, /\d+ open cases/);
  }
});

test("a member has no war chest and no cabinet stability to lose", () => {
  const s = member();
  applySession(s, "cloakroom", -3);
  assert.equal(s.warChest, undefined);
  assert.equal(s.stability, undefined);
  assert.ok(s.capital >= 0, "and favours never go below nothing");
});

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

test("one missed week is free for a member too", () => {
  const s = member();
  assert.deepEqual(tickRooms(s, null), []);
});

test("a term spent in none of them is a term the seat notices", () => {
  const s = member();
  let breaks = 0;
  for (let month = 1; month <= 24; month += 1) {
    s.month = month;
    breaks += tickRooms(s, s.situation).length;
  }
  assert.ok(breaks > 6, `ignoring the whole job should bite — got ${breaks}`);
  assert.ok(s.approval < 50, "and the seat is the first thing to go");
});

test("turning up everywhere is never punished", () => {
  const s = member();
  for (let month = 1; month <= 24; month += 1) {
    s.month = month;
    for (const id of roomIdsFor(s)) applySession(s, id, 0);
    assert.deepEqual(tickRooms(s, s.situation), [], `something broke in month ${month}`);
  }
});

test("the month tick runs the rooms, and the record remembers what broke", () => {
  const s = member({ month: 6 });
  // Enough absence that something has to give this month.
  s.rooms = Object.fromEntries(roomIdsFor(s)
    .map((id) => [id, { heat: 40, streak: 14, visited: 0, term: 1, done: false }]));

  const out = advanceHouseMonth(s);
  const next = out.state ?? out;
  assert.ok((next.roomBreaks || []).length, "a break has to leave a trace somebody can find later");
  for (const gone of next.roomBreaks) {
    assert.ok(gone.note.length > 30);
    assert.ok(roomIdsFor(next).includes(gone.room));
  }
});

// ---------------------------------------------------------------------------
// Who is advising
// ---------------------------------------------------------------------------

test("a member is advised by their own staff, not by a cabinet they do not have", () => {
  const s = member();
  const staff = chamberAdvisors(s, "district");
  assert.equal(staff.length, 3);
  assert.ok(staff.every((a) => a.name && a.role));
  assert.ok(staff.some((a) => a.id === "district_director"), "the district office hears from the district director");
  assert.equal(s.cabinet, undefined, "and there is no cabinet anywhere near this career");
});

test("the same seat has the same staff every month of the career", () => {
  const a = chamberStaff(member()).map((s) => `${s.name}${s.competence}`);
  const b = chamberStaff(member({ month: 19 })).map((s) => `${s.name}${s.competence}`);
  assert.deepEqual(a, b);
});

test("every chamber room has a written scene and three written plans", () => {
  const s = member();
  for (const id of roomIdsFor(s)) {
    const written = writtenOpening(id, s, null);
    assert.ok(written.scene.length > 40, `${id} has no written scene`);
    assert.ok(written.asks.length > 5, `${id} asks nothing`);
    assert.equal(written.options.length, 3, `${id} offers no recommendations offline`);
  }
  assert.ok(writtenOptions(s, "caucus").every((o) => o.plan.length > 20));
});

/**
 * A live session put the identical sentence in two advisors' mouths: one seed
 * for the whole room meant two people in the same competence band drew the same
 * written plan, and a room where two of three recommendations are word for word
 * the same reads as broken rather than as agreement.
 */
test("no two advisors ever offer the same words", () => {
  const s = member();
  for (const id of roomIdsFor(s)) {
    const plans = writtenOptions(s, id).map((o) => o.plan);
    assert.equal(new Set(plans).size, plans.length, `${id} repeated itself: ${plans.join(" || ")}`);
  }
});

test("and the written plans do not assume the speaker runs a federal agency", () => {
  // They were phrased for the West Wing and turned up in a district office
  // being offered to a backbencher about a passport backlog.
  const s = member();
  for (const id of roomIdsFor(s)) {
    for (const { plan } of writtenOptions(s, id)) {
      assert.doesNotMatch(plan, /inspector general|the agencies|White House/i, plan);
    }
  }
});
