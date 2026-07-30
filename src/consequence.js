import { clamp, round1 } from "./rng.js";
import { billById } from "./bills.js";
import { SOCIETY_METRICS } from "./society.js";

/**
 * What passing a bill does to the country.
 *
 * This is the half of the chamber modes that was never built. Every bill in the
 * hand-written pool carries an `fx` block — what it does to the economy, to
 * poverty, to crime, to how many people have insurance — and in a congressional
 * career not one line of it was ever read. `enact()` in bills.js applies it when
 * a *president* signs, and a member never signs anything, so a twenty-year
 * Senate career that passed universal healthcare, a jobs guarantee and a crime
 * bill left a country whose statistics were identical, to the decimal, to one
 * that passed nothing at all.
 *
 * Which is why nothing in the mode felt like it was developing. It wasn't. The
 * only trace a bill left was one point off one problem's severity.
 *
 * Two rules hold everything here together:
 *
 * **The engine owns the numbers.** A model-written bill gets its effects from
 * its own position and subject through the table below, never by being asked
 * what it thinks it should do. A bill from the pool uses the effects a human
 * wrote for it, because those are better than anything derivable.
 *
 * **Passing the chamber is passing.** A real bill would still need the other
 * chamber and a signature, and modelling that would mean half the bills a
 * player fought for vanishing with no visible result — which is realistic and
 * ruinous for the one thing this exists to do, which is to make the line from a
 * vote to a changed country legible.
 */

/**
 * How a bill's subject and politics move the country, per unit of conviction.
 *
 * Read as: a bill in this domain, from this end of the spectrum, pushes these
 * things this way. Everything is scaled by how far from the centre the bill
 * actually sits, so a centrist compromise moves almost nothing and a bill at
 * the end of the spectrum moves a lot — which is the trade the whole mode is
 * about, since those are also the bills that cost you your seat.
 *
 * Deliberately blunt. It is a strategy game's model of legislation, not an
 * econometric one, and a player has to be able to predict it well enough to
 * make a decision.
 */
const LEVERS = {
  health: {
    left: { uninsured: -3.4, lifeExpectancy: 0.22, poverty: -0.2, debt: 1.1 },
    right: { uninsured: 2.2, lifeExpectancy: -0.12, debt: -0.7 },
  },
  economy: {
    left: { poverty: -0.7, unemployment: -0.18, homeownership: 0.25, debt: 1.3, gdpGrowth: 0.04 },
    right: { poverty: 0.4, gdpGrowth: 0.16, unemployment: -0.12, debt: 0.9, homeownership: -0.1 },
  },
  justice: {
    left: { crime: 9, unrest: -4.5, literacy: 0.05 },
    right: { crime: -17, unrest: 3.5 },
  },
  social: {
    left: { poverty: -0.5, literacy: 0.3, homeownership: 0.3, unrest: -2, debt: 0.7 },
    right: { literacy: -0.22, homeownership: 0.18, unrest: 1.5, poverty: 0.15 },
  },
  security: {
    left: { unrest: -2.5, debt: 0.5 },
    right: { unrest: 2.5, crime: -5, debt: 1.2 },
  },
  foreign: {
    left: { debt: 0.4, gdpGrowth: 0.03 },
    right: { debt: 0.8, gdpGrowth: -0.06, unrest: 1 },
  },
};

/** Which of the eight national statistics a key names, as opposed to the economy. */
const SOCIETY_KEYS = new Set(SOCIETY_METRICS.map((m) => m.id));
const ECONOMY_KEYS = new Set(["gdpGrowth", "unemployment", "inflation", "debt"]);

/**
 * A bill written to the centre is a bill nobody has to be brave about, and it
 * should not reshape the country either. Below this the effects round to
 * nothing on purpose.
 */
const CONVICTION_FLOOR = 0.1;

/**
 * What this bill would do, whoever wrote it.
 *
 * A pool bill's authored effects win outright — a human decided that the
 * Universal Coverage Act takes six points off the uninsured rate, and no table
 * is going to improve on that. Everything else is derived.
 */
export function effectsOf(bill) {
  const authored = billById(bill?.id);
  if (authored) return fromAuthored(authored);

  const axis = Number(bill?.axis) || 0;
  const conviction = Math.abs(axis);
  if (conviction < CONVICTION_FLOOR) return {};

  const table = LEVERS[bill?.domain] || LEVERS.social;
  const side = axis < 0 ? table.left : table.right;

  const out = {};
  for (const [key, per] of Object.entries(side)) {
    const value = round2(per * conviction);
    if (value) out[key] = value;
  }
  return out;
}

