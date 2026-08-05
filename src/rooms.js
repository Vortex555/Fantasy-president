import { seeded, clamp, round1 } from "./rng.js";
import { activeArcs } from "./arcs.js";
import { severityWord } from "./nation.js";
import { partyControl } from "./gameEngine.js";
import { foundingBlocs } from "./coalition.js";
import { CHAMBER_ROOMS, chamberAdvisors, moveMember } from "./chamberRooms.js";

/**
 * The president's month, as a building rather than a button.
 *
 * A term used to be forty-eight repetitions of one gesture: read the dashboard,
 * press Play, write a policy, read what happened. Everything else the office
 * involves — the press, the cabinet, the leadership of both chambers, the
 * intelligence people, the party's own money — existed in the simulation and
 * was met only in its consequences. You could serve four years without ever
 * taking a question.
 *
 * So the month is a set of rooms and none of them is compulsory. Each is a
 * standing appointment: it is offering something specific this month, it knows
 * how long since you were last in it, and it is perfectly capable of going
 * wrong in your absence. Nothing forces you into any of them and nothing stops
 * you ending the month having done none — which is a real strategy for exactly
 * as long as it works.
 *
 * The engine owns every number. A room's session is written by the model — the
 * questions, the argument in the room, what people say back — and comes back
 * carrying one judgement between -3 and +3, the same shape the debate scorer
 * has always used. What that judgement costs is decided here.
 */

// --- Neglect ------------------------------------------------------------------

/**
 * Below this, absence is just a quiet month. Above it, absence is a story.
 *
 * Read in months rather than points: a room with nothing much on gains 0.6 a
 * month and a room in crisis gains 1.8, so a quiet room is exposed after five
 * months of neglect and an urgent one after two. That gap is the mechanic. It
 * is not skipping the press briefing that ends a presidency, it is skipping the
 * press briefing in the month they had something to ask about.
 */
export const SAFE_HEAT = 3;
/**
 * Where the odds top out, so no amount of neglect is ever a certainty.
 *
 * Deliberately low. The first version ran to 0.55 and, with six rooms rolling
 * every month, a president who ignored everything ate twenty catastrophes in a
 * year — which is not a risk, it is a schedule. A third is enough that ignoring
 * a hot room is playing with fire and never enough that it stops being a bet.
 */
export const MAX_BREAK_CHANCE = 0.35;
const HEAT_BASE = 0.6;
const HEAT_PER_URGENCY = 0.4;

export const ROOM_IDS = ["situation", "press", "cabinet", "hill", "brief", "road"];

/**
 * A fresh set of appointments, none of them kept yet.
 *
 * `heat` is the exposure a room has accumulated, `streak` is how the screen
 * tells the player about it, and `visited` is the month it was last attended so
 * that an old save with none of this simply starts from cold.
 */
export const emptyRooms = (state = null) => Object.fromEntries(
  (state ? roomIdsFor(state) : ROOM_IDS)
    .map((id) => [id, { heat: 0, streak: 0, visited: 0, term: 0, done: false }]),
);

/** Old saves predate the whole system; nobody should crash for that. */
export function roomState(state, id) {
  return (state.rooms || {})[id] || { heat: 0, streak: 0, visited: 0, term: 0, done: false };
}

// --- What each room is offering this month ------------------------------------

const worstArc = (state) => activeArcs(state)
  .slice()
  .sort((a, b) => b.severity - a.severity)[0] || null;

/**
 * The six standing appointments of the office.
 *
 * `offer` is what is waiting in there *this month*, read out of the systems the
 * game already runs — it is not decoration, it is the reason to go in, and a
 * room with nothing to say says so. `urgency` is how much it costs to be
 * absent: a press room in a scandal month is not the same room as a press room
 * in a quiet one.
 *
 * `breaks` is what happens when accumulated absence finally produces an event.
 * It returns the line the player reads and the damage the engine applies —
 * never both from the model, and never a number the model chose.
 */
