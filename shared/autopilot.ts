// A surfer that plays by sending the same inputs a human would. Used by the fun-check test,
// scripted captures, and (with personality on top) the bots. It never touches state directly.
import { B, Board, St, timeToWhitewater, type Input, type Surfer, type World } from './physics';
import { C0, T_CURL, breakDelay, crestSpeed, crestZ, newSample, peelDir, sampleWave, type Wave } from './waves';
import { TUNING as T } from './tuning';
import { shoreZ } from './bathy';

const sample = newSample();
const turnTo = (s: Surfer, want: number, gain = 2.5) => { const d = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)); return Math.max(-1, Math.min(1, d * gain)); };

/** Steering while riding: hold a line on the open face ahead of the break. */
export function rideInput(s: Surfer, w: World, style = 0): Input {
  const wave = w.waves.find((x) => x.id === s.waveId);
  if (!wave) return { buttons: 0, steer: 0 };
  const sm = sampleWave(wave, w.spot, s.x, s.z, w.t, sample), dir = peelDir(wave, s.x);
  // Angle off straight-in. Hold a line down the face; race when the curl is on your heels; fade back when you have outrun it.
  let ang = 1.0;
  if (sm.tau > -0.8) ang = 1.3;
  else if (s.rideTime < 0.5) ang = 0.6; // drop in before turning
  else if (sm.tau < -2.6) ang = 0.45;
  if (sm.tau >= T_CURL) ang = 0.1; // already whitewater: straighten out and ride it in
  let buttons = 0;
  if (s.board === Board.Short) { if (sm.slope > 0.1 && s.speed < 7.5) buttons |= B.forward; }
  else if (style > 0 && sm.slope > 0.12 && sm.tau < -1.2 && s.rideTime > 2) buttons |= B.forward; // walk to the nose in clean trim
  else if (s.stance > 0.3) buttons |= B.back;
  return { buttons, steer: turnTo(s, -Math.PI / 2 + dir * ang, 3) };
}

export interface Pilot { goalX: number; goalZ: number; target: number; offset: number } // offset: where this surfer likes to sit relative to the peak (m along the shore)
export const newPilot = (goalX = 0, goalZ = 113, offset = 0): Pilot => ({ goalX, goalZ, target: -1, offset }); // offset 0: whichever side of the peak is nearer

/** The next wave worth going for from where we sit: one that will be steep here soon. */
export function pickWave(s: Surfer, w: World, minH = 0): Wave | undefined {
  let best: Wave | undefined, bestT = Infinity;
  for (const wave of w.waves) {
    const zc = crestZ(wave, w.spot, w.t), arrive = (zc - s.z) / C0;
    if (arrive < 1.2 || arrive > 9 || wave.h < minH) continue;
    const tauThen = w.t + arrive - wave.tb - breakDelay(wave, s.x); // how broken this section will be when it gets here
    if (tauThen > 0.3 || tauThen < -3) continue; // already whitewater here, or still too soft to catch
    if (arrive < bestT) { best = wave; bestT = arrive; }
  }
  return best;
}

