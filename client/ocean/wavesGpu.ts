// @ts-nocheck  (TSL node chains)
// GPU mirror of shared/waves.ts sampleWave(). Up to MAX waves are fed in as uniforms each frame;
// the shader evaluates the same formulas, so the mesh conforms to what physics simulates.
import * as THREE from 'three/webgpu';
import { Fn, Loop, uniformArray, uniform, float, vec2, vec4, min, max, mix, clamp, abs, sqrt, exp, select, step } from 'three/tsl';
import { C0, T_CURL, crestZ, inside, type BreakSpec, type Wave } from '../../shared/waves';

export const MAX_WAVES = 8;
const T_SHOAL = 14, W_OFF = 10, PEAKED = 1.2; // keep in step with shared/waves.ts

const A = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()); // zc, t - tb, h, reach
const P0 = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 1e6, 1, 1)); // peak x, dt, vl, vr
const P1 = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 1e6, 1, 1));
const uA = uniformArray(A), uP0 = uniformArray(P0), uP1 = uniformArray(P1);
const uBreak = uniform(new THREE.Vector4(0, 110, 125, 1)); // centerX, zb, halfWidth, steep
const uInside = uniform(new THREE.Vector2(24, 0.12)); // tin, dec

export function updateWaveUniforms(waves: Wave[], b: BreakSpec, t: number): void {
  const { tin, dec } = inside(b);
  uBreak.value.set(b.centerX, b.zb, b.halfWidth, b.steep);
  uInside.value.set(tin, dec);
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = waves[i];
    if (!w) { A[i].set(1e5, -1e5, 0, 1); continue; }
    A[i].set(crestZ(w, b, t), t - w.tb, w.h, w.reach);
    const p0 = w.peaks[0], p1 = w.peaks[1];
    P0[i].set(p0.x, p0.dt, p0.vl, p0.vr);
    if (p1) P1[i].set(p1.x, p1.dt, p1.vl, p1.vr); else P1[i].set(0, 1e6, 1, 1);
  }
}

const sm = (t) => t.mul(t).mul(t.mul(-2).add(3));
const sat = (t) => clamp(t, 0, 1);

/**
 * Sum the waves at world xz `p`. Returns vec4(height, dHeight/dz, foam 0..1, w). w above zero is the backlit-lip mask;
 * below zero it is minus the churn of a live bore (the two never share a place: one is unbroken face, one is broken).
 * `detail` false skips trail foam and lip work (vertex stage).
 */
export const waveField = (p, detail: boolean) => Fn(() => {
  const eta = float(0).toVar(), slope = float(0).toVar(), foam = float(0).toVar(), lip = float(0).toVar(), bore = float(0).toVar();
  const cx = uBreak.x, zb = uBreak.y, half = uBreak.z, steep = uBreak.w, tin = uInside.x, dec = uInside.y;
  const taper = float(1).sub(sm(sat(abs(p.x.sub(cx)).sub(half).div(60))).mul(0.7));
  Loop(MAX_WAVES, ({ i }) => {
    const a = uA.element(i), zc = a.x, tRel = a.y, h = a.z, reach = a.w;
    const delayOf = (pk) => { const dx = p.x.sub(pk.x); return pk.y.add(select(dx.lessThan(0), dx.negate().div(pk.z), dx.div(pk.w))); };
    const delay = min(delayOf(uP0.element(i)), delayOf(uP1.element(i)));
    const tau = tRel.sub(delay), d = p.y.sub(zc);
    const wfBreak = max(float(2.2), h.mul(2.4).div(steep));
    // Before this section breaks: it stands up and its face steepens.
    const s = sm(sat(tau.negate().div(T_SHOAL)));
    const ampPre = h.mul(taper).mul(float(1).sub(s.mul(0.72))), wfPre = mix(wfBreak, float(W_OFF), s);
    // After: it collapses into a bore that weakens as it runs.
    const broken = sm(sat(tau.div(T_CURL)));
    const dl = clamp(delay, 0, tin);
    const zBreak = zb.sub(dl.mul(C0)).add(dec.mul(dl).mul(dl).mul(0.5));
    const sigma = sat(float(1).sub(zBreak.sub(zc).div(reach)));
    const ampPost = h.mul(taper).mul(mix(float(1), sigma.mul(0.45).add(0.3).mul(min(float(1), sigma.mul(4))), broken));
    const post = step(0, tau);
    const amp = mix(ampPre, ampPost, post), wf = mix(wfPre, mix(wfBreak, float(1.6), broken), post), wb = mix(float(W_OFF), mix(float(W_OFF), float(13), broken), post);
    const front = d.lessThan(0);
    const pk = select(front, mix(float(PEAKED).mul(float(1).sub(s)), mix(float(PEAKED), float(0.5), broken), post), float(0));
    const w = select(front, wf, wb), u = d.div(w);
    // The mesh cannot hold a knife edge: without rounding, the crest line saws. This form is smooth at the crest and
    // returns to |u| a little way down the face, so boards drawn at the physics height do not sink into the mesh.
    const au = detail ? abs(u) : u.mul(u).div(sqrt(u.mul(u).add(0.03)));
    const q = float(1).div(pk.mul(au).add(u.mul(u)).add(1)), P = q.mul(q);
    eta.addAssign(amp.mul(P));
    slope.addAssign(amp.mul(pk.sub(u.mul(2))).mul(P).mul(q).mul(2).div(w));
    // Churning front: spreads from the lip down the face as the section pitches, then rides the bore.
    const cover = mix(sigma, float(1), float(1).sub(broken)).mul(taper).mul(min(float(1), h.div(0.9)));
    const churn = post.mul(cover).mul(sat(d.div(wf.mul(mix(float(0.25), float(1.5), broken))).add(1))).mul(sat(float(1).sub(d.div(4.5))));
    bore.assign(max(bore, churn.mul(broken)));
    if (detail) {
      // Trail: foam left where the bore passed, fading with age.
      const zr = max(zb.sub(p.y), 0);
      const tp = select(p.y.greaterThanEqual(zb), p.y.sub(zb).div(-C0), float(C0).sub(sqrt(max(float(C0 * C0).sub(dec.mul(2).mul(zr)), 0))).div(dec));
      const age = tRel.sub(tp);
      const sigPass = sat(float(1).sub(zBreak.sub(p.y).div(reach)));
      // Thick for a second, then thinning fast into lace, with a long faint tail. A wide soft edge along the peel line.
      const fade = exp(age.div(-2.5)).mul(0.6).add(exp(age.div(-9)).mul(0.28));
      const trail = sat(tp.sub(delay).div(2.2)).mul(sat(age.div(0.4))).mul(sqrt(sigPass)).mul(taper).mul(fade).mul(min(float(1), h.div(0.9)));
      // The lip feathers just before it goes.
      const feather = sat(tau.add(1.3).div(1.3)).mul(float(1).sub(post)).mul(sat(float(1).sub(abs(d.add(0.15)).div(0.45)))).mul(taper).mul(0.8);
      foam.assign(max(foam, max(max(churn, trail), feather)));
      // Thin water high on an unbroken face lets backlight through.
      lip.assign(max(lip, P.mul(P).mul(P).mul(P).mul(P).mul(sat(amp.div(1.4))).mul(float(1).sub(broken)).mul(step(d, 0.3)).mul(sat(tau.add(5).div(4)))));
    }
  });
  return vec4(eta, slope, foam, select(lip.greaterThan(0.004), lip, bore.negate()));
})();
