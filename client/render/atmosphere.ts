// Physically based sky: single scattering (Rayleigh + Mie + ozone) ray-marched on the CPU.
// One implementation feeds the sky lookup texture, the direct light color, the ambient light,
// and the eye-adaptation target, so they can never disagree.

const R0 = 6360e3, R1 = 6460e3; // planet and atmosphere radii (m)
const BR = [5.802e-6, 13.558e-6, 33.1e-6], HR = 8000; // Rayleigh
const BM = 3.996e-6, BME = 4.44e-6, HM = 1200, G = 0.8; // Mie
const BO = [0.65e-6, 1.881e-6, 0.085e-6]; // ozone absorption
const CAM_H = 30;
const VIEW_STEPS = 18, LIGHT_STEPS = 6;
const MS = 0.18; // isotropic multiple-scattering fudge on the phase functions
const MSC = [0.3, 0.5, 1.0], MSC_DUSK = [1.0, 0.72, 0.8]; // color of the second-bounce fill that lights air the planet shadows

export const LUT_W = 64, LUT_H = 48;
export type V3 = [number, number, number];

function exitDist(px: number, py: number, pz: number, dx: number, dy: number, dz: number, R: number): number {
  const b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - R * R;
  const disc = b * b - c;
  return disc < 0 ? -1 : -b + Math.sqrt(disc);
}
function hitsPlanet(px: number, py: number, pz: number, dx: number, dy: number, dz: number): boolean {
  const b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - R0 * R0;
  return b < 0 && b * b - c > 0;
}
const ozone = (h: number) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

/** Optical depths (Rayleigh, Mie, ozone) from p along d to the top of the atmosphere. */
function lightDepth(px: number, py: number, pz: number, d: V3, out: Float64Array): void {
  const tmax = exitDist(px, py, pz, d[0], d[1], d[2], R1), dt = tmax / LIGHT_STEPS;
  let r = 0, m = 0, o = 0;
  for (let i = 0; i < LIGHT_STEPS; i++) {
    const t = (i + 0.5) * dt;
    const x = px + d[0] * t, y = py + d[1] * t, z = pz + d[2] * t;
    const h = Math.sqrt(x * x + y * y + z * z) - R0;
    r += Math.exp(-h / HR) * dt; m += Math.exp(-h / HM) * dt; o += ozone(h) * dt;
  }
  out[0] = r; out[1] = m; out[2] = o;
}

const ld = new Float64Array(3);

/**
 * Sky radiance toward `v` for a light of unit irradiance arriving from direction `l` (both unit, y up).
 * `fill` scales an isotropic second-bounce term that also reaches air in the planet's shadow (twilight).
 */
export function skyRadiance(v: V3, l: V3, out: V3, fill = 0.3, dusk = 0): void {
  const py = R0 + CAM_H;
  const tmax = exitDist(0, py, 0, v[0], v[1], v[2], R1);
  const mu = v[0] * l[0] + v[1] * l[1] + v[2] * l[2];
  const phR = (3 / (16 * Math.PI)) * (1 + mu * mu) + MS / (4 * Math.PI);
  const phM = (3 / (8 * Math.PI)) * ((1 - G * G) * (1 + mu * mu)) / ((2 + G * G) * Math.pow(1 + G * G - 2 * G * mu, 1.5)) + MS / (4 * Math.PI);
  let odR = 0, odM = 0, odO = 0;
  const sR = [0, 0, 0], sM = [0, 0, 0], sI = [0, 0, 0];
  for (let i = 0; i < VIEW_STEPS; i++) {
    // Quadratic spacing: dense near the camera where the air is thick.
    const a = i / VIEW_STEPS, b = (i + 1) / VIEW_STEPS;
    const t0 = tmax * a * a, t1 = tmax * b * b, t = (t0 + t1) / 2, dt = t1 - t0;
    const x = v[0] * t, y = py + v[1] * t, z = v[2] * t;
    const h = Math.sqrt(x * x + y * y + z * z) - R0;
    const dR = Math.exp(-h / HR) * dt, dM = Math.exp(-h / HM) * dt;
    odR += dR / 2; odM += dM / 2; odO += ozone(h) * dt / 2;
    for (let c = 0; c < 3; c++) sI[c] += dR * Math.exp(-(BR[c] * odR + BME * odM));
    if (!hitsPlanet(x, y, z, l[0], l[1], l[2])) {
      lightDepth(x, y, z, l, ld);
      for (let c = 0; c < 3; c++) {
        const att = Math.exp(-(BR[c] * (odR + ld[0]) + BME * (odM + ld[1]) + BO[c] * (odO + ld[2])));
        sR[c] += dR * att; sM[c] += dM * att;
      }
    }
    odR += dR / 2; odM += dM / 2; odO += ozone(h) * dt / 2;
  }
  for (let c = 0; c < 3; c++) out[c] = phR * BR[c] * sR[c] + phM * BM * sM[c] + fill * (MSC[c] + (MSC_DUSK[c] - MSC[c]) * dusk) * BR[c] * sI[c] / (4 * Math.PI);
}

/** Fraction of a light's irradiance that reaches the camera from direction `l` (per channel). */
export function transmittance(l: V3, out: V3): void {
  const py = R0 + CAM_H;
  if (hitsPlanet(0, py, 0, l[0], l[1], l[2])) { out[0] = out[1] = out[2] = 0; return; }
  // More steps than the in-scatter march: this one sets the color of the low sun.
  const tmax = exitDist(0, py, 0, l[0], l[1], l[2], R1), N = 40;
  let r = 0, m = 0, o = 0;
  for (let i = 0; i < N; i++) {
    const a = i / N, b = (i + 1) / N, t0 = tmax * a * a, t1 = tmax * b * b, t = (t0 + t1) / 2, dt = t1 - t0;
    const x = l[0] * t, y = py + l[1] * t, z = l[2] * t;
    const h = Math.sqrt(x * x + y * y + z * z) - R0;
    r += Math.exp(-h / HR) * dt; m += Math.exp(-h / HM) * dt; o += ozone(h) * dt;
  }
  for (let c = 0; c < 3; c++) out[c] = Math.exp(-(BR[c] * r + BME * m + BO[c] * o));
}

/** Direction for a lookup-texture texel. u: azimuth from the light (0..π). v: elevation, sqrt-mapped. */
export function lutDir(i: number, j: number, lightAz: number, out: V3): void {
  const daz = ((i + 0.5) / LUT_W) * Math.PI, vv = (j + 0.5) / LUT_H, el = vv * vv * (Math.PI / 2);
  const c = Math.cos(el);
  out[0] = c * Math.cos(lightAz + daz); out[1] = Math.sin(el); out[2] = c * Math.sin(lightAz + daz);
}