export interface PilotOpts {
  allow?: (wave: Wave) => boolean; // may this surfer go for that wave (size taste, etiquette)?
  react?: number; // seconds of hesitation before popping up; more than the window means a blown takeoff
  skipDive?: boolean; // misjudge the next whitewater
  style?: number; // > 0 walks to the nose in clean trim
}
/** One tick of a simple, competent surfer: paddle out, get under whitewater, wait, go, ride. */
export function pilotInput(s: Surfer, w: World, p: Pilot, o: PilotOpts = {}): Input {
  if (s.state === St.Ride || s.state === St.PopUp) return rideInput(s, w, o.style ?? 0);
  if (s.state === St.Wipeout || s.state === St.Recover || s.state === St.Tumble || s.state === St.Treat) return { buttons: 0, steer: 0 };
  if (s.lift > 0) return { buttons: (s.lift <= T.catch.popWindow - (o.react ?? 0) ? B.action : 0) | B.paddle, steer: turnTo(s, -Math.PI / 2) }; // feel the lift: pop up
  // Hurt: paddle in to the shallows by the lifeguard tower.
  if (s.cut === 1) { const tx = T.world.towerX, tz = shoreZ(tx) + 6; if (s.state === St.Sit) return { buttons: B.sit, steer: 0 }; return { buttons: B.paddle, steer: turnTo(s, Math.atan2(tz - s.z, tx - s.x)) }; }

  // Whitewater coming: shortboards dive late, bigger boards roll early and hold.
  const hit = timeToWhitewater(w, s.x, s.z);
  const facingIn = Math.sin(s.heading) < -0.5;
  if ((!facingIn || p.target < 0) && !o.skipDive) {
    if (s.board === Board.Short) { if (hit < 0.16 && s.state === St.Paddle) return { buttons: B.dive, steer: 0 }; }
    else if (hit < 0.7 || s.state === St.Turtle && hit < 1.2) return { buttons: s.state === St.Sit ? B.sit : B.dive, steer: 0 };
  }
  if (s.state === St.Dive || s.state === St.Turtle) return { buttons: 0, steer: 0 };

  // Going for a wave: turn in, paddle hard, alternate strokes for the extra speed.
  const wave = w.waves.find((x) => x.id === p.target);
  if (wave) {
    const zc = crestZ(wave, w.spot, w.t);
    if (zc < s.z - 3 || s.cut === 1) p.target = -1; // it went by
    else {
      if (s.state === St.Sit) return { buttons: B.sit, steer: 0 };
      // Turn early, paddle late: start stroking when the wave is two seconds out, or it takes forever to catch up.
      const aim = turnTo(s, -Math.PI / 2 + peelDir(wave, s.x) * 0.4), lined = Math.abs(aim) < 0.25, go = zc - s.z < 15; // angle the takeoff away from the peak
      return { buttons: go ? B.paddle : 0, steer: lined && go ? (Math.floor(w.t * 5) % 2 ? 1 : -1) : aim };
    }
  }

  // Read the horizon: shuffle along the lineup toward where the next wave will peak.
  let gx = p.goalX;
  if (s.z > p.goalZ - 12) {
    let soon = Infinity;
    for (const wv of w.waves) {
      const arrive = (crestZ(wv, w.spot, w.t) - s.z) / C0;
      if (arrive > 4 && arrive < 16 && arrive < soon) { soon = arrive; const px = wv.peaks[0].x; gx = px + (p.offset || (s.x >= px ? 4 : -4)); }
    }
  }
  const dx = gx - s.x, dz = p.goalZ - s.z, far = Math.hypot(dx, dz);
  if (far > 2.5) { // paddle to the lineup
    if (s.state === St.Sit) return { buttons: B.sit, steer: 0 };
    return { buttons: s.stamina > 8 ? B.paddle : 0, steer: turnTo(s, Math.atan2(dz, dx)) };
  }
  // In position: sit, face the horizon, watch for a wave.
  const cand = pickWave(s, w), next = cand && (!o.allow || o.allow(cand)) ? cand : undefined;
  if (next) { p.target = next.id; return { buttons: s.state === St.Sit ? B.sit : B.paddle, steer: turnTo(s, -Math.PI / 2) }; }
  if (s.state !== St.Sit) return { buttons: s.speed < 0.6 ? B.sit : 0, steer: 0 };
  return { buttons: 0, steer: turnTo(s, Math.PI / 2, 1.5) };
}

/** Whether a section of wave is close enough and steep enough to matter to someone at (x, z). */
export function waveNear(w: World, x: number, z: number): number {
  let near = Infinity;
  for (const wave of w.waves) { const d = crestZ(wave, w.spot, w.t) - z; if (d > 0 && d < near && wave.h > 0.9) near = d / crestSpeed(wave, w.spot, w.t); }
  return near;
}
