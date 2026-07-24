import { clamp, round1 } from "./rng.js";

/**
 * Social Engineering mode — the country underneath the polling.
 *
 * Approval is what people say about you this month. These are the numbers a
 * historian uses in forty years, and they move slowly, lag policy, and do not
 * care whether the month went well politically.
 */

export const SOCIETY_METRICS = [
  { id: "population", name: "Population", unit: "M", decimals: 1, better: "up" },
  { id: "poverty", name: "Poverty rate", unit: "%", decimals: 1, better: "down" },
  { id: "crime", name: "Violent crime", unit: "/100k", decimals: 0, better: "down" },
  { id: "lifeExpectancy", name: "Life expectancy", unit: "yrs", decimals: 1, better: "up" },
  { id: "literacy", name: "Literacy", unit: "%", decimals: 1, better: "up" },
  { id: "homeownership", name: "Home ownership", unit: "%", decimals: 1, better: "up" },
  { id: "uninsured", name: "Uninsured", unit: "%", decimals: 1, better: "down" },
  { id: "unrest", name: "Civil unrest", unit: "/100", decimals: 0, better: "down" },
];

const ERA_BASELINES = [
  { from: 2020, v: { population: 335, poverty: 11.5, crime: 380, lifeExpectancy: 77.5, literacy: 79, homeownership: 65.7, uninsured: 8.0, unrest: 34 } },
  { from: 2009, v: { population: 307, poverty: 14.3, crime: 430, lifeExpectancy: 78.5, literacy: 78, homeownership: 67.4, uninsured: 16.7, unrest: 24 } },
  { from: 2001, v: { population: 285, poverty: 11.7, crime: 505, lifeExpectancy: 77.0, literacy: 77, homeownership: 67.8, uninsured: 14.6, unrest: 20 } },
  { from: 1993, v: { population: 258, poverty: 15.1, crime: 747, lifeExpectancy: 75.5, literacy: 75, homeownership: 64.0, uninsured: 15.3, unrest: 28 } },
  { from: 1961, v: { population: 184, poverty: 22.2, crime: 159, lifeExpectancy: 70.2, literacy: 70, homeownership: 62.4, uninsured: 40.0, unrest: 42 } },
  { from: 1900, v: { population: 149, poverty: 30.0, crime: 120, lifeExpectancy: 68.2, literacy: 66, homeownership: 55.0, uninsured: 55.0, unrest: 30 } },
];

export function buildSociety(scenario) {
  const year = scenario.startYear || 2025;
  const base = ERA_BASELINES.find((b) => year >= b.from) || ERA_BASELINES.at(-1);
  return { ...base.v };
}

/**
 * Which metrics a policy plausibly touches, by what the president wrote. Kept
 * deliberately blunt: the model can override any of it by returning `society`.
 */
const LEVERS = [
  { re: /\b(police|policing|crime|sentenc|prison|gun|law and order|patrol)\b/i,
    fx: { crime: -6, unrest: -1 } },
  { re: /\b(defund|decriminal|release|clemency|reform polic)\b/i,
    fx: { crime: 4, unrest: 2 } },
  { re: /\b(welfare|food stamp|snap|benefit|minimum wage|child credit|cash transfer|anti-poverty)\b/i,
    fx: { poverty: -0.35, unrest: -2 } },
  { re: /\b(austerity|cut spending|cut benefits|slash|entitlement reform)\b/i,
    fx: { poverty: 0.4, unrest: 3 } },
  { re: /\b(healthcare|health care|medicare|medicaid|insurance|clinic|hospital|coverage)\b/i,
    fx: { uninsured: -0.8, lifeExpectancy: 0.06 } },
  { re: /\b(opioid|addiction|overdose|mental health|suicide)\b/i,
    fx: { lifeExpectancy: 0.08, unrest: -1 } },
  { re: /\b(school|education|teacher|literacy|university|college|tuition)\b/i,
    fx: { literacy: 0.4 } },
  { re: /\b(housing|rent|mortgage|homeless|zoning|build homes|first-time buyer)\b/i,
    fx: { homeownership: 0.35, poverty: -0.1 } },
  { re: /\b(immigrat|refugee|asylum|visa|border)\b/i,
    fx: { population: 0.25, unrest: 2 } },
  { re: /\b(deport|expel|remove migrants|mass removal)\b/i,
    fx: { population: -0.3, unrest: 5 } },
  { re: /\b(crackdown|martial law|national guard|emergency powers|suspend)\b/i,
    fx: { unrest: 8, crime: -3 } },
];

const DRIFT = {
  population: 0.06, poverty: 0.01, crime: -0.4, lifeExpectancy: 0.005,
  literacy: 0.02, homeownership: -0.01, uninsured: 0.01, unrest: -0.6,
};

const BOUNDS = {
  population: [50, 900], poverty: [1, 60], crime: [20, 2000],
  lifeExpectancy: [40, 100], literacy: [40, 100], homeownership: [25, 90],
  uninsured: [0, 70], unrest: [0, 100],
};

/** One month of the country changing under the policy. */
export function applySociety(next, policyText, result) {
  if (!next.society) return [];

  const deltas = {};
  const add = (id, v) => { deltas[id] = (deltas[id] || 0) + v; };

  for (const lever of LEVERS) {
    if (!lever.re.test(String(policyText || ""))) continue;
    for (const [id, v] of Object.entries(lever.fx)) add(id, v);
  }

  // Hardship shows up in the social numbers a month or two after the economy.
  const misery = next.economy.unemployment + next.economy.inflation;
  if (misery > 9) {
    add("poverty", (misery - 9) * 0.08);
    add("unrest", (misery - 9) * 0.6);
  }
  if (next.approval < 35) add("unrest", 1.5);

  // Anything the model asserted wins over the keyword read.
  for (const entry of result?.society || []) {
    if (deltas[entry.id] != null || SOCIETY_METRICS.some((m) => m.id === entry.id)) {
      deltas[entry.id] = Number(entry.change) || 0;
    }
  }

  const moved = [];
  for (const metric of SOCIETY_METRICS) {
    const before = next.society[metric.id];
    const [lo, hi] = BOUNDS[metric.id];
    const change = (deltas[metric.id] || 0) + (DRIFT[metric.id] || 0);
    const after = clamp(round1(before + change), lo, hi);
    next.society[metric.id] = metric.decimals === 0 ? Math.round(after) : after;
    if (Math.abs(next.society[metric.id] - before) >= (metric.decimals === 0 ? 1 : 0.05)) {
      moved.push({ id: metric.id, name: metric.name, change: round1(next.society[metric.id] - before) });
    }
  }

  // Unrest is the one that bites back: a country coming apart is ungovernable.
  if (next.society.unrest > 60) {
    next.stability = clamp(next.stability - Math.round((next.society.unrest - 60) / 8));
  }
  return moved;
}

export function societySummary(state) {
  if (!state.society) return "";
  return SOCIETY_METRICS
    .map((m) => `${m.name} ${state.society[m.id]}${m.unit}`)
    .join(", ");
}
