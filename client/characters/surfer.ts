// @ts-nocheck  (one small TSL material)
// One surfer on screen: board, body, pose, and contact with the water.
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { St } from '../../shared/physics';
import { BOARD_LEN, type Look } from '../../shared/looks';
import { TUNING as T } from '../../shared/tuning';
import { buildBody, buildOf } from './body';
import { buildBoard } from './board';
import { Rig, newPose, easePose } from './rig';
import { poseFor, standPose, kneelPose, pushPose } from './poses';
import { groundY, shoreZ } from '../../shared/bathy';
import { Kind } from '../render/particles';
import type { App } from '../app';

export interface ViewState { x: number; z: number; heading: number; state: St; stateTime: number; speed: number; paddling: boolean; stamina: number; stance?: number; steer?: number; vx?: number; vz?: number }

let bodyMat: THREE.MeshStandardNodeMaterial, boardMat: THREE.MeshStandardNodeMaterial;
function materials() {
  if (bodyMat) return;
  bodyMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0 });
  bodyMat.roughnessNode = attribute('rough', 'float'); // wet skin shines, cloth does not
  boardMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0, roughness: 0.32 });
}

export class SurferView {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  private pose = newPose(); private target = newPose();
  private body: THREE.SkinnedMesh; private board: THREE.Mesh;
  private phase = 0; private t = Math.random() * 100; private seed = Math.random();
  private steer = 0; private wasState: St = St.Paddle; private onSand = false;
  private paddle = 0; private boardPitch = 0; private boardSink = 0; private started = false;
  private fwd = new THREE.Vector3(); private up = new THREE.Vector3(); private right = new THREE.Vector3(); private m = new THREE.Matrix4(); private tmp = new THREE.Vector3();
  readonly scale: number; readonly length: number;

  constructor(readonly look: Look) {
    materials();
    const build = buildOf(look);
    this.scale = build.h; this.length = BOARD_LEN[look.board];
    this.rig = new Rig(build);
    this.body = new THREE.SkinnedMesh(buildBody(look), bodyMat);
    for (const b of this.rig.bones) this.group.add(b);
    this.body.bind(this.rig.skeleton, new THREE.Matrix4());
    this.body.frustumCulled = false;
    this.board = new THREE.Mesh(buildBoard(look), boardMat);
    this.body.castShadow = this.board.castShadow = true;
    this.group.add(this.body, this.board);
  }

  /** Stand on the sand by the tower with the board under one arm (the lifeguard scene). `kneel`: patching yourself up after hours. */
  updateOnSand(dt: number, x: number, z: number, facing: number, kneel: boolean): void {
    this.t += dt;
    this.group.position.set(x, groundY(x, z), z);
    this.group.rotation.set(0, -facing, 0);
    (kneel ? kneelPose : standPose)(this.target, this.scale, this.t);
    easePose(this.pose, this.target, 1 - Math.exp(-dt * 6));
    this.rig.solve(this.pose);
    // Board under the right arm, nose forward and a little up; lying on the sand if we are kneeling.
    if (kneel) { this.board.position.set(-0.3, 0.05, 0.9); this.board.rotation.set(0, 0.3, 0); }
    else { this.board.position.set(0.3, 1.0 * this.scale, -0.4); this.board.rotation.set(-Math.PI / 2 + 0.1, 0, 0.08); }
    this.onSand = true;
  }

