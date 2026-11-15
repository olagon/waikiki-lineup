import { DurableObject } from 'cloudflare:workers';
import { TUNING as T, tickAt } from '../shared/tuning';
import { BREAKS, roomSeed, type BreakSpec } from '../shared/waves';
import * as P from '../shared/protocol';
import type { Look } from '../shared/looks';
import { Sim, type Member } from './sim';

const MAX_MSGS_PER_SEC = 60, REJOIN_MS = 30000, IDLE_KICK_MS = 300000, KEYFRAME_TICKS = 40;
interface Conn { ws: WebSocket; sent: Map<number, string>; msgs: number; msgWindow: number }

/** One break, one room: the authority on everything that matters. Ticks only while a human is connected. */
export class Room extends DurableObject<Env> {
  private sim: Sim | null = null; private spot: BreakSpec = BREAKS.canoes; private roomId = '';
  private conns = new Map<number, Conn>(); // member id -> socket
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventId = 0; private stepMs: number[] = []; private errors = 0; private lastReport = 0;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!this.sim) {
      this.spot = BREAKS[url.searchParams.get('break') ?? 'canoes'] ?? BREAKS.canoes;
      this.roomId = url.searchParams.get('room') ?? 'x';
      this.sim = new Sim(this.spot, roomSeed(this.spot.name + ':' + this.roomId), Date.now() >>> 0);
    }
    if (url.pathname.endsWith('/stats')) {
      const s = [...this.stepMs].sort((a, b) => a - b);
      return Response.json({ tick: this.sim.tick, members: this.sim.members.size, humans: this.conns.size, p50: s[s.length >> 1] ?? 0, p99: s[Math.floor(s.length * 0.99)] ?? 0, max: s[s.length - 1] ?? 0, errors: this.errors });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (this.conns.size >= T.rooms.maxHumans) return new Response('room full', { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // hibernation API: the object can sleep with sockets open
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private memberOf(ws: WebSocket): Member | undefined { const id = (ws.deserializeAttachment() as { id?: number } | null)?.id; const c = id === undefined ? undefined : this.conns.get(id); return c && c.ws === ws ? this.sim?.members.get(id!) : undefined; }

  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    try {
      const sim = this.sim;
      if (!sim || typeof data === 'string' || data.byteLength < 2 || data.byteLength > 256) return;
      const v = new DataView(data);
      if (v.getUint8(0) !== P.PROTOCOL) { ws.close(4000, 'protocol version'); return; }
      const type = v.getUint8(1), now = Date.now();
      if (type === P.Msg.Hello) { if (data.byteLength >= 45) this.join(ws, P.decodeHello(v), now); return; }
      const m = this.memberOf(ws), c = m && this.conns.get(m.id);
      if (!m || !c) return;
      // Rate limit: anything past 60 messages a second is dropped.
      if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgs = 0; }
      if (++c.msgs > MAX_MSGS_PER_SEC) return;
      if (type === P.Msg.Input && data.byteLength === 16) {
        const inp = P.decodeInput(v);
        if (inp.tick > sim.tick + 40 || inp.tick < sim.tick - 40) return; // nonsense timing
        for (const f of inp.frames) if (f.tick > sim.tick && !m.inputs.has(f.tick)) m.inputs.set(f.tick, { tick: f.tick, buttons: f.buttons & 127, steer: Math.max(-1, Math.min(1, f.steer)) });
        if (m.inputs.size > 64) m.inputs.clear();
      } else if (type === P.Msg.Ping && data.byteLength === 10) ws.send(P.encodePong(v.getFloat64(2, true), now));
      else if (type === P.Msg.Emote && data.byteLength === 3) { m.lastActive = now; sim.emote(m, v.getUint8(2) % 6); this.flush(); }
    } catch (e) { this.errors++; console.error('message', e); }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const m = this.memberOf(ws);
    if (m) { this.conns.delete(m.id); m.connected = false; m.goneAt = Date.now(); m.last = { buttons: 0, steer: 0 }; }
    if (!this.conns.size) this.stop();
    this.report();
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }

  private join(ws: WebSocket, hello: { token: string; name: string; look: Look }, now: number): void {
    const sim = this.sim!;
    // Same token within 30 s: you get your surfer back, still in the water.
    let m = [...sim.members.values()].find((x) => !x.bot && x.token === hello.token && !x.connected && now - (x.goneAt ?? now) < REJOIN_MS);
    m ??= sim.addHuman(hello.name, hello.look, hello.token, now);
    m.connected = true; m.goneAt = undefined; m.lastActive = now;
    this.conns.set(m.id, { ws, sent: new Map(), msgs: 0, msgWindow: now });
    ws.serializeAttachment({ id: m.id });
    this.start();
    ws.send(P.encodeWelcome({ id: m.id, seed: sim.seed, spot: this.spot.id, serverTime: now, tick: sim.tick }));
    ws.send(P.encodeRoster([...sim.members.values()].map((x) => ({ id: x.id, bot: x.bot, name: x.name, look: x.look }))));
    this.flush();
    this.report();
  }

  private send(ws: WebSocket, data: ArrayBuffer): void { try { ws.send(data); } catch { /* closing */ } }
  /** Send out whatever the simulation produced: new roster entries and events, reliably and in order. */
  private flush(): void {
    const sim = this.sim!;
    if (sim.added.length) { const r = P.encodeRoster(sim.added.map((x) => ({ id: x.id, bot: x.bot, name: x.name, look: x.look }))); for (const c of this.conns.values()) this.send(c.ws, r); sim.added.length = 0; }
    for (const e of sim.events) { const d = P.encodeEvent({ id: ++this.eventId, tick: sim.tick, ...e }); for (const c of this.conns.values()) this.send(c.ws, d); }
    sim.events.length = 0;
  }

  private start(): void {
    if (this.timer) return;
    const sim = this.sim!;
    sim.tick = tickAt(Date.now());
    this.timer = setInterval(() => { try { const target = tickAt(Date.now()); if (target - sim.tick > 5) sim.tick = target - 1; while (sim.tick < target) this.step(); } catch (e) { this.errors++; console.error('tick', e); } }, T.tick * 1000);
  }
  /** Last human left: stop ticking so the object can hibernate. Bots are forgotten and respawn plausibly on the next join. */
  private stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.sim?.clearBots(); }

  private step(): void {
    const sim = this.sim!, t0 = performance.now(), now = Date.now();
    sim.step(now);
    this.flush();
    // Snapshots: your own exact state every tick; others only when they changed, all of them every two seconds.
    const full = sim.tick % KEYFRAME_TICKS === 0, buf = new DataView(new ArrayBuffer(P.REMOTE_BYTES)), recs = new Map<number, { r: P.Remote; key: string }>();
    for (const m of sim.members.values()) {
      const r: P.Remote = { id: m.id, state: m.s.state, paddling: m.paddling, cut: m.s.cut, bot: m.bot, x: m.s.x, z: m.s.z, heading: m.s.heading, speed: m.s.speed, waveId: m.s.waveId < 0 ? -1 : m.s.waveId & 0xffff, stance: m.s.stance, stamina: m.s.stamina, respect: m.respect };
      P.writeRemote(buf, 0, r);
      recs.set(m.id, { r, key: String.fromCharCode(...new Uint8Array(buf.buffer)) });
    }
    for (const [id, c] of this.conns) {
      const m = sim.members.get(id);
      if (!m) continue;
      const others: P.Remote[] = [];
      for (const [oid, rec] of recs) { if (oid === id) continue; if (full || c.sent.get(oid) !== rec.key) { others.push(rec.r); c.sent.set(oid, rec.key); } }
      this.send(c.ws, P.encodeSnapshot(sim.tick, full, m.s, m.respect, others));
    }
    // Housekeeping: forget surfers whose owners did not come back; take the idle out of the water.
    for (const m of [...sim.members.values()]) {
      if (m.bot) continue;
      if (!m.connected && now - (m.goneAt ?? now) > REJOIN_MS) sim.remove(m);
      else if (m.connected && now - m.lastActive > IDLE_KICK_MS) { const c = this.conns.get(m.id); c?.ws.close(4001, 'idle'); this.conns.delete(m.id); sim.remove(m); if (!this.conns.size) this.stop(); }
    }
    if (now - this.lastReport > 20000) this.report();
    this.stepMs.push(performance.now() - t0); if (this.stepMs.length > 2000) this.stepMs.shift();
  }

  /** Tell the lobby how many humans are here. */
  private report(): void {
    this.lastReport = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
    this.ctx.waitUntil(lobby.fetch('https://lobby/report', { method: 'POST', body: JSON.stringify({ spot: this.spot.name.toLowerCase(), room: this.roomId, humans: this.conns.size }) }).catch(() => {}));
  }
}