export const ROOMS = [
  {
    id: "situation",
    name: "The Situation Room",
    emoji: "🛰️",
    who: "The National Security Council",
    invite: "Write the response. The agencies are waiting on a decision, not a view.",
    /**
     * The month's situation is held by the client and posted with the request
     * rather than stored on the career, so it arrives as an argument. Every
     * other room reads its own subsystem off the state and ignores it.
     */
    offer(state, event) {
      const arc = worstArc(state);
      if (event?.title) {
        return { line: `${event.title} — the room wants a decision this month.`, urgency: 3 };
      }
      if (arc) {
        return {
          line: `${arc.title} is ${severityWord(arc.severity)} and nobody has been told what to do about it.`,
          urgency: Math.min(3, Math.max(1, arc.severity - 1)),
        };
      }
      return { line: "Nothing is on fire. The staff would like a steer anyway.", urgency: 0 };
    },
    breaks(state) {
      const arc = worstArc(state);
      return {
        note: arc
          ? `Nobody was in the chair. ${arc.title} was handled at staff level by people with no authority `
            + "to decide anything, and it got away from them."
          : "A decision that needed a president was taken by somebody who was not one, and it shows.",
        effects: { approval: -6, stability: -5 },
      };
    },
  },
  {
    id: "press",
    name: "The Press Briefing",
    emoji: "🎙️",
    who: "The White House press corps",
    invite: "Take the questions. Every one of them is going to be asked whether you are there or not.",
    /**
     * The press room is about whatever the country is about, which is the one
     * thing the first version of this did not read. It offered "the usual: the
     * economy, the schedule" in a month when protests had reached the Mall —
     * every other room was reacting to the news and the press corps, of all
     * people, was not.
     */
    offer(state, event) {
      const scandal = state.jeopardy?.status && state.jeopardy.status !== "none";
      if (scandal) return { line: "They are going to ask about the investigation, repeatedly.", urgency: 3 };
      /**
       * The headline stands as written rather than being folded into the
       * sentence. Lowercasing its first letter produced "every question is
       * going to be about cyber Attack on National Infrastructure" — a title in
       * title case with one letter knocked out of it, which reads worse than
       * either version whole.
       */
      if (event?.title) return { line: `They will ask about one thing: ${event.title}.`, urgency: 2 };
      const last = (state.history || []).slice(-1)[0];
      if (last?.approvalChange <= -3) {
        return { line: "They have the polling and they want to know what went wrong last month.", urgency: 2 };
      }
      return { line: "The usual: the economy, the schedule, and whatever leaked overnight.", urgency: 1 };
    },
    breaks() {
      return {
        note: "The podium has been empty for months, so the press wrote the story without you — "
          + "sourced entirely to people who do not like you.",
        effects: { approval: -5, press: true },
      };
    },
  },
  {
    id: "cabinet",
    name: "The Cabinet Table",
    emoji: "🪑",
    who: "Your secretaries",
    invite: "Hear the room, back somebody, and find out who is briefing against you.",
    offer(state) {
      const cabinet = state.cabinet || [];
      const worst = cabinet.slice().sort((a, b) => a.loyalty - b.loyalty)[0];
      if (worst && worst.loyalty < 45) {
        return { line: `${worst.role} ${worst.name} has been talking to reporters.`, urgency: 3 };
      }
      const weakest = cabinet.slice().sort((a, b) => a.competence - b.competence)[0];
      if (weakest && weakest.competence < 55) {
        return { line: `${weakest.role} ${weakest.name} is not on top of the department.`, urgency: 2 };
      }
      return { line: "Departmental business, and one turf war you could settle in ten minutes.", urgency: 1 };
    },
    breaks(state) {
      const worst = (state.cabinet || []).slice().sort((a, b) => a.loyalty - b.loyalty)[0];
      return {
        note: worst
          ? `${worst.role} ${worst.name} gave an interview. It was not cleared, and it was not kind.`
          : "Your own government briefed against you, and nobody at the table thought to warn you.",
        effects: { approval: -3, stability: -7 },
      };
    },
  },
  {
    id: "hill",
    name: "The Hill",
    emoji: "🏛️",
    who: "The leadership of both chambers",
    invite: "Find out what will actually pass, and what it costs to make it pass.",
    offer(state) {
      const control = partyControl(state);
      const mine = state.scenario?.party;
      const split = control.house !== control.senate;
      const bills = (state.bills || []).length;
      if (bills) return { line: `${bills} bill${bills === 1 ? "" : "s"} on your desk and a leadership that wants something for them.`, urgency: 2 };
      if (control.house !== mine && control.senate !== mine) {
        return { line: "Both chambers belong to the other side. Nothing moves without a conversation.", urgency: 3 };
      }
      return {
        line: split ? "A split Congress, which means two different prices for the same vote."
          : "Your own leadership, wanting to know what you will spend capital on.",
        urgency: 1,
      };
    },
    breaks() {
      return {
        note: "Your legislative programme is sitting in committee because nobody from this building "
          + "has been up there to ask about it. Leadership has moved on to their own priorities.",
        effects: { approval: -2, party: -8 },
      };
    },
  },
  {
    id: "brief",
    name: "The Intelligence Brief",
    emoji: "📕",
    who: "The Director of National Intelligence",
    invite: "Read it. Most of it is nothing. The rest is next month's crisis.",
    offer(state) {
      const wars = (state.deployments?.wars || []).filter((w) => w.status === "active").length;
      const exposure = Number(state.covert?.exposure) || 0;
      if (wars) {
        return {
          line: `${wars} deployment${wars === 1 ? "" : "s"} in the field, and today's traffic is about `
            + `${wars === 1 ? "it" : "them"}.`,
          urgency: 3,
        };
      }
      if (exposure >= 45) return { line: "An operation is live and the deniability is thinner than you were told.", urgency: 3 };
      return { line: "Foreign traffic, an economic assessment, and one thing they want you to see.", urgency: 1 };
    },
    breaks() {
      return {
        note: "Something was in the book for weeks. You had not opened the book, so the first you heard "
          + "of it was the same way the country did.",
        effects: { approval: -4, stability: -4, situation: true },
      };
    },
  },
  {
    id: "road",
    name: "The Road",
    emoji: "🚌",
    who: "The party, the donors, and everybody who put you here",
    invite: "Leave the building. Nobody was ever re-elected from the Oval Office.",
    offer(state) {
      const chest = Number(state.warChest) || 0;
      if (state.phase === "campaign") return { line: "You are on a ballot in months and the schedule is empty.", urgency: 3 };
      if (chest < 40) return { line: `$${Math.round(chest)}M in the account, which is not a campaign.`, urgency: 2 };
      return { line: "Two states that like you and one that does not. The party would like all three.", urgency: 1 };
    },
    breaks() {
      return {
        note: "You have not left Washington in months. The money has gone quiet, and the people who "
          + "knocked on doors for you are not sure you remember they exist.",
        effects: { approval: -2, party: -5, warChest: -25 },
      };
    },
  },
];

