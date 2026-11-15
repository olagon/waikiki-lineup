// @ts-nocheck  (TSL node chains)
// The sea surface: one camera-centered radial mesh, analytic normals, Fresnel sky reflection,
// sun glitter, and a refracted, depth-absorbed view of whatever is under the water.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, vec4, float, uniform, positionLocal, positionWorld, positionView, cameraPosition, cameraNear, cameraFar,
  normalize, dot, max, mix, clamp, pow, exp, sin, cos, length, reflect, texture, screenUV,
  viewportSharedTexture, viewportDepthTexture, perspectiveDepthToViewZ, select, frontFacing, dFdx, dFdy,
} from 'three/tsl';
import { U, type Env } from '../render/env';
import { skyReflection, skyLut, noiseTex } from '../render/sky';
import { ss } from '../render/tsl';
import { CHOP, RIPPLE_SLOPE, chopOmega, makeRippleTexture } from './ripples';
import { waveField } from './wavesGpu';
import type { Wake } from './wake';

export const WATER = {
  absorb: new THREE.Vector3(0.4, 0.065, 0.028), // per meter of path (ART.md)
  scatter: new THREE.Vector3(0.004, 0.06, 0.15), // color of light scattered back by the water body
  scatterRate: 0.1,
  visibility: 16000, // haze e-folding distance (m), shared with land fog
};

/** A rate in cycles per second snapped so animation loops seamlessly when U.time wraps each hour. */
const loop = (cps: number) => Math.round(cps * 3600) / 3600;
const TAU = Math.PI * 2;

function radialGrid(rings: number, segs: number, r0: number, r1: number): THREE.BufferGeometry {
  const pos = new Float32Array((rings + 1) * segs * 3);
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : r0 * Math.pow(r1 / r0, (i - 1) / (rings - 1));
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU, o = (i * segs + j) * 3;
      pos[o] = r * Math.cos(a); pos[o + 2] = r * Math.sin(a);
    }
  }
  const idx = new Uint32Array(rings * segs * 6);
  let k = 0;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** z of the waterline; mirrors shared/bathy.ts shoreZ. */
export const shoreZNode = (x) => {
  const u = x.div(400), t = clamp(x.sub(380).div(620), 0, 1);
  return u.mul(u).mul(30).div(u.mul(u).add(1)).add(t.mul(t).mul(t.mul(-2).add(3)).mul(260));
};

export interface Ocean { mesh: THREE.Mesh; update(camera: THREE.PerspectiveCamera): void }

