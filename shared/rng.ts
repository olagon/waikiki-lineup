// Seeded, integer-only randomness. Identical on every engine. No Math.random in shared code.

/** Mix any number of 32-bit keys into one well-distributed uint32. */
export function hash32(...keys: number[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Uniform float in [0, 1) from keys. */
export function rand01(...keys: number[]): number {
  return hash32(...keys) / 4294967296;
}

/** Uniform float in [lo, hi) from keys. */
export function randRange(lo: number, hi: number, ...keys: number[]): number {
  return lo + (hi - lo) * rand01(...keys);
}

/** Sequential generator (mulberry32) for places that need a stream. */
export function rngStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
