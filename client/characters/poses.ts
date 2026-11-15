// Keyed poses, written as functions so they breathe with time. All in board space:
// x toward the nose, y up from the board's underside, z to the surfer's right.
import { St, Board } from '../../shared/physics';
import type { Pose } from './rig';

export interface PoseIn {
  s: number; // body scale
  board: Board;
  t: number; // seconds, free-running, per surfer
  stateTime: number;
  phase: number; // paddle stroke phase 0..1 (right hand catches at 0, left at 0.5)
  paddling: number; // 0 gliding .. 1 stroking
  lookYaw: number; // where the head wants to turn, radians, positive left
  seed: number; // 0..1 per surfer, staggers idles
  water: (x: number, z: number) => number; // water height in board space at a board-space point
  stance: number; // 0 tail .. 1 nose (riding)
  steer: number; // -1..1 (riding)
  len: number; // board length
}
const DECK = 0.085, lerp = (a: number, b: number, t: number) => a + (b - a) * t, clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function prone(p: Pose, i: PoseIn): void {
  const s = i.s, px = i.board === Board.Short ? -0.32 * s : -0.42 * s, xs = px + 0.5 * s;
  p.pelvis.set(px, DECK + 0.1 * s, 0); p.yaw = 0; p.pitch = Math.PI / 2; p.roll = 0.1 * Math.sin(i.phase * Math.PI * 2) * i.paddling;
  p.spinePitch = -0.5 - 0.06 * i.paddling; p.spineRoll = 0; p.spineTwist = 0; p.headPitch = -0.78; p.headYaw = clamp(i.lookYaw, -0.7, 0.7);
  p.toes = 1; p.footYaw = 0;
  for (const k of [0, 1]) {
    const sgn = k ? 1 : -1, ph = (i.phase + (k ? 0 : 0.5)) % 1;
    let x: number, y: number, z: number;
    if (ph < 0.6) { const u = ph / 0.6; x = xs + lerp(0.52, -0.4, u) * s; z = (0.31 + 0.06 * Math.sin(Math.PI * u)) * sgn; y = i.water(x, z) - 0.08 - 0.2 * Math.sin(Math.PI * u); }
    else { const u = (ph - 0.6) / 0.4; x = xs + lerp(-0.4, 0.52, u) * s; z = (0.31 + 0.15 * Math.sin(Math.PI * u)) * sgn; y = i.water(x, z) + 0.04 + 0.2 * Math.sin(Math.PI * u); }
    p.hand[k].set(lerp(xs + 0.02, x, i.paddling), lerp(DECK + 0.03, y, i.paddling), lerp(0.21 * sgn, z, i.paddling));
    p.elbow[k].set(-0.2, 1, 0.9 * sgn);
    p.foot[k].set(px - 0.84 * s, DECK + 0.06 + 0.05 * Math.sin(i.t * 1.3 + k * 2), 0.1 * sgn); p.knee[k].set(0, 1, 0);
  }
}

function sit(p: Pose, i: PoseIn): void {
  const s = i.s, px = i.board === Board.Short ? -0.3 * s : -0.5 * s, t = i.t + i.seed * 40;
  const sway = Math.sin(t * 0.7) * 0.03, idle = Math.floor(t / 7 + i.seed * 3) % 4, k = Math.sin(Math.min(1, (t % 7) / 7) * Math.PI); // one idle at a time, eased in and out
  p.pelvis.set(px, DECK + 0.085 * s, 0); p.yaw = 0; p.pitch = 0.22; p.roll = sway;
  p.spinePitch = 0.42; p.spineRoll = -sway * 1.5; p.spineTwist = clamp(i.lookYaw, -0.6, 0.6) * 0.6 + (idle === 1 ? 0.5 * k : 0);
  p.headPitch = -0.28; p.headYaw = clamp(i.lookYaw, -1.2, 1.2) * 0.7 + (idle === 1 ? 0.9 * k : 0); // idle 1: a look over the shoulder
  p.toes = 0.55; p.footYaw = 0;
  for (const j of [0, 1]) {
    const sgn = j ? 1 : -1;
    p.foot[j].set(px + 0.42 * s, DECK - 0.5 * s + 0.03 * Math.sin(t * 1.1 + j * 1.7), 0.36 * s * sgn); p.knee[j].set(1, 0.9, 0.9 * sgn);
    p.hand[j].set(px + 0.38 * s, DECK + 0.13 * s, 0.2 * sgn); p.elbow[j].set(-0.4, -0.5, sgn);
  }
  if (idle === 0) { const a = t * 2.2; p.hand[1].set(px + 0.2 * s + 0.07 * Math.cos(a), lerp(DECK + 0.2 * s, i.water(px + 0.2, 0.46) - 0.06, k), lerp(0.16, 0.46 + 0.07 * Math.sin(a), k)); } // sculling
  if (idle === 2) p.hand[0].set(lerp(px + 0.32 * s, px + 0.15 * s, k), lerp(DECK + 0.2 * s, DECK - 0.25 * s, k), lerp(-0.16, -0.36, k)); // reaching for the leash
}

