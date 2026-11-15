import { describe, it, expect } from 'vitest';
import { B, Board, Ev, St, newSurfer, stepSurfer, timeToWhitewater, type Input, type World } from '../../shared/physics';
import { BREAKS, activeWaves, crestZ, roomSeed, type Wave } from '../../shared/waves';
import { TUNING as T } from '../../shared/tuning';
import { rngStream } from '../../shared/rng';

const spot = BREAKS.canoes, seed = roomSeed('test-room'), T0 = 1794700000;
const world = (t: number, night = 0): World => ({ t, waves: activeWaves(seed, t, spot), spot, night });
const idle: Input = { buttons: 0, steer: 0 };

describe('physics step', () => {
  it('is deterministic: the same inputs give the same surfer', () => {
    const run = () => {
      const s = newSurfer(Board.Short), r = rngStream(9);
      for (let i = 0; i < 3000; i++) stepSurfer(s, { buttons: r() < 0.8 ? B.paddle : r() < 0.3 ? B.action | B.dive : 0, steer: Math.round(r() * 2 - 1) }, world(T0 + i * T.tick));
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
  it('paddles at 2.2 m/s, faster with alternating strokes, and tires', () => {
    const s = newSurfer();
    const calm: World = { t: T0, waves: [], spot, night: 0 };
    for (let i = 0; i < 100; i++) stepSurfer(s, { buttons: B.paddle, steer: 0 }, calm);
    expect(s.speed).toBeCloseTo(T.paddle.speed, 1);
    expect(s.stamina).toBeCloseTo(100 - T.stamina.drainSteady * 5, 0);
    for (let i = 0; i < 100; i++) stepSurfer(s, { buttons: 0, steer: Math.floor(i / 5) % 2 ? 1 : -1 }, calm);
    expect(s.speed).toBeCloseTo(T.paddle.speed + T.paddle.altBonus, 1);
    expect(s.stamina).toBeCloseTo(100 - T.stamina.drainSteady * 5 - T.stamina.drain * 5, -1); // sprinting drains 4 per second
    s.state = St.Sit;
    for (let i = 0; i < 40; i++) stepSurfer(s, idle, calm);
    expect(s.stamina).toBeGreaterThan(75);
  });
});

describe('whitewater', () => {
  // Find a set wave and a spot in the path of its whitewater.
  const setWave = (() => { for (let t = T0; ; t += 5) { const w = activeWaves(seed, t, spot).find((x) => x.set); if (w) return w; } })() as Wave;
  const x = setWave.peaks[0].x, tHit0 = setWave.tb + 4;
  const place = (board: Board) => { const s = newSurfer(board); s.x = x; s.z = crestZ(setWave, spot, tHit0) - 2.5; return s; };
  /** Step from 2 s before the front arrives; `act(dtToHit)` returns the input for that moment. */
  const run = (board: Board, act: (toHit: number) => Input, night = 0) => {
    const s = place(board);
    let events = 0;
    for (let t = tHit0 - 2; t < tHit0 + 1.5; t += T.tick) {
      const w = world(t, night);
      stepSurfer(s, act(timeToWhitewater(w, s.x, s.z)), w);
      events |= s.events;
    }
    return { s, events, pushed: crestZ(setWave, spot, tHit0) - 2.5 - s.z };
  };
  const pressAt = (lead: number) => { let done = false; return (toHit: number): Input => { if (!done && toHit <= lead) { done = true; return { buttons: B.dive, steer: 0 }; } return idle; }; };

  it('the pop-up button never rolls or dives; only the dive button does', () => {
    for (const board of [Board.Short, Board.Long]) {
      const s = newSurfer(board); stepSurfer(s, { buttons: B.action, steer: 0 }, world(T0));
      expect(s.state).toBe(St.Paddle);
      stepSurfer(s, { buttons: B.dive, steer: 0 }, world(T0 + T.tick));
      expect(s.state).toBe(board === Board.Short ? St.Dive : St.Turtle);
    }
  });
  it('a perfect duck dive is not pushed at all', () => {
    const r = run(Board.Short, pressAt(0.15));
    expect(r.events & Ev.divePerfect).toBeTruthy();
    expect(Math.abs(r.pushed)).toBeLessThan(0.3);
  });
  it('a dive inside the window but not perfect is pushed about 2 m', () => {
    const r = run(Board.Short, pressAt(0.42));
    expect(r.events & Ev.diveOk).toBeTruthy();
    expect(r.pushed).toBeGreaterThan(1.2); expect(r.pushed).toBeLessThan(2.6);
  });
  it('a miss washes you in 6-12 m, tumbling, with a stamina hit', () => {
    const r = run(Board.Short, () => idle);
    expect(r.events & Ev.washed).toBeTruthy();
    expect(r.pushed).toBeGreaterThan(5); expect(r.pushed).toBeLessThan(12.5);
    expect(r.s.stamina).toBeLessThan(100);
  });
  it('a turtle roll on a longboard is pushed 3-5 m', () => {
    const r = run(Board.Long, (toHit) => (toHit < 1 || toHit === Infinity ? { buttons: B.dive, steer: 0 } : idle));
    expect(r.events & Ev.turtled).toBeTruthy();
    expect(r.pushed).toBeGreaterThan(2.4); expect(r.pushed).toBeLessThan(5.3);
  });
  it('at night the dive window is 80% as long', () => {
    expect(run(Board.Short, pressAt(0.47), 0).events & Ev.diveOk).toBeTruthy();
    expect(run(Board.Short, pressAt(0.47), 1).events & Ev.washed).toBeTruthy();
  });
});
