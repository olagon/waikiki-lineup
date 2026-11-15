// One connection to a room: clock sync, input at 20 Hz, prediction and reconciliation for your own
// surfer, interpolation for everyone else. No DOM in here, so the same code runs in Node tests.
import { TUNING as T, tickAt, tickTime } from '../../shared/tuning';
import { newSurfer, stepSurfer, type Input, type Surfer, type World } from '../../shared/physics';
import { BREAKS, activeWaves, type BreakSpec, type Wave } from '../../shared/waves';
import { nightFactor, sunPosition, towerOpen } from '../../shared/sun';
import * as P from '../../shared/protocol';
import type { Look } from '../../shared/looks';

export interface Chaos { latency: number; jitter: number; loss: number } // ms each way (mean, plus or minus), fraction of frames lost
interface Sample { t: number; r: P.Remote }
export interface RemoteView extends P.Remote { visible: boolean }

export class Session {
  id = 0; seed = 0; spot: BreakSpec = BREAKS.canoes;
  me: Surfer = newSurfer(); myTick = 0; respect = 60;
  offset = 0; rtt = 80; jitter = 10; // offset: server clock minus local clock, ms
  roster = new Map<number, P.RosterEntry>();
  onEvent: (e: P.GameEvent) => void = () => {};
  /** Smoothed visual correction for your own surfer (meters): add to the predicted position when drawing. */
  ox = 0; oz = 0;
  // Measurements for tests and the dev panel.
  corrections: number[] = []; snapshots = 0; closed = false; ackTick = 0; bytesIn = 0;
  input: Input = { buttons: 0, steer: 0 };
  private ws!: WebSocket; private tracks = new Map<number, Sample[]>(); private inputs = new Map<number, Input>();
  private waveCache = new Map<number, Wave[]>(); private env = { night: 0, guard: true, at: 0 };
  private outQ: { at: number; data: ArrayBuffer }[] = []; private inQ: { at: number; data: ArrayBuffer }[] = []; private pump: ReturnType<typeof setInterval> | null = null;
  private bestRtt = Infinity; private lastSnapAt = 0; private pingTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(private chaos?: Chaos) {}

