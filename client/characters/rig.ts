// Pose solver: a handful of numbers and four limb targets in, seventeen bone transforms out.
// Bones are flat children of the root, so the hierarchy math lives here and nowhere else.
import * as THREE from 'three/webgpu';
import { BONE, NBONES, restJoints, type Build } from './body';

export interface Pose {
  pelvis: THREE.Vector3; yaw: number; pitch: number; roll: number; // pitch > 0 leans forward; roll > 0 leans right
  spinePitch: number; spineRoll: number; spineTwist: number;
  headYaw: number; headPitch: number;
  hand: [THREE.Vector3, THREE.Vector3]; elbow: [THREE.Vector3, THREE.Vector3]; // targets and bend hints, left then right
  foot: [THREE.Vector3, THREE.Vector3]; knee: [THREE.Vector3, THREE.Vector3];
  toes: number; // 0 soles flat, 1 toes pointed along the shin
  footYaw: number; // which way flat feet point, radians (positive turns left)
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const newPose = (): Pose => ({ pelvis: V(0, 0.95, 0), yaw: 0, pitch: 0, roll: 0, spinePitch: 0, spineRoll: 0, spineTwist: 0, headYaw: 0, headPitch: 0,
  hand: [V(0, 0.9, -0.2), V(0, 0.9, 0.2)], elbow: [V(-1, 0, -0.3), V(-1, 0, 0.3)], foot: [V(0, 0.08, -0.1), V(0, 0.08, 0.1)], knee: [V(1, 0, 0), V(1, 0, 0)], toes: 0, footYaw: 0 });

/** Move `cur` toward `to` by fraction k (0..1). Every field eases, so states never pop. */
export function easePose(cur: Pose, to: Pose, k: number): void {
  cur.pelvis.lerp(to.pelvis, k);
  for (const f of ['yaw', 'pitch', 'roll', 'spinePitch', 'spineRoll', 'spineTwist', 'headYaw', 'headPitch', 'toes', 'footYaw'] as const) cur[f] += (to[f] - cur[f]) * k;
  for (const i of [0, 1]) { cur.hand[i].lerp(to.hand[i], k); cur.elbow[i].lerp(to.elbow[i], k); cur.foot[i].lerp(to.foot[i], k); cur.knee[i].lerp(to.knee[i], k); }
}

const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1), DOWN = V(0, -1, 0);
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
/** Orientation from yaw (about up), pitch (forward lean) and roll (lean right). */
function orient(out: THREE.Quaternion, yaw: number, pitch: number, roll: number): THREE.Quaternion {
  return out.setFromAxisAngle(Y, yaw).multiply(qa.setFromAxisAngle(Z, -pitch)).multiply(qb.setFromAxisAngle(X, roll));
}

export class Rig {
  readonly bones: THREE.Bone[] = [];
  readonly skeleton: THREE.Skeleton;
  readonly rest: THREE.Vector3[];
  private len: { arm: number; fore: number; thigh: number; shin: number; spine: number; chest: number; neck: number; shW: number; shY: number; hipW: number };
  /** World-in-root positions of hands and feet after the last solve (for splashes and contact). */
  readonly handPos = [V(), V()]; readonly footPos = [V(), V()]; readonly headPos = V();

  constructor(build: Build) {
    const J = (this.rest = restJoints(build));
    const inv: THREE.Matrix4[] = [];
    for (let i = 0; i < NBONES; i++) { const b = new THREE.Bone(); b.position.copy(J[i]); this.bones.push(b); inv.push(new THREE.Matrix4().makeTranslation(-J[i].x, -J[i].y, -J[i].z)); }
    this.skeleton = new THREE.Skeleton(this.bones, inv);
    const d = (a: number, b: number) => J[a].distanceTo(J[b]);
    this.len = { arm: d(BONE.armR, BONE.foreR), fore: d(BONE.foreR, BONE.handR), thigh: d(BONE.thighR, BONE.shinR), shin: d(BONE.shinR, BONE.footR), spine: J[BONE.spine].y - J[BONE.pelvis].y,
      chest: J[BONE.chest].y - J[BONE.spine].y, neck: J[BONE.neck].y - J[BONE.chest].y, shW: J[BONE.armR].z, shY: J[BONE.armR].y - J[BONE.chest].y, hipW: J[BONE.thighR].z };
  }

