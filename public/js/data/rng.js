"use strict";

/**
 * Seeded randomness, shared by the browser and the server.
 *
 * Lives under public/ because the client needs it too; `src/rng.js` re-exports
 * from here so there is exactly one implementation. Browser-safe: no imports,
 * no Node APIs.
 *
 * Every roll in this game is seeded from something the player did — a name, a
 * policy string, the month — so the same inputs always produce the same term.
 * That is what lets a 535-member Congress be derived on demand from a single
 * stored seed instead of shipped in the save file.
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
    /** Pick from `items` using a parallel array of weights. */
    weighted(items, weights) {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return items[Math.floor(rng() * items.length)];
      let roll = rng() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}
