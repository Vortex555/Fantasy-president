"use strict";

import { seeded } from "./rng.js";
import { IDEOLOGIES, mainstreamIdeologies, fringeIdeologies } from "./ideologies.js";

/**
 * The people who actually hold office.
 *
 * 435 representatives, 100 senators and 9 justices, each with a name, a seat
 * and an ideology of their own. They are derived on demand from a seed stored
 * on the state rather than saved with it — 535 records would multiply the size
 * of every save and of every request sent to the server, and the whole roster
 * is reproducible from the seed anyway.
 *
 * Ideology is drawn from the member's own party, weighted so that most of a
 * caucus sits near its centre of gravity and the tails are thin. Nobody gets a
 * radical position unless Radicalised Government is switched on — a Theocrat
 * senator is a deliberate choice by the player, not background noise.
 */

// Where each party's caucus clusters. These are the "balanced" positions.
const PARTY_ANCHOR = { Democrat: -0.35, Republican: 0.45 };
const SPREAD = 0.34; // how far a normal caucus fans out around its anchor

const FIRST = [
  "Margaret", "James", "Elena", "Marcus", "Priya", "David", "Sofia", "Nathan", "Yuki", "Andre",
  "Rachel", "Tomás", "Grace", "Omar", "Nina", "Caleb", "Dana", "Ibrahim", "Coretta", "Walter",
  "Beatriz", "Hugh", "Ingrid", "Desmond", "Alma", "Curtis", "Naomi", "Rafael", "Tabitha", "Elias",
  "Colette", "Gordon", "Amara", "Victor", "Rosalind", "Hollis", "Junko", "Emeka", "Delia", "Anders",
  "Meredith", "Roscoe", "Lucia", "Bertrand", "Simone", "Otis", "Farrah", "Clement", "Wanda", "Ezra",
  "Constance", "Milo", "Adaeze", "Sterling", "Perla", "Lionel", "Marguerite", "Dov", "Kiona", "Ferdinand",
];

const LAST = [
  "Whitfield", "Okafor", "Castellano", "Nguyen", "Brennan", "Al-Rashid", "Sundqvist", "Delgado",
  "Harrington", "Petrov", "Osei", "Kaplan", "Romano", "Fairbanks", "Mbeki", "Larsson", "Pemberton",
  "Achebe", "Vance", "Lindqvist", "Ferraro", "Okonjo", "Brightwater", "Halloran", "Nakashima",
  "Ferreira", "Adeyemi", "Stroud", "Cardoza", "Whitlock", "Ashford", "Boone", "Calloway", "Duvall",
  "Emerson", "Fontaine", "Gallagher", "Hearst", "Ivers", "Jessup", "Kirkland", "Lamotte", "Mercer",
  "Nordstrom", "Ollivander", "Prentice", "Quimby", "Radcliffe", "Sackville", "Thorne", "Underhill",
  "Vasquez", "Wexler", "Yarborough", "Zamora", "Beaumont", "Crenshaw", "Dunmore", "Ellery", "Fairweather",
  "Grimaldi", "Hollingsworth", "Ipswich", "Jankowski", "Kettering", "Lindberg", "Marchetti", "Nightingale",
  "Ostrowski", "Pankhurst", "Rutherford", "Sinclair", "Tremaine", "Vandermeer", "Winthrop", "Yates",
];

const TITLES = { house: "Rep.", senate: "Sen." };

/**
 * The ideology bench a member of this party can draw from, with weights.
 * Normal service: mainstream only, clustered around the party's centre.
 * Radicalised: the fringe is included and heavily favoured.
 */
export function caucusBench(party, radical) {
  const anchor = PARTY_ANCHOR[party] ?? 0;
  const mainstream = mainstreamIdeologies(party);
  const gaussian = (i) => Math.exp(-(((i.axis - anchor) / SPREAD) ** 2));

  const items = [...mainstream];
  const weights = mainstream.map(gaussian);

  if (radical) {
    // "Very often" — the fringe should dominate a radicalised chamber rather
    // than merely appear in it.
    for (const i of fringeIdeologies(party)) {
      items.push(i);
      weights.push(gaussian(i) * 6 + 1.5);
    }
  }
  return { items, weights };
}

function memberName(r, used) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
  // Fall back to a suffix rather than loop forever on a small pool.
  const name = `${r.pick(FIRST)} ${r.pick(LAST)} ${used.size}`;
  used.add(name);
  return name;
}

/**
 * Real apportionment, derived from electoral votes: a state's House delegation
 * is its EV minus its two senators. The District has three electoral votes and
 * no voting members of either chamber.
 */