/**
 * Which building this career is in.
 *
 * The engine below — the exposure, the odds, the board, the tick — is identical
 * for a president and for a member, and the two registries differ only in what
 * is behind each door and what it can do to you. Resolving by office here means
 * every caller, the server routes included, works for both without knowing
 * there are two. See chamberRooms.js.
 */
const LEGISLATURES = new Set(["house", "senate", "statehouse"]);

export const registryFor = (state) => (LEGISLATURES.has(state?.office) ? CHAMBER_ROOMS : ROOMS);

export const roomIdsFor = (state) => registryFor(state).map((r) => r.id);

/** By id, across both buildings — a room id is unique to one of them. */
export const roomById = (id) => [...ROOMS, ...CHAMBER_ROOMS].find((r) => r.id === id) || null;

/**
 * Whose brief each room is.
 *
 * The three people who would actually be in the room with something to
 * recommend — which is what makes the cabinet you appointed matter after the
 * transition screen. A Situation Room staffed by a Defense Secretary you chose
 * for loyalty at competence 44 offers worse plans than one staffed by the
 * professional you passed over, and the difference is visible in the options
 * rather than hidden in a modifier.
 *
 * The domain-relevant secretary is added first where a room has one, so a
 * health crisis brings HHS to the table and an energy crisis brings Energy.
 */