function dive(p: Pose, i: PoseIn): void {
  prone(p, { ...i, paddling: 0 });
  const s = i.s, k = Math.sin(clamp(i.stateTime / 0.95, 0, 1) * Math.PI), px = p.pelvis.x;
  p.spinePitch = -0.45 - 0.5 * k; p.headPitch = -0.5;
  for (const j of [0, 1]) { const sgn = j ? 1 : -1; p.hand[j].set(px + 0.6 * s, DECK, 0.25 * sgn); p.elbow[j].set(-0.2, 0.3, sgn); }
  p.foot[1].set(px - lerp(0.84, 0.45, k) * s, DECK + 0.07, 0.07); p.knee[1].set(0.3, -1, 0.3); // a knee drives the tail down
  p.foot[0].set(px - 0.8 * s, DECK + 0.06 + 0.5 * k * s, -0.12); // the other leg kicks up for balance
}

function turtle(p: Pose, i: PoseIn): void {
  prone(p, { ...i, paddling: 0 });
  const s = i.s, px = p.pelvis.x;
  p.spinePitch = 0.05; p.headPitch = 0.25;
  for (const j of [0, 1]) { const sgn = j ? 1 : -1; p.hand[j].set(px + 0.5 * s, DECK - 0.02, 0.28 * sgn); p.elbow[j].set(0, 0.2, sgn); }
}

function tumble(p: Pose, i: PoseIn): void {
  const s = i.s, px = -0.3 * s, w = Math.sin(i.stateTime * 9) * 0.25;
  p.pelvis.set(px, DECK + 0.25 * s, 0); p.pitch = 1.1; p.roll = w; p.yaw = 0; p.spinePitch = 0.8; p.spineRoll = 0; p.spineTwist = w; p.headPitch = 0.5; p.headYaw = 0; p.toes = 0.6; p.footYaw = 0;
  for (const j of [0, 1]) { const sgn = j ? 1 : -1; p.foot[j].set(px + 0.1 * s, DECK - 0.2 * s, 0.13 * sgn); p.knee[j].set(1, 0.4, 0.3 * sgn); p.hand[j].set(px + 0.3 * s, DECK + 0.1 * s + w * 0.3 * sgn, 0.3 * sgn); p.elbow[j].set(-0.5, 0, sgn); }
}

const sm01 = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** Standing and riding, regular foot: left foot forward, chest toward the right rail, eyes down the line. */
function ride(p: Pose, i: PoseIn): void {
  const s = i.s, long = i.board !== Board.Short, nose = long ? sm01((i.stance - 0.72) / 0.25) : 0;
  const xb = long ? lerp(-0.27 * i.len, 0.26 * i.len, i.stance) : -0.3 * i.len, xf = Math.min(xb + lerp(0.52, 0.24, nose) * s, 0.47 * i.len);
  const crouch = (lerp(0.6, 0.8, nose) - 0.07 * Math.abs(i.steer) + 0.02 * Math.sin(i.t * 2.3)) * 0.88 * s, hipY = DECK + crouch;
  p.foot[0].set(xf, DECK + 0.035, -0.04); p.foot[1].set(xb, DECK + 0.035, 0.05); p.footYaw = -1.2; p.toes = 0;
  p.knee[0].set(0.5, 0.2, 1); p.knee[1].set(-0.1, 0.2, 1);
  p.pelvis.set((xf + xb) / 2 - 0.03, hipY, 0.04 + i.steer * 0.07); p.yaw = -1.15; p.pitch = lerp(0.22, 0.02, nose); p.roll = 0;
  p.spinePitch = lerp(0.34, -0.12, nose); p.spineTwist = 0.55; p.spineRoll = -i.steer * 0.22; p.headYaw = 0.75; p.headPitch = -0.12;
  // Arms balance: front arm reaches down the line, back arm trails; on the nose they drop low and loose.
  p.hand[0].set(p.pelvis.x + lerp(0.5, 0.2, nose) * s, hipY + lerp(0.42, 0.1, nose) * s + i.steer * 0.12, lerp(-0.12, -0.34, nose)); p.elbow[0].set(0, -1, -0.3);
  p.hand[1].set(p.pelvis.x - lerp(0.45, 0.22, nose) * s, hipY + lerp(0.38, 0.08, nose) * s - i.steer * 0.12, lerp(0.25, 0.36, nose)); p.elbow[1].set(-0.3, -1, 0.3);
}