export function apportion(chamber, states) {
  const seats = [];
  for (const [code, info] of Object.entries(states)) {
    if (code === "DC") continue;
    const count = chamber === "house" ? Math.max(1, (info?.ev ?? 3) - 2) : 2;
    for (let i = 0; i < count; i++) {
      seats.push({ state: code, seat: chamber === "house" ? `${code}-${i + 1}` : code });
    }
  }
  return seats;
}

/**
 * Build one chamber. `seats` is `{ Democrat, Republican }`; members are placed
 * into real districts and the roster is ordered by state so it reads like a
 * directory.
 */
export function buildChamber({ seed, chamber, seats, radical = false, states = {} }) {
  const r = seeded(`${seed}|${chamber}|${radical ? "radical" : "normal"}`);
  const used = new Set();
  const benches = {
    Democrat: caucusBench("Democrat", radical),
    Republican: caucusBench("Republican", radical),
  };

  const districts = apportion(chamber, states);
  const total = seats.Democrat + seats.Republican;
  // Seat counts come from the game state and apportionment from the map; if
  // they disagree, the seat counts win and the tail is filled at large.
  while (districts.length < total) districts.push({ state: "US", seat: "at-large" });

  const parties = [
    ...Array(seats.Democrat).fill("Democrat"),
    ...Array(seats.Republican).fill("Republican"),
  ];
  // Shuffle so the two caucuses interleave across the states.
  for (let i = parties.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [parties[i], parties[j]] = [parties[j], parties[i]];
  }

  const roster = parties.map((party, index) => {
    const bench = benches[party];
    const ideology = r.weighted(bench.items, bench.weights);
    const district = districts[index];
    return {
      id: `${chamber}-${index}`,
      title: TITLES[chamber],
      name: memberName(r, used),
      party,
      state: district.state,
      seat: district.seat,
      ideology: ideology.value,
      axis: ideology.axis,
      // What the state may do to a person, which the roll call reads beside
      // the axis. A member without it is invisible to half of every bill
      // that is actually about state power. See `stanceFit` in bills.js.
      liberty: ideology.liberty ?? 0,
      fringe: Boolean(ideology.fringe),
    };
  });

  return roster.sort((a, b) => a.seat.localeCompare(b.seat, undefined, { numeric: true }));
}

/**
 * Both chambers, from the seat counts on the state and the apportionment
 * implied by `states` (the reference map of electoral votes per state).
 */
export function buildCongress(state, states = {}) {
  const seed = state.rosterSeed || state.scenario?.presidentName || "congress";
  const radical = state.scenario?.radicals === true;

  return {
    house: buildChamber({
      seed, chamber: "house", radical, states,
      seats: { Democrat: state.congress.houseD, Republican: state.congress.houseR },
    }),
    senate: buildChamber({
      seed, chamber: "senate", radical, states,
      seats: { Democrat: state.congress.senateD, Republican: state.congress.senateR },
    }),
  };
}

/**
 * The nine. A wider pool is generated than the bench needs, so that when the
 * balance shifts a new name appears rather than a sitting justice apparently
 * changing their mind.
 */
export function buildCourt({ seed, court, radical = false }) {
  const r = seeded(`${seed}|court|${radical ? "radical" : "normal"}`);
  const used = new Set();
  const pool = (party, count) => {
    const bench = caucusBench(party, radical);
    return Array.from({ length: count }, () => {
      const ideology = r.weighted(bench.items, bench.weights);
      return {
        name: `Justice ${memberName(r, used).split(" ")[1]}`,
        wing: party === "Republican" ? "conservative" : "liberal",
        ideology: ideology.value,
        axis: ideology.axis,
        fringe: Boolean(ideology.fringe),
        age: r.between(48, 82),
      };
    });
  };

  const conservatives = pool("Republican", 9);
  const liberals = pool("Democrat", 9);
  const seats = [
    ...conservatives.slice(0, court.conservative),
    ...liberals.slice(0, court.liberal),
  ];
  // The longest-serving of the majority wing holds the centre chair.
  if (seats.length) seats[Math.min(1, seats.length - 1)].chief = true;
  return seats;
}

/** Cabinet ideologies: an administration is staffed from the president's side. */
export function cabinetIdeology(seed, memberId, party, radical) {
  const bench = caucusBench(party === "Independent" ? "Republican" : party, radical);
  const r = seeded(`${seed}|cabinet|${memberId}`);
  const chosen = r.weighted(bench.items, bench.weights);
  return { ideology: chosen.value, axis: chosen.axis, liberty: chosen.liberty ?? 0,
    fringe: Boolean(chosen.fringe) };
}

/** A caucus broken down by ideology, most numerous first. */
export function caucusBreakdown(roster) {
  const counts = new Map();
  for (const m of roster) {
    const key = `${m.party}|${m.ideology}`;
    const entry = counts.get(key) || { party: m.party, ideology: m.ideology, fringe: m.fringe, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
