// A human body generated in code: lofted tubes skinned to one shared skeleton.
// Stylized-realistic: believable proportions and motion, no face.
import * as THREE from 'three/webgpu';
import { COLORS, HAIR, SKIN, type Look } from '../../shared/looks';

export const BONE = { pelvis: 0, spine: 1, chest: 2, neck: 3, head: 4, armL: 5, foreL: 6, handL: 7, armR: 8, foreR: 9, handR: 10, thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16 };
export const NBONES = 17;
export interface Build { h: number; sw: number; g: number; belly: number }
const BUILDS: Build[] = [{ h: 0.97, sw: 0.97, g: 0.96, belly: 0 }, { h: 1, sw: 1.02, g: 1.03, belly: 0.01 }, { h: 1.03, sw: 1.1, g: 1.17, belly: 0.05 }, { h: 0.74, sw: 0.88, g: 0.93, belly: 0 }];
export const buildOf = (look: Look) => BUILDS[look.build] ?? BUILDS[1];

/** Rest joint positions for a build (meters; x forward, y up, z right). */
export function restJoints(b: Build): THREE.Vector3[] {
  const s = b.h, sh = 0.185 * b.sw * s, hip = 0.095 * s, J: THREE.Vector3[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x * s, y * s, z);
  J[BONE.pelvis] = v(0, 0.95, 0); J[BONE.spine] = v(0, 1.08, 0); J[BONE.chest] = v(0, 1.28, 0); J[BONE.neck] = v(0, 1.5, 0); J[BONE.head] = v(0, 1.58, 0);
  J[BONE.armL] = v(0, 1.44, -sh); J[BONE.foreL] = v(0, 1.16, -sh); J[BONE.handL] = v(0, 0.9, -sh);
  J[BONE.armR] = v(0, 1.44, sh); J[BONE.foreR] = v(0, 1.16, sh); J[BONE.handR] = v(0, 0.9, sh);
  J[BONE.thighL] = v(0, 0.93, -hip); J[BONE.shinL] = v(0, 0.5, -hip); J[BONE.footL] = v(0, 0.08, -hip);
  J[BONE.thighR] = v(0, 0.93, hip); J[BONE.shinR] = v(0, 0.5, hip); J[BONE.footR] = v(0, 0.08, hip);
  return J;
}

type W = [number, number][]; // [bone, weight] pairs
interface Ring { c: [number, number, number]; ru: number; rv: number; w: W; col: number[]; rough: number; axis?: 'x' }