  static async join(origin: string, spot: string, room: string | null, token: string, name: string, look: Look, chaos?: Chaos): Promise<Session> {
    const s = new Session(chaos);
    const j = (await (await fetch(`${origin}/api/join?break=${spot}${room ? '&room=' + room : ''}`)).json()) as { break: string; room: string; full?: boolean };
    if (j.full) throw new Error('full'); // every room allowed is in use
    s.spot = BREAKS[j.break] ?? BREAKS.canoes; s.roomId = j.room;
    await new Promise<void>((resolve, reject) => {
      const ws = (s.ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/ws?break=${j.break}&room=${j.room}`));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => s.send(P.encodeHello(token, name, look));
      ws.onerror = () => reject(new Error('connection failed'));
      ws.onclose = () => { s.closed = true; };
      ws.onmessage = (e) => { if (typeof e.data === 'string') return; s.receive(e.data as ArrayBuffer); if (s.id && s.myTick) resolve(); };
    });
    s.pingTimer = setInterval(() => s.send(P.encodePing(Date.now())), 2000); // clock sync every 2 s
    s.send(P.encodePing(Date.now()));
    return s;
  }
  roomId = '';

  close(): void { if (this.pingTimer) clearInterval(this.pingTimer); if (this.pump) clearInterval(this.pump); this.ws.close(); this.closed = true; }
  serverNow(): number { return Date.now() + this.offset; }
  emote(n: number): void { this.send(P.encodeEmote(n)); }

  // ---- transport, with an optional bad-network shim for the chaos test
  private send(data: ArrayBuffer, droppable = false): void {
    if (this.ws.readyState !== 1) return;
    if (!this.chaos) { this.ws.send(data); return; }
    if (droppable && Math.random() < this.chaos.loss) return;
    this.queue(this.outQ, data);
  }
  private receive(data: ArrayBuffer): void { if (this.chaos) this.queue(this.inQ, data, Math.random() < this.chaos.loss ? 200 : 0); else this.handle(data); }
  private queue(q: { at: number; data: ArrayBuffer }[], data: ArrayBuffer, extra = 0): void {
    const c = this.chaos!, at = Math.max(q.length ? q[q.length - 1].at : 0, Date.now() + c.latency / 2 + (Math.random() * 2 - 1) * c.jitter / 2 + extra); // in order, like TCP
    q.push({ at, data });
    this.pump ??= setInterval(() => {
      const now = Date.now();
      while (this.outQ.length && this.outQ[0].at <= now) { const m = this.outQ.shift()!; if (this.ws.readyState === 1) this.ws.send(m.data); }
      while (this.inQ.length && this.inQ[0].at <= now) this.handle(this.inQ.shift()!.data);
    }, 4);
  }

  private handle(data: ArrayBuffer): void {
    const v = new DataView(data);
    this.bytesIn += data.byteLength;
    if (v.getUint8(0) !== P.PROTOCOL) return;
    const type = v.getUint8(1);
    if (type === P.Msg.Welcome) { const w = P.decodeWelcome(v); this.id = w.id; this.seed = w.seed; this.spot = Object.values(BREAKS).find((b) => b.id === w.spot) ?? BREAKS.canoes; this.offset = w.serverTime - Date.now(); this.myTick = tickAt(this.serverNow()) + 2; }
    else if (type === P.Msg.Pong) {
      // Keep the offset from the samples with the least delay; they are the least distorted.
      const p = P.decodePong(v), now = Date.now(), rtt = now - p.clientTime, off = p.serverTime + rtt / 2 - now;
      this.jitter += (Math.abs(rtt - this.rtt) - this.jitter) * 0.2; this.rtt += (rtt - this.rtt) * 0.3;
      this.bestRtt = Math.min(this.bestRtt * 1.02 + 0.5, rtt);
      if (rtt <= this.bestRtt * 1.25) this.offset += (off - this.offset) * 0.35;
    }
    else if (type === P.Msg.Roster) for (const e of P.decodeRoster(v)) this.roster.set(e.id, e);
    else if (type === P.Msg.Event) { const e = P.decodeEvent(v); if (e.kind === P.EvKind.Leave) { this.roster.delete(e.a); this.tracks.delete(e.a); } this.onEvent(e); }
    else if (type === P.Msg.Snapshot) this.snapshot(v);
  }

  private world(tick: number): World {
    const t = tickTime(tick);
    let waves = this.waveCache.get(tick);
    if (!waves) { waves = activeWaves(this.seed, t, this.spot); this.waveCache.set(tick, waves); if (this.waveCache.size > 80) this.waveCache.delete(this.waveCache.keys().next().value!); }
    const now = t * 1000;
    if (Math.abs(now - this.env.at) > 2000) this.env = { at: now, night: nightFactor(sunPosition(now).elevation, T.night.fullAt), guard: towerOpen(now, T.lifeguard.open, T.lifeguard.close) };
    return { t, waves, spot: this.spot, night: this.env.night, guard: this.env.guard };
  }

  private snapshot(v: DataView): void {
    const authoritative = newSurfer(), snap = P.decodeSnapshot(v, authoritative);
    if (snap.tick <= this.ackTick) return;
    this.ackTick = snap.tick; this.respect = snap.respect; this.snapshots++; this.lastSnapAt = Date.now();
    // Reconcile: take the server's state for tick T, replay the inputs it has not seen yet, and ease out the difference.
    const bx = this.me.x, bz = this.me.z;
    for (let k = snap.tick + 1; k <= this.myTick; k++) stepSurfer(authoritative, this.inputs.get(k) ?? this.input, this.world(k));
    this.me = authoritative;
    for (const k of this.inputs.keys()) if (k <= snap.tick) this.inputs.delete(k);
    const ex = bx - this.me.x, ez = bz - this.me.z, err = Math.hypot(ex, ez);
    if (this.snapshots > 3) this.corrections.push(err);
    if (this.corrections.length > 6000) this.corrections.shift();
    if (err > 2) { this.ox = 0; this.oz = 0; } else { this.ox += ex; this.oz += ez; }
    // Everyone else: record where they were at this tick. Unchanged surfers are not resent, so carry them forward.
    const t = tickTime(snap.tick), seen = new Set<number>();
    for (const r of snap.others) { seen.add(r.id); const tr = this.tracks.get(r.id) ?? []; tr.push({ t, r }); if (tr.length > 24) tr.shift(); this.tracks.set(r.id, tr); }
    for (const [id, tr] of this.tracks) if (!seen.has(id) && tr.length) { tr.push({ t, r: tr[tr.length - 1].r }); if (tr.length > 24) tr.shift(); }
  }

  /** Call every frame. Runs prediction up to the tick the server needs next and sends one input per tick. */
  update(sample: () => Input, dt: number): void {
    if (!this.id || this.closed) return;
    const lead = this.rtt / 2 + this.jitter + 60; // be this far ahead of the server so inputs arrive in time
    const target = tickAt(this.serverNow() + lead);
    if (target - this.myTick > 20) this.myTick = target - 1; // tab was asleep
    while (this.myTick < target) {
      this.myTick++;
      const p1 = this.inputs.get(this.myTick - 1) ?? this.input, p2 = this.inputs.get(this.myTick - 2) ?? p1;
      this.input = sample();
      this.inputs.set(this.myTick, this.input);
      this.send(P.encodeInput(this.myTick, Date.now(), [{ tick: this.myTick, ...this.input }, { tick: this.myTick - 1, ...p1 }, { tick: this.myTick - 2, ...p2 }]), true);
      stepSurfer(this.me, this.input, this.world(this.myTick));
    }
    const k = Math.exp(-dt / 0.12); // corrections fade over 100-200 ms
    this.ox *= k; this.oz *= k;
  }
  /** Seconds the drawn frame is past the last predicted tick (for smooth drawing between ticks). */
  ahead(): number { const lead = this.rtt / 2 + this.jitter + 60; return Math.max(0, Math.min(T.tick, (this.serverNow() + lead) / 1000 - tickTime(this.myTick))); }

  /**
   * Where another surfer is right now, drawn about 100 ms in the past so there is always a sample on each side.
   * Surfers close to you are drawn nearer to the present instead (extrapolated, never more than 200 ms), so that
   * when the server calls a bump the two boards are touching on your screen too.
   */
  remote(id: number): RemoteView | null {
    const tr = this.tracks.get(id);
    if (!tr?.length) return null;
    const newest = tr[tr.length - 1].r, near = 1 - Math.max(0, Math.min(1, (Math.hypot(newest.x - this.me.x, newest.z - this.me.z) - 4) / 5));
    const delay = (Math.min(250, Math.max(100, 60 + this.jitter * 2 + T.tick * 1000)) / 1000) * (1 - near) - near * Math.min(0.12, this.rtt / 2000), rt = this.serverNow() / 1000 - this.rtt / 2000 - delay;
    let i = tr.length - 1;
    while (i > 0 && tr[i - 1].t > rt) i--;
    const b = tr[i], a = tr[Math.max(0, i - 1)];
    if (rt >= b.t) { // past the newest sample: extrapolate, but never more than 200 ms
      const e = Math.min(0.2, rt - b.t);
      return { ...b.r, x: b.r.x + Math.cos(b.r.heading) * b.r.speed * e * (b.r.state === 6 ? 0 : 1), z: b.r.z + Math.sin(b.r.heading) * b.r.speed * e * (b.r.state === 6 ? 0 : 1), visible: true };
    }
    const u = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1, dh = Math.atan2(Math.sin(b.r.heading - a.r.heading), Math.cos(b.r.heading - a.r.heading));
    return { ...b.r, x: a.r.x + (b.r.x - a.r.x) * u, z: a.r.z + (b.r.z - a.r.z) * u, heading: a.r.heading + dh * u, speed: a.r.speed + (b.r.speed - a.r.speed) * u, stance: a.r.stance + (b.r.stance - a.r.stance) * u, visible: true };
  }
  remoteIds(): number[] { return [...this.tracks.keys()]; }
  /** Largest jump between consecutive samples of any other surfer, in meters (teleport check). */
  maxRemoteStep(): number { let m = 0; for (const tr of this.tracks.values()) for (let i = 1; i < tr.length; i++) if (tr[i].t - tr[i - 1].t < 0.11) m = Math.max(m, Math.hypot(tr[i].r.x - tr[i - 1].r.x, tr[i].r.z - tr[i - 1].r.z)); return m; }
}
