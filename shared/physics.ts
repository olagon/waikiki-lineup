// Surfer simulation, one fixed step. The same code runs for client prediction, the server, and bots.
import { TUNING as T } from './tuning';
import { depthAt, shoreZ } from './bathy';
import { T_CURL, crestSpeed, crestZ, newSample, sampleWave, type BreakSpec, type Wave } from './waves';

// Plain objects rather than enums: they survive type-stripping in Node and every bundler.
export const St = { Paddle: 0, Sit: 1, Dive: 2, Turtle: 3, Tumble: 4, PopUp: 5, Ride: 6, Wipeout: 7, Recover: 8, Treat: 9 } as const;
export type St = (typeof St)[keyof typeof St];
export const Board = { Short: 0, Long: 1, Soft: 2 } as const;
export type Board = (typeof Board)[keyof typeof Board];
// Input buttons (bitmask).
export const B = { paddle: 1, action: 2, sit: 4, kick: 8, forward: 16, back: 32, dive: 64 }; // action: pop up. dive: duck dive or turtle roll. Separate, so a mistimed pop-up never rolls you over.
// Things that happened this tick (bitmask on Surfer.events). The server turns these into reliable events.
export const Ev = { divePerfect: 1, diveOk: 2, washed: 4, turtled: 8, lift: 16, popUp: 32, rideEnd: 64, wipeout: 128, badWipeout: 256, maneuver: 512, missed: 1024 };

export interface Input { buttons: number; steer: number } // steer: -1..1, positive turns right
/** What the world is doing this tick. */
export interface World { t: number; waves: Wave[]; spot: BreakSpec; night: number; guard?: boolean } // guard: tower staffed (default yes)
export interface Surfer {
  x: number; z: number;
  heading: number; // radians; facing direction is (cos, sin) in (x, z). pi/2 faces out to sea.
  speed: number; // along heading
  state: St; stateTime: number;
  stamina: number;
  board: Board;
  altTimer: number; altSign: number; // alternating-stroke detection
  prevButtons: number;
  pushV: number; // m/s shoreward shove from whitewater, decaying
  hitWave: number; // id of the last wave whose whitewater reached us
  events: number;
  // Riding
  waveId: number; // wave being caught or ridden, -1 none
  lift: number; // seconds left in the pop-up window, 0 when closed
  stance: number; // 0 back of the board .. 1 toes on the nose
  rideTime: number; rideDist: number; noseTime: number; maneuvers: number;
  turnAcc: number; turnCool: number; // carve detection
  hold: number; // seconds of hold-down for the current wipeout
  score: number; // last ride's score, 0..10
  cut: number; // 0 fine, 1 open reef cut, 2 sealed
}

