// @ts-nocheck  (TSL node chains; types are loose here on purpose)
// Sky dome: atmosphere lookup, sun and moon disks, stars, ray-marched trade-wind cumulus, high cirrus.
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, vec2, vec3, vec4, float, texture, positionWorld, cameraPosition, normalize, dot, max, mix, clamp,
  acos, asin, sqrt, abs, pow, exp, floor, fract, length, step, log2, interleavedGradientNoise, screenCoordinate, mx_noise_float, mx_fractal_noise_float, mx_cell_noise_float,
} from 'three/tsl';
import { U, type Env } from './env';
import { makeNoiseTexture } from './noise';
import { ss } from './tsl';

const HALF_PI = Math.PI / 2;
const WIND = vec2(-0.17, 0.98); // trades blow offshore, toward +z
const CLOUD_BASE = 850, CLOUD_TOP = 1550;
export const noiseTex = makeNoiseTexture(256, 7);

/** Atmosphere radiance for a direction (mirrored below the horizon). */
export const skyLut = (env: Env, dir) => {
  const v = sqrt(asin(clamp(abs(dir.y), 0, 1)).div(HALF_PI));
  const u = acos(clamp(dot(normalize(dir.xz.add(vec2(1e-5, 0))), U.lutAz), -1, 1)).div(Math.PI);
  return texture(env.skyLut, vec2(u, v)).level(0).rgb;
};

/** Warm light pooled low over the city at night. */
const cityGlow = (dir) => {
  const overLand = ss(0.25, -0.5, dir.z);
  return vec3(1.0, 0.62, 0.34).mul(exp(max(dir.y, 0).mul(-9)).mul(overLand).mul(U.night).mul(0.0035));
};

const cloudCover = (p) => {
  const big = texture(noiseTex, p.xz.div(47000).add(0.37)).level(0).b;
  // More cloud over the land and stacked on the mountains; scattered puffs over the sea.
  return mix(float(0.68), float(0.52), ss(300, -7000, p.z)).add(big.sub(0.5).mul(0.25));
};
const cloudDensity = (p, h, lod) => {
  const uv = p.xz.add(WIND.mul(U.time.mul(9))).div(9000);
  const n = texture(noiseTex, uv).level(lod).r;
  const erode = texture(noiseTex, uv.mul(5.3).add(h.mul(0.37))).level(lod.add(2.4)).g.sub(0.5).mul(0.12); // 5.3x finer, so 2.4 mips up to stay in step
  const taper = h.mul(h).mul(0.24).add(ss(0.2, 0.0, h).mul(0.5)); // domed top, flat base (spread over several slices, or each slice draws its own edge)
  return clamp(n.sub(cloudCover(p)).sub(taper).sub(erode).mul(5.5), 0, 1);
};