const ROOM_ADVISORS = {
  situation: ["defense", "state", "dhs", "chief"],
  press: ["press", "chief", "vp"],
  cabinet: ["chief", "treasury", "ag"],
  hill: ["chief", "vp", "treasury"],
  brief: ["state", "defense", "dhs"],
  road: ["vp", "press", "chief"],
};

const DOMAIN_ADVISOR = {
  economy: "treasury", health: "hhs", security: "defense",
  justice: "ag", foreign: "state", social: "hud",
};

/**
 * The three people advising this room this month, in the order they matter.
 *
 * Never fewer than three where a cabinet exists, and never a duplicate — a
 * room offering two plans from the same secretary is a room that has been
 * padded rather than staffed.
 */
export function advisorsFor(state, id, event = null) {
  // A member has a staff of four in a corridor office, not a cabinet.
  if (registryFor(state) === CHAMBER_ROOMS) return chamberAdvisors(state, id);
  const cabinet = state.cabinet || [];
  const wanted = [DOMAIN_ADVISOR[event?.domain], ...(ROOM_ADVISORS[id] || [])].filter(Boolean);
  const seen = new Set();
  const out = [];

  for (const roleId of wanted) {
    if (seen.has(roleId)) continue;
    const member = cabinet.find((m) => m.id === roleId);
    if (!member) continue;
    seen.add(roleId);
    out.push(member);
    if (out.length === 3) return out;
  }
  // A cabinet missing the usual faces still fields somebody.
  for (const member of cabinet) {
    if (seen.has(member.id) || member.id === "spouse") continue;
    seen.add(member.id);
    out.push(member);
    if (out.length === 3) break;
  }
  return out;
}

// --- The board ----------------------------------------------------------------

/**
 * How likely absence is to bite, given what it has accumulated.
 *
 * Nothing at all below the safe line, because one skipped month has to be free
 * or the rooms are compulsory with extra steps. Above it the odds climb and
 * then flatten: a president who has ignored the press corps for a year should
 * expect the story, not be guaranteed it.
 */
export function breakChance(heat) {
  if (heat <= SAFE_HEAT) return 0;
  return Math.min(MAX_BREAK_CHANCE, Math.round((heat - SAFE_HEAT) * 0.08 * 100) / 100);
}

/** Everything the screen needs to draw the month. */
export function roomBoard(state, event = null) {
  return registryFor(state).map((room) => {
    const mine = roomState(state, room.id);
    const offer = room.offer(state, event) || { line: "", urgency: 0 };
    return {
      id: room.id,
      name: room.name,
      emoji: room.emoji,
      who: room.who,
      invite: room.invite,
      line: offer.line,
      urgency: offer.urgency,
      done: Boolean(mine.done),
      streak: mine.streak,
      heat: mine.heat,
      risk: breakChance(mine.heat),
      /**
       * Said in months rather than in a number, because "four months since you
       * took a question" is a fact about the presidency and "heat 6" is a fact
       * about the source code.
       */
      since: mine.streak === 0 ? "You were in here last month."
        : mine.streak === 1 ? "You missed it last month."
        : `${mine.streak} months since you were in here.`,
    };
  });
}

// --- Attending ----------------------------------------------------------------

/**
 * What a session did, once the model has judged it.
 *
 * The judgement is the only thing that crosses over, and it is deliberately one
 * small number: how the room took it, from -3 to +3. Everything the player sees
 * change is computed from that here, at a scale the room decides. A press
 * briefing that went badly costs approval; a cabinet table that went badly
 * costs stability; the Hill costs standing with your own party. The rooms are
 * different because what they can do to you is different.
 */
const ROOM_STAKES = {
  situation: { approval: 1.6, stability: 1.2 },
  press: { approval: 2.2 },
  cabinet: { stability: 2.4, approval: 0.4 },
  hill: { party: 2.6, approval: 0.5 },
  brief: { stability: 1.6, approval: 0.6 },
  road: { party: 1.8, warChest: 9 },
};

