import { seeded, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";

/**
 * Who actually lives there.
 *
 * Every place in the game was a single number. A state carried a name, its
 * electoral votes, two map coordinates and a partisan lean; a district carried a
 * seat code and a lean and nothing else. Four hundred and thirty-five
 * constituencies, and the only thing distinguishing any of them was one integer
 * saying which way it votes — which is the *output* of a place's politics
 * standing in for the place.
 *
 * So a bill could never land differently in a college town and a mill town,
 * because as far as the engine was concerned they were the same object with
 * different numbers on it. The thirty recurring voters have demographics —
 * "Retired teacher, Ohio", "Rideshare driver, Georgia" — written as prose that
 * nothing has ever read.
 *
 * These are the axes that actually move American voting behaviour and that a
 * strategy game can simulate honestly: age, education, income, where people
 * live, what they do for work, whether they belong to a union, how often they
 * attend a service, and the census composition of the place.
 *
 * Composition is here because without it the model cannot represent the American
 * South at all. A poor rural district in Mississippi and one in West Virginia
 * have near-identical incomes, education and churchgoing and vote forty points
 * apart, and no other column in this file can tell them apart. It is also, on
 * the evidence, among the strongest predictors of American voting behaviour
 * there is, which is why every serious forecasting model uses it.
 *
 * Two rules keep it honest, and they are load-bearing rather than decorative:
 *
 * **The engine owns it.** Composition feeds a place's lean, its turnout and its
 * coalition. It is arithmetic about a place, in exactly the way union density
 * is, and no part of it is ever handed to a language model as licence to
 * characterise anybody.
 *
 * **It is not an interest group.** The bill-impact groups below are defined by a
 * shared material stake in specific legislation — union households, pensioners,
 * manufacturing workers, churchgoers. Composition is not that, and modelling it
 * as though a census category wants a particular bill would be both worse
 * political science and the thing worth avoiding. The policy dimension is
 * already carried by the civil-rights bloc in coalition.js.
 */

/**
 * The axes, with which direction each one pulls politically.
 *
 * `pull` is how a higher-than-average value moves a place's partisan lean, on
 * the same scale the lean itself uses. These are the well-attested modern
 * correlations and they are what keep a derived profile coherent with the lean
 * the game already assigned.
 */
export const AXES = [
  { id: "age", name: "Median age", unit: "", decimals: 1, pull: 0.9 },
  { id: "over65", name: "Over 65", unit: "%", decimals: 0, pull: 0.7 },
  { id: "college", name: "College degree", unit: "%", decimals: 0, pull: -1.5 },
  { id: "income", name: "Median income", unit: "k", decimals: 0, pull: -0.2 },
  { id: "rural", name: "Rural", unit: "%", decimals: 0, pull: 1.4 },
  { id: "suburban", name: "Suburban", unit: "%", decimals: 0, pull: 0.1 },
  { id: "urban", name: "Urban", unit: "%", decimals: 0, pull: -1.6 },
  { id: "manufacturing", name: "Manufacturing", unit: "%", decimals: 0, pull: 0.3 },
  { id: "union", name: "Union households", unit: "%", decimals: 0, pull: -0.8 },
  { id: "faith", name: "Weekly attendance", unit: "%", decimals: 0, pull: 1.3 },

  /**
   * Composition, as census categories.
   *
   * Among the strongest documented predictors of American voting behaviour, and
   * the reason a seat's politics can be unreadable from its economics alone: a
   * poor rural district in Mississippi and one in West Virginia have similar
   * incomes, similar education and similar churchgoing, and vote forty points
   * apart. Without this the model simply could not represent that, and it is not
   * a marginal case — it is most of the American South.
   *
   * `pull` here is observed vote share, nothing else. These are the historical
   * and structural patterns political scientists measure, not claims about
   * anybody's nature, and the engine only ever uses them the way it uses union
   * density: as arithmetic about a place.
   */
  { id: "white", name: "White", unit: "%", decimals: 0, pull: 0.9 },
  { id: "black", name: "Black", unit: "%", decimals: 0, pull: -2.2 },
  { id: "hispanic", name: "Hispanic", unit: "%", decimals: 0, pull: -0.9 },
  { id: "asian", name: "Asian", unit: "%", decimals: 0, pull: -0.7 },
];

/** Composition shares, which must add up to a population. */
const COMPOSITION = ["white", "black", "hispanic", "asian"];

export const AXIS_IDS = AXES.map((a) => a.id);
const axisById = (id) => AXES.find((a) => a.id === id);

/**
 * The country as a whole, by era.
 *
 * Approximations of real national figures, which is enough for a game and
 * honest about being enough for a game. The trends between them are the point:
 * America got older, far better educated, much more urban, much less unionised
 * and much less religious over this period, and a career spanning decades should
 * be able to watch that happen.
 */
const ERAS = [
  /**
   * A projection, so the present has a direction.
   *
   * Without a forward anchor the interpolation had nothing to aim at past the
   * last historical row: `nationalProfile(2025)` and `nationalProfile(2026)`
   * returned the same object, the derived monthly rate was exactly zero, and
   * every career beginning in the modern era — which is the default — had no
   * demographic drift whatsoever. Tests starting in 2005 all passed and hid it.
   *
   * Broadly the Census Bureau's mid-century projections. A projection rather
   * than a fact, and labelled as one.
   */
  { from: 2050, v: { age: 41.0, over65: 22, college: 45, income: 95, rural: 14, suburban: 55, urban: 31, manufacturing: 6, union: 7, faith: 18, white: 47, black: 12, hispanic: 25, asian: 9 } },
  { from: 2020, v: { age: 38.5, over65: 17, college: 38, income: 75, rural: 17, suburban: 52, urban: 31, manufacturing: 8, union: 10, faith: 24, white: 58, black: 12, hispanic: 19, asian: 6 } },
  { from: 2000, v: { age: 35.3, over65: 12, college: 26, income: 58, rural: 21, suburban: 50, urban: 29, manufacturing: 13, union: 13, faith: 33, white: 69, black: 12, hispanic: 13, asian: 4 } },
  { from: 1980, v: { age: 30.0, over65: 11, college: 17, income: 48, rural: 26, suburban: 45, urban: 29, manufacturing: 22, union: 23, faith: 40, white: 80, black: 12, hispanic: 6, asian: 2 } },
  { from: 1960, v: { age: 29.5, over65: 9, college: 8, income: 38, rural: 30, suburban: 33, urban: 37, manufacturing: 31, union: 31, faith: 47, white: 85, black: 11, hispanic: 3, asian: 1 } },
  { from: 1900, v: { age: 22.9, over65: 4, college: 3, income: 18, rural: 60, suburban: 12, urban: 28, manufacturing: 28, union: 7, faith: 52, white: 87, black: 12, hispanic: 1, asian: 0 } },
];

/**
 * The nation's composition in a given year, interpolated between the anchors.
 *
 * Stepping between eras rather than interpolating was the source of a
 * genuinely nasty bug. It left two disagreeing accounts of the same trend — this
 * table said the country went from twenty-six per cent graduates to thirty-eight
 * over twenty years, while a separate hand-set monthly drift rate moved a seat
 * by five — so every seat in the game fell steadily behind the national figure,
 * every seat's *relative* education collapsed, and every seat in the country
 * drifted fifteen points to the right over a career, including the college
 * cities. One trend, stated once, is the fix.
 */
export function nationalProfile(year = 2025) {
  const sorted = [...ERAS].sort((a, b) => a.from - b.from);
  const after = sorted.find((e) => e.from >= year);
  const before = [...sorted].reverse().find((e) => e.from <= year);
  if (!before) return { ...sorted[0].v };
  if (!after || after.from === before.from) return { ...before.v };

  const t = (year - before.from) / (after.from - before.from);
  const out = {};
  for (const axis of AXES) {
    out[axis.id] = before.v[axis.id] + (after.v[axis.id] - before.v[axis.id]) * t;
  }
  return out;
}

/** How much the country moves on each axis in a month, at this point in history. */
/**
 * The country a career is sworn into, as a thing that can be changed.
 *
 * `nationalProfile` reads the era table and is therefore a pure function of the
 * year — which meant the national composition was a backdrop no legislation
 * could touch. A member could pass immigration restriction for twenty years and
 * the country's trajectory was identical to one that passed none. This is the
 * same numbers as a stored profile, so the drift can be bent.
 */
export function seedCountry(year = 2025) {
  return { ...nationalProfile(year) };
}

export function nationalRate(year = 2025) {
  const now = nationalProfile(year);
  const next = nationalProfile(year + 1);
  const out = {};
  for (const axis of AXES) out[axis.id] = (next[axis.id] - now[axis.id]) / 12;
  return out;
}

/**
 * A place's own composition, derived rather than tabulated.
 *
 * Fifty-one states and four hundred and thirty-five districts is far too many to
 * hand-author without the numbers becoming noise, and the game already knows the
 * single most informative thing about each of them: how it votes. So the profile
 * is reconstructed from that.
 *
 * The reconstruction runs the correlation backwards. A place twenty points more
 * Republican than the country is, on average, more rural, less educated, more
 * observant and older — so the lean is used to displace each axis from the
 * national figure by that axis's own `pull`, and a seeded wobble is added so two
 * seats with identical leans are not identical places. A university town inside
 * a conservative state comes out as one, because its own lean says so.
 *
 * The consequence that matters: a profile can never contradict the lean the game
 * already assigned. They are the same fact stated twice.
 */
export function profileFor({ lean = 0, year = 2025, seed = "place", scale = 1 } = {}) {
  const base = nationalProfile(year);
  const r = seeded(`${seed}|demo`);
  const out = {};

  for (const axis of AXES) {
    // How far this place sits from the country, in that axis's own units.
    const spread = SPREAD[axis.id] ?? 8;
    const fromLean = (lean / 20) * axis.pull * spread * 0.28 * scale;
    const wobble = (r.next() - 0.5) * spread * 0.5;
    out[axis.id] = bound(axis.id, base[axis.id] + fromLean + wobble);
  }

  // Where people live has to add up to the whole of them, and so does who they are.
  normaliseSettlement(out);
  normaliseComposition(out);
  return out;
}

/**
 * The four composition shares, as parts of one population.
 *
 * Kept a little under a hundred, because the census categories here do not
 * exhaust the country — the remainder is everybody the four columns do not
 * describe, and pretending otherwise would be worse than leaving a gap.
 */
function normaliseComposition(p) {
  const total = COMPOSITION.reduce((sum, id) => sum + (p[id] || 0), 0);
  if (total <= 0) { p.white = 58; p.black = 12; p.hispanic = 19; p.asian = 6; return; }
  const room = 97;
  for (const id of COMPOSITION) {
    p[id] = Math.round(((p[id] || 0) / total) * room * 1000) / 1000;
  }
}

/**
 * The facts about a state that its politics does not predict.
 *
 * Deriving everything from partisan lean produced Vermont at nought per cent
 * rural, which is not a rounding error but a category error: Vermont and Wyoming
 * are among the most rural states in the country and they vote thirty-five
 * points apart. Settlement, age, income and industry are geography and history,
 * not ideology, and the correlation the derivation relies on only really holds
 * for education, religiosity and union density.
 *
 * So these four are anchored per state and everything else is still derived.
 * Approximations of real figures — accurate enough that a player who knows the
 * country will not be jarred, and not pretending to be a census.
 *
 * [rural %, median age, median household income $k, manufacturing % of jobs]
 */
const STATE_ANCHORS = {
  AK: [34, 35, 86, 3], ME: [61, 45, 68, 9], VT: [61, 43, 72, 10], NH: [40, 43, 89, 10],
  WA: [16, 38, 91, 8], ID: [29, 37, 70, 10], MT: [44, 40, 66, 5], ND: [40, 35, 73, 6],
  MN: [27, 38, 84, 11], IL: [11, 39, 78, 10], WI: [30, 40, 72, 16], MI: [25, 40, 68, 14],
  NY: [12, 39, 81, 5], MA: [8, 40, 94, 8], RI: [9, 40, 81, 9], OR: [19, 40, 76, 10],
  NV: [6, 38, 71, 4], WY: [35, 39, 72, 4], SD: [43, 38, 70, 10], IA: [36, 39, 71, 14],
  IN: [27, 38, 68, 17], OH: [22, 40, 67, 13], PA: [21, 41, 73, 10], NJ: [5, 40, 97, 6],
  CT: [12, 42, 90, 9], CA: [5, 38, 91, 7], UT: [9, 32, 87, 9], CO: [14, 38, 87, 6],
  NE: [27, 37, 71, 11], MO: [30, 39, 65, 10], KY: [41, 39, 60, 13], WV: [51, 43, 55, 8],
  VA: [25, 39, 87, 6], MD: [13, 39, 98, 4], DE: [17, 41, 79, 7], AZ: [10, 38, 74, 6],
  NM: [23, 39, 59, 4], KS: [26, 37, 69, 12], AR: [43, 39, 56, 13], TN: [34, 39, 65, 12],
  NC: [34, 39, 70, 11], SC: [34, 40, 65, 12], DC: [0, 34, 102, 1], OK: [34, 37, 62, 9],
  LA: [27, 38, 58, 8], MS: [51, 38, 53, 12], AL: [41, 40, 60, 13], GA: [25, 38, 74, 9],
  TX: [15, 36, 76, 8], FL: [9, 43, 71, 5], HI: [8, 40, 95, 3],
};

/** How much each axis varies between places, roughly one standard deviation. */
const SPREAD = {
  age: 4, over65: 5, college: 14, income: 22,
  rural: 22, suburban: 16, urban: 22, manufacturing: 7, union: 7, faith: 13,
  white: 18, black: 12, hispanic: 14, asian: 6,
};

const BOUNDS = {
  age: [22, 56], over65: [3, 34], college: [2, 78], income: [12, 190],
  rural: [0, 92], suburban: [3, 82], urban: [1, 96],
  manufacturing: [1, 42], union: [1, 46], faith: [4, 78],
  white: [3, 98], black: [0, 82], hispanic: [0, 88], asian: [0, 62],
};

function bound(id, value) {
  const [lo, hi] = BOUNDS[id] || [0, 100];
  const decimals = axisById(id)?.decimals ?? 0;
  const v = clamp(value, lo, hi);
  return decimals ? round1(v) : Math.round(v);
}

/**
 * The same bounds, without rounding to whole people.
 *
 * Drift moves a couple of hundredths of a point a month, and rounding at every
 * step swallowed all of it: twenty-one per cent college plus 0.021 rounds back
 * to twenty-one, every month, for twenty years. The value is carried at full
 * precision and rounded where it is displayed instead.
 */
function boundPrecise(id, value) {
  const [lo, hi] = BOUNDS[id] || [0, 100];
  return Math.round(clamp(value, lo, hi) * 1000) / 1000;
}

/** Rural, suburban and urban are shares of one population. */
function normaliseSettlement(p) {
  const total = p.rural + p.suburban + p.urban;
  if (total <= 0) { p.rural = 20; p.suburban = 50; p.urban = 30; return; }
  const at = (v) => Math.round((v / total) * 100000) / 1000;
  p.rural = at(p.rural);
  p.suburban = at(p.suburban);
  p.urban = Math.round((100 - p.rural - p.suburban) * 1000) / 1000;
}

/**
 * Who lives in each state, as census shares.
 *
 * Anchored rather than derived, and this is the case where deriving would not
 * merely be imprecise but exactly inverted. Mississippi is the most Republican
 * state in the Deep South and has the largest Black population in the country;
 * running the correlation backwards from its lean would report it as
 * overwhelmingly white. The same goes for Louisiana, Alabama, Georgia and South
 * Carolina — which is to say, for most of the American South, a region the model
 * simply could not represent before this.
 *
 * That is also the strongest argument for having these columns at all. A poor
 * rural district in Mississippi and one in West Virginia have near-identical
 * incomes, education and churchgoing, and vote forty points apart. Nothing else
 * in the profile can tell them apart.
 *
 * [white %, Black %, Hispanic %, Asian %] — approximations of real figures.
 */
const STATE_COMPOSITION = {
  AK: [60, 3, 7, 6], ME: [93, 2, 2, 1], VT: [93, 1, 2, 2], NH: [90, 2, 4, 3],
  WA: [67, 4, 13, 9], ID: [81, 1, 13, 1], MT: [86, 1, 4, 1], ND: [84, 3, 4, 2],
  MN: [78, 7, 6, 5], IL: [61, 14, 18, 6], WI: [80, 6, 7, 3], MI: [74, 14, 5, 3],
  NY: [55, 15, 19, 9], MA: [71, 7, 12, 7], RI: [71, 6, 17, 4], OR: [75, 2, 14, 5],
  NV: [46, 10, 29, 9], WY: [84, 1, 10, 1], SD: [82, 2, 4, 2], IA: [84, 4, 6, 3],
  IN: [78, 10, 7, 3], OH: [77, 13, 4, 3], PA: [74, 11, 8, 4], NJ: [54, 13, 21, 10],
  CT: [64, 11, 17, 5], CA: [35, 5, 40, 15], UT: [76, 1, 15, 3], CO: [66, 4, 22, 4],
  NE: [76, 5, 12, 3], MO: [78, 11, 5, 2], KY: [83, 8, 4, 2], WV: [92, 3, 2, 1],
  VA: [60, 19, 10, 7], MD: [48, 30, 11, 7], DE: [60, 22, 10, 4], AZ: [53, 4, 32, 4],
  NM: [36, 2, 50, 2], KS: [74, 6, 13, 3], AR: [71, 15, 8, 2], TN: [73, 16, 6, 2],
  NC: [61, 21, 10, 3], SC: [63, 26, 6, 2], DC: [36, 41, 11, 5], OK: [64, 7, 12, 3],
  LA: [56, 32, 6, 2], MS: [56, 37, 3, 1], AL: [64, 26, 5, 2], GA: [50, 31, 10, 5],
  TX: [40, 12, 40, 6], FL: [51, 15, 27, 3], HI: [21, 2, 10, 37],
};

/** The four axes that are geography rather than ideology. */
const ANCHORED = ["rural", "age", "income", "manufacturing"];

/**
 * Where deriving from lean gets a state conspicuously wrong.
 *
 * The correlation between partisan lean and religiosity is strong enough to
 * derive from in general and hopeless for the outliers — Utah came out at
 * twenty-six per cent weekly attendance, roughly half its real figure and the
 * single most recognisable demographic fact about the state. Deep South
 * religiosity is similarly understated, and union density in the north-east is
 * a legacy of industrial history rather than of how those states vote now.
 *
 * A short list of corrections is honest about the model's limits and costs less
 * than pretending a two-variable derivation can carry every case.
 */
const OUTLIERS = {
  UT: { faith: 51 },
  MS: { faith: 47 }, AL: { faith: 46 }, LA: { faith: 42 }, AR: { faith: 43 }, TN: { faith: 42 },
  SC: { faith: 41 }, OK: { faith: 41 }, KY: { faith: 38 },
  NY: { union: 21 }, HI: { union: 22 }, NJ: { union: 16 }, MI: { union: 14 }, WA: { union: 17 },
  NH: { faith: 15 }, ME: { faith: 16 }, VT: { faith: 14 },
};

/**
 * The profile of a state, stable for a given year.
 *
 * Derived from the lean, then the four geographic axes are replaced by the real
 * ones — scaled into the era, so a rural state in 1900 is more rural still and
 * a manufacturing state in 1960 is a manufacturing state.
 */
export function stateProfile(code, year = 2025) {
  const info = STATES[code];
  const anchors = STATE_ANCHORS[code];
  if (!info) return nationalProfile(year);

  const out = profileFor({ lean: info.lean, year, seed: `state|${code}` });
  if (!anchors) return out;

  const now = nationalProfile(2025);
  const then = nationalProfile(year);
  const [rural, age, income, manufacturing] = anchors;
  const scaled = { rural, age, income, manufacturing };

  for (const id of ANCHORED) {
    /**
     * Held at the same distance from the national figure rather than at the same
     * absolute value, so a state that is unusually rural stays unusually rural in
     * every decade instead of becoming ordinary the moment the country was.
     */
    const ratio = now[id] ? scaled[id] / now[id] : 1;
    out[id] = bound(id, then[id] * ratio);
  }

  /**
   * Composition, anchored and then scaled into the era.
   *
   * The country in 1960 was 85% white and is 58% now, so a state's shares are
   * held at their distance from the national figure rather than at their
   * absolute value — a 1960 California comes out far whiter than a modern one
   * while still being much less white than a 1960 Iowa.
   */
  const composition = STATE_COMPOSITION[code];
  if (composition) {
    COMPOSITION.forEach((id, i) => {
      const ratio = now[id] ? composition[i] / now[id] : 1;
      out[id] = boundPrecise(id, then[id] * ratio);
    });
    normaliseComposition(out);
  }

  // The handful of cases the derivation cannot reach, scaled into the era the
  // same way so a 1960 Utah is more observant still.
  for (const [id, value] of Object.entries(OUTLIERS[code] || {})) {
    const ratio = now[id] ? value / now[id] : 1;
    out[id] = bound(id, then[id] * ratio);
  }

  // Whatever is not rural is split between suburb and city on the derived ratio.
  const rest = Math.max(0, 100 - out.rural);
  const derivedRest = Math.max(1, out.suburban + out.urban);
  out.suburban = Math.round(rest * (out.suburban / derivedRest));
  out.urban = 100 - out.rural - out.suburban;
  return out;
}

/**
 * The profile of a district.
 *
 * Built from its own lean rather than its state's, because that is the whole
 * point of a district — but seeded on the state as well, so neighbouring seats
 * in the same state resemble each other more than they resemble Vermont.
 */
export function districtProfile(seat, lean, year = 2025) {
  const stateCode = String(seat || "").split("-")[0];
  const state = STATES[stateCode];
  const own = profileFor({ lean, year, seed: `seat|${seat}` });
  if (!state) return own;

  // Pulled a third of the way toward the state it sits in.
  const home = stateProfile(stateCode, year);
  const out = {};
  for (const axis of AXES) out[axis.id] = bound(axis.id, own[axis.id] * 0.7 + home[axis.id] * 0.3);

  /**
   * Composition leans much harder on the state than the derivation does.
   *
   * A district cannot contain people its state does not, and seat-level variation
   * within a state — a majority-Black urban seat inside a white state — comes
   * from the district's own lean rather than from the national average, which is
   * why the derived part is applied as a deviation from the state instead of
   * being averaged with it.
   */
  COMPOSITION.forEach((id) => {
    const deviation = own[id] - nationalProfile(year)[id];
    out[id] = boundPrecise(id, home[id] + deviation * 0.85);
  });

  normaliseSettlement(out);
  normaliseComposition(out);
  return out;
}

// --- Saying it out loud ------------------------------------------------------

/**
 * The two or three facts that actually characterise a place, so a screen and a
 * prompt can both say "a rural manufacturing seat with an ageing population"
 * rather than reciting ten numbers.
 */
export function describeProfile(profile, year = 2025) {
  if (!profile) return "";
  const base = nationalProfile(year);
  const notes = [];

  const settle = profile.rural >= 45 ? "heavily rural"
    : profile.urban >= 55 ? "densely urban"
    : profile.suburban >= 55 ? "overwhelmingly suburban"
    : profile.rural >= 30 ? "small-town" : "mixed suburban";
  notes.push(settle);

  if (profile.college >= base.college + 12) notes.push("unusually well educated");
  else if (profile.college <= base.college - 12) notes.push("few graduates");

  if (profile.manufacturing >= base.manufacturing + 6) notes.push("a manufacturing economy");
  if (profile.union >= base.union + 7) notes.push("heavily unionised");
  if (profile.faith >= base.faith + 12) notes.push("strongly observant");
  else if (profile.faith <= base.faith - 12) notes.push("largely secular");
  if (profile.over65 >= base.over65 + 6) notes.push("old");
  else if (profile.over65 <= base.over65 - 5) notes.push("young");
  if (profile.income <= base.income - 15) notes.push("poor");
  else if (profile.income >= base.income + 25) notes.push("wealthy");

  /**
   * Composition, only where it is the defining fact about a seat.
   *
   * Stated the way a psephologist states it — as the arithmetic of a
   * constituency — and only at thresholds where it genuinely characterises the
   * place rather than as a label attached to everywhere.
   */
  if (profile.black >= 45) notes.push("majority-Black");
  else if (profile.black >= base.black + 14) notes.push("heavily Black");
  if (profile.hispanic >= 45) notes.push("majority-Hispanic");
  else if (profile.hispanic >= base.hispanic + 15) notes.push("heavily Hispanic");
  if (profile.asian >= base.asian + 14) notes.push("heavily Asian");
  if (profile.white >= 88) notes.push("almost entirely white");

  return notes.slice(0, 5).join(", ");
}

/** The same thing, as rows a screen can render against the national figure. */
export function profileRows(profile, year = 2025) {
  const base = nationalProfile(year);
  if (!profile) return [];
  return AXES.map((axis) => ({
    id: axis.id,
    name: axis.name,
    unit: axis.unit,
    value: bound(axis.id, profile[axis.id]),
    national: base[axis.id],
    // How far from the country this place sits, in that axis's own spread.
    deviation: round1((profile[axis.id] - base[axis.id]) / (SPREAD[axis.id] || 8)),
  }));
}

// --- Who a bill actually lands on -------------------------------------------

/**
 * The groups a member hears from, and what moves them.
 *
 * A bill's ideological position tells you which half of a seat likes it; this
 * says which *people* in it win or lose, which is the thing a member is actually
 * lobbied about and the thing a local paper writes up. A steel tariff and a
 * student-debt write-off can sit at the same point on the spectrum and land on
 * completely different constituencies.
 *
 * `share` reads the profile for how much of the seat this group is. `axis` is
 * where the group's own interests sit, and `domains` are the subjects it turns
 * out for — a group only reacts to bills in areas it cares about, so a seat's
 * pensioners are silent on a tariff and deafening on a benefits bill.
 */
export const GROUPS = [
  { id: "seniors", name: "Pensioners", axis: 0.15, domains: ["health", "economy", "social"],
    share: (p) => p.over65 },
  { id: "graduates", name: "College graduates", axis: -0.45, domains: ["social", "health", "justice", "foreign"],
    share: (p) => p.college },
  { id: "workers", name: "Manufacturing workers", axis: -0.1, domains: ["economy", "foreign", "security"],
    share: (p) => p.manufacturing * 2.2 },
  { id: "unionists", name: "Union households", axis: -0.55, domains: ["economy", "social"],
    share: (p) => p.union * 1.6 },
  { id: "faithful", name: "Churchgoers", axis: 0.5, domains: ["social", "justice", "health"],
    share: (p) => p.faith },
  { id: "rural", name: "Rural voters", axis: 0.45, domains: ["economy", "health", "security"],
    share: (p) => p.rural },
  { id: "urban", name: "City voters", axis: -0.5, domains: ["social", "justice", "economy"],
    share: (p) => p.urban },
  { id: "lowincome", name: "Low-income households", axis: -0.3, domains: ["economy", "health", "social"],
    share: (p, base) => clamp(38 - (p.income - base.income) * 0.45, 6, 62) },
];

/** How strongly each group in a place reacts to a given bill. */
export function billImpact(profile, bill, year = 2025) {
  if (!profile || !bill) return [];
  const base = nationalProfile(year);
  const axis = Number(bill.axis) || 0;
  const domain = bill.domain || "economy";

  return GROUPS
    .filter((g) => g.domains.includes(domain))
    .map((g) => {
      const share = clamp(Math.round(g.share(profile, base)), 0, 100);
      // How far the bill is from what this group wants, on the usual scale.
      const agreement = 1 - Math.abs(g.axis - axis) / 2;
      const feeling = round1((agreement - 0.76) * 4);
      return { id: g.id, name: g.name, share, feeling };
    })
    // Only groups with enough presence in this seat to be worth hearing from.
    .filter((g) => g.share >= 8 && Math.abs(g.feeling) >= 0.12)
    .sort((a, b) => Math.abs(b.feeling) * b.share - Math.abs(a.feeling) * a.share)
    .slice(0, 4);
}

/**
 * The one sentence a member would actually be told about a vote: the biggest
 * group in the seat that this bill goes against.
 */
export function loudestObjection(profile, bill, year = 2025) {
  const hit = billImpact(profile, bill, year).filter((g) => g.feeling < 0);
  if (!hit.length) return null;
  const worst = hit.sort((a, b) => b.share * Math.abs(b.feeling) - a.share * Math.abs(a.feeling))[0];
  return { ...worst, note: `${worst.name} are ${worst.share}% of this seat, and this is against them.` };
}

// --- The country changing under you -----------------------------------------

/**
 * A month of demographic drift.
 *
 * Every trend here ran in one direction for the whole of the twentieth century
 * and most of the twenty-first: the country got older, far better educated, more
 * suburban, and much less unionised, observant and industrial. Slow enough that
 * a single term barely shows it and a twenty-year career cannot miss it, which
 * is exactly the timescale a congressional career runs on.
 *
 * Per month, so a two-year term moves education about half a point and a
 * twenty-year career moves it five.
 */
/** The two axes where being unusual makes you more unusual still. */
const DIVERGING = { college: 0.8, manufacturing: 0.7 };

/**
 * How much of each axis's movement is driven by people arriving.
 *
 * Net migration is the main engine of compositional change in the United States
 * and a large part of why the country is getting older more slowly than it
 * otherwise would. These are the axes federal immigration law can actually
 * reach; everything else moves for its own reasons and ignores the setting.
 *
 * Age is inverted on purpose. Arrivals are younger than the resident population,
 * so restricting them does not slow the country's ageing — it accelerates it.
 */
const MIGRATION_DRIVEN = {
  hispanic: 1, asian: 1, white: 1, black: 0.25,
  age: -1, over65: -1,
};

export function driftProfile(profile, year = 2025, { migration = 1 } = {}) {
  if (!profile) return profile;
  const base = nationalProfile(year);
  // The country's own monthly movement, so a seat that merely keeps pace with it
  // stays exactly where it was politically.
  const rate = nationalRate(year);

  for (const axis of AXES) {
    const step = rate[axis.id];
    if (!step) continue;
    /**
     * Places diverge; they do not move in lockstep.
     *
     * Applying the national trend uniformly moved every seat identically, which
     * left every seat in exactly the same position relative to every other one —
     * so nothing realigned and the lean never shifted by more than a tenth of a
     * point in twenty years. That is the opposite of what happened to American
     * politics over the period this is meant to model.
     *
     * What actually happens is that two of these trends compound where they have
     * already taken hold — graduates cluster with graduates, and the towns losing
     * their factories keep losing them — while the rest are a national tide that
     * lifts everywhere at once.
     *
     * Only those two diverge, and the restriction is doing real work. Applying
     * momentum to every axis made secular places secularise *slower* than the
     * country, because a place below the mean on a falling measure got a
     * multiplier below one — so a college city came out drifting rightwards,
     * which is precisely backwards. Education and industry are also the two axes
     * that genuinely drove American realignment over this period, so restricting
     * it to them is both the correct arithmetic and the better history.
     */
    const spread = SPREAD[axis.id] || 8;
    const unusual = (profile[axis.id] - base[axis.id]) / spread;
    const momentum = DIVERGING[axis.id]
      ? clamp(1 + unusual * DIVERGING[axis.id], 0.15, 2.6)
      : 1;

    /**
     * And what the country's immigration law is doing to it.
     *
     * `migration` is 1 when policy is where history left it. Below one, arrivals
     * slow: composition changes more slowly and — because the people not
     * arriving are the young ones — the country greys faster. Above one, both
     * run the other way.
     */
    const driven = MIGRATION_DRIVEN[axis.id];
    const flow = driven == null ? 1
      : driven > 0 ? migration
      : 2 - migration;

    profile[axis.id] = boundPrecise(axis.id, profile[axis.id] + step * momentum * flow);
  }
  normaliseSettlement(profile);
  return profile;
}

/**
 * What a seat's composition now implies about how it votes.
 *
 * The payoff of the whole feature, and the reason the profile is derived from
 * the lean rather than invented beside it: run the same correlation forwards and
 * a changing population produces a changing lean. A seat that is quietly losing
 * its mill and gaining graduates stops being the seat that first elected you —
 * not because anybody's mind changed, but because the people did.
 *
 * Returned as a nudge rather than an assignment, so it accumulates gently
 * instead of overwriting the lean the map was drawn with.
 */
export function leanDriftFor(profile, baseline, year = 2025, bornYear = year) {
  if (!profile || !baseline) return 0;
  /**
   * Measured against the country, not against the seat's own past.
   *
   * A lean says how a place votes *compared with everywhere else*, so what moves
   * it is the seat's position relative to the nation changing — not the seat
   * changing. If the whole country gains ten points of graduates and so does
   * this seat, its politics are where they were. Comparing a seat only with its
   * own history mistook the national tide for a local realignment and returned
   * nothing, because every seat was riding the same tide.
   */
  const now = nationalProfile(year);
  const then = nationalProfile(bornYear);

  let pull = 0;
  for (const axis of AXES) {
    const spread = SPREAD[axis.id] || 8;
    const before = (baseline[axis.id] - then[axis.id]) / spread;
    const after = (profile[axis.id] - now[axis.id]) / spread;
    pull += (after - before) * axis.pull;
  }
  // Scaled into the same points the lean itself is measured in.
  return round1(clamp(pull * 9, -30, 30));
}
