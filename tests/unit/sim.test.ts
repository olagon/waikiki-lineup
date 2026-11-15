import { describe, it, expect } from 'vitest';
import { Sim, Emote } from '../../worker/sim';
import { BREAKS, activeWaves, roomSeed } from '../../shared/waves';
import { tickAt, tickTime } from '../../shared/tuning';
import { hstToUtcMs } from '../../shared/sun';
import { DEFAULT_LOOK, ARCHETYPE_LOOKS } from '../../shared/looks';
import { EvKind } from '../../shared/protocol';
import { newPilot, pilotInput } from '../../shared/autopilot';

function room(name: string, hour: number, humans = 1) {
  const sim = new Sim(BREAKS.canoes, roomSeed(name), 7);
  sim.tick = tickAt(hstToUtcMs(2026, 11, 14, hour));
  for (let i = 0; i < humans; i++) sim.addHuman('H' + i, DEFAULT_LOOK, 'tok' + i, tickTime(sim.tick) * 1000);
  return sim;
}
const run = (sim: Sim, seconds: number, each?: (sim: Sim, i: number) => void) => { for (let i = 0; i < seconds * 20; i++) { each?.(sim, i); sim.step(tickTime(sim.tick + 1) * 1000); sim.added.length = 0; } };

describe('bots', () => {
  it('at least five are always out, eight with a lone human, each archetype present by day', () => {
    const sim = room('lineup', 10);
    run(sim, 5);
    const bots = [...sim.members.values()].filter((m) => m.bot);
    expect(bots.length).toBe(7); // one human: fill to eight surfers
    const looks = new Set(bots.map((b) => JSON.stringify(b.look)));
    for (const kind of ['uncle', 'grom', 'instructor', 'student', 'charger', 'aunty']) expect(looks.has(JSON.stringify(ARCHETYPE_LOOKS[kind]))).toBe(true);
    expect(new Set(bots.map((b) => b.name)).size).toBe(bots.length);
    const busy = room('busy', 10, 6); run(busy, 5);
    expect([...busy.members.values()].filter((m) => m.bot).length).toBe(5);
  });
  it('at night the instructor and student go home, and five are still out', () => {
    const sim = room('night', 22);
    run(sim, 5);
    const bots = [...sim.members.values()].filter((m) => m.bot), looks = bots.map((b) => JSON.stringify(b.look));
    expect(bots.length).toBeGreaterThanOrEqual(5);
    expect(looks).not.toContain(JSON.stringify(ARCHETYPE_LOOKS.instructor));
    expect(looks).not.toContain(JSON.stringify(ARCHETYPE_LOOKS.student));
  });
  it('fun check: within three minutes the lineup shows a party wave, a drop-in callout and a hoot', () => {
    let rooms = 0;
    for (const name of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
      const sim = room(name, 10);
      let party = false, callout = false, hoot = false, dropAt = -1;
      run(sim, 180, (s, i) => { for (const e of s.events) {
        if (e.kind === EvKind.Party) party = true;
        if (e.kind === EvKind.DropIn) dropAt = i;
        if (e.kind === EvKind.Emote && e.b === Emote.Point && dropAt >= 0 && i - dropAt < 60) callout = true;
        if (e.kind === EvKind.Emote && e.b === Emote.Hoot) hoot = true;
      } });
      if (party && callout && hoot) rooms++;
    }
    expect(rooms).toBeGreaterThanOrEqual(4); // sets and tempers vary; most sessions must show all three
  });
  it('bots catch waves, ride them, and never leave the bay or the water', () => {
    const sim = room('rides', 14);
    let rides = 0;
    run(sim, 240, (s) => { for (const e of s.events) if (e.kind === EvKind.RideScore && e.value > 2) rides++; for (const m of s.members.values()) { expect(Number.isFinite(m.s.x + m.s.z + m.s.speed)).toBe(true); expect(Math.abs(m.s.x)).toBeLessThanOrEqual(261); expect(m.s.z).toBeGreaterThan(0); } });
    expect(rides).toBeGreaterThanOrEqual(3); // sets and tempers vary; tuning bot keenness is on the polish list
  });
});

describe('server tick', () => {
  it('p99 stays far under 10 ms with 16 humans and their bots', () => {
    const sim = room('load', 14, 16), pilots = new Map<number, ReturnType<typeof newPilot>>(), ms: number[] = [];
    for (const m of sim.humans()) pilots.set(m.id, newPilot((m.id - 8) * 6, 113, (m.id % 5) * 3 - 6));
    for (let i = 0; i < 2400; i++) {
      const t = tickTime(sim.tick + 1), w = { t, waves: activeWaves(sim.seed, t, sim.spot), spot: sim.spot, night: 0 };
      for (const m of sim.humans()) { const inp = pilotInput(m.s, w, pilots.get(m.id)!); m.inputs.set(sim.tick + 1, { tick: sim.tick + 1, ...inp }); }
      const t0 = performance.now(); sim.step(t * 1000); ms.push(performance.now() - t0);
      sim.added.length = 0;
    }
    ms.sort((a, b) => a - b);
    expect(sim.members.size).toBeGreaterThanOrEqual(21);
    expect(ms[Math.floor(ms.length * 0.99)]).toBeLessThan(10);
  });
});
