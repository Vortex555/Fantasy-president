import { seeded } from "./rng.js";
import { CABINET_ROLES } from "./gameEngine.js";

/**
 * The government you appoint, rather than the one you are handed.
 *
 * A president arrived in office with eleven strangers already at the table,
 * generated off the hash of their own name, and the only post they had ever
 * chosen was the Vice President. Then the rooms made those strangers matter:
 * the plan you are offered in the Situation Room is only as good as the person
 * offering it, and being handed a Defense Secretary at competence 47 by an
 * algorithm is a different thing from picking one.
 *
 * So the transition is a decision. It is deliberately two decisions of very
 * different sizes — a doctrine that staffs the whole government in one click,
 * and then as many individual posts as you care enough to argue about. Nobody
 * should have to read thirty-six candidate cards to start a game, and nobody
 * who wants to should be stopped.
 */

/** Posts nobody picks from a slate: one is elected with you, one is married to you. */
const NOT_APPOINTED = new Set(["vp", "spouse"]);

/**
 * Computed on call rather than at import.
 *
 * gameEngine.js imports this module and this module imports its role table, so
 * reading `CABINET_ROLES` while that file is still evaluating throws — the
 * roles are a `const` and the binding is not initialised yet. A function
 * defers the read to the first time anybody actually wants the list, by which
 * point both modules exist.
 */
export const appointable = () => CABINET_ROLES.filter((r) => !NOT_APPOINTED.has(r.id));

/**
 * How a president staffs a government.
 *
 * Each is a real trade and none of them is the right answer. Loyalty buys a
 * cabinet that will not brief against you and cannot tell you when you are
 * wrong; competence buys the opposite. The bands are wide enough that any
 * doctrine still produces individuals worth knowing about — a cabinet where
 * everyone is 80 is as uninteresting as one where everyone is 50.
 */
export const DOCTRINES = [
  {
    id: "loyalists",
    name: "People you trust",
    blurb: "Friends, staffers, the ones who were there in the second month of the primary. "
      + "They will never brief against you, and they will never tell you the plan is bad.",
    loyalty: [62, 92],
    competence: [38, 72],
  },
  {
    id: "professionals",
    name: "People who can do the job",
    blurb: "Career appointments and safe hands. The government will run, the press will "
      + "approve, and at least two of them are already writing a book.",
    loyalty: [30, 62],
    competence: [62, 94],
  },
  {
    id: "balanced",
    name: "A bit of both",
    blurb: "A few of yours in the posts that matter to you, professionals everywhere else. "
      + "The ordinary way governments are assembled, and the reason most of them are average.",
    loyalty: [45, 80],
    competence: [48, 86],
  },
  {
    id: "rivals",
    name: "A team of rivals",
    blurb: "The people who ran against you and the ones who wanted your job. They are "
      + "formidable, they are watching, and every one of them has their own timetable.",
    loyalty: [18, 52],
    competence: [70, 96],
  },
];

export const doctrineById = (id) => DOCTRINES.find((d) => d.id === id) || DOCTRINES[2];

const between = (r, [lo, hi]) => Math.round(lo + r.next() * (hi - lo));

/** The three bargains on every slate. */
export const CANDIDATE_KEYS = ["loyalist", "professional", "operator"];

/**
 * The transition, as it arrives from a browser.
 *
 * Lives here rather than in the server's scenario sanitiser because that is
 * where it went wrong the first time: the doctrine was chosen, the override was
 * picked, the request carried both, the sanitiser copied neither, and the
 * president was sworn in with the same eleven strangers as always. Every unit
 * test passed, because they all called `createGame` directly and never crossed
 * the wire the feature actually travels on.
 *
 * @returns {{cabinetDoctrine?: string, cabinetPicks?: object}} only what is real
 */
export function sanitiseTransition(raw) {
  if (!raw?.cabinetDoctrine) return {};
  const out = { cabinetDoctrine: doctrineById(String(raw.cabinetDoctrine).slice(0, 20)).id };

  const posts = new Set(appointable().map((r) => r.id));
  const picks = {};
  for (const [role, key] of Object.entries(raw?.cabinetPicks || {})) {
    if (posts.has(role) && CANDIDATE_KEYS.includes(key)) picks[role] = key;
  }
  if (Object.keys(picks).length) out.cabinetPicks = picks;
  return out;
}

/**
 * Three ways to fill one post.
 *
 * The same three bargains the independent agencies already offer — see
 * `candidatesFor` in institutions.js — because it is the same decision and a
 * player who has learned to read one should not have to learn the other. The
 * doctrine sets the house style; a slate is where you depart from it.
 */
export function candidatesFor(scenario, roleId) {
  const role = appointable().find((r) => r.id === roleId);
  if (!role) return [];
  const seed = `${scenario?.presidentName || "potus"}|cabinet|${roleId}`;

  return [
    {
      key: "loyalist",
      ...person(`${seed}|loyalist`, [70, 95], [40, 70]),
      pitch: "Yours before any of this started. Will take the blame for you in public and has "
        + "never once been right about anything you did not already believe.",
    },
    {
      key: "professional",
      ...person(`${seed}|professional`, [40, 65], [70, 95]),
      pitch: "Ran something large and ran it well. Will tell you the plan is bad in front of "
        + "other people, which is what you are paying for.",
    },
    {
      key: "operator",
      ...person(`${seed}|operator`, [25, 50], [60, 88]),
      pitch: "Knows the building, the committees and everybody's price. Effective, and quite "
        + "openly running their own campaign at the same time.",
    },
  ].map((c) => ({ ...c, role: role.role, roleId: role.id, emoji: role.emoji, focus: role.focus }));
}

const FIRST = ["Marguerite", "Clay", "Rosalind", "Emeka", "Hollis", "Verna", "Sterling", "Otis",
  "Dov", "Marisol", "Terrence", "Nell", "Amos", "Priya", "Whit", "Adaeze", "Lionel", "Junko"];
const LAST = ["Kirkland", "Thorne", "Mercer", "Prentice", "Winthrop", "Ashford", "Calloway",
  "Boyle", "Ferris", "Okonjo", "Vance", "Radcliffe", "Nakamura", "Salas", "Ivory", "Ballard"];

function person(seed, loyalty, competence) {
  const r = seeded(seed);
  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    loyalty: between(r, loyalty),
    competence: between(r, competence),
  };
}

/**
 * The cabinet a scenario asked for.
 *
 * Returns only what the player decided — the doctrine's numbers for every post,
 * and the named individual for any post they picked personally. `buildCabinet`
 * in gameEngine.js still assembles the roster itself, because the VP, the
 * spouse and the personas all belong to it; this only says what the appointees
 * are like. A scenario with no doctrine gets nothing back and the old random
 * cabinet stands, which is what every save made before today has.
 */
export function appointments(scenario) {
  if (!scenario?.cabinetDoctrine) return null;
  const doctrine = doctrineById(scenario.cabinetDoctrine);
  const picks = scenario.cabinetPicks || {};
  const out = {};

  for (const role of appointable()) {
    const chosen = picks[role.id];
    if (chosen) {
      const candidate = candidatesFor(scenario, role.id).find((c) => c.key === chosen);
      if (candidate) {
        out[role.id] = {
          name: candidate.name,
          loyalty: candidate.loyalty,
          competence: candidate.competence,
          picked: candidate.key,
        };
        continue;
      }
    }
    const r = seeded(`${scenario.presidentName}|${doctrine.id}|${role.id}`);
    out[role.id] = {
      name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
      loyalty: between(r, doctrine.loyalty),
      competence: between(r, doctrine.competence),
      picked: null,
    };
  }
  return out;
}