export function newSurfer(board: Board = Board.Long): Surfer {
  return { x: T.world.spawnX, z: T.world.spawnZ, heading: Math.PI / 2, speed: 0, state: St.Paddle, stateTime: 0, stamina: T.stamina.max, board, altTimer: 9, altSign: 0, prevButtons: 0, pushV: 0, hitWave: -1, events: 0,
    waveId: -1, lift: 0, stance: 0.25, rideTime: 0, rideDist: 0, noseTime: 0, maneuvers: 0, turnAcc: 0, turnCool: 0, hold: 0, score: 0, cut: 0 };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PUSH_TAU = 0.45; // s; a shove of D meters starts at D / PUSH_TAU m/s and decays
const DIVE_TIME = 0.95, TURTLE_MAX = 4, G = 9.81;
const sample = newSample();

const FRONT = 1.3; // whitewater hits when its crest is this close (m)
/** Seconds until whitewater reaches (x, z), or Infinity if none is coming. Drives prompts and bots. */
export function timeToWhitewater(w: World, x: number, z: number): number {
  let best = Infinity;
  for (const wave of w.waves) {
    const zc = crestZ(wave, w.spot, w.t);
    if (zc - FRONT <= z) continue; // already on us or past
    const dt = (zc - FRONT - z) / crestSpeed(wave, w.spot, w.t);
    if (dt < best && sampleWave(wave, w.spot, x, z, w.t + dt, sample).power > 0.1) best = dt;
  }
  return best;
}

/** `late`: seconds since the front actually arrived (it is only noticed on the next tick). */
function hitByWhitewater(s: Surfer, w: World, strength: number, late: number): void {
  const nf = lerp(1, T.night.windowFactor, w.night), held = s.stateTime - late;
  let push: number;
  if (s.state === St.Dive && held <= T.dive.perfect * nf) { push = 0; s.events |= Ev.divePerfect; }
  else if (s.state === St.Dive && held <= T.dive.window * nf) { push = T.dive.pushOk; s.events |= Ev.diveOk; }
  else if (s.state === St.Turtle) { push = lerp(T.dive.turtlePush[0], T.dive.turtlePush[1], strength); s.events |= Ev.turtled; }
  else {
    push = lerp(T.dive.pushMiss[0], T.dive.pushMiss[1], strength);
    s.state = St.Tumble; s.stateTime = 0; s.speed = 0;
    s.stamina = Math.max(0, s.stamina - T.dive.staminaHit);
    s.events |= Ev.washed;
  }
  s.pushV = push / PUSH_TAU;
}

/** Advance one surfer by one tick. Mutates and returns `s`. */
export function stepSurfer(s: Surfer, inp: Input, w: World, dt = T.tick): Surfer {
  const pressed = inp.buttons & ~s.prevButtons;
  s.prevButtons = inp.buttons;
  s.stateTime += dt;
  s.events = 0;
  const steer = clamp(inp.steer, -1, 1);

  if (s.state >= St.PopUp) return stepRiding(s, inp, w, dt, pressed, steer);

  // Whitewater: the first tick a wave's churning front is on us, it hits.
  for (const wave of w.waves) {
    if (wave.id === s.hitWave) continue;
    const sm = sampleWave(wave, w.spot, s.x, s.z, w.t, sample);
    if (sm.power <= 0.1 || sm.d < -FRONT || sm.d > 0.8) continue; // only the front arriving counts, not a wave that already went by
    // The front arrived some time within the last tick; judge timing from that moment, not from when we noticed.
    const late = clamp((sm.d + FRONT) / crestSpeed(wave, w.spot, w.t), 0, dt);
    s.hitWave = wave.id;
    // Paddling in with it at speed? Then it picks you up instead of rolling you: the easiest wave to catch.
    const vz = -Math.sin(s.heading) * s.speed;
    if (s.state === St.Paddle && s.cut !== 1 && vz >= crestSpeed(wave, w.spot, w.t) * 0.3) { s.waveId = wave.id; s.lift = T.catch.popWindow * lerp(1, T.night.windowFactor, w.night) * 1.6; s.events |= Ev.lift; }
    else hitByWhitewater(s, w, clamp(sm.power, 0, 1), late);
  }

  // Catching an unbroken wave: on the steep part of the face near the breaking point, moving fast enough.
  if (s.state === St.Paddle && s.cut !== 1) {
    for (const wave of w.waves) {
      const sm = sampleWave(wave, w.spot, s.x, s.z, w.t, sample);
      if (sm.d > 0.4 || sm.d < -9 || sm.slope < 0.1 || sm.tau > T_CURL * 0.5 || sm.tau < -3.2) continue;
      const c = crestSpeed(wave, w.spot, w.t), toShore = -Math.sin(s.heading);
      // The face pulls a pointed board along with it; paddling early is what gets you up to speed.
      if (toShore > 0.3) s.speed += G * sm.slope * T.catch.slopeAssist * toShore * dt;
      const frac = s.board === Board.Short ? T.catch.speedFrac : T.catch.speedFracLong;
      if (s.lift <= 0 && s.waveId !== wave.id && s.speed * toShore >= frac * c) { s.waveId = wave.id; s.lift = T.catch.popWindow * lerp(1, T.night.windowFactor, w.night); s.events |= Ev.lift; }
    }
  }
  if (s.lift > 0 && s.state === St.Paddle) {
    const wave = w.waves.find((x) => x.id === s.waveId);
    if (!wave) { s.lift = 0; s.waveId = -1; }
    else {
      // Lifted: the wave carries you while the window is open.
      const c = crestSpeed(wave, w.spot, w.t);
      s.speed += (c * 0.95 - s.speed) * Math.min(1, 6 * dt);
      s.lift -= dt;
      if (pressed & B.action) { s.state = St.PopUp; s.stateTime = 0; s.lift = 0; s.events |= Ev.popUp; startRide(s); }
      else if (s.lift <= 0) {
        // Too late. On a steep or breaking face the nose goes under; on a soft one the wave just leaves you.
        const sm = sampleWave(wave, w.spot, s.x, s.z, w.t, sample);
        if (sm.slope > 0.26 || sm.tau > 0) wipe(s, w, wave, sm.tau > -0.5 && wave.set);
        else { s.waveId = -1; s.events |= Ev.missed; }
      }
    }
  }
  if (s.state >= St.PopUp) return s;

  if (s.state === St.Tumble) {
    if (s.stateTime >= T.dive.tumble) { s.state = St.Paddle; s.stateTime = 0; }
  } else if (s.state === St.Dive) {
    if (s.stateTime >= DIVE_TIME) { s.state = St.Paddle; s.stateTime = 0; }
  } else if (s.state === St.Turtle) {
    s.speed -= s.speed * Math.min(1, 1.5 * dt);
    if (!(inp.buttons & B.dive) || s.stateTime >= TURTLE_MAX) { s.state = St.Paddle; s.stateTime = 0; }
  } else {
    if (pressed & B.sit) { s.state = s.state === St.Sit ? St.Paddle : St.Sit; s.stateTime = 0; }
    // Under the wave: shortboards duck dive on a timed press, bigger boards turtle roll while held.
    if (pressed & B.dive && s.state === St.Paddle && s.lift <= 0) { s.state = s.board === Board.Short ? St.Dive : St.Turtle; s.stateTime = 0; }
  }

  // Alternating left-right strokes are stronger than a steady paddle.
  const sign = steer > 0.5 ? 1 : steer < -0.5 ? -1 : 0;
  s.altTimer += dt;
  if (sign !== 0 && sign !== s.altSign) { if (s.altSign !== 0) s.altTimer = 0; s.altSign = sign; }
  const alternating = s.altTimer < T.paddle.altWindow;

  if (s.state === St.Sit) {
    s.heading += steer * T.paddle.turnSit * dt;
    s.speed -= s.speed * Math.min(1, 2.2 * dt);
    s.stamina = Math.min(T.stamina.max, s.stamina + T.stamina.recoverSit * dt);
  } else if (s.state === St.Paddle) {
    const paddling = (inp.buttons & B.paddle) !== 0 || alternating;
    if (paddling) {
      const tired = s.stamina <= 0 ? T.paddle.emptySpeedFactor : 1;
      const target = (T.paddle.speed + (alternating ? T.paddle.altBonus : 0)) * tired;
      s.speed += (target - s.speed) * Math.min(1, T.paddle.accel * dt);
      s.stamina = Math.max(0, s.stamina - (alternating ? T.stamina.drain : T.stamina.drainSteady) * dt);
    } else {
      s.speed -= s.speed * Math.min(1, T.paddle.glide * dt);
      s.stamina = Math.min(T.stamina.max, s.stamina + T.stamina.recoverRest * dt);
    }
    s.heading += steer * T.paddle.turn * dt * (alternating ? 0.25 : 1);
  }

  s.x += Math.cos(s.heading) * s.speed * dt;
  s.z += Math.sin(s.heading) * s.speed * dt - s.pushV * dt;
  s.pushV -= s.pushV * Math.min(1, dt / PUSH_TAU);

  // Hurt and back in the shallows by the tower: go get it looked at.
  if (s.cut === 1 && s.state === St.Paddle && Math.abs(s.x - T.world.towerX) < 18 && s.z < shoreZ(s.x) + 10) { s.state = St.Treat; s.stateTime = 0; s.speed = 0; return s; }

  // Stay in the water and in the bay.
  const minZ = shoreZ(s.x) + 4;
  if (s.z < minZ || depthAt(s.x, s.z) < 0.45) { s.z = Math.max(s.z, minZ); s.speed *= 0.5; s.pushV = 0; }
  s.x = clamp(s.x, T.world.xMin, T.world.xMax);
  s.z = Math.min(s.z, T.world.zMax);
  return s;
}

function startRide(s: Surfer): void {
  s.rideTime = 0; s.rideDist = 0; s.noseTime = 0; s.maneuvers = 0; s.turnAcc = 0; s.turnCool = 0; s.stance = 0.25; s.score = 0;
  if (Math.sin(s.heading) > -0.2) s.heading = -Math.PI / 2; // make sure the board points in
}

/** Fall. `bad`: pitched on a set wave or dragged over shallow reef; only bad wipeouts can cut you. */
export function wipe(s: Surfer, w: World, wave: Wave | undefined, bad: boolean): void {
  const h = wave ? wave.h : 1;
  // Shallow reef only bites when the wave still has its punch here, not in the spent whitewater of the inside.
  const shallow = depthAt(s.x, s.z) < 1.25 && !!wave && sampleWave(wave, w.spot, s.x, s.z, w.t, sample).power > 0.55;
  if (s.rideTime >= 1) endRide(s, w);
  s.hold = lerp(T.wipeout.hold[0], T.wipeout.hold[1], clamp((h - T.waves.face[0]) / (T.waves.face[1] - T.waves.face[0]), 0, 1)) + (shallow && h > 1.5 ? 0.7 : 0);
  s.state = St.Wipeout; s.stateTime = 0; s.lift = 0; s.waveId = -1;
  s.pushV = (wave ? crestSpeed(wave, w.spot, w.t) : 3) * 0.9; s.speed = 0;
  s.events |= Ev.wipeout | (bad || (shallow && h > 1.5) ? Ev.badWipeout : 0);
}

function endRide(s: Surfer, w: World): void {
  if (s.rideTime < 1) { s.score = 0; s.events |= Ev.missed; return; } // not really a ride
  const v = s.rideDist / s.rideTime;
  const raw = 4 * Math.min(1, s.rideDist / 90) + 2 * Math.min(1, v / 8) + 0.7 * Math.min(4, s.maneuvers) + 0.4 * Math.min(5, s.noseTime);
  s.score = Math.round(Math.min(10, raw * (1 + T.night.scoreBonus * w.night)) * 10) / 10;
  s.events |= Ev.rideEnd;
}

function stepRiding(s: Surfer, inp: Input, w: World, dt: number, pressed: number, steer: number): Surfer {
  if (s.state === St.Wipeout) {
    // Held down: dragged shoreward with the whitewater, then let go.
    s.z -= s.pushV * dt; s.pushV -= s.pushV * Math.min(1, dt / 1.1);
    s.z = Math.max(s.z, shoreZ(s.x) + 4);
    if (s.stateTime >= s.hold) { s.state = St.Recover; s.stateTime = 0; }
    return s;
  }
  if (s.state === St.Recover) { if (s.stateTime >= T.wipeout.leash) { s.state = St.Paddle; s.stateTime = 0; s.heading = Math.PI / 2; } return s; }
  if (s.state === St.Treat) { if (s.stateTime >= (w.guard === false ? T.reefCut.afterHoursSeconds : T.reefCut.cutsceneSeconds)) { s.state = St.Paddle; s.stateTime = 0; s.cut = 2; s.x = T.world.spawnX + 14; s.z = shoreZ(s.x) + 8; s.heading = Math.PI / 2; } return s; }

  const wave = w.waves.find((x) => x.id === s.waveId);
  if (!wave) { endRide(s, w); s.state = St.Paddle; s.stateTime = 0; s.waveId = -1; return s; }
  const sm = sampleWave(wave, w.spot, s.x, s.z, w.t, sample), c = crestSpeed(wave, w.spot, w.t);
  // The wave carries the board shoreward as well: fully at the lip, less down the face, not at all in the flats.
  // That is what lets you angle along the face without sliding out the back, and what makes trim self-correcting.
  const wf = Math.max(2.2, (wave.h * 2.4) / w.spot.steep);
  const carry = sm.d < 0 ? Math.pow(clamp(1 + sm.d / (wf * 1.3), 0, 1), 1.2) : clamp(1 - sm.d / 1.5, 0, 1);
  if (s.state === St.PopUp) {
    // Getting to your feet: carried by the wave, already steering a little.
    s.speed += (Math.max(c * 0.75, s.speed) - s.speed) * Math.min(1, 5 * dt);
    s.heading += steer * 0.8 * dt;
    if (s.stateTime >= T.catch.popTime) { s.state = St.Ride; s.stateTime = 0; }
  } else {
    const long = s.board !== Board.Short, old = sm.tau >= T_CURL;
    // Steering: carves on the face, slower on the nose or in whitewater.
    const turn = T.ride.turn[s.board] * (1 - 0.5 * Math.max(0, s.stance - 0.5)) * (old ? 0.55 : 1);
    s.heading += steer * turn * dt;
    // Speed: the face pulls the board downhill (toward shore); drag and stalling take it away; pumping adds a little.
    let a = -G * T.ride.gravity * sm.slope * Math.sin(s.heading) - T.ride.drag * s.speed * s.speed - 0.2;
    if (inp.buttons & B.forward && !long && sm.slope > 0.08) a += T.ride.pump;
    if (inp.buttons & B.back && !long) a -= 2.5;
    if (old && sm.power > 0.08) a += (c * 0.5 - s.speed) * 2.5; // in the soup you are mostly along for the ride
    s.speed = clamp(s.speed + a * dt, 0, T.ride.speed[1] + 0.8);
    // Longboards: walk the deck. Forward toward the nose, back toward the tail.
    if (long) {
      if (inp.buttons & B.forward) s.stance = Math.min(1, s.stance + T.ride.stepRate * dt);
      else if (inp.buttons & B.back) s.stance = Math.max(0.1, s.stance - T.ride.stepRate * dt);
      if (s.stance > 0.8 && sm.slope > 0.08 && !old) s.noseTime += dt;
    }
    // Carves count when they are real changes of direction made at speed on the open face.
    s.turnCool -= dt;
    s.turnAcc = s.turnAcc * (1 - 1.2 * dt) + steer * turn * dt;
    if (Math.abs(s.turnAcc) > 0.75 && s.speed > 4.5 && sm.slope > 0.1 && s.turnCool <= 0 && !old) { s.maneuvers++; s.turnCool = 0.9; s.turnAcc = 0; s.events |= Ev.maneuver; }
    s.rideTime += dt;

    // Ways a ride ends.
    // The lip coming over only gets you if you are up under it. Lower down, the foam just bumps you along.
    const underLip = sm.tau > 0.2 && sm.tau < T_CURL && sm.d < 0.8 && sm.d > -wf * 0.45;
    if (underLip && s.rideTime > 0.6) { wipe(s, w, wave, wave.set && sm.amp > 1.2); return s; }
    if (long && s.stance > 0.9 && sm.slope > 0.5) { wipe(s, w, wave, wave.set); return s; } // pearled off the nose
    if (pressed & B.kick || sm.d > 1.6 || (s.speed < 1.1 && carry < 0.1) || sm.amp < 0.22 || s.z < shoreZ(s.x) + 7) {
      endRide(s, w);
      s.state = St.Paddle; s.stateTime = 0; s.waveId = -1; s.hitWave = wave.id; s.speed = Math.min(s.speed, 1.5); return s;
    }
  }
  const vx = Math.cos(s.heading) * s.speed, vz = Math.sin(s.heading) * s.speed - c * carry * (s.state === St.Ride ? 1 : 0.6);
  s.x = clamp(s.x + vx * dt, T.world.xMin, T.world.xMax);
  s.z += vz * dt;
  if (s.state === St.Ride) s.rideDist += Math.sqrt(vx * vx + vz * vz) * dt;
  return s;
}

/**
 * Reef cuts are rolled by whoever is the authority (the room server, or the local game offline).
 * `r` is a uniform random number; `now` and `joinedAt` are in seconds. Returns true if this wipeout cut the surfer.
 */
export function rollReefCut(s: Surfer, r: number, now: number, joinedAt: number, lastCutAt: number): boolean {
  if (!(s.events & Ev.badWipeout) || s.cut === 1) return false;
  if (now - joinedAt < T.reefCut.graceSeconds || now - lastCutAt < T.reefCut.cooldownSeconds) return false;
  if (r >= T.reefCut.chance) return false;
  s.cut = 1;
  return true;
}

/** Pushed under for a moment by someone riding over you. No shove, no stamina hit. */
export function dunk(s: Surfer, seconds = 1): void {
  s.state = St.Tumble; s.stateTime = T.dive.tumble - seconds; s.speed = 0; s.lift = 0; s.waveId = -1;
}
/** True while the surfer can touch and be touched (not under water, not on the sand). */
export const solid = (s: Surfer) => s.state === St.Paddle || s.state === St.Sit || s.state === St.PopUp || s.state === St.Ride;
export const isRiding = (s: Surfer) => s.state === St.Ride || s.state === St.PopUp;