/** Trade-wind cumulus: a short march through a slab. Returns premultiplied rgb + alpha. */
const cumulus = (env: Env, dir, atmo, steps: number, jitter, crisp = false) => Fn(() => {
  const y = max(dir.y, 0.012);
  const t0 = float(CLOUD_BASE).div(y), t1 = float(CLOUD_TOP).div(y);
  const dt = t1.sub(t0).div(steps);
  // Filter the noise to the spacing of the samples. A slanted ray moves sideways between slices; any detail finer than
  // that step shows up as one outline per slice, which reads as stripes on every cloud edge (and rings in reflections).
  const stepXZ = dt.mul(sqrt(max(float(1).sub(dir.y.mul(dir.y)), 0)));
  const lod = clamp(max(log2(t0.div(20000)), log2(stepXZ.div(9000 / 256))), 0, 6);
  const T = float(1).toVar(), C = vec3(0).toVar();
  const toward = pow(clamp(dot(dir, U.lightDir), 0, 1), 5);
  const glow = skyLut(env, vec3(U.lutAz.x, 0.05, U.lutAz.y)); // horizon glow lights the undersides at dusk
  Loop(steps, ({ i }) => {
    const f = float(i).add(jitter).div(steps);
    const t = mix(t0, t1, f);
    const p = cameraPosition.add(dir.mul(t));
    const d = cloudDensity(p, f, lod);
    const dl = cloudDensity(p.add(U.lightDir.mul(240)), f.add(U.lightDir.y.mul(240 / (CLOUD_TOP - CLOUD_BASE))), lod);
    const a = float(1).sub(exp(d.mul(dt).mul(-0.011)));
    const sun = exp(dl.mul(-2.4)).mul(mix(float(0.5), float(1), f));
    const lit = U.lightColor.mul(sun.mul(0.3)).mul(toward.mul(d.oneMinus()).mul(2).add(1))
      .add(U.skyAmbient.mul(mix(float(0.55), float(1.15), f)))
      .add(glow.mul(f.oneMinus().mul(0.5).add(0.15)));
    C.addAssign(T.mul(a).mul(mix(atmo, lit, exp(t.div(-45000)))));
    T.mulAssign(a.oneMinus());
  });
  const fade = ss(0.0, 0.035, dir.y);
  const alpha = T.oneMinus();
  if (!crisp) return vec4(C.mul(fade), alpha.mul(fade));
  // The march above is filtered smooth. Put the fine structure back from noise laid over the sky itself, in a map of
  // directions that keeps shapes round everywhere (stereographic). It has no slices in it, and unlike a flat sheet at
  // cloud height it does not smear into streaks near the horizon. Clouds drift through it, so their edges slowly evolve.
  const q = dir.xz.div(dir.y.add(1)), drift = vec2(0, U.time.mul(2 / 3600));
  const detailAt = (o) => texture(noiseTex, o.mul(1.5).add(drift)).g.mul(0.65).add(texture(noiseTex, o.mul(4.7).sub(drift)).a.mul(0.35));
  const detail = detailAt(q);
  const edge = alpha.mul(alpha.oneMinus()).mul(4); // only where the cloud is thin
  const sharp = ss(0.18, 0.82, alpha.add(detail.sub(0.5).mul(1.5).mul(edge)));
  // Billows: the same noise read as relief, lit from the sun's side.
  const sunQ = U.lightDir.xz.div(U.lightDir.y.add(1)), toSun = normalize(sunQ.sub(q).add(vec2(1e-4, 0)));
  const relief = clamp(detail.sub(detailAt(q.add(toSun.mul(0.022)))).mul(2.6), -0.6, 0.6);
  const shade = relief.mul(0.24).add(mix(float(0.93), float(1.05), detail));
  return vec4(C.mul(shade).mul(sharp.div(max(alpha, 1e-4))).mul(fade), sharp.mul(fade));
})();

/** Thin high streaks that carry sunset color. */
const cirrus = (env: Env, dir) => {
  const t = float(8000).div(max(dir.y, 0.03));
  const p = dir.xz.mul(t).add(cameraPosition.xz).add(WIND.mul(U.time.mul(20)));
  const n = texture(noiseTex, p.div(vec2(61000, 19000))).level(0).a;
  const a = ss(0.56, 0.8, n).mul(0.16).mul(ss(0.03, 0.22, dir.y)).mul(exp(t.div(-90000)));
  const glow = skyLut(env, vec3(U.lutAz.x, 0.12, U.lutAz.y));
  return { color: U.lightColor.mul(0.2).add(U.skyAmbient.mul(0.9)).add(glow.mul(0.9)), alpha: a };
};

const stars = (dir) => {
  const g = dir.mul(170), cell = floor(g), f = fract(g).sub(0.5);
  const h = mx_cell_noise_float(cell), h2 = mx_cell_noise_float(cell.add(31.7));
  const off = vec3(h2, fract(h2.mul(7.13)), fract(h2.mul(13.7))).sub(0.5).mul(0.5);
  const twinkle = mx_noise_float(vec2(h.mul(900), U.time.mul(1.7))).mul(0.25).add(1);
  const mag = pow(fract(h.mul(91.7)), 5).mul(5).add(0.35);
  const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.86, 1.0), fract(h.mul(37.1)));
  return tint.mul(step(0.988, h).mul(mag).mul(twinkle).mul(ss(0.17, 0.02, length(f.sub(off)))));
};

