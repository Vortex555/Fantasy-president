import { seeded, clamp, round1 } from "./rng.js";
import { activeArcs } from "./arcs.js";
import { severityWord } from "./nation.js";
import { committeeById } from "./committees.js";
import { inFlight } from "./passage.js";

/**
 * A member's month, as a building.
 *
 * The presidency got a schedule and the chambers did not, which left two thirds
 * of the game playing the way the whole game used to: one long scrolling screen
 * with every lever stacked on it, and a button at the bottom that ended the
 * month. Everything a member does existed — casework, hearings, the petition,
 * the whip — and none of it was ever *waiting* for them. Nothing could be
 * neglected because nothing was ever offered.
 *
 * The engine is the presidency's, unchanged: a room accumulates exposure while
 * you stay out of it, faster in the months it had something urgent, and
 * eventually something gives. What differs is what these rooms can do to you.
 * A president who skips the press corps loses the country; a member who skips
 * their district office loses the eleven hundred people whose passport
 * applications are sitting in it, which is a smaller and much more personal
 * kind of ruin.
 */

const seatName = (state) => (state.office === "senate"
  ? state.seat?.stateName || "your state"
  : state.seat?.district || "your seat");

const worstArc = (state) => activeArcs(state)
  .slice()
  .sort((a, b) => b.severity - a.severity)[0] || null;

/**
 * The five standing appointments of a congressional office.
 *
 * Chosen because each is a different constituency with a different hold over
 * you — the people who elected you, the committee that gives you a subject, the
 * leadership that gives you a schedule, the colleagues who owe you, and the
 * paper that tells your district what you did. A member who serves all five is
 * doing the job; nobody has ever had time to.
 */
export const CHAMBER_ROOMS = [
  {
    id: "district",
    name: "The District Office",
    emoji: "🏛️",
    who: "Your caseworkers",
    invite: "Sign the letters, take the hard calls, and hear what is actually happening at home.",
    stakes: { approval: 2.0, casework: 4 },
    /**
     * The queue is derived, not stored.
     *
     * `state.casework` is a career total of cases *handled* — it only ever goes
     * up — and reading it as a backlog gave a freshly sworn-in member a
     * district office advertising "0 cases open". A room with nothing concrete
     * in it is a room the model fills with whatever else it can see, and the
     * first live session produced caseworkers briefing a Representative on
     * national platform-regulation strategy. So the waiting list is generated
     * per month from the seat, the way every other unstored fact in this game
     * is, and it is never empty because a congressional office never is.
     */
    offer(state) {
      const r = seeded(`${state.rosterSeed || "seat"}|cases|${state.term || 1}|${state.month}`);
      const waiting = r.between(9, 48);
      if (state.caseworkThisMonth) {
        return { line: "This week's surgery is done. The post has not stopped.", urgency: 0 };
      }
      if (waiting > 34) {
        return { line: `${waiting} open cases and a full waiting room on Friday.`, urgency: 3 };
      }
      return {
        line: `${waiting} open cases — veterans' benefits, a passport for a funeral, somebody's mother.`,
        urgency: waiting > 18 ? 2 : 1,
      };
    },
    breaks(state) {
      return {
        note: `Nobody in ${seatName(state)} has been able to get an answer out of your office for `
          + "months. The local paper found three of them and printed all three.",
        effects: { approval: -6 },
      };
    },
  },
  {
    id: "committee",
    name: "The Committee Room",
    emoji: "⚖️",
    who: "Your committee, and whoever is testifying",
    invite: "Read the brief, ask the question nobody else has thought of, and be seen doing it.",
    stakes: { profile: 1.6, leadership: 1.2 },
    offer(state) {
      const committee = committeeById(state.committee);
      const gavel = ["subchair", "chair", "speaker"].includes(state.rank);
      const arc = worstArc(state);
      if (!committee) return { line: "No committee, so nothing is in your name yet.", urgency: 0 };
      if (arc && committee.domains?.includes(arc.domain)) {
        return {
          line: `${arc.title} is ${severityWord(arc.severity)} and it is ${committee.name}'s subject.`,
          urgency: 3,
        };
      }
      return {
        line: gavel
          ? `${committee.name}: your markup, your witnesses, your quorum to hold.`
          : `${committee.name} is marking up, and the members who turn up ask the questions.`,
        urgency: gavel ? 2 : 1,
      };
    },
    breaks(state) {
      const committee = committeeById(state.committee);
      return {
        note: `${committee?.name || "Your committee"} met without you again. Somebody junior to `
          + "you asked the question that made the evening news, and it is their subject now.",
        effects: { profile: -8, leadership: -4 },
      };
    },
  },
  {
    id: "caucus",
    name: "The Caucus Room",
    emoji: "🗣️",
    who: "Leadership and the whip",
    invite: "Find out what the vote is worth this week, and what they will remember.",
    stakes: { leadership: 2.2, capital: 3 },
    offer(state) {
      const pending = (state.docket?.bills || []).length;
      if (state.vacancy) return { line: "No Speaker, no schedule, and everybody is counting.", urgency: 3 };
      if ((state.leadership ?? 50) < 40) {
        return { line: "They have noticed how you have been voting. They would like a word.", urgency: 3 };
      }
      if (pending) return { line: `${pending} on the floor this week and the whip is short.`, urgency: 2 };
      return { line: "The weekly meeting: the schedule, the message, and who is in trouble.", urgency: 1 };
    },
    breaks() {
      return {
        note: "You have not been to a caucus meeting in months, so when the leadership needed "
          + "somebody for the difficult vote they did not think of you — and when the good "
          + "assignment came up they did not think of you either.",
        effects: { leadership: -7, capital: -4 },
      };
    },
  },
  {
    id: "cloakroom",
    name: "The Cloakroom",
    emoji: "🤝",
    who: "The people who owe you, and the ones you owe",
    invite: "The favours that make a bill move are agreed here, not on the floor.",
    stakes: { capital: 4, bloc: 1.4 },
    offer(state) {
      const mine = inFlight(state).filter((r) => r.yours && r.stage === "far");
      if (mine.length) {
        return { line: `${mine[0].title} needs friends in the other chamber.`, urgency: 3 };
      }
      if ((state.capital ?? 0) < 4) {
        return { line: "You have no favours to call in, which is a position rather than a strategy.", urgency: 2 };
      }
      return { line: "Half the chamber is in here and two of them want something from you.", urgency: 1 };
    },
    breaks() {
      return {
        note: "You have spent the session in your office. When your own bill needed three "
          + "signatures nobody could think of a reason to give you one.",
        effects: { capital: -6, bloc: -3 },
      };
    },
  },
  {
    id: "localpress",
    name: "The Local Press",
    emoji: "📻",
    who: "The county paper and the drive-time show",
    invite: "Explain the vote before somebody else explains it for you.",
    stakes: { approval: 1.6, profile: 1.2 },
    offer(state) {
      const last = (state.voteLog || []).slice(-1)[0];
      if (last && last.withDistrict === false) {
        return { line: `They want to know why you voted ${last.vote} on ${last.title}.`, urgency: 3 };
      }
      return {
        line: `${seatName(state)} wants ten minutes on the radio about anything at all.`,
        urgency: 1,
      };
    },
    breaks(state) {
      return {
        note: `You have not given ${seatName(state)} an interview in months. The paper ran your `
          + "voting record next to your challenger's explanation of it.",
        effects: { approval: -5, profile: -3 },
      };
    },
  },
];

