/**
 * Seeded randomness for the demo generator. Every random choice goes through
 * one of these so a given seed always produces the same league — a re-run of
 * the demo build on unchanged inputs must be byte-identical
 * (tests/demo-generator.test.ts).
 */

/** Hash a string seed to a 32-bit integer (FNV-1a). */
export function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for fiction. */
export function createRng(seed) {
  let a = hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Integer in [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** Uniform pick. */
    pick: (list) => list[Math.floor(next() * list.length)],
    /** True with probability p. */
    chance: (p) => next() < p,
    /** Fisher–Yates shuffle, returning a new array. */
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** Normal-ish noise via the sum of uniforms, mean 0, sd ≈ `sd`. */
    noise: (sd) => ((next() + next() + next() + next() - 2) / 0.577) * sd,
    /** A child stream, so adding draws in one area doesn't reshuffle another. */
    fork: (label) => createRng(`${seed}/${label}`),
  };
  return rng;
}
