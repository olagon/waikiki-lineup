import { describe, it, expect } from 'vitest';
import { Board, St, newSurfer, type Surfer, type World } from '../../shared/physics';
import { Hit, gap, priorityOn, resolve } from '../../shared/collisions';
import { BREAKS, activeWaves, crestZ, roomSeed, type Wave } from '../../shared/waves';

const spot = BREAKS.canoes, seed = roomSeed('collide');
const wave = (() => { for (let t = 1794700000; ; t += 5) { const w = activeWaves(seed, t, spot).find((x) => x.set && x.peaks.length === 1); if (w) return w; } })() as Wave;
const t = wave.tb + 2, world: World = { t, waves: [wave], spot, night: 0 };
const at = (x: number, z: number, state: St, heading = Math.PI / 2, board: Board = Board.Long): Surfer => Object.assign(newSurfer(board), { x, z, state, heading });
const rider = (x: number, speed: number, rideTime: number, heading = -Math.PI / 2 + 0.9): Surfer => Object.assign(at(x, crestZ(wave, spot, t) - 1.5, St.Ride, heading), { speed, rideTime, waveId: wave.id });
const px = wave.peaks[0].x;

describe('capsules', () => {
  it('boards touch nose to tail but not when a length apart side by side', () => {
    expect(gap(at(0, 100, St.Paddle), at(0, 102.5, St.Paddle))).toBeLessThan(0);
    expect(gap(at(0, 100, St.Paddle), at(2, 100, St.Paddle))).toBeGreaterThan(0);
    expect(gap(at(0, 100, St.Paddle, 0, Board.Short), at(2.3, 100, St.Paddle, 0, Board.Short))).toBeGreaterThan(0); // shortboards are 2.1 m
    expect(gap(at(0, 100, St.Paddle, 0, Board.Long), at(2.3, 100, St.Paddle, 0, Board.Long))).toBeLessThan(0); // longboards are 2.9 m
  });
});

describe('collision outcomes (one per row of the brief)', () => {
  it('paddler vs paddler: soft push apart, both lose speed', () => {
    const a = Object.assign(at(0, 100, St.Paddle), { speed: 2 }), b = Object.assign(at(0.4, 100.2, St.Sit), { speed: 1 });
    const c = resolve(a, b, world, undefined, false, false)!;
    expect(c.hit).toBe(Hit.Bump);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.45 + 0.4);
    expect(a.speed).toBe(1); expect(b.speed).toBe(0.5);
    expect(a.state).toBe(St.Paddle); expect(b.state).toBe(St.Sit);
  });
  it('rider vs paddler: paddler dunked 1 s, rider loses 30% speed', () => {
    const r = rider(px + 10, 5, 4), p = at(px + 10.5, r.z, St.Paddle, 0);
    expect(resolve(r, p, world, wave, true, false)!.hit).toBe(Hit.Dunk);
    expect(r.speed).toBeCloseTo(3.5); expect(r.state).toBe(St.Ride);
    expect(p.state).toBe(St.Tumble);
    let ticks = 0; while (p.state === St.Tumble && ticks < 100) { p.stateTime += 0.05; if (p.stateTime >= 1.2) p.state = St.Paddle; ticks++; }
    expect(ticks * 0.05).toBeCloseTo(1, 1);
  });
  it('rider above 6 m/s hitting a paddler head-on: both wipe out', () => {
    const r = rider(px + 10, 7, 4, -Math.PI / 2), p = at(px + 10, r.z - 1, St.Paddle, Math.PI / 2);
    expect(resolve(r, p, world, wave, true, false)!.hit).toBe(Hit.BothDown);
    expect(r.state).toBe(St.Wipeout); expect(p.state).toBe(St.Wipeout);
  });
  it('rider vs rider, one has priority: priority keeps riding, the other wipes out', () => {
    const a = rider(px + 6, 6, 4), b = rider(px + 6.5, 6, 3);
    const c = resolve(a, b, world, wave, true, false)!;
    expect(c.hit).toBe(Hit.PriorityHolds); expect(c.fault).toBe(2);
    expect(a.state).toBe(St.Ride); expect(b.state).toBe(St.Wipeout);
  });
  it('rider vs rider, neither has priority (a shared party wave): both wipe out', () => {
    const a = rider(px + 6, 6, 4), b = rider(px + 6.5, 6, 3);
    expect(resolve(a, b, world, wave, false, false)!.hit).toBe(Hit.PartyCrash);
    expect(a.state).toBe(St.Wipeout); expect(b.state).toBe(St.Wipeout);
  });
  it('bump during takeoff (first second): the surfer taking off is knocked off; a drop-in on the bumper', () => {
    const fresh = rider(px + 6, 5, 0.4), bumper = rider(px + 6.5, 6, 5);
    const c = resolve(fresh, bumper, world, wave, true, false)!; // even with priority, a takeoff bump knocks you off
    expect(c.hit).toBe(Hit.TakeoffBump); expect(c.fault).toBe(2);
    expect(fresh.state).toBe(St.Wipeout); expect(bumper.state).toBe(St.Ride);
  });
  it('surfers who are under water or on the sand are not touched', () => {
    expect(resolve(at(0, 50, St.Dive), at(0, 50, St.Paddle), world, undefined, false, false)).toBeNull();
    expect(resolve(at(0, 50, St.Wipeout), rider(0, 6, 3), world, wave, false, false)).toBeNull();
  });
});

describe('priority', () => {
  it('goes to the surfer closest to the breaking part, per peel direction', () => {
    const deep = rider(px + 4, 6, 3), shoulder = rider(px + 20, 6, 3), otherSide = rider(px - 15, 6, 3, -Math.PI / 2 - 0.9);
    const all = [shoulder, deep, otherSide];
    expect(priorityOn(wave, t, all, 1)).toBe(1);
    expect(priorityOn(wave, t, all, -1)).toBe(2);
    expect(priorityOn(wave, t, [at(px + 5, 100, St.Sit)], 1)).toBe(-1); // just sitting there is not a claim
  });
});
