import { round1 } from "./rng.js";
import { SOCIETY_METRICS } from "./society.js";
import { absoluteMonth } from "./nation.js";
import { nationalProfile } from "./demographics.js";

/**
 * The country, month by month, for as long as the career lasts.
 *
 * A congressional career recorded almost nothing about itself: one line in
 * `history` per election, and otherwise only the present tense. You could see
 * what the country was, never what it had been, so nothing could be seen to
 * develop — which is a strange thing for a mode whose whole subject is thirty
 * years of somebody else's decisions accumulating around you.
 *
 * So every month leaves an entry, and the entries are the game's memory. They
 * are what the charts are drawn from, what "the country you found and the
 * country you leave" is computed against, and what lets a bill passed in a
 * member's second term still be pointed at as the reason a line bends.
 *
 * Keys are short because this is the one structure that grows without bound —
 * a three-term Senate career is 216 of them — and it rides in the save file.
 */

/** Long name to short key, for the compact record. */
const ECON_KEYS = { gdpGrowth: "g", unemployment: "u", inflation: "i", debt: "d" };
/** The country's composition, on the same compact keys as everything else. */
const PEOPLE_KEYS = {
  age: "pa", over65: "p65", college: "pc", income: "pi",
  rural: "pr", urban: "pu", union: "pn", faith: "pf", manufacturing: "pm",
};

const SOC_KEYS = {
  population: "pop", poverty: "pov", crime: "cri", lifeExpectancy: "life",
  literacy: "lit", homeownership: "own", uninsured: "unins", unrest: "unr",
};

const pack = (source, keys) => {
  if (!source) return null;
  const out = {};
  for (const [long, short] of Object.entries(keys)) {
    if (source[long] != null) out[short] = round1(source[long]);
  }
  return out;
};

const unpack = (packed, keys) => {
  if (!packed) return null;
  const out = {};
  for (const [long, short] of Object.entries(keys)) {
    if (packed[short] != null) out[long] = packed[short];
  }
  return out;
};

/**
 * What happened this month, beyond the numbers.
 *
 * These are the annotations the charts hang off — the reason a line bends. Kept
 * to what a player would actually point at years later: a bill that became law,
 * a problem that was finally settled, a problem that was left until it broke,
 * and the nights the country voted.
 */
export const EVENT = {
  PASSED: "passed",
  FAILED: "failed",
  RESOLVED: "resolved",
  DETONATED: "detonated",
  ELECTION: "election",
  /**
   * What the other end of the building did with it.
   *
   * Clearing your own chamber used to be the end of a bill's life and the
   * moment the country changed. It is now the middle of the story, so the
   * record needs words for the rest of it: sent onward, killed over there,
   * cut down to something the far chamber would take, vetoed, and — the only
   * one of them that moves a number — signed into law.
   */
  SENT: "sent",
  BLOCKED: "blocked",
  GUTTED: "gutted",
  VETOED: "vetoed",
  ENACTED: "enacted",
};

/**
 * Close the month off.
 *
 * Called at the end of a chamber's advance, after the votes are in, the country
 * has moved and the problems have been re-scored — so the entry is the month as
 * it finished rather than as it began.
 */
/** The calendar year a career's month falls in. */
const yearOf = (state) =>
  (state?.scenario?.startYear || 2025) + Math.floor((absoluteMonth(state) - 1) / 12);

export function recordMonth(state, events = []) {
  const entry = {
    m: absoluteMonth(state),
    t: state.term || 1,
    mo: state.month,
    e: pack(state.economy, ECON_KEYS),
    s: pack(state.society, SOC_KEYS),
    // The two numbers that are the member's own, and the one that is the wave
    // they run in.
    a: round1(state.approval ?? 50),
    l: round1(state.leadership ?? 50),
    p: round1(state.president?.approval ?? 50),
    /**
     * And who the country was that month.
     *
     * The electorate moves slowly enough that no single month shows it and a
     * twenty-year career cannot miss it, which is exactly what the record exists
     * to make visible. See demographics.js.
     */
    d: pack(state.country || nationalProfile(yearOf(state)), PEOPLE_KEYS),
    mg: state.migration ?? 1,
    // Where the country's problems stood when the month closed.
    pb: (state.arcs || []).map((x) => ({ id: x.id, sv: x.severity })),
  };
  if (events.length) entry.ev = events;

  state.chronicle = [...(state.chronicle || []), entry];
  return state;
}