/** The lit skyline as the water reflects it at night: columns of warm light low over the land. */
export const cityLights = (dir) => {
  const az = dir.x.div(max(dir.z.negate(), 0.05));
  const col = mx_cell_noise_float(vec2(floor(az.mul(42)), 1.7)), lit = step(0.45, col);
  const warm = mix(vec3(1.0, 0.68, 0.36), vec3(0.8, 0.88, 1.0), step(0.9, col));
  return warm.mul(lit).mul(ss(0.3, 0.02, dir.y)).mul(ss(0.0, 0.2, dir.z.negate())).mul(ss(-1.2, 0.2, az)).mul(ss(0.25, 0.8, U.night)).mul(float(0.5).div(U.exposure));
};

/** Sky as the water sees it: atmosphere plus soft clouds, cheap enough for reflections and fog. */
export const skyReflection = (env: Env, dir) => {
  const atmo = skyLut(env, dir).add(cityGlow(dir)).add(cityLights(dir));
  const c = cumulus(env, dir, atmo, 3, float(0.5));
  return atmo.mul(c.a.oneMinus()).add(c.rgb);
};

export function createSky(env: Env, cloudSteps = 28): THREE.Mesh {
  const dir = normalize(positionWorld.sub(cameraPosition));
  const atmo = skyLut(env, dir).add(cityGlow(dir));
  const above = ss(-0.01, 0.01, dir.y);

  // Sun: HDR disk with limb darkening, plus a tight aureole the lookup texture is too coarse to hold.
  const cs = dot(dir, U.sunDir);
  const sunDisk = ss(0.999955, 0.99998, cs).mul(mix(float(0.6), float(1), ss(0.999955, 0.99999, cs)));
  const aureole = pow(clamp(cs, 0, 1), 900).mul(0.35).add(pow(clamp(cs, 0, 1), 60).mul(0.012));
  const sun = U.sunColor.mul(sunDisk.mul(22).add(aureole));

  // Moon: always full, drawn a little larger than life, brightness held steady on screen.
  const cm = dot(dir, U.moonDir);
  const MOON_R = 0.0085;
  const md = acos(clamp(cm, -1, 1)).div(MOON_R); // 0 center .. 1 limb
  const moonMask = ss(1.0, 0.94, md);
  const mx = normalize(vec3(U.moonDir.z, 0, U.moonDir.x.negate())), my = normalize(mx.cross(U.moonDir));
  const muv = vec2(dot(dir, mx), dot(dir, my)).div(MOON_R);
  const maria = ss(0.35, 0.65, mx_fractal_noise_float(vec3(muv.mul(1.4).add(3.1), 1.5), 3, 2.1, 0.5).mul(0.5).add(0.5));
  const moonTint = U.moonColor.div(max(max(U.moonColor.x, U.moonColor.y), max(U.moonColor.z, 1e-5)));
  const moonUp = ss(-0.02, 0.01, U.moonDir.y);
  const moonLum = mix(float(1), float(0.62), maria).mul(sqrt(max(float(1).sub(md.mul(md)), 0)).mul(0.25).add(0.75));
  const moon = mix(vec3(0.9, 0.8, 0.7), moonTint, 0.75).mul(moonLum).mul(moonMask).mul(moonUp).mul(float(2.4).div(U.exposure));
  const halo = U.moonColor.mul(pow(clamp(cm, 0, 1), 500).mul(0.4).add(pow(clamp(cm, 0, 1), 40).mul(0.012))).mul(moonUp);

  const nearMoon = ss(0.93, 0.999, cm);
  const starLight = stars(dir).mul(U.night.mul(U.night)).mul(nearMoon.oneMinus()).mul(ss(0.02, 0.25, dir.y)).mul(0.03);

  let col = atmo.add(sun.add(moon).add(halo).add(starLight).mul(above));
  const hi = cirrus(env, dir);
  col = mix(col, hi.color, hi.alpha.mul(moonMask.mul(0.7).oneMinus()));
  const lo = cumulus(env, dir, atmo, cloudSteps, interleavedGradientNoise(screenCoordinate.xy).sub(0.5).mul(0.18).add(0.5), true);
  col = col.mul(lo.a.oneMinus()).add(lo.rgb);

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  // From under water the sky is only ever seen through the surface; the dome itself takes the water's color.
  const waterCol = vec3(0.004, 0.06, 0.15).mul(U.lightColor.mul(max(U.lightDir.y, 0).mul(0.6)).add(U.skyAmbient.mul(2.2)));
  mat.colorNode = mix(col, waterCol, U.under);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(15000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