/** The pool's own numbers, flattened into the one shape this module applies. */
function fromAuthored(bill) {
  const out = {};
  for (const [key, value] of Object.entries(bill.fx?.economy || {})) {
    if (ECONOMY_KEYS.has(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(bill.society || {})) {
    if (SOCIETY_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Apply it, and say what it did.
 *
 * The returned deltas are what actually landed after clamping, not what was
 * asked for — so a country already at one per cent uninsured records the half
 * point it had left to give rather than the four the bill was worth. The record
 * has to be able to survive being read back years later and still add up.
 */
export function applyConsequence(state, bill) {
  const wanted = effectsOf(bill);
  const moved = {};

  for (const [key, delta] of Object.entries(wanted)) {
    if (ECONOMY_KEYS.has(key) && state.economy) {
      const before = state.economy[key];
      state.economy[key] = boundEconomy(key, before + delta);
      const actual = round2(state.economy[key] - before);
      if (actual) moved[key] = actual;
      continue;
    }
    if (SOCIETY_KEYS.has(key) && state.society) {
      const before = state.society[key];
      state.society[key] = boundSociety(key, before + delta);
      const actual = round2(state.society[key] - before);
      if (actual) moved[key] = actual;
    }
  }
  return moved;
}

const ECONOMY_BOUNDS = {
  gdpGrowth: [-7, 7], unemployment: [1.5, 25], inflation: [-3, 40], debt: [0, 400],
};

function boundEconomy(key, value) {
  const [lo, hi] = ECONOMY_BOUNDS[key] || [-Infinity, Infinity];
  return round1(clamp(value, lo, hi));
}

/**
 * Where each statistic is allowed to go.
 *
 * Floors and ceilings that are physically or politically real, so a long career
 * of one-directional legislating asymptotes instead of driving literacy through
 * a hundred per cent or crime below zero.
 */
const SOCIETY_BOUNDS = {
  population: [50, 900], poverty: [1.5, 60], crime: [15, 2000],
  lifeExpectancy: [45, 95], literacy: [40, 99.5], homeownership: [25, 85],
  uninsured: [0.3, 70], unrest: [0, 100],
};

function boundSociety(key, value) {
  const [lo, hi] = SOCIETY_BOUNDS[key] || [0, 100];
  return round1(clamp(value, lo, hi));
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The country's slow return to normal.
 *
 * Without this a single good decade is permanent and the game stops being about
 * anything. Crime drifts back toward its era's baseline, unrest cools, poverty
 * creeps — so a member who fixed something and then stopped watching finds it
 * unfixing itself, which is the truer thing about governing anyway.
 *
 * Deliberately slow: about a fortieth of the gap a month, so it never overtakes
 * what legislation does, it only makes it cost upkeep.
 */
const REVERSION = 0.025;

export function driftSociety(state, baseline) {
  if (!state.society || !baseline) return;
  for (const metric of SOCIETY_METRICS) {
    if (metric.id === "population") continue;   // population has its own trend
    const now = state.society[metric.id];
    const base = baseline[metric.id];
    if (now == null || base == null) continue;
    state.society[metric.id] = boundSociety(metric.id, now + (base - now) * REVERSION);
  }
  // People keep being born, a little faster in a country that is doing well.
  if (state.society.population != null) {
    const health = (state.society.lifeExpectancy ?? 77) - 70;
    state.society.population = round1(state.society.population * (1 + 0.0004 + health * 0.00004));
  }
}

/**
 * A problem left until it broke open takes its own bite out of the country.
 *
 * The same shape as a bill's effects and the opposite sign, so the chronicle
 * can put the two side by side: this is what the chamber built, and this is
 * what it lost by looking away.
 */
const DETONATION_DAMAGE = {
  economy: { poverty: 0.8, unemployment: 0.4, gdpGrowth: -0.4 },
  health: { lifeExpectancy: -0.5, uninsured: 1.6 },
  justice: { crime: 22, unrest: 7 },
  social: { unrest: 9, poverty: 0.5, literacy: -0.3 },
  security: { unrest: 8, crime: 12 },
  foreign: { gdpGrowth: -0.3, debt: 0.8, unrest: 4 },
};

export function applyDetonationDamage(state, domain) {
  return applyRaw(state, DETONATION_DAMAGE[domain] || DETONATION_DAMAGE.social);
}

/** Apply an explicit set of deltas, for effects that are not a bill's. */
export function applyRaw(state, deltas) {
  const moved = {};
  for (const [key, delta] of Object.entries(deltas)) {
    if (ECONOMY_KEYS.has(key) && state.economy) {
      const before = state.economy[key];
      state.economy[key] = boundEconomy(key, before + delta);
      const actual = round2(state.economy[key] - before);
      if (actual) moved[key] = actual;
    } else if (SOCIETY_KEYS.has(key) && state.society) {
      const before = state.society[key];
      state.society[key] = boundSociety(key, before + delta);
      const actual = round2(state.society[key] - before);
      if (actual) moved[key] = actual;
    }
  }
  return moved;
}

export { DETONATION_DAMAGE, SOCIETY_KEYS, ECONOMY_KEYS };