  /** `ahead`: seconds past the last simulation tick, so motion is drawn smoothly between ticks. */
  update(dt: number, v: ViewState, app: App, ahead = 0): void {
    this.t += dt;
    if (this.onSand) { this.board.position.set(0, 0, 0); this.board.rotation.set(0, 0, 0); this.onSand = false; this.started = false; }
    const cx = Math.cos(v.heading), cz = Math.sin(v.heading);
    const x = v.x + (v.vx ?? cx * v.speed) * ahead, z = v.z + (v.vz ?? cz * v.speed) * ahead;
    // Sit the board on the water: height at the middle, pitch and roll from the surface around it.
    // On a hollow face the straight board bridges the curve: rest it on its ends, or nose and tail sink into the water.
    const L = this.length * 0.42, W = 0.25, hf = app.waterY(x + cx * L, z + cz * L), hb = app.waterY(x - cx * L, z - cz * L), y = Math.max(app.waterY(x, z), (hf + hb) / 2);
    const pitch = (hf - hb) / (2 * L);
    const roll = (app.waterY(x - cz * W, z + cx * W) - app.waterY(x + cz * W, z - cx * W)) / (2 * W);
    // Sitting sinks the tail and lifts the nose; diving drives the nose under; a tumble spins everything.
    const k = v.stateTime + ahead, e = this.started ? 1 - Math.exp(-dt * 7) : 1;
    let wantPitch = 0, wantSink = 0, spinX = 0, spinZ = 0;
    if (v.state === St.Sit) { wantPitch = 0.2; wantSink = 0.2; }
    else if (v.state === St.Dive) { const u = Math.min(1, k / 0.95); wantSink = Math.sin(u * Math.PI) * 0.95; wantPitch = -Math.sin(u * Math.PI * 2) * 0.5; }
    else if (v.state === St.Turtle) spinX = Math.min(1, k / 0.35) * Math.PI;
    else if (v.state === St.Tumble) { wantSink = 0.6 * Math.sin(Math.min(1, k / T.dive.tumble) * Math.PI); spinX = k * 7; spinZ = k * 4; }
    else if (v.state === St.Wipeout) { wantSink = k < 0.5 ? -0.55 * Math.sin((k / 0.5) * Math.PI) : Math.min(1.1, (k - 0.5) * 2); spinX = Math.min(k, 2.5) * 4; spinZ = Math.min(k, 2.5) * 2.4; } // thrown up first, then under
    const riding = v.state === St.Ride || v.state === St.PopUp, steer = this.steer += ((v.steer ?? 0) - this.steer) * (1 - Math.exp(-dt * 6));
    if (riding) wantPitch = 0.07;
    this.boardPitch += (wantPitch - this.boardPitch) * (v.state === St.Dive ? 1 : e); this.boardSink += (wantSink - this.boardSink) * (v.state === St.Dive || v.state === St.Wipeout ? 1 : e);
    this.fwd.set(cx, pitch, cz).normalize(); this.right.set(-cz, roll, cx).normalize(); this.up.crossVectors(this.right, this.fwd).normalize();
    this.group.quaternion.setFromRotationMatrix(this.m.makeBasis(this.fwd, this.up, this.right));
    this.group.rotateZ(this.boardPitch); if (spinX) this.group.rotateX(spinX); if (spinZ) this.group.rotateZ(spinZ);
    if (riding) this.group.rotateX(steer * 0.42 * Math.min(1, v.speed / 5)); // bank into the carve
    this.group.position.set(x, y - this.boardSink + 0.02, z);
    this.group.updateMatrixWorld();

    // Pose: ease toward the state's target so nothing pops; strokes slow and deepen as the arms tire.
    const tired = v.stamina <= 0 ? 0.62 : 1;
    this.paddle += ((v.paddling && v.state === St.Paddle ? 1 : 0) - this.paddle) * (1 - Math.exp(-dt * 6));
    const before = this.phase;
    if (v.state === St.Paddle) this.phase = (this.phase + dt * 0.62 * tired * (0.4 + 0.6 * this.paddle)) % 1;
    const inv = this.group.matrixWorld.clone().invert();
    const water = (bx: number, bz: number) => { this.tmp.set(bx, 0, bz).applyMatrix4(this.group.matrixWorld); const wy = app.waterY(this.tmp.x, this.tmp.z); return this.tmp.setY(wy).applyMatrix4(inv).y; };
    const toSea = -Math.atan2(cx, cz); // head turns toward the horizon, where sets come from
    poseFor(v.state, this.target, { s: this.scale, board: this.look.board, t: this.t, stateTime: k, phase: this.phase, paddling: this.paddle, lookYaw: toSea, seed: this.seed, water, stance: v.stance ?? 0.25, steer, len: this.length });
    easePose(this.pose, this.target, this.started ? 1 - Math.exp(-dt * (v.state === St.Tumble || v.state === St.Wipeout ? 16 : v.state === St.PopUp ? 12 : 9)) : 1);
    this.rig.solve(this.pose);
    this.started = true;

    // Riding: a foam trail off the tail, spray off the rail in a carve. Falling: a burst of white.
    if (riding) {
      app.wake.splat(x - cx * this.length * 0.4, z - cz * this.length * 0.4, 0.45, Math.min(1, v.speed / 5) * dt * 26);
      if (Math.random() < (0.25 + Math.abs(steer) * 2.2) * v.speed * dt * 3) { const side = steer >= 0 ? 1 : -1; app.particles.emit(x - cx * 0.6 - cz * 0.25 * side, y + 0.1, z - cz * 0.6 + cx * 0.25 * side, -cz * side * (1 + Math.random() * 2) - cx, 1 + Math.random() * 2.2, cx * side * (1 + Math.random() * 2) - cz, 0.45 + Math.random() * 0.4, 0.08 + Math.random() * 0.14, Kind.spray); }
    }
    if (v.state === St.Wipeout && this.wasState !== St.Wipeout) for (let n = 0; n < 90; n++) app.particles.emit(x + (Math.random() - 0.5), y + 0.2, z + (Math.random() - 0.5), (Math.random() - 0.5) * 5, 1.5 + Math.random() * 4.5, (Math.random() - 0.5) * 5, 0.6 + Math.random() * 0.7, 0.03 + Math.random() ** 2 * 0.14, Kind.spray);
    if (v.state === St.Wipeout && k < 0.6) app.wake.splat(x, z, 1.6, dt * 30);
    if (v.state === St.PopUp && this.wasState !== St.PopUp) for (let n = 0; n < 8; n++) app.particles.emit(x, y + 0.1, z, (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.3, 0.08 + Math.random() * 0.1, Kind.spray);
    this.wasState = v.state;

    // Foam on the water: a soft wake behind a moving board, a burst where someone goes under.
    if (v.speed > 0.8 && v.state === St.Paddle) app.wake.splat(x - cx * this.length * 0.45, z - cz * this.length * 0.45, 0.32, Math.min(0.5, v.speed * 0.1) * dt * 20);
    if (v.state === St.Tumble && k < 0.5) app.wake.splat(x, z, 1.3, 0.9 * dt * 20);
    if (v.state === St.Dive && k < 0.25) app.wake.splat(x + cx, z + cz, 0.7, 0.6 * dt * 20);

    // A small splash where each hand catches the water.
    if (this.paddle > 0.5) for (const h of [0, 1]) {
      const c = h ? 0 : 0.5;
      if ((before < c || before > this.phase) && this.phase >= c && this.phase - c < 0.2) {
        this.tmp.copy(this.rig.handPos[h]).applyMatrix4(this.group.matrixWorld);
        app.wake.splat(this.tmp.x, this.tmp.z, 0.22, 0.5);
        for (let n = 0; n < 5; n++) app.particles.emit(this.tmp.x, this.tmp.y + 0.05, this.tmp.z, cx * 0.6 + (Math.random() - 0.5) * 1.2, 0.7 + Math.random() * 1.1, cz * 0.6 + (Math.random() - 0.5) * 1.2, 0.35 + Math.random() * 0.25, 0.05 + Math.random() * 0.07, Kind.spray);
      }
    }
  }
}

/** A person without a board: the lifeguard. */
export class Figure {
  readonly group = new THREE.Group();
  private rig: Rig; private pose = newPose(); private t = 0;
  constructor(look: Look) {
    materials();
    this.rig = new Rig(buildOf(look));
    const body = new THREE.SkinnedMesh(buildBody(look), bodyMat);
    for (const b of this.rig.bones) this.group.add(b);
    body.bind(this.rig.skeleton, new THREE.Matrix4()); body.frustumCulled = false; body.castShadow = true;
    this.group.add(body);
  }
  update(dt: number, x: number, z: number, facing: number, kneel: boolean, push = false): void {
    this.t += dt;
    this.group.position.set(x, groundY(x, z), z); this.group.rotation.set(0, -facing, 0);
    (push ? pushPose : kneel ? kneelPose : standPose)(this.pose, 1, this.t);
    this.rig.solve(this.pose);
  }
}
/** Where the lifeguard scene plays: on the sand just seaward of the tower. */
export const TREAT_SPOT = { x: T.world.towerX - 3.2, z: shoreZ(T.world.towerX) - 9 };