/** An event worth annotating a chart with. */
export function noteEvent(kind, { title, domain, moved, vote, tally } = {}) {
  const note = { k: kind };
  if (title) note.ti = String(title).slice(0, 90);
  if (domain) note.dm = domain;
  // What it actually did to the country, so the chart can say why a line bent.
  if (moved && Object.keys(moved).length) note.mv = moved;
  // Which way the member personally went, which is the whole point of showing it.
  if (vote) note.v = vote;
  if (tally) note.ta = tally;
  return note;
}

// --- Reading it back ---------------------------------------------------------

/**
 * The country you found and the country you leave.
 *
 * The comparison the whole feature exists to make. Every indicator, where it
 * started, where it is, and whether that direction is the good one — which
 * differs per statistic and is the sort of thing a player should never have to
 * remember (crime down is good, home ownership down is not).
 */
export function thenAndNow(state) {
  const log = state.chronicle || [];
  if (!log.length) return null;
  const first = log[0];
  const last = log[log.length - 1];

  const rows = [];

  for (const metric of SOCIETY_METRICS) {
    const short = SOC_KEYS[metric.id];
    if (!short || first.s?.[short] == null) continue;
    rows.push(row(metric, first.s[short], last.s[short], log.map((x) => x.s?.[short])));
  }

  for (const [long, short] of Object.entries(ECON_KEYS)) {
    if (first.e?.[short] == null) continue;
    rows.push(row(ECONOMY_METRICS[long], first.e[short], last.e[short], log.map((x) => x.e?.[short])));
  }

  const people = [];
  for (const [long, short] of Object.entries(PEOPLE_KEYS)) {
    if (first.d?.[short] == null) continue;
    people.push(row(PEOPLE_METRICS[long], first.d[short], last.d[short], log.map((x) => x.d?.[short])));
  }

  return {
    people,
    from: { term: first.t, month: first.mo, absolute: first.m },
    to: { term: last.t, month: last.mo, absolute: last.m },
    months: log.length,
    rows,
  };
}

/**
 * The country's composition, described the same way.
 *
 * `better` is deliberately null on every one of these. A country becoming older
 * or more secular or less unionised is not a success or a failure — it is a
 * change, and which way a player feels about it is the entire point of having
 * politics. The economy and the eight statistics get an arrow; these get a
 * direction and no verdict.
 */
const PEOPLE_METRICS = {
  age: { id: "age", name: "Median age", unit: "", decimals: 1, better: null },
  over65: { id: "over65", name: "Over 65", unit: "%", decimals: 0, better: null },
  college: { id: "college", name: "Graduates", unit: "%", decimals: 0, better: null },
  income: { id: "income", name: "Median income", unit: "k", decimals: 0, better: null },
  rural: { id: "rural", name: "Rural", unit: "%", decimals: 0, better: null },
  urban: { id: "urban", name: "Urban", unit: "%", decimals: 0, better: null },
  union: { id: "union", name: "Union households", unit: "%", decimals: 0, better: null },
  faith: { id: "faith", name: "Weekly attendance", unit: "%", decimals: 0, better: null },
  manufacturing: { id: "manufacturing", name: "Manufacturing jobs", unit: "%", decimals: 0, better: null },
};

/** The economy, described the same way the social statistics are. */
const ECONOMY_METRICS = {
  gdpGrowth: { id: "gdpGrowth", name: "GDP growth", unit: "%", decimals: 1, better: "up" },
  unemployment: { id: "unemployment", name: "Unemployment", unit: "%", decimals: 1, better: "down" },
  inflation: { id: "inflation", name: "Inflation", unit: "%", decimals: 1, better: "down" },
  debt: { id: "debt", name: "National debt", unit: "T", decimals: 1, better: "down" },
};

