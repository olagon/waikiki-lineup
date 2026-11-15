import { describe, it, expect } from 'vitest';
import { Board, Ev, St, newSurfer, rollReefCut, stepSurfer, type World } from '../../shared/physics';
import { newPilot, pilotInput } from '../../shared/autopilot';
import { BREAKS, activeWaves, roomSeed } from '../../shared/waves';
import { TUNING as T } from '../../shared/tuning';

const spot = BREAKS.canoes;
/** Play a scripted surfer from a fresh spawn. */
function session(seedName: string, board: Board, seconds: number, t0 = 1794700000) {
  const seed = roomSeed(seedName), s = newSurfer(board), pilot = newPilot();
  let events = 0, firstRide = Infinity, longest = 0, rideStart = -1, dives = 0, wipeouts = 0, best = 0;
  for (let i = 0; i < seconds / T.tick; i++) {
    const t = t0 + i * T.tick, w: World = { t, waves: activeWaves(seed, t, spot), spot, night: 0 };
    stepSurfer(s, pilotInput(s, w, pilot), w);
    events |= s.events;
    if (s.events & (Ev.divePerfect | Ev.diveOk | Ev.turtled)) dives++;
    if (s.events & Ev.wipeout) wipeouts++;
    if (s.events & Ev.rideEnd) best = Math.max(best, s.score);
    if (s.state === St.Ride && rideStart < 0) rideStart = i * T.tick;
    if (rideStart >= 0 && i * T.tick - rideStart >= 3 && firstRide === Infinity) firstRide = rideStart;
    if (s.state !== St.Ride && s.state !== St.PopUp && rideStart >= 0) { const len = i * T.tick - rideStart; longest = Math.max(longest, len); if (len >= 3 && firstRide === Infinity) firstRide = rideStart; rideStart = -1; }
  }
  return { s, events, firstRide, longest, dives, wipeouts, best };
}

describe('fun check (single player)', () => {
  it('a new player paddles out, gets under whitewater, and is riding within 90 s', () => {
    // Sets arrive on their own schedule, so try several rooms: nearly all must work, and across them
    // the player must have met whitewater and got under it (some paddle-outs fall in a lull and meet none).
    let ok = 0, dives = 0;
    for (const room of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const r = session(room, Board.Long, 90);
      dives += r.dives;
      if (r.firstRide < 90) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(5);
    expect(dives).toBeGreaterThanOrEqual(5);
  });
  it('shortboards catch waves and score rides too', () => {
    const r = session('shorty', Board.Short, 300);
    expect(r.longest).toBeGreaterThan(4);
    expect(r.best).toBeGreaterThan(1);
  });
  it('rides last a believable time and score between 0 and 10', () => {
    const r = session('long-session', Board.Long, 600);
    expect(r.longest).toBeGreaterThan(6);
    expect(r.longest).toBeLessThan(30);
    expect(r.best).toBeGreaterThan(2); expect(r.best).toBeLessThanOrEqual(10);
  });
});

describe('reef cuts', () => {
  const hurt = () => { const s = newSurfer(); s.events = Ev.wipeout | Ev.badWipeout; return s; };
  it('only bad wipeouts can cut', () => {
    const s = newSurfer(); s.events = Ev.wipeout;
    expect(rollReefCut(s, 0, 10000, 0, -1e9)).toBe(false);
    expect(rollReefCut(hurt(), 0, 10000, 0, -1e9)).toBe(true);
  });
  it('the chance is 8%', () => {
    expect(rollReefCut(hurt(), 0.079, 10000, 0, -1e9)).toBe(true);
    expect(rollReefCut(hurt(), 0.081, 10000, 0, -1e9)).toBe(false);
  });
  it('never in the first 5 minutes, and at most one every 15 minutes', () => {
    expect(rollReefCut(hurt(), 0, 299, 0, -1e9)).toBe(false);
    expect(rollReefCut(hurt(), 0, 301, 0, -1e9)).toBe(true);
    expect(rollReefCut(hurt(), 0, 2000, 0, 2000 - 899)).toBe(false);
    expect(rollReefCut(hurt(), 0, 2000, 0, 2000 - 901)).toBe(true);
  });
  it('an open cut means no wave catching until it is treated', () => {
    const seed = roomSeed('cut-room'), s = newSurfer(Board.Long), pilot = newPilot();
    s.cut = 1;
    let lifted = false;
    for (let i = 0; i < 240 / T.tick; i++) {
      const t = 1794700000 + i * T.tick, w: World = { t, waves: activeWaves(seed, t, spot), spot, night: 0 };
      // Force the pilot to keep trying: aim it at waves as if it were not hurt.
      s.cut = 0; const inp = pilotInput(s, w, pilot); s.cut = 1;
      stepSurfer(s, inp, w);
      if (s.events & Ev.lift || s.state === St.Ride) lifted = true;
    }
    expect(lifted).toBe(false);
  });
});
