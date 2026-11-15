// Wire protocol: binary, little-endian, first byte is the protocol version.
// Waves are never sent: both ends compute them from the room seed and server time.
import { newSurfer, type Surfer } from './physics';
import type { Look } from './looks';

export const PROTOCOL = 1;
export const Msg = { Hello: 1, Input: 2, Ping: 3, Emote: 4, Welcome: 10, Snapshot: 11, Event: 12, Pong: 13, Roster: 14 } as const;
export const EvKind = { Leave: 1, Wipeout: 2, RideScore: 3, ReefCut: 4, Treated: 5, Collision: 6, DropIn: 7, Emote: 8, Party: 9, Dive: 10 } as const;

// ---- surfer state, exact (your own surfer, for reconciliation). Every numeric field, fixed order, float32.
const FIELDS = ['x', 'z', 'heading', 'speed', 'state', 'stateTime', 'stamina', 'board', 'altTimer', 'altSign', 'prevButtons', 'pushV', 'hitWave', 'events',
  'waveId', 'lift', 'stance', 'rideTime', 'rideDist', 'noseTime', 'maneuvers', 'turnAcc', 'turnCool', 'hold', 'score', 'cut'] as const;
export const SURFER_BYTES = FIELDS.length * 4;
export function writeSurfer(v: DataView, o: number, s: Surfer): number { for (const f of FIELDS) { v.setFloat32(o, s[f] as number, true); o += 4; } return o; }
export function readSurfer(v: DataView, o: number, s: Surfer = newSurfer()): Surfer { const r = s as unknown as Record<string, number>; for (const f of FIELDS) { r[f] = v.getFloat32(o, true); o += 4; } return s; }

// ---- surfer state, compact (everyone else): 14 bytes, positions in centimeters.
export interface Remote { id: number; state: number; paddling: boolean; cut: number; bot: boolean; x: number; z: number; heading: number; speed: number; waveId: number; stance: number; stamina: number; respect: number }
export const REMOTE_BYTES = 14;
const TAU = Math.PI * 2;
export function writeRemote(v: DataView, o: number, r: Remote): number {
  v.setUint8(o, r.id); v.setUint8(o + 1, (r.state & 15) | (r.paddling ? 16 : 0) | ((r.cut & 3) << 5) | (r.bot ? 128 : 0));
  v.setInt16(o + 2, Math.max(-32767, Math.min(32767, Math.round(r.x * 100))), true); v.setUint16(o + 4, Math.max(0, Math.min(65535, Math.round(r.z * 100))), true);
  v.setUint16(o + 6, Math.round((((r.heading % TAU) + TAU) % TAU) / TAU * 65535), true); v.setUint8(o + 8, Math.min(255, Math.round(r.speed * 10)));
  v.setUint16(o + 9, r.waveId < 0 ? 65535 : r.waveId, true); v.setUint8(o + 11, Math.round(r.stance * 255)); v.setUint8(o + 12, Math.round(r.stamina)); v.setUint8(o + 13, Math.round(r.respect));
  return o + REMOTE_BYTES;
}
export function readRemote(v: DataView, o: number): Remote {
  const f = v.getUint8(o + 1), w = v.getUint16(o + 9, true);
  return { id: v.getUint8(o), state: f & 15, paddling: (f & 16) !== 0, cut: (f >> 5) & 3, bot: (f & 128) !== 0, x: v.getInt16(o + 2, true) / 100, z: v.getUint16(o + 4, true) / 100,
    heading: v.getUint16(o + 6, true) / 65535 * TAU, speed: v.getUint8(o + 8) / 10, waveId: w === 65535 ? -1 : w, stance: v.getUint8(o + 11) / 255, stamina: v.getUint8(o + 12), respect: v.getUint8(o + 13) };
}

const LOOK_KEYS: (keyof Look)[] = ['skin', 'build', 'hair', 'hairColor', 'top', 'topColor', 'shortsColor', 'board', 'boardColor', 'stringer'];
const enc = new TextEncoder(), dec = new TextDecoder();
const head = (type: number, bytes: number) => { const b = new ArrayBuffer(bytes), v = new DataView(b); v.setUint8(0, PROTOCOL); v.setUint8(1, type); return { b, v }; };
const writeLook = (v: DataView, o: number, l: Look) => { LOOK_KEYS.forEach((k, i) => v.setUint8(o + i, l[k] as number)); return o + 10; };
const readLook = (v: DataView, o: number): Look => { const l = {} as Record<string, number>; LOOK_KEYS.forEach((k, i) => { l[k] = v.getUint8(o + i); }); return l as unknown as Look; };
const cleanName = (s: string) => s.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 14) || 'Surfer';

// ---- client -> server
/** Join (or rejoin with the same token within 30 s). */
export function encodeHello(token: string, name: string, look: Look): ArrayBuffer {
  const n = enc.encode(cleanName(name)), t = enc.encode(token.slice(0, 32).padEnd(32, '0')), { b, v } = head(Msg.Hello, 2 + 32 + 10 + 1 + n.length);
  new Uint8Array(b).set(t, 2); writeLook(v, 34, look); v.setUint8(44, n.length); new Uint8Array(b).set(n, 45);
  return b;
}
export function decodeHello(v: DataView) { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), n = Math.min(v.getUint8(44), 48); return { token: dec.decode(u.subarray(2, 34)), look: readLook(v, 34), name: cleanName(dec.decode(u.subarray(45, 45 + n))) }; }