/**
 * A member has a staff, not a cabinet.
 *
 * Three people, derived from the career seed rather than appointed — a member
 * does not get confirmation hearings for their legislative director, and making
 * the player hire one would be a transition screen for an office of nine. They
 * still differ, because the whole point of an advisor's recommendation is that
 * it is only as good as the person making it: a chief of staff at competence 82
 * proposes something that works and one at 44 proposes something with a hole in
 * it. See `advisorsFor` in rooms.js for the presidential version.
 */
const STAFF_ROLES = [
  { id: "chief", role: "Chief of Staff", emoji: "🗂️", rooms: ["caucus", "cloakroom", "committee", "district", "localpress"] },
  { id: "district_director", role: "District Director", emoji: "🏘️", rooms: ["district", "localpress"] },
  { id: "leg_director", role: "Legislative Director", emoji: "📑", rooms: ["committee", "caucus", "cloakroom"] },
  { id: "comms", role: "Communications Director", emoji: "📣", rooms: ["localpress", "district"] },
];

const FIRST = ["Rosalind", "Dov", "Marisol", "Terrence", "Nell", "Amos", "Priya", "Whit", "Junko", "Emeka"];
const LAST = ["Boyle", "Ferris", "Okonjo", "Vance", "Radcliffe", "Nakamura", "Salas", "Ivory", "Ballard"];

export function chamberStaff(state) {
  return STAFF_ROLES.map((role) => {
    const r = seeded(`${state?.rosterSeed || "seat"}|staff|${role.id}`);
    return {
      id: role.id,
      role: role.role,
      emoji: role.emoji,
      rooms: role.rooms,
      name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
      // A congressional office is small, underpaid and staffed by the young.
      // Nobody here is a cabinet secretary and nobody is useless either.
      competence: r.between(42, 88),
      loyalty: r.between(55, 95),
    };
  });
}

/** The three of them who would have a view on this room. */
export function chamberAdvisors(state, id) {
  const staff = chamberStaff(state);
  const relevant = staff.filter((s) => s.rooms.includes(id));
  return [...relevant, ...staff.filter((s) => !relevant.includes(s))].slice(0, 3);
}

/**
 * What a session does to a member.
 *
 * A different set of dials from the presidency's and deliberately so: there is
 * no stability here and no war chest, and the two that matter most — the seat
 * and the leadership — are the same two the floor screen has always shown,
 * because those are the two things a member is actually trading between.
 */
export function moveMember(next, stakes, magnitude) {
  const moved = {};
  for (const [key, per] of Object.entries(stakes || {})) {
    const delta = round1(magnitude * per);
    if (!delta) continue;

    if (key === "capital") {
      next.capital = Math.max(0, round1((next.capital ?? 0) + delta));
      moved.capital = delta;
    } else if (key === "casework") {
      // A career total of cases handled, which only ever goes up — the same
      // counter `doCasework` feeds, and the thing a member points at in a
      // re-election ad. See district.js.
      next.casework = Math.max(0, round1((next.casework ?? 0) + delta));
      moved.casework = delta;
    } else if (key === "profile") {
      next.profile = clamp(round1((next.profile ?? 0) + delta), 0, 100);
      moved.profile = delta;
    } else if (key === "bloc") {
      next.bloc = clamp(round1((next.bloc ?? 50) + delta));
      moved.bloc = delta;
    } else {
      next[key] = clamp(round1((next[key] ?? 50) + delta));
      moved[key] = delta;
    }
  }
  return moved;
}