export function applySession(next, id, judgement) {
  const score = Math.max(-3, Math.min(3, Math.round(Number(judgement) || 0)));
  const room = registryFor(next).find((r) => r.id === id);
  /**
   * A room declares its own stakes where it has them — every chamber room does
   * — and the presidential six keep theirs in a table beside their registry.
   * What a session is worth is always the room's business and never the
   * model's.
   */
  const stakes = room?.stakes || ROOM_STAKES[id] || {};
  const moved = registryFor(next) === CHAMBER_ROOMS
    ? moveMember(next, stakes, score)
    : movePresidency(next, stakes, score);

  const mine = {
    ...roomState(next, id),
    done: true, heat: 0, streak: 0, visited: next.month, term: next.term || 1,
  };
  next.rooms = { ...(next.rooms || emptyRooms()), [id]: mine };
  return { score, moved };
}

/**
 * The four things a room can move, and how each of them is actually stored.
 *
 * "Party stability" is the one that catches people out, this file included: it
 * is not a field. It is derived from the blocs the president's own ideology
 * brought with them — see `partyStanding` — so a room that costs you standing
 * with your party has to cost you standing with those blocs, exactly as the
 * monthly turn already does when a president governs against their own
 * politics. Writing to a `partyStability` that does not exist would have looked
 * like it worked and changed nothing on the screen.
 */
function movePresidency(next, stakes, magnitude) {
  const moved = {};
  for (const [key, per] of Object.entries(stakes)) {
    const delta = round1(magnitude * per);
    if (!delta) continue;

    if (key === "warChest") {
      next.warChest = round1(Math.max(0, (next.warChest ?? 0) + delta));
      moved.warChest = delta;
    } else if (key === "party") {
      const blocs = foundingBlocs(next.scenario).filter((b) => b.pull > 0);
      const pool = blocs.length ? blocs : Object.keys(next.stakeholders || {}).map((id) => ({ id }));
      for (const bloc of pool) {
        if (next.stakeholders?.[bloc.id] == null) continue;
        next.stakeholders[bloc.id] = clamp(Math.round(next.stakeholders[bloc.id] + delta));
      }
      moved.party = delta;
    } else {
      next[key] = clamp(round1((next[key] ?? 50) + delta));
      moved[key] = delta;
    }
  }
  return moved;
}

// --- The month turning over ---------------------------------------------------

/**
 * Absence, accumulated and occasionally paid for.
 *
 * Run as the month ends, on every room the president did not enter. Exposure
 * grows by more in the months a room had something urgent, which is the whole
 * mechanic in one line: it is not skipping the press briefing that ends you, it
 * is skipping the press briefing in the month they had something to ask about.
 *
 * The roll is seeded on the career and the month, so a given month is not a
 * different month each time it is replayed, and a break is capped well short of
 * certain. Nothing here decides that a president is finished; it decides that
 * this was the month they found out what they had been getting away with.
 */
export function tickRooms(next, event = null) {
  const rooms = { ...(next.rooms || emptyRooms()) };
  const r = seeded(`${next.scenario?.presidentName || "potus"}|rooms|${next.term || 1}|${next.month}`);
  const events = [];

  for (const room of registryFor(next)) {
    const mine = { ...(rooms[room.id] || roomState(next, room.id)) };

    if (mine.done) {
      rooms[room.id] = { ...mine, done: false };
      continue;
    }

    const offer = room.offer(next, event) || { urgency: 0 };
    mine.streak += 1;
    mine.heat = round1(mine.heat + HEAT_BASE + (offer.urgency || 0) * HEAT_PER_URGENCY);

    if (r.next() < breakChance(mine.heat)) {
      const broke = room.breaks(next) || {};
      applyBreak(next, broke.effects || {});
      events.push({ room: room.id, name: room.name, note: broke.note || "", effects: broke.effects || {} });
      // It has happened; the exposure it had built is spent.
      mine.heat = 0;
      mine.streak = 0;
    }
    rooms[room.id] = mine;
  }

  next.rooms = rooms;
  return events;
}

const applyBreak = (next, effects) => (registryFor(next) === CHAMBER_ROOMS
  ? moveMember(next, effects, 1)
  : movePresidency(next, {
  approval: effects.approval || 0,
  stability: effects.stability || 0,
  party: effects.party || 0,
    warChest: effects.warChest || 0,
  }, 1));
