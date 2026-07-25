/**
 * Seeded randomness and the numeric helpers every subsystem needs.
 *
 * The generator itself lives in `public/js/data/rng.js` so the browser can use
 * the same one — a Congress derived on the client and a Congress described in
 * a prompt on the server have to be the same Congress.
 */

export { hashString, mulberry32, seeded } from "../public/js/data/rng.js";

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const round1 = (v) => Math.round(v * 10) / 10;