export function buildBody(look: Look): THREE.BufferGeometry {
  const b = buildOf(look), s = b.h, g = b.g, sh = 0.185 * b.sw * s, hip = 0.095 * s;
  const skin = SKIN[look.skin] ?? SKIN[2], top = COLORS[look.topColor] ?? COLORS[3], shorts = COLORS[look.shortsColor] ?? COLORS[1], hair = HAIR[look.hairColor] ?? HAIR[0];
  const pos: number[] = [], col: number[] = [], rgh: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const N = 14;
  const tube = (input: Ring[], capStart = true, capEnd = true) => {
    // Where clothing meets skin, double the ring so the color edge is crisp instead of a gradient.
    const rings: Ring[] = [];
    input.forEach((r, i) => { const p = input[i - 1]; if (p && (p.col[0] !== r.col[0] || p.col[1] !== r.col[1] || p.col[2] !== r.col[2])) rings.push({ ...r, col: p.col, rough: p.rough }); rings.push(r); });
    const base = pos.length / 3;
    rings.forEach((r) => {
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2, cu = Math.cos(a) * r.ru, cv = Math.sin(a) * r.rv;
        if (r.axis === 'x') pos.push(r.c[0], r.c[1] + cu, r.c[2] + cv); else pos.push(r.c[0] + cu, r.c[1], r.c[2] + cv);
        col.push(r.col[0], r.col[1], r.col[2]); rgh.push(r.rough);
        const w = [...r.w, [0, 0], [0, 0]].slice(0, 2) as W, t = w[0][1] + w[1][1];
        si.push(w[0][0], w[1][0], 0, 0); sw.push(w[0][1] / t, w[1][1] / t, 0, 0);
      }
    });
    // Faces must point outward whichever way the rings are listed. Arms and legs are listed top to bottom, and for
    // years of this file's life that drew them inside out: you saw the far inner wall of every limb, lit backwards,
    // and looked straight into the legs of the shorts. A ring around x also turns the other way from one around y.
    const alongX = rings[0].axis === 'x', ax = alongX ? 0 : 1, rising = rings[rings.length - 1].c[ax] > rings[0].c[ax], turn = alongX === rising;
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < N; k++) {
      const a = base + i * N + k, c = base + i * N + ((k + 1) % N), d = a + N, e = c + N;
      turn ? idx.push(a, c, d, c, e, d) : idx.push(a, d, c, c, d, e);
    }
    const cap = (ri: number, flip: boolean) => { const o = base + ri * N; for (let k = 1; k < N - 1; k++) flip === turn ? idx.push(o, o + k, o + k + 1) : idx.push(o, o + k + 1, o + k); }; // end caps face away from the tube
    if (capStart) cap(0, false);
    if (capEnd) cap(rings.length - 1, true);
  };
  const B = BONE, SK = 0.42, CL = 0.8, y = (v: number) => v * s;
  const swim = look.top === 3, covered = look.top !== 0, sleeves = look.top === 2;
  const torsoCol = (yy: number) => (yy < 0.99 ? shorts : covered ? (swim && yy > 1.42 ? skin : top) : skin);
  const tr = (yy: number, rx: number, rz: number, w: W): Ring => ({ c: [yy > 0.95 && yy < 1.15 ? b.belly * 0.5 : 0, y(yy), 0], ru: (rx + (yy > 0.95 && yy < 1.15 ? b.belly : 0)) * g * s, rv: rz * g * s, w, col: torsoCol(yy), rough: torsoCol(yy) === skin ? SK : CL });
  // Torso, neck, head
  const HC: [number, number, number] = [0.015 * s, y(1.665), 0];
  // The head is a skull, not a ball: a jaw that comes forward of the neck, cheeks, a brow, and a fuller back.
  const hd = (dy: number, ru: number, rv: number, cx: number): Ring => ({ c: [HC[0] + cx * s, HC[1] + dy * s, 0], ru: ru * s, rv: rv * s, w: [[B.head, 1]], col: skin, rough: SK });
  tube([
    tr(0.84, 0.08, 0.125, [[B.pelvis, 1]]), tr(0.93, 0.108, 0.17, [[B.pelvis, 1]]), tr(1.02, 0.1, 0.152, [[B.pelvis, 0.5], [B.spine, 0.5]]), tr(1.1, 0.092, 0.138, [[B.spine, 1]]),
    tr(1.2, 0.105, 0.15, [[B.spine, 0.5], [B.chest, 0.5]]), tr(1.3, 0.122, 0.172, [[B.chest, 1]]),
    { ...tr(1.385, 0.118, 0.17, [[B.chest, 1]]), rv: 0.19 * b.sw * s * Math.sqrt(g) }, { ...tr(1.445, 0.095, 0.12, [[B.chest, 1]]), rv: 0.165 * b.sw * s }, // shoulder line
    { ...tr(1.49, 0.07, 0.09, [[B.chest, 1]]), rv: 0.095 * b.sw * s }, // trapezius, sloping up into the neck
    { c: [0, y(1.525), 0], ru: 0.058 * s, rv: 0.06 * s, w: [[B.chest, 0.5], [B.neck, 0.5]], col: skin, rough: SK },
    { c: [0.006, y(1.562), 0], ru: 0.054 * s, rv: 0.055 * s, w: [[B.neck, 0.6], [B.head, 0.4]], col: skin, rough: SK },
    hd(-0.096, 0.056, 0.046, 0.016), hd(-0.07, 0.083, 0.065, 0.014), hd(-0.035, 0.096, 0.077, 0.006), hd(0.01, 0.102, 0.083, 0), hd(0.055, 0.098, 0.081, -0.004),
    hd(0.092, 0.076, 0.064, -0.006), hd(0.112, 0.04, 0.034, -0.006), hd(0.119, 0.008, 0.007, -0.006),
  ]);
  // Hair: a shell a centimeter or so off the skull. Each ring is the skull's own outline pushed out at the back and
  // sides and pulled back at the front, so its front edge sinks into the head and the line where it comes out is the
  // hairline: across the top of the forehead, down the temples, behind the ears, in to the nape.
  if (look.hair > 0) {
    const HR = 0.55, hr = (dy: number, cx: number, ru: number, rv: number): Ring => ({ c: [HC[0] + cx * s, HC[1] + dy * s, 0], ru: ru * s, rv: rv * s, w: [[B.head, 1]], col: hair, rough: HR });
    tube([hr(-0.08, -0.05, 0.02, 0.04), hr(-0.055, -0.05, 0.041, 0.066), hr(-0.02, -0.045, 0.065, 0.088), hr(0.02, -0.02, 0.096, 0.094), hr(0.06, -0.015, 0.1, 0.093),
      hr(0.098, -0.007, 0.079, 0.068), hr(0.118, -0.008, 0.05, 0.045), hr(0.128, -0.008, 0.012, 0.011)]);
    // Long hair falls behind the neck to the shoulder blades. Tied hair gathers into a knot high on the back of the head.
    if (look.hair === 2) tube([{ c: [-0.095 * s, y(1.36), 0], ru: 0.015 * s, rv: 0.045 * s, w: [[B.chest, 1]], col: hair, rough: HR }, { c: [-0.085 * s, y(1.46), 0], ru: 0.035 * s, rv: 0.075 * s, w: [[B.head, 0.4], [B.chest, 0.6]], col: hair, rough: HR },
      { c: [-0.06 * s, y(1.58), 0], ru: 0.055 * s, rv: 0.085 * s, w: [[B.head, 0.7], [B.chest, 0.3]], col: hair, rough: HR }, hr(-0.02, -0.045, 0.066, 0.09)]);
    if (look.hair === 3) tube([{ c: [-0.17 * s, y(1.7), 0], ru: 0.02 * s, rv: 0.02 * s, w: [[B.head, 1]], col: hair, rough: HR, axis: 'x' }, { c: [-0.135 * s, y(1.705), 0], ru: 0.042 * s, rv: 0.042 * s, w: [[B.head, 1]], col: hair, rough: HR, axis: 'x' },
      { c: [-0.1 * s, y(1.7), 0], ru: 0.03 * s, rv: 0.03 * s, w: [[B.head, 1]], col: hair, rough: HR, axis: 'x' }]);
  }
  // Arms
  for (const [sgn, A, F, H] of [[-1, B.armL, B.foreL, B.handL], [1, B.armR, B.foreR, B.handR]] as const) {
    const z = sgn * sh, sleeveCol = (yy: number) => (covered && !swim && (sleeves ? yy > 0.94 : yy > 1.24) ? top : skin);
    const ar = (yy: number, r: number, w: W, rz = r): Ring => ({ c: [0, y(yy), z], ru: r * g * s, rv: rz * g * s, w, col: sleeveCol(yy), rough: sleeveCol(yy) === skin ? SK : CL });
    // Deltoid cap, biceps, a narrow elbow, the forearm's bulge below it, a thin wrist, then a hand: palm, fingers, tip.
    tube([ar(1.478, 0.032, [[B.chest, 0.6], [A, 0.4]]), ar(1.448, 0.058, [[B.chest, 0.35], [A, 0.65]]), ar(1.39, 0.06, [[A, 1]]), ar(1.32, 0.053, [[A, 1]]), ar(1.25, 0.05, [[A, 1]]),
      ar(1.19, 0.043, [[A, 0.65], [F, 0.35]]), ar(1.15, 0.042, [[A, 0.3], [F, 0.7]]), ar(1.1, 0.047, [[F, 1]]), ar(1.02, 0.04, [[F, 1]]), ar(0.95, 0.03, [[F, 0.7], [H, 0.3]]),
      ar(0.915, 0.032, [[H, 1]], 0.02), ar(0.865, 0.045, [[H, 1]], 0.021), ar(0.805, 0.043, [[H, 1]], 0.016), ar(0.755, 0.032, [[H, 1]], 0.012), ar(0.728, 0.012, [[H, 1]], 0.008)]);
  }
  // Legs and feet
  for (const [sgn, Th, Sh, Ft] of [[-1, B.thighL, B.shinL, B.footL], [1, B.thighR, B.shinR, B.footR]] as const) {
    const z = sgn * hip, legCol = (yy: number) => (yy > (swim ? 0.86 : 0.62) ? shorts : skin);
    const loose = (yy: number) => (legCol(yy) === shorts && !swim ? 1.1 : 1); // boardshorts hang off the leg
    const lr = (yy: number, r: number, w: W): Ring => ({ c: [0, y(yy), z], ru: r * g * s * loose(yy), rv: r * g * s * loose(yy), w, col: legCol(yy), rough: legCol(yy) === skin ? SK : CL });
    // Full thigh, a knee that narrows, a calf that swells below it, a slim ankle.
    tube([lr(0.95, 0.075, [[B.pelvis, 0.7], [Th, 0.3]]), lr(0.88, 0.092, [[Th, 0.75], [B.pelvis, 0.25]]), lr(0.76, 0.086, [[Th, 1]]), lr(0.63, 0.071, [[Th, 1]]), lr(0.62, 0.07, [[Th, 1]]),
      lr(0.53, 0.059, [[Th, 0.65], [Sh, 0.35]]), lr(0.49, 0.056, [[Th, 0.5], [Sh, 0.5]]), lr(0.44, 0.055, [[Th, 0.3], [Sh, 0.7]]), lr(0.36, 0.064, [[Sh, 1]]), lr(0.27, 0.054, [[Sh, 1]]),
      lr(0.15, 0.038, [[Sh, 0.8], [Ft, 0.2]]), lr(0.07, 0.034, [[Ft, 1]]), lr(0.05, 0.036, [[Ft, 1]])]);
    const fr = (x: number, ry: number, rz: number): Ring => ({ c: [x * s, y(0.012) + ry * s, z], ru: ry * s, rv: rz * s, w: [[Ft, 1]], col: skin, rough: SK, axis: 'x' });
    tube([fr(-0.06, 0.032, 0.032), fr(0.02, 0.042, 0.044), fr(0.11, 0.03, 0.052), fr(0.175, 0.018, 0.05), fr(0.2, 0.008, 0.036)]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('rough', new THREE.Float32BufferAttribute(rgh, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
