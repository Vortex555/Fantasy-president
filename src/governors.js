import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { caucusBench } from "../public/js/data/government.js";

/**
 * The fifty governors.
 *
 * Until now a state was a number on a map — something that happened to the
 * president rather than something with a view of its own. A governor is the
 * other half of that: somebody with their own mandate, their own state, and no
 * obligation whatever to carry out federal policy they campaigned against.
 *
 * Two things follow, and both matter more than the defiance number itself.
 * First, a policy lands where it is implemented, so a hostile statehouse blunts
 * you in exactly the places you can least afford it. Second, governors are the
 * bench: the person who challenges you for the nomination, and the person who
 * beats you in November, is somebody whose state you have been looking at on
 * the map for four years.
 */

export const MAX_DEFIANCE = 100;

/** What a private understanding with a statehouse costs, in $M. */
export const COURTING_COST = 25;

/** How much defiance a single deal buys off. */
const COURTING_RELIEF = 26;

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

const presidentAxis = (state) => {
  const axis = Number(state?.scenario?.ideologyAxis);
  if (Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
  return partySign(state?.scenario?.party) * 0.45;
};

const govStates = () => STATE_CODES.filter((code) => code !== "DC");

const FIRST = [
  "Marguerite", "Clay", "Rosalind", "Emeka", "Delia", "Anders", "Junko", "Hollis", "Verna",
  "Sterling", "Perla", "Bertrand", "Wanda", "Adaeze", "Roscoe", "Simone", "Otis", "Farrah",
  "Clement", "Ezra", "Constance", "Milo", "Kiona", "Ferdinand", "Lucia", "Dov", "Alma", "Hugh",
];
const LAST = [
  "Kirkland", "Yarborough", "Thorne", "Underhill", "Mercer", "Nordstrom", "Prentice", "Radcliffe",
  "Sackville", "Winthrop", "Crenshaw", "Dunmore", "Ellery", "Fairweather", "Grimaldi", "Ipswich",
  "Kettering", "Lindberg", "Marchetti", "Nightingale", "Pankhurst", "Rutherford", "Tremaine",
  "Vandermeer", "Ashford", "Boone", "Calloway", "Duvall",
];

/**
 * The fifty, derived rather than stored.
 *
 * Same arrangement as Congress: a roster this size would multiply the save file
 * and every request, and it is entirely reproducible from the seed. Only the
 * part that actually changes — how defiant each one has become — is kept on the
 * state.
 */
export function governorRoster(state) {
  const seed = state.rosterSeed || state.scenario?.presidentName || "governors";
  const radical = state.scenario?.radicals === true;
  const used = new Set();

  return govStates().map((code) => {
    const info = STATES[code];
    const r = seeded(`${seed}|gov|${code}`);

    // A state usually elects its own politics, but roughly one in six does not
    // — which is where the interesting governors come from.
    const leansR = (info.lean ?? 0) > 0;
    const contrarian = r.chance(0.17);
    const party = (leansR !== contrarian) ? "Republican" : "Democrat";

    const bench = caucusBench(party, radical);
    const ideology = r.weighted(bench.items, bench.weights);

    let name;
    for (let i = 0; i < 24; i++) {
      name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
      if (!used.has(name)) break;
    }
    used.add(name);

    return {
      state: code,
      stateName: info.name,
      name,
      party,
      ideology: ideology.value,
      axis: ideology.axis,
      fringe: Boolean(ideology.fringe),
      // How badly they want the bigger job. This is what makes one of fifty
      // governors turn into a challenger and the other forty-nine not.
      ambition: r.between(20, 96),
      // Their own standing at home, which is what a national run is built on.
      standing: r.between(34, 88),
      ev: info.ev,
    };
  });
}

export function governorFor(state, code) {
  return governorRoster(state).find((g) => g.state === code) || null;
}

/**
 * Where each statehouse starts.
 *
 * Not zero: a president is inaugurated into a country that already has opinions
 * about them. The opposing party in a state that voted against them is hostile
 * on day one, and an ally in a friendly state will carry out almost anything.
 */
export function buildGovernors(state) {
  const sign = partySign(state.scenario?.party);
  const axis = presidentAxis(state);
  const out = {};

  for (const g of governorRoster(state)) {
    const opposed = partySign(g.party) !== sign && sign !== 0;
    // How far apart the two of them actually are, 0–2 on the shared spectrum.
    const distance = Math.abs(g.axis - axis);
    const lean = STATES[g.state]?.lean ?? 0;
    // A state that disagrees with the president emboldens its governor.
    const hostility = -sign * lean * 0.25;

    out[g.state] = clamp(Math.round(
      18 + (opposed ? 30 : 0) + distance * 16 + hostility
    ), 0, MAX_DEFIANCE);
  }
  return out;
}

/**
 * How much of a policy actually reaches the ground in a state.
 *
 * Never zero. A governor can slow-walk, litigate and refuse to staff a
 * programme, but they cannot repeal federal law — so total defiance still lets
 * roughly a third of the intent through.
 */
export function defianceDrag(defiance) {
  const d = clamp(Number(defiance) || 0, 0, MAX_DEFIANCE);
  return round1(1 - (d / MAX_DEFIANCE) * 0.65);
}

// How the president is treating the states.
//
// Note the two halves of each pattern. Whole words are anchored with \b, but
// stems are deliberately not — a trailing \b would make "federalis" fail to
// match "federalising", which is exactly the word a president reaches for.
const COOPERATIVE = new RegExp([
  "\\b(?:alongside|bipartisan|devolve|state-led|jointly)\\b",
  "work(?:ing)? with", "partner(?:ing|ship)? with", "in concert with",
  "consult", "block grant", "grants? to the states?",
  "governors? of", "with the (?:states?|governors?)",
].join("|"), "i");

const COERCIVE = new RegExp([
  "\\b(?:override|overrule|preempt|compel|seize|impose)\\b",
  "federalis", "federaliz", "nationalis", "nationaliz",
  "withhold(?:ing)? fund", "force the states?", "whatever they say",
  "by decree", "ignor(?:e|ing) the states?", "regardless of the states?",
  "over the objections? of",
].join("|"), "i");

/** Every state named in a policy, so the response is specific to who was hit. */
function statesNamedIn(text) {
  const t = String(text || "");
  const named = new Set();
  for (const code of govStates()) {
    const name = STATES[code].name;
    if (new RegExp(`\\b${name}\\b`, "i").test(t)) named.add(code);
    else if (new RegExp(`\\b${code}\\b`).test(t)) named.add(code);
  }
  return named;
}

/**
 * One month of the states reacting.
 *
 * A president who works through the governors calms them; one who goes over
 * their heads hardens them. States named explicitly move most, because being
 * singled out from Washington is a different thing from a national programme.
 * Everything else drifts slowly back toward where the politics says it belongs.
 */
export function tickGovernors(next, policyText = "") {
  next.governors = next.governors || buildGovernors(next);
  const baseline = buildGovernors(next);
  const named = statesNamedIn(policyText);

  const cooperative = COOPERATIVE.test(policyText);
  const coercive = COERCIVE.test(policyText);
  // Coercion wins when a president manages to do both in one sentence.
  const push = coercive ? 7 : cooperative ? -6 : 0;

  const events = [];
  for (const g of governorRoster(next)) {
    const code = g.state;
    const current = next.governors[code] ?? baseline[code];
    // Named states feel it properly; everyone else reads about it.
    const direct = named.has(code) ? 2.2 : 0.45;
    // Absent any push, a statehouse settles back toward its natural position.
    const settle = (baseline[code] - current) * 0.08;

    const moved = clamp(Math.round(current + push * direct + settle), 0, MAX_DEFIANCE);
    if (named.has(code) && Math.abs(moved - current) >= 8) {
      events.push({
        state: code,
        name: g.name,
        party: g.party,
        defiance: moved,
        detail: moved > current
          ? `Gov. ${g.name} of ${g.stateName} is publicly refusing to co-operate.`
          : `Gov. ${g.name} of ${g.stateName} has agreed to work with the administration.`,
      });
    }
    next.governors[code] = moved;
  }
  return events;
}

/**
 * A private understanding with a statehouse. Money, a project, a photograph
 * together — the currency is the same war chest the elections run on, which is
 * the point: every dollar spent calming Texas is a dollar not spent winning
 * Pennsylvania.
 */
export function courtGovernor(state, code) {
  if (code === "DC" || !STATES[code] || !govStates().includes(code)) {
    return { state, rejected: true, note: "There is no governor there." };
  }
  const chest = state.warChest ?? 0;
  if (chest < COURTING_COST) {
    return { state, rejected: true, note: `You cannot afford it — a deal runs to $${COURTING_COST}M.` };
  }

  const next = structuredClone(state);
  next.governors = next.governors || buildGovernors(next);
  const g = governorFor(next, code);
  const before = next.governors[code] ?? 50;
  // A true believer costs the same and yields less.
  const stubbornness = Math.abs(g.axis - presidentAxis(next)) * 0.4;
  const relief = Math.round(COURTING_RELIEF * (1 - Math.min(0.6, stubbornness)));

  next.governors[code] = clamp(before - relief, 0, MAX_DEFIANCE);
  next.warChest = round1(chest - COURTING_COST);

  return {
    state: next,
    governor: g,
    before,
    after: next.governors[code],
    note: `You came to an understanding with Gov. ${g.name} of ${g.stateName}. ` +
      `Their resistance fell from ${before} to ${next.governors[code]}, and it cost $${COURTING_COST}M ` +
      `you will not have in November.`,
  };
}

// --- The bench --------------------------------------------------------------

/**
 * Who is positioning for a run.
 *
 * A governor becomes a national figure by wanting it, by being popular at home,
 * and by having something to run against. The president's own weakness is part
 * of the calculation — nobody challenges a president at sixty per cent.
 */
export function risingStars(state) {
  const defiance = state.governors || buildGovernors(state);
  const axis = presidentAxis(state);
  const weakness = Math.max(0, 55 - (state.approval ?? 50));

  return governorRoster(state)
    .map((g) => ({
      ...g,
      defiance: defiance[g.state] ?? 40,
      score: round1(
        g.ambition * 0.5
        + g.standing * 0.35
        + (defiance[g.state] ?? 40) * 0.2
        + Math.abs(g.axis - axis) * 12
        + weakness * 0.4
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

/** The bench of one party, most plausible candidate first. */
export function benchFor(state, party) {
  return risingStars(state).filter((g) => g.party === party);
}

/** A one-line readout for the model's context block, only when it matters. */
export function governorsSummary(state) {
  const defiance = state.governors;
  if (!defiance) return "";
  const roster = governorRoster(state);
  const hostile = roster
    .filter((g) => (defiance[g.state] ?? 0) >= 70)
    .sort((a, b) => (defiance[b.state] ?? 0) - (defiance[a.state] ?? 0))
    .slice(0, 5);
  if (!hostile.length) return "";
  return `Statehouses in open resistance: ${hostile.map((g) =>
    `${g.stateName} (Gov. ${g.name}, ${g.party}, defiance ${defiance[g.state]})`).join("; ")}. ` +
    `Federal policy lands weakly in these states and they will litigate.`;
}