export function createOcean(env: Env, wake: Wake, tier: { rings: number; segs: number } = { rings: 360, segs: 512 }): Ocean {
  const uCenter = uniform(new THREE.Vector2());
  const ripples = makeRippleTexture();

  // --- vertex: place the grid around the camera and lift it by chop and shoreline swash
  const wxz = positionLocal.xz.add(uCenter);
  const chopTerms = CHOP.map(([dx, dz, len, amp, ph]) => {
    const k = TAU / len, w = chopOmega(len);
    return { k, amp, phase: (p) => p.x.mul(dx * k).add(p.y.mul(dz * k)).sub(U.time.mul(w)).add(ph), dx, dz };
  });
  const chopH = (p) => chopTerms.reduce((acc, c) => acc.add(sin(c.phase(p)).mul(c.amp)), float(0));
  const seaward = (p) => p.y.sub(shoreZNode(p.x)); // distance past the waterline
  const swash = (p) => sin(U.time.mul(loop(0.11) * TAU).add(p.x.mul(0.05))).mul(0.07).mul(exp(max(seaward(p), 0).div(-10)));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, fog: false, side: THREE.DoubleSide });
  // A live bore is a tumbling pile, not a sheet: heap it up in lumps that travel in with it.
  const boreUV = (q, len: number) => q.div(len).add(vec2(0, U.time.mul(loop(4.6 / len))));
  // Only where the mesh is fine enough to hold the lumps; farther out they would show as facets.
  const wfV = waveField(wxz, false), heap = max(wfV.w.negate(), 0).mul(texture(noiseTex, boreUV(wxz, 13)).level(0).r.mul(0.55).add(0.1)).mul(ss(70, 25, length(positionLocal.xz)));
  mat.positionNode = vec3(wxz.x, chopH(wxz).add(swash(wxz)).add(wfV.x).add(heap), wxz.y);

  // --- fragment
  const p = positionWorld.xz;
  const toCam = cameraPosition.sub(positionWorld);
  const dist = length(toCam);
  const V = toCam.div(dist);

  // Surface slope: analytic chop plus three ripple layers at unrelated scales so no tiling shows.
  // The chop is exact math, so nothing filters it: once a wavelength shrinks to a few pixels it turns into speckle.
  // Fade each term out as it nears the size of the pixel's footprint on the water (long axis, in meters).
  const footprint = max(length(dFdx(p)), length(dFdy(p)));
  let slope = chopTerms.reduce((acc, c) => acc.add(vec2(c.dx, c.dz).mul(cos(c.phase(p)).mul(c.amp * c.k)).mul(ss(2.5, 8, float(TAU / c.k).div(footprint)))), vec2(0));
  const layer = (len: number, ang: number, speed: number, gain: number) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const uv = vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c))).div(len).add(vec2(0, U.time.mul(-loop(speed / len))));
    const t = texture(ripples, uv).rg.sub(0.5).mul(2 * RIPPLE_SLOPE * gain);
    return vec2(t.x.mul(c).add(t.y.mul(s)), t.y.mul(c).sub(t.x.mul(s))); // rotate slopes back to world
  };
  // Offshore wind keeps the surface clean: fine ripples up close, calmer and glossier with distance.
  // Gusts roughen the water in drifting patches, which also hides any repetition in the ripple texture.
  const gust = texture(noiseTex, p.div(210).add(vec2(U.time.mul(loop(0.004)), U.time.mul(loop(0.011))))).r;
  const calm = mix(float(1), float(0.4), ss(30, 500, dist)).mul(mix(float(0.3), float(1.25), ss(0.32, 0.68, gust)));
  // A standing face is stretched glass: the ripples flatten out of it.
  const wf = waveField(p, true), glassy = mix(float(1), float(0.3), ss(0.06, 0.35, wf.y.abs()));
  slope = slope.add(layer(2.9, 0.0, 0.5, 0.3).mul(ss(220, 40, dist)).add(layer(9.7, 0.61, 0.9, 0.38)).add(layer(33, -0.4, 1.6, 0.22)).mul(calm).mul(glassy));
  // Break the foam's outline up at the scale of a few meters, so trails are ragged patches and not clean polygons.
  const patchy = texture(noiseTex, p.div(13).add(vec2(0.31, 0.17))).b.mul(0.9).add(0.55);
  const foamAmt = max(clamp(wf.z.mul(patchy), 0, 1), wake.sample(p)), lipAmt = max(wf.w, 0), fresh = clamp(wf.w.negate().mul(1.6), 0, 1);
  slope = slope.add(vec2(0, wf.y));
  const N = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));

  const NV = max(dot(N, V), 0.04);
  const fresnel = pow(float(1).sub(NV), 5).mul(0.98).add(0.02);

  // Reflection: the sky, with roughness rising with distance where ripples are no longer resolved.
  const R0 = reflect(V.negate(), N);
  const R = normalize(vec3(R0.x, max(R0.y, 0.02), R0.z));
  const sky = skyReflection(env, R);
  const rough = mix(float(0.11), float(0.24), ss(10, 600, dist));
  const H = normalize(U.lightDir.add(V));
  const NH = max(dot(N, H), 0), a2 = rough.mul(rough);
  const D = a2.div(NH.mul(NH).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI));
  const FH = pow(float(1).sub(max(dot(V, H), 0)), 5).mul(0.98).add(0.02);
  // Far off, the sun's path is a sheen, not a sheet of white: cap it lower with distance.
  const glitter = U.lightColor.mul(clamp(D.mul(FH).div(NV.mul(4)), 0, mix(float(28), float(4), ss(80, 700, dist)))).mul(ss(-0.02, 0.05, U.lightDir.y));

  // Refraction: look through the surface at the scene behind it, bent by the surface slope.
  const fragZ = positionView.z;
  // The reversed depth buffer is depth32float; the copy target must match it.
  const depthCopy = new THREE.DepthTexture();
  depthCopy.type = THREE.FloatType;
  const zAt = (uv) => perspectiveDepthToViewZ(viewportDepthTexture(uv, null, depthCopy), cameraNear, cameraFar);
  const thick0 = fragZ.sub(zAt(screenUV));
  const bend = N.xz.mul(float(0.06).div(dist.mul(0.08).add(1))).mul(clamp(thick0.mul(0.6), 0, 1));
  const uvBent = screenUV.add(bend);
  const thickBent = fragZ.sub(zAt(uvBent));
  const ok = thickBent.greaterThan(0); // do not pull in things that are in front of the water
  const uvR = select(ok, uvBent, screenUV);
  // Clamp hard: at grazing triangle edges MSAA extrapolates varyings, and a negative path would amplify instead of absorb.
  const path = clamp(select(ok, thickBent, thick0), 0, 400).mul(clamp(dist.div(max(fragZ.negate(), 0.05)), 1, 3));
  const behind = viewportSharedTexture(uvR).rgb;
  const light = U.lightColor.mul(max(U.lightDir.y, 0).mul(0.6)).add(U.skyAmbient.mul(2.2));
  const absorb = uniform(WATER.absorb), scatter = uniform(WATER.scatter);
  const body = behind.mul(exp(absorb.mul(path).negate()))
    .add(scatter.mul(light).mul(float(1).sub(exp(path.mul(-WATER.scatterRate)))));

  // Lace at the waterline where the water thins to nothing.
  const lace = texture(noiseTex, p.div(3.1).add(vec2(0, U.time.mul(loop(0.05))))).g;
  const edge = ss(0.22, 0.0, thick0).mul(ss(0.35, 0.6, lace.add(ss(0.1, 0.0, thick0).mul(0.4))));
  // Whitewater is a thick scatterer: it stays bright under a low sun and takes its shade from the sky.
  const foamCol = U.lightColor.mul(max(U.lightDir.y, 0).mul(0.14).add(0.13)).add(U.skyAmbient.mul(1.7));

  // Backlit lips glow green-gold: light entering the back of a thin face and scattering toward the eye.
  const Lh = normalize(U.lightDir.xz.add(vec2(1e-4, 0))), Vh = normalize(V.xz.add(vec2(1e-4, 0)));
  const backlit = pow(clamp(dot(Vh, Lh).negate().mul(0.5).add(0.5), 0, 1), 2).mul(ss(0.5, 0.05, U.lightDir.y).mul(0.75).add(0.25));
  const glow = mix(vec3(0.14, 0.5, 0.3), vec3(0.42, 0.62, 0.2), ss(0.3, 0.03, U.lightDir.y)).mul(U.lightColor).mul(lipAmt).mul(backlit).mul(0.55);

  // Whitewater: thick where it is fresh, breaking into lace as it ages.
  const n1 = texture(noiseTex, p.div(5.3).add(vec2(U.time.mul(loop(0.013)), 0))).r, n2 = texture(noiseTex, p.div(1.7)).g;
  const laceN = n1.mul(0.6).add(n2.mul(0.4));
  const n3 = texture(noiseTex, p.div(0.55).add(vec2(0, U.time.mul(loop(0.03))))).b;
  const white = ss(float(1.0).sub(foamAmt.mul(1.25)), float(1.34).sub(foamAmt.mul(1.25)), laceN.add(0.22).add(n3.sub(0.5).mul(0.22)));
  // Foam has body: bubbly highlights, bluish hollows, and a darker rim where it thins.
  const flatShade = mix(vec3(0.62, 0.74, 0.86), vec3(1.08, 1.06, 1.02), ss(0.3, 0.75, n2.mul(0.55).add(n3.mul(0.45)))).mul(white.mul(0.3).add(0.72));
  // The live bore has relief: lumps and churn that travel with it, lit from the sun's side and blue in the hollows.
  const Lxz = normalize(U.lightDir.xz.add(vec2(1e-4, 0)));
  const lump = (q) => texture(noiseTex, boreUV(q, 13)).r, boil = (q) => texture(noiseTex, boreUV(q, 3.7).add(vec2(U.time.mul(loop(0.03)), 0))).g;
  const relief = lump(p).sub(lump(p.add(Lxz.mul(0.9)))).mul(2.4).add(boil(p).sub(boil(p.add(Lxz.mul(0.28)))).mul(1.5));
  const lowSun = ss(0.6, 0.05, U.lightDir.y).mul(0.6).add(0.4); // a low sun rakes across the foam and the relief deepens
  const boreShade = mix(vec3(0.5, 0.63, 0.8), vec3(1.16, 1.12, 1.05), clamp(relief.mul(lowSun).mul(2.2).add(0.58), 0, 1)).mul(boil(p).mul(0.25).add(0.84));
  const foamShade = mix(flatShade, boreShade, fresh);

  // Priority: while you paddle for a wave, its face glows faintly in the color of whoever has the right to it.
  const claim = U.priority.rgb.mul(U.priority.w).mul(pow(lipAmt, 0.3)).mul(exp(length(p.sub(U.priorityAt)).div(-11))).mul(U.skyAmbient.x.add(U.skyAmbient.y).add(U.skyAmbient.z).mul(2).add(0.02));

  let col = mix(body.add(glow).add(claim), sky, fresnel).add(glitter.mul(white.oneMinus()));
  col = mix(col, foamCol.mul(foamShade), max(white, edge.mul(0.85)));
  // Aerial haze toward the horizon.
  const hazeDir = normalize(vec3(V.x.negate(), 0.03, V.z.negate()));
  col = mix(skyLut(env, hazeDir), col, exp(dist.div(-WATER.visibility)));
  // --- seen from below: Snell's window to the sky, a dark mirror outside it, bright churning foam overhead
  const Nd = N.negate(), I = V.negate(), ci = clamp(dot(I, Nd).negate(), 0, 1);
  const kk = float(1).sub(float(1.33 * 1.33).mul(float(1).sub(ci.mul(ci)))); // > 0 inside the window
  const Tdir = normalize(I.mul(1.33).add(Nd.mul(float(1.33).mul(ci).sub(max(kk, 0).sqrt()))));
  const up = normalize(vec3(Tdir.x, max(Tdir.y, 0.03), Tdir.z));
  const sunThrough = U.lightColor.mul(pow(clamp(dot(up, U.lightDir), 0, 1), 220).mul(14).add(pow(clamp(dot(up, U.lightDir), 0, 1), 12).mul(0.35)));
  const deep = scatter.mul(light);
  let below = mix(deep.mul(0.9), skyReflection(env, up).add(sunThrough), ss(-0.25, 0.3, kk)); // ripples blur the edge of the window
  const churn = texture(noiseTex, p.div(2.3).add(vec2(U.time.mul(loop(0.05)), U.time.mul(loop(0.03))))).r;
  const foamBelow = U.lightColor.mul(max(U.lightDir.y, 0.1).mul(0.3)).add(U.skyAmbient.mul(1.3)).mul(churn.mul(0.9).add(0.35));
  below = mix(below, foamBelow, clamp(foamAmt.mul(1.4), 0, 1).mul(ss(0.25, 0.6, churn.add(foamAmt.mul(0.5)))));
  below = below.mul(exp(absorb.mul(dist).mul(-0.5))).add(deep.mul(float(1).sub(exp(dist.mul(-0.09)))));
  col = select(frontFacing, col, below);

  const dbg = new URLSearchParams(location.search).get('wdbg');
  mat.colorNode = vec4(dbg === '1' ? sky : dbg === '2' ? vec3(fresnel).div(U.exposure) : dbg === '3' ? N.mul(0.5).add(0.5).div(U.exposure) : dbg === '4' ? body : clamp(col, 0, float(12).div(U.exposure)), 1); // bounded on screen at any exposure, so night glitter cannot flash

  const mesh = new THREE.Mesh(radialGrid(tier.rings, tier.segs, 0.25, 12000), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'ocean';

  const fwd = new THREE.Vector3();
  return {
    mesh,
    update(camera) {
      // Center the dense part of the grid ahead of the camera when it is high, under it when it is low.
      camera.getWorldDirection(fwd);
      const ahead = Math.min(400, Math.max(0, camera.position.y - 2) * 8);
      const l = Math.hypot(fwd.x, fwd.z) || 1;
      uCenter.value.set(camera.position.x + (fwd.x / l) * ahead, camera.position.z + (fwd.z / l) * ahead);
    },
  };
}