/** Thrown: limbs everywhere for a beat, then a tuck while the wave has you. */
function wipeout(p: Pose, i: PoseIn): void {
  tumble(p, i);
  const k = sm01(1 - i.stateTime / 0.55), s = i.s;
  p.pelvis.y += 0.9 * k * s; p.pitch = lerp(1.1, -0.5, k); p.spinePitch = lerp(0.8, -0.5, k);
  for (const j of [0, 1]) { const sgn = j ? 1 : -1; p.hand[j].y += 0.9 * k; p.hand[j].z += 0.3 * k * sgn; p.foot[j].x -= 0.5 * k; p.foot[j].z += 0.25 * k * sgn; }
}

/** Back up: head out of the water with a shake, one arm over the board, pulling it in. */
function recover(p: Pose, i: PoseIn): void {
  const s = i.s, shake = Math.sin(i.stateTime * 22) * Math.max(0, 0.6 - i.stateTime) * 0.9;
  p.pelvis.set(-0.15, DECK - 0.5 * s, 0.5); p.yaw = 0.5; p.pitch = 0.35; p.roll = 0; p.spinePitch = 0.1; p.spineRoll = 0; p.spineTwist = -0.3; p.headYaw = shake; p.headPitch = -0.25; p.toes = 0.7; p.footYaw = 0;
  p.hand[0].set(0.15, DECK + 0.02, 0.2); p.elbow[0].set(0, 1, 0.5); p.hand[1].set(-0.3 + 0.12 * Math.sin(i.t * 3), DECK - 0.22, 0.85); p.elbow[1].set(-0.5, -0.3, 1);
  for (const j of [0, 1]) { p.foot[j].set(-0.2 + 0.12 * Math.sin(i.t * 4 + j * 3.1), DECK - 1.3 * s, 0.45 + (j ? 0.14 : -0.14)); p.knee[j].set(1, 0, 0); }
}

/** On the sand, board under one arm (the lifeguard scene). */
export function standPose(p: Pose, s: number, t: number): void {
  p.pelvis.set(0, 0.95 * s, 0); p.yaw = 0; p.pitch = 0.03; p.roll = 0.03 * Math.sin(t * 0.8); p.spinePitch = 0.05; p.spineRoll = 0; p.spineTwist = 0; p.headYaw = 0; p.headPitch = 0.3; p.toes = 0; p.footYaw = 0;
  p.foot[0].set(0.02, 0.08 * s, -0.11); p.foot[1].set(0, 0.08 * s, 0.11); p.knee[0].set(1, 0, 0); p.knee[1].set(1, 0, 0);
  p.hand[0].set(0.14, 0.9 * s, -0.36); p.elbow[0].set(-1, 0, -0.6); p.hand[1].set(0.05, 0.86 * s, 0.24); p.elbow[1].set(-1, 0, 0.3); // left arm wraps the board
}
/** Standing waist deep, leaning in, both hands on the tail of a student's board (the beach-boy push). */
export function pushPose(p: Pose, s: number, t: number): void {
  standPose(p, s, t);
  const k = 0.5 + 0.5 * Math.sin(t * 2.2);
  p.pitch = 0.32 + 0.08 * k; p.spinePitch = 0.25; p.headPitch = -0.3; p.foot[0].set(0.25, 0.08 * s, -0.14); p.foot[1].set(-0.3, 0.08 * s, 0.14);
  p.hand[0].set(0.62 + 0.08 * k, 1.12 * s, -0.16); p.elbow[0].set(-0.3, -1, -0.5); p.hand[1].set(0.62 + 0.08 * k, 1.12 * s, 0.16); p.elbow[1].set(-0.3, -1, 0.5);
}
/** Kneeling to treat a shin, hands working (the lifeguard). */
export function kneelPose(p: Pose, s: number, t: number): void {
  p.pelvis.set(-0.05, 0.52 * s, 0); p.yaw = 0; p.pitch = 0.3; p.roll = 0; p.spinePitch = 0.5; p.spineRoll = 0; p.spineTwist = 0; p.headYaw = 0; p.headPitch = 0.35; p.toes = 0.3; p.footYaw = 0;
  p.foot[0].set(0.28, 0.08 * s, -0.13); p.knee[0].set(1, 0.6, 0); p.foot[1].set(-0.42, 0.1 * s, 0.13); p.knee[1].set(1, -1, 0);
  p.hand[0].set(0.5, 0.3 * s + 0.02 * Math.sin(t * 5), -0.07); p.elbow[0].set(0, -1, -0.5); p.hand[1].set(0.52 + 0.03 * Math.sin(t * 7), 0.36 * s, 0.05); p.elbow[1].set(0, -1, 0.5);
}

/** Fill `p` with the target pose for a state. */
export function poseFor(state: St, p: Pose, i: PoseIn): void {
  if (state === St.Sit) sit(p, i); else if (state === St.Dive) dive(p, i); else if (state === St.Turtle) turtle(p, i); else if (state === St.Tumble) tumble(p, i);
  else if (state === St.Ride || state === St.PopUp) ride(p, i); else if (state === St.Wipeout) wipeout(p, i); else if (state === St.Recover) recover(p, i); else prone(p, i);
}
