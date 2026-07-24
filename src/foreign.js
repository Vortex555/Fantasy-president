import { clamp, round1 } from "./rng.js";

/**
 * Foreign relations — one standing score per region, 0–100.
 *
 * These are slow numbers. They barely move in a month and they never move on
 * rhetoric alone, which is the point: a president inherits a position in the
 * world and hands on a slightly different one.
 */

export const REGIONS = [
  { id: "europe", name: "Europe", emoji: "🇪🇺", keywords: /\b(europe|nato|eu\b|brussels|ukraine|germany|france|britain|uk\b|poland)\b/i },
  { id: "china", name: "China", emoji: "🇨🇳", keywords: /\b(china|chinese|beijing|taiwan|xi\b|tariff|semiconductor)\b/i },
  { id: "russia", name: "Russia", emoji: "🇷🇺", keywords: /\b(russia|russian|moscow|kremlin|putin|sanction)\b/i },
  { id: "middle_east", name: "Middle East", emoji: "🕌", keywords: /\b(middle east|israel|iran|saudi|gulf|gaza|syria|iraq|oil embargo)\b/i },
  { id: "latin_america", name: "Latin America", emoji: "🌎", keywords: /\b(latin america|mexico|brazil|venezuela|colombia|cartel|border|migrant)\b/i },
  { id: "africa", name: "Africa", emoji: "🌍", keywords: /\b(africa|nigeria|kenya|ethiopia|sahel|congo)\b/i },
  { id: "indo_pacific", name: "Indo-Pacific", emoji: "🌏", keywords: /\b(japan|korea|india|australia|philippines|indo-pacific|pacific|asean)\b/i },
];

/** Where each era starts. Presidents inherit the world, they don't pick it. */
const ERA_BASELINES = [
  { from: 2020, values: { europe: 68, china: 32, russia: 20, middle_east: 45, latin_america: 55, africa: 52, indo_pacific: 64 } },
  { from: 2009, values: { europe: 72, china: 48, russia: 44, middle_east: 38, latin_america: 58, africa: 60, indo_pacific: 62 } },
  { from: 2001, values: { europe: 66, china: 52, russia: 55, middle_east: 30, latin_america: 54, africa: 50, indo_pacific: 58 } },
  { from: 1993, values: { europe: 78, china: 50, russia: 62, middle_east: 48, latin_america: 60, africa: 48, indo_pacific: 60 } },
  { from: 1961, values: { europe: 74, china: 18, russia: 16, middle_east: 44, latin_america: 42, africa: 44, indo_pacific: 40 } },
  { from: 1900, values: { europe: 70, china: 22, russia: 18, middle_east: 46, latin_america: 46, africa: 42, indo_pacific: 38 } },
];

export function buildForeign(scenario) {
  const year = scenario.startYear || 2025;
  const baseline = ERA_BASELINES.find((b) => year >= b.from) || ERA_BASELINES.at(-1);
  const out = {};
  for (const r of REGIONS) out[r.id] = clamp(baseline.values[r.id] ?? 50);
  return out;
}

/**
 * Read a month's policy and move the regions it actually touched. Regions the
 * president never mentioned drift a point toward neutral — attention is itself
 * a foreign policy.
 */
export function applyForeign(next, policyText, result) {
  if (!next.foreign) return [];
  const text = String(policyText || "");
  const moved = [];

  // The model may name regions directly; that takes precedence.
  const explicit = new Map();
  for (const entry of result?.foreign || []) {
    const region = REGIONS.find((r) => r.id === entry.id || r.name.toLowerCase() === String(entry.name).toLowerCase());
    if (region) explicit.set(region.id, Number(entry.change) || 0);
  }

  for (const region of REGIONS) {
    const before = next.foreign[region.id];
    let change = explicit.get(region.id);

    if (change == null) {
      if (region.keywords.test(text)) {
        // Engaged with. Tone decides the direction.
        const hostile = /\b(sanction|strike|troops|invade|tariff|expel|condemn|withdraw from|cut off)\b/i.test(text);
        const warm = /\b(summit|treaty|aid|alliance|talks|negotiat|reopen|partnership|visit)\b/i.test(text);
        change = hostile && !warm ? -4 : warm ? 3 : 1;
      } else {
        change = before > 50 ? -0.4 : before < 50 ? 0.4 : 0; // neglect regresses
      }
    }

    next.foreign[region.id] = clamp(Math.round(before + change));
    if (Math.abs(next.foreign[region.id] - before) >= 1) {
      moved.push({ id: region.id, name: region.name, change: next.foreign[region.id] - before });
    }
  }

  // Standing in the world feeds back into the Pentagon's confidence in you.
  const avg = REGIONS.reduce((sum, r) => sum + next.foreign[r.id], 0) / REGIONS.length;
  next.stakeholders.pentagon = clamp(Math.round(next.stakeholders.pentagon + (avg - 50) * 0.02));
  return moved;
}

export function foreignSummary(state) {
  if (!state.foreign) return "";
  return REGIONS.map((r) => `${r.name} ${state.foreign[r.id]}`).join(", ");
}

/** The worst relationship right now, for prompting a plausible crisis. */
export function weakestRegion(state) {
  if (!state.foreign) return null;
  return REGIONS
    .map((r) => ({ ...r, value: state.foreign[r.id] }))
    .sort((a, b) => a.value - b.value)[0];
}