export interface InputFrame { tick: number; buttons: number; steer: number }
/** Input for `tick`, with the previous two ticks' inputs repeated so a lost or late frame costs nothing. */
export function encodeInput(tick: number, clientTime: number, frames: [InputFrame, InputFrame, InputFrame]): ArrayBuffer {
  const { b, v } = head(Msg.Input, 16);
  v.setUint32(2, tick >>> 0, true); v.setUint32(6, clientTime >>> 0, true);
  frames.forEach((f, i) => { v.setUint8(10 + i * 2, f.buttons & 255); v.setInt8(11 + i * 2, Math.round(Math.max(-1, Math.min(1, f.steer)) * 127)); });
  return b;
}
export function decodeInput(v: DataView): { tick: number; clientTime: number; frames: InputFrame[] } {
  const tick = v.getUint32(2, true), frames: InputFrame[] = [];
  for (let i = 0; i < 3; i++) frames.push({ tick: tick - i, buttons: v.getUint8(10 + i * 2), steer: v.getInt8(11 + i * 2) / 127 });
  return { tick, clientTime: v.getUint32(6, true), frames };
}
export function encodePing(clientTime: number): ArrayBuffer { const { b, v } = head(Msg.Ping, 10); v.setFloat64(2, clientTime, true); return b; }
export function encodeEmote(emote: number): ArrayBuffer { const { b, v } = head(Msg.Emote, 3); v.setUint8(2, emote); return b; }

// ---- server -> client
export interface Welcome { id: number; seed: number; spot: number; serverTime: number; tick: number }
export function encodeWelcome(w: Welcome): ArrayBuffer { const { b, v } = head(Msg.Welcome, 20); v.setUint8(2, w.id); v.setUint8(3, w.spot); v.setUint32(4, w.seed >>> 0, true); v.setFloat64(8, w.serverTime, true); v.setUint32(16, w.tick >>> 0, true); return b; }
export function decodeWelcome(v: DataView): Welcome { return { id: v.getUint8(2), spot: v.getUint8(3), seed: v.getUint32(4, true), serverTime: v.getFloat64(8, true), tick: v.getUint32(16, true) }; }
export function encodePong(clientTime: number, serverTime: number): ArrayBuffer { const { b, v } = head(Msg.Pong, 18); v.setFloat64(2, clientTime, true); v.setFloat64(10, serverTime, true); return b; }
export function decodePong(v: DataView) { return { clientTime: v.getFloat64(2, true), serverTime: v.getFloat64(10, true) }; }

/** Snapshot for one client: the tick it describes, that client's exact state, and the others that changed (all of them when `full`). */
export function encodeSnapshot(tick: number, full: boolean, you: Surfer, respect: number, others: Remote[]): ArrayBuffer {
  const { b, v } = head(Msg.Snapshot, 9 + SURFER_BYTES + others.length * REMOTE_BYTES);
  v.setUint32(2, tick >>> 0, true); v.setUint8(6, full ? 1 : 0); v.setUint8(7, Math.round(respect)); v.setUint8(8, others.length);
  let o = writeSurfer(v, 9, you);
  for (const r of others) o = writeRemote(v, o, r);
  return b;
}
export function decodeSnapshot(v: DataView, you: Surfer = newSurfer()) {
  const n = v.getUint8(8), others: Remote[] = [];
  readSurfer(v, 9, you);
  for (let i = 0, o = 9 + SURFER_BYTES; i < n; i++, o += REMOTE_BYTES) others.push(readRemote(v, o));
  return { tick: v.getUint32(2, true), full: v.getUint8(6) === 1, respect: v.getUint8(7), you, others };
}

export interface GameEvent { id: number; tick: number; kind: number; a: number; b: number; value: number }
export function encodeEvent(e: GameEvent): ArrayBuffer { const { b, v } = head(Msg.Event, 17); v.setUint32(2, e.id >>> 0, true); v.setUint32(6, e.tick >>> 0, true); v.setUint8(10, e.kind); v.setUint8(11, e.a); v.setUint8(12, e.b); v.setFloat32(13, e.value, true); return b; }
export function decodeEvent(v: DataView): GameEvent { return { id: v.getUint32(2, true), tick: v.getUint32(6, true), kind: v.getUint8(10), a: v.getUint8(11), b: v.getUint8(12), value: v.getFloat32(13, true) }; }

export interface RosterEntry { id: number; bot: boolean; name: string; look: Look }
export function encodeRoster(list: RosterEntry[]): ArrayBuffer {
  const names = list.map((e) => enc.encode(cleanName(e.name))), { b, v } = head(Msg.Roster, 3 + names.reduce((a, n) => a + 13 + n.length, 0));
  v.setUint8(2, list.length);
  let o = 3;
  list.forEach((e, i) => { v.setUint8(o, e.id); v.setUint8(o + 1, e.bot ? 1 : 0); writeLook(v, o + 2, e.look); v.setUint8(o + 12, names[i].length); new Uint8Array(b).set(names[i], o + 13); o += 13 + names[i].length; });
  return b;
}
export function decodeRoster(v: DataView): RosterEntry[] {
  const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), out: RosterEntry[] = [];
  for (let i = 0, o = 3; i < v.getUint8(2); i++) { const n = v.getUint8(o + 12); out.push({ id: v.getUint8(o), bot: v.getUint8(o + 1) === 1, look: readLook(v, o + 2), name: dec.decode(u.subarray(o + 13, o + 13 + n)) }); o += 13 + n; }
  return out;
}
