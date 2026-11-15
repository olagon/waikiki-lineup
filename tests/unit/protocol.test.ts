import { describe, it, expect } from 'vitest';
import * as P from '../../shared/protocol';
import { newSurfer } from '../../shared/physics';
import { ARCHETYPE_LOOKS } from '../../shared/looks';

const view = (b: ArrayBuffer) => new DataView(b);
describe('protocol round trips', () => {
  it('starts every message with the version byte', () => {
    for (const b of [P.encodePing(1), P.encodeEmote(2), P.encodePong(1, 2), P.encodeInput(1, 2, [{ tick: 1, buttons: 0, steer: 0 }, { tick: 0, buttons: 0, steer: 0 }, { tick: -1, buttons: 0, steer: 0 }])]) expect(view(b).getUint8(0)).toBe(P.PROTOCOL);
  });
  it('hello', () => {
    const h = P.decodeHello(view(P.encodeHello('abc123', 'Kai <script>', ARCHETYPE_LOOKS.aunty)));
    expect(h.token.startsWith('abc123')).toBe(true); expect(h.name).toBe('Kai script'); expect(h.look).toEqual(ARCHETYPE_LOOKS.aunty);
  });
  it('input carries the previous two frames', () => {
    const d = P.decodeInput(view(P.encodeInput(1000, 123456, [{ tick: 1000, buttons: 3, steer: 1 }, { tick: 999, buttons: 1, steer: -0.5 }, { tick: 998, buttons: 0, steer: 0 }])));
    expect(d.tick).toBe(1000); expect(d.clientTime).toBe(123456);
    expect(d.frames.map((f) => [f.tick, f.buttons, Math.round(f.steer * 100) / 100])).toEqual([[1000, 3, 1], [999, 1, -0.5], [998, 0, 0]]);
  });
  it('welcome and pong', () => {
    expect(P.decodeWelcome(view(P.encodeWelcome({ id: 7, seed: 0xdeadbeef, spot: 1, serverTime: 1794700000123.5, tick: 123456789 })))).toEqual({ id: 7, seed: 0xdeadbeef, spot: 1, serverTime: 1794700000123.5, tick: 123456789 });
    expect(P.decodePong(view(P.encodePong(12.5, 99.25)))).toEqual({ clientTime: 12.5, serverTime: 99.25 });
  });
  it('snapshot: exact own state, others to the centimeter', () => {
    const me = newSurfer(); Object.assign(me, { x: -12.25, z: 108.5, heading: 4.5, speed: 6.25, state: 6, waveId: 4321, stance: 0.75, rideTime: 3.5 });
    const other: P.Remote = { id: 9, state: 1, paddling: true, cut: 2, bot: true, x: -123.45, z: 207.89, heading: 1.2345, speed: 2.2, waveId: -1, stance: 0.5, stamina: 73, respect: 50 };
    const d = P.decodeSnapshot(view(P.encodeSnapshot(555, true, me, 42, [other])));
    expect(d.tick).toBe(555); expect(d.full).toBe(true); expect(d.respect).toBe(42);
    expect(d.you).toEqual(me);
    const o = d.others[0];
    expect(o.x).toBeCloseTo(other.x, 2); expect(o.z).toBeCloseTo(other.z, 2); expect(o.heading).toBeCloseTo(other.heading, 3); expect(o.speed).toBeCloseTo(2.2, 1);
    expect([o.id, o.state, o.paddling, o.cut, o.bot, o.waveId, o.stamina, o.respect]).toEqual([9, 1, true, 2, true, -1, 73, 50]);
  });
  it('event and roster', () => {
    const e = { id: 77, tick: 1234, kind: P.EvKind.Collision, a: 3, b: 250, value: 2.5 };
    expect(P.decodeEvent(view(P.encodeEvent(e)))).toEqual(e);
    const r = [{ id: 1, bot: false, name: 'Player', look: ARCHETYPE_LOOKS.uncle }, { id: 2, bot: true, name: 'Keoni', look: ARCHETYPE_LOOKS.grom }];
    expect(P.decodeRoster(view(P.encodeRoster(r)))).toEqual(r);
  });
});
