"use strict";

/**
 * The president's own coalition.
 *
 * Lives under public/ because both sides need it: the dashboard shows it and
 * the primary is decided by it, and there must be exactly one of it. Same
 * arrangement as rng.js and government.js — browser-safe, no imports.
 */

/** Which blocs lean which way. Mirrors STAKEHOLDERS in the engine. */
export const BLOC_LEAN = {
  wall_street: 1, big_business: 1, pentagon: 0.5, labor: -1,
  greens: -1, civil_rights: -1, gun_owners: 1, faith: 0.7,
};

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/**
 * How the president's own coalition is holding, 0–100.
 *
 * Averages only the blocs that lean the president's way — those are the people
 * who are supposed to be with them, and whose defection is what a primary
 * challenge is made of. An independent has no such side, so the whole board
 * counts.
 */
export function partyStanding(state) {
  const sign = partySign(state?.scenario?.party);
  const blocs = Object.entries(state?.stakeholders || {});
  if (!blocs.length) return 50;

  const mine = sign
    ? blocs.filter(([id]) => Math.sign(BLOC_LEAN[id] ?? 0) === sign)
    : blocs;
  const pool = mine.length ? mine : blocs;
  return Math.round(pool.reduce((sum, [, v]) => sum + v, 0) / pool.length);
}
