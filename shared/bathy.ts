// The bay floor: beach, sand, reef flat, drop-off. Arithmetic only, so every engine agrees.
// +z is seaward, y is up, mean sea level is y = 0.
import { hash32 } from './rng';

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1). */
export function vnoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), u = smooth(x - xi), v = smooth(z - zi);
  const h = (a: number, b: number) => hash32(seed, a, b) / 4294967296;
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

/** z of the waterline at mean sea level: a gentle crescent that swings seaward toward Lēʻahi. */
export function shoreZ(x: number): number {
  const u = x / 400, t = clamp01((x - 380) / 620);
  return (30 * u * u) / (1 + u * u) + 260 * smooth(t);
}

/** 0 on sand, 1 on reef. Reef starts past the sandy shallows and is cut by sand channels. */
export function reefMask(x: number, z: number): number {
  const s = z - shoreZ(x);
  const band = smooth(clamp01((s - 28) / 20)) * (1 - smooth(clamp01((s - 150) / 90)));
  const channel = smooth(clamp01((vnoise(x / 70, z / 55, 13) - 0.56) / 0.12));
  return band * (1 - 0.85 * channel);
}

/** Height of the ground (beach or sea floor) in meters. Negative is under water. */
export function groundY(x: number, z: number): number {
  const s = z - shoreZ(x);
  if (s < 0) return Math.min(2.6, -s * 0.085);
  const a = clamp01(s / 25);
  let d = 1.3 * a * (2 - a); // sandy slope to waist-deep-plus
  d += 0.9 * smooth(clamp01((s - 25) / 85)); // reef flat deepens gently toward the lineup
  const o = Math.max(0, s - 118);
  d += (26 * o * o) / (o * o + 48400); // drop-off past the reef edge
  const relief = vnoise(x / 11, z / 11, 11) * 0.65 + vnoise(x / 3.7, z / 3.7, 12) * 0.35;
  d -= reefMask(x, z) * (relief - 0.35) * 1.1; // coral heads and holes
  return -Math.max(d, Math.min(s * 0.1, 0.45));
}

export const depthAt = (x: number, z: number) => Math.max(0, -groundY(x, z));