  solve(p: Pose): void {
    const B = this.bones, L = this.len, set = (i: number, pos: THREE.Vector3, q: THREE.Quaternion) => { B[i].position.copy(pos); B[i].quaternion.copy(q); };
    const rp = orient(new THREE.Quaternion(), p.yaw, p.pitch, p.roll);
    const bend = orient(qc, p.spineTwist / 2, p.spinePitch / 2, p.spineRoll / 2).clone();
    const rs = rp.clone().multiply(bend), rc = rs.clone().multiply(bend);
    const rn = rc.clone().multiply(orient(qc, p.headYaw / 2, p.headPitch / 2, 0)), rh = rn.clone().multiply(orient(qc, p.headYaw / 2, p.headPitch / 2, 0));
    const spine = V(0, L.spine, 0).applyQuaternion(rp).add(p.pelvis), chest = V(0, L.chest, 0).applyQuaternion(rs).add(spine);
    const neck = V(0, L.neck, 0).applyQuaternion(rc).add(chest), head = V(0, this.rest[BONE.head].y - this.rest[BONE.neck].y, 0).applyQuaternion(rn).add(neck);
    set(BONE.pelvis, p.pelvis, rp); set(BONE.spine, spine, rs); set(BONE.chest, chest, rc); set(BONE.neck, neck, rn); set(BONE.head, head, rh);
    this.headPos.copy(V(0, 0.09, 0).applyQuaternion(rh).add(head));
    const flat = new THREE.Quaternion().setFromAxisAngle(Y, p.footYaw);
    for (const i of [0, 1]) {
      const sgn = i ? 1 : -1;
      const sh = V(0, L.shY, sgn * L.shW).applyQuaternion(rc).add(chest);
      const [e, h] = limb(sh, p.hand[i], p.elbow[i], L.arm, L.fore);
      const qu = new THREE.Quaternion().setFromUnitVectors(DOWN, e.clone().sub(sh).normalize()), qf = new THREE.Quaternion().setFromUnitVectors(DOWN, h.clone().sub(e).normalize());
      set(i ? BONE.armR : BONE.armL, sh, qu); set(i ? BONE.foreR : BONE.foreL, e, qf); set(i ? BONE.handR : BONE.handL, h, qf);
      this.handPos[i].copy(h);
      const hip = V(0, -0.02, sgn * L.hipW).applyQuaternion(rp).add(p.pelvis);
      const [k, a] = limb(hip, p.foot[i], p.knee[i], L.thigh, L.shin);
      const shinDir = a.clone().sub(k).normalize();
      const qt = new THREE.Quaternion().setFromUnitVectors(DOWN, k.clone().sub(hip).normalize()), qs = new THREE.Quaternion().setFromUnitVectors(DOWN, shinDir);
      const pointed = new THREE.Quaternion().setFromUnitVectors(X, shinDir);
      set(i ? BONE.thighR : BONE.thighL, hip, qt); set(i ? BONE.shinR : BONE.shinL, k, qs); set(i ? BONE.footR : BONE.footL, a, flat.clone().slerp(pointed, p.toes));
      this.footPos[i].copy(a);
    }
  }
}

/** Two-bone IK. Returns [middle joint, end joint]; the end is pulled in if the target is out of reach. */
function limb(a: THREE.Vector3, target: THREE.Vector3, hint: THREE.Vector3, l1: number, l2: number): [THREE.Vector3, THREE.Vector3] {
  const dir = target.clone().sub(a), dist = Math.min(Math.max(dir.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  dir.normalize();
  const cos = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const n = hint.clone().addScaledVector(dir, -hint.dot(dir));
  if (n.lengthSq() < 1e-6) n.set(dir.y, -dir.x, 0);
  n.normalize();
  return [a.clone().addScaledVector(dir, l1 * cos).addScaledVector(n, l1 * sin), a.clone().addScaledVector(dir, dist)];
}
