/**
 * Deterministic randomness and the numeric helpers every subsystem needs.
 *
 * Every roll in this game is seeded from something the player did — a name, a
 * policy string, the month — so the same inputs always produce the same term.
 * That is what makes a saved career resumable and a bug reproducible.
 */

export function hashString(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded generator plus the pickers most callers immediately want. */
export function seeded(seed) {
  const rng = mulberry32(hashString(seed));
  return {
    next: rng,
    pick: (list) => list[Math.floor(rng() * list.length)],
    between: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
    chance: (p) => rng() < p,
  };
}

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const round1 = (v) => Math.round(v * 10) / 10;