function row(metric, from, to, series) {
  const change = round1(to - from);
  // A composition has no better or worse; it only has a direction.
  if (metric.better === null) {
    return {
      id: metric.id, name: metric.name, unit: metric.unit,
      from, to, change, direction: "neutral", series: series.filter((v) => v != null),
    };
  }
  const better = metric.better === "up" ? change > 0 : change < 0;
  return {
    id: metric.id,
    name: metric.name,
    unit: metric.unit,
    from,
    to,
    change,
    // Not merely the sign: whether this is the direction a country wants.
    direction: change === 0 ? "flat" : better ? "better" : "worse",
    series: series.filter((v) => v != null),
  };
}

/**
 * What moved them.
 *
 * The annotated events, largest effect first, so the screen can show the four
 * or five things that actually shaped this country rather than every roll call
 * of a twenty-year career. "Largest" is measured against how far the statistic
 * itself travelled, so half a year of life expectancy ranks against ninety
 * points of crime honestly instead of by raw magnitude.
 */
export function turningPoints(state, limit = 8) {
  const log = state.chronicle || [];
  const spread = spreadOf(log);
  const out = [];

  for (const entry of log) {
    for (const ev of entry.ev || []) {
      if (!ev.mv && ev.k !== EVENT.DETONATED && ev.k !== EVENT.ELECTION) continue;
      out.push({
        term: entry.t,
        month: entry.mo,
        absolute: entry.m,
        kind: ev.k,
        title: ev.ti || "",
        domain: ev.dm || null,
        moved: ev.mv || {},
        vote: ev.v || null,
        tally: ev.ta || null,
        weight: weigh(ev, spread),
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/** How far each statistic travelled across the whole career, for scale. */
function spreadOf(log) {
  const range = {};
  const track = (key, value) => {
    if (value == null) return;
    const r = range[key] || (range[key] = { lo: value, hi: value });
    r.lo = Math.min(r.lo, value);
    r.hi = Math.max(r.hi, value);
  };
  for (const entry of log) {
    for (const [, short] of Object.entries(ECON_KEYS)) track(short, entry.e?.[short]);
    for (const [, short] of Object.entries(SOC_KEYS)) track(short, entry.s?.[short]);
  }
  const out = {};
  for (const [key, r] of Object.entries(range)) out[key] = Math.max(0.1, r.hi - r.lo);
  return out;
}

/** Long keys in `moved`, short keys in `spread` — this is the bridge. */
const SHORT_OF = { ...ECON_KEYS, ...SOC_KEYS };

function weigh(ev, spread) {
  // A problem breaking open is always worth showing; it is the most expensive
  // thing that can happen and the player chose it by omission.
  let weight = ev.k === EVENT.DETONATED ? 2 : ev.k === EVENT.ELECTION ? 1.2 : 0;
  for (const [key, delta] of Object.entries(ev.mv || {})) {
    const short = SHORT_OF[key] || key;
    weight += Math.abs(delta) / (spread[short] || 1);
  }
  return weight;
}

/**
 * The series a chart needs, already thinned.
 *
 * A three-term Senate career is 216 points and a sparkline is sixty pixels
 * wide, so this samples rather than handing the client everything and asking it
 * to cope.
 */
export function series(state, key, points = 48) {
  const log = state.chronicle || [];
  const short = SHORT_OF[key] || key;
  const values = log
    .map((x) => (x.e?.[short] ?? x.s?.[short] ?? (key === "approval" ? x.a : key === "leadership" ? x.l : key === "president" ? x.p : null)))
    .filter((v) => v != null);

  if (values.length <= points) return values;
  const step = values.length / points;
  return Array.from({ length: points }, (_, i) => values[Math.floor(i * step)]);
}
