// The room's simulation, free of any Cloudflare API so it can run (and be tested and timed) anywhere.
// worker/room.ts wraps it with sockets and snapshots.
import { TUNING as T, tickTime } from '../shared/tuning';
import { B, Ev, St, isRiding, newSurfer, rollReefCut, solid, stepSurfer, type Input, type Surfer, type World } from '../shared/physics';
import { activeWaves, breakDelay, crestZ, peelDir, type BreakSpec, type Wave } from '../shared/waves';
import { nightFactor, sunPosition, towerOpen } from '../shared/sun';
import { rngStream } from '../shared/rng';
import { Hit, RESPECT, clampRespect, gap, priorityOn, resolve } from '../shared/collisions';
import { EvKind, type InputFrame } from '../shared/protocol';
import type { Look } from '../shared/looks';
import { Bots } from './bots';

export interface Member {
  id: number; s: Surfer; name: string; look: Look; bot: boolean;
  token?: string; connected: boolean; goneAt?: number; // humans
  inputs: Map<number, InputFrame>; last: Input; paddling: boolean;
  joinedAt: number; lastCutAt: number; lastActive: number; respect: number;
  prevX: number; prevZ: number; // position before this tick, for collision substeps
  intent: number; // wave this surfer is going for, -1 none
  anchorX: number; anchorZ: number; anchorAt: number; // how long they have held their spot (snaking)
  lastHootAt: number;
  lastInputTick: number; // last tick an input frame was applied (a hidden tab stops sending)
}
export interface SimEvent { kind: number; a: number; b: number; value: number }
export const Emote = { Shaka: 0, Hoot: 1, Go: 2, Point: 3, Splash: 4, Laugh: 5 };

export class Sim {
  members = new Map<number, Member>();
  tick = 0; events: SimEvent[] = []; added: Member[] = [];
  night = 0; guard = true; world!: World;
  rng: () => number;
  readonly bots: Bots;
  private envAt = 0;
  private cool = new Map<string, number>(); // pair -> tick they may collide again
  private shared = new Set<number>(); // waves whose priority holder said "go"
  private together = new Map<string, number>(); // "wave:a:b" -> ticks both have been riding it
  private partied = new Set<string>(); private bonus = new Map<number, number>(); // member -> wave they earned a party bonus on

  constructor(public spot: BreakSpec, public seed: number, rngSeed: number) { this.rng = rngStream(rngSeed); this.bots = new Bots(this); }

  humans(): Member[] { return [...this.members.values()].filter((m) => !m.bot && m.connected); }
  private make(id: number, name: string, look: Look, bot: boolean, now: number): Member {
    const s = newSurfer(look.board);
    const m: Member = { id, s, name, look, bot, connected: !bot, inputs: new Map(), last: { buttons: 0, steer: 0 }, paddling: false, joinedAt: (bot ? tickTime(this.tick) * 1000 : now) / 1000, lastCutAt: -1e9, lastActive: now, respect: RESPECT.start,
      prevX: s.x, prevZ: s.z, intent: -1, anchorX: s.x, anchorZ: s.z, anchorAt: now / 1000, lastHootAt: -1e9, lastInputTick: this.tick };
    this.members.set(id, m); this.added.push(m);
    return m;
  }
  addHuman(name: string, look: Look, token: string, now: number): Member {
    let id = 1; while (this.members.has(id)) id++;
    // Never trust a client's look: clamp every field to what exists.
    const c = (v: number, max: number) => Math.max(0, Math.min(max, v | 0));
    const safe: Look = { skin: c(look.skin, 5), build: c(look.build, 3), hair: c(look.hair, 3), hairColor: c(look.hairColor, 3), top: c(look.top, 3), topColor: c(look.topColor, 12), shortsColor: c(look.shortsColor, 12), board: c(look.board, 2) as Look['board'], boardColor: c(look.boardColor, 12), stringer: c(look.stringer, 12) };
    const m = this.make(id, name, safe, false, now);
    m.token = token; m.s.x += (this.rng() - 0.5) * 16;
    return m;
  }
  addBot(name: string, look: Look): Member { let id = 100; while (this.members.has(id)) id++; return this.make(id, name, look, true, 0); }
  remove(m: Member): void { this.members.delete(m.id); this.events.push({ kind: EvKind.Leave, a: m.id, b: 0, value: 0 }); }
  clearBots(): void { for (const m of [...this.members.values()]) if (m.bot) this.members.delete(m.id); }
  emit(kind: number, a: number, b: number, value: number): void { this.events.push({ kind, a, b, value }); }
  respect(m: Member, d: number): void { m.respect = clampRespect(m.respect + d); }
  isShared(waveId: number): boolean { return this.shared.has(waveId); }

  /** An emote from anyone. "Go" from the surfer with priority gives the wave away: it becomes a party wave. */
  emote(m: Member, e: number): void {
    this.emit(EvKind.Emote, m.id, e, 0);
    const t = this.world?.t ?? 0;
    if (e === Emote.Go && this.world) {
      const wave = this.world.waves.find((w) => w.id === (m.s.waveId >= 0 ? m.s.waveId : m.intent));
      if (wave && !this.shared.has(wave.id) && this.deepest(wave, peelDir(wave, m.s.x)) === m) { this.shared.add(wave.id); this.respect(m, RESPECT.give); this.bots.onShared(wave.id); }
    }
    if (e === Emote.Hoot && t - m.lastHootAt > 10 && [...this.members.values()].some((o) => o !== m && isRiding(o.s) && o.s.rideTime > 2)) { m.lastHootAt = t; this.respect(m, RESPECT.hoot); }
    if (!m.bot) this.bots.onEmote(m, e);
  }

  /** Who is closest to the peak among everyone riding or going for this wave in this direction. */
  deepest(wave: Wave, dir: number): Member | undefined {
    let best: Member | undefined, bestAhead = Infinity;
    for (const m of this.members.values()) {
      if (!(m.s.waveId === wave.id && (isRiding(m.s) || m.s.lift > 0)) && m.intent !== wave.id) continue;
      if (peelDir(wave, m.s.x) !== dir) continue;
      const ahead = breakDelay(wave, m.s.x);
      if (ahead < bestAhead) { bestAhead = ahead; best = m; }
    }
    return best;
  }

  /** Advance one tick. `now` is wall-clock ms (for idle timers and day/night); the world time comes from the tick number. */
  step(now: number): void {
    this.tick++;
    this.events.length = 0;
    const t = tickTime(this.tick);
    if (Math.abs(now - this.envAt) > 2000) { this.envAt = now; this.night = nightFactor(sunPosition(t * 1000).elevation, T.night.fullAt); this.guard = towerOpen(t * 1000, T.lifeguard.open, T.lifeguard.close); }
    const world: World = (this.world = { t, waves: activeWaves(this.seed, t, this.spot), spot: this.spot, night: this.night, guard: this.guard });
    this.bots.manage(world);

    for (const m of this.members.values()) {
      const s = m.s;
      m.prevX = s.x; m.prevZ = s.z;
      let inp: Input;
      if (m.bot) inp = this.bots.input(m, world);
      else {
        const f = m.inputs.get(this.tick);
        if (f) { if (f.buttons !== m.last.buttons || Math.abs(f.steer - m.last.steer) > 0.1) m.lastActive = now; m.last = { buttons: f.buttons, steer: f.steer }; m.lastInputTick = this.tick; }
        else if (this.tick - m.lastInputTick > 20) m.last = { buttons: 0, steer: 0 }; // a second of silence (tab hidden, connection stalled): let go of the controls
        for (const k of m.inputs.keys()) if (k <= this.tick) m.inputs.delete(k);
        inp = m.connected ? m.last : { buttons: 0, steer: 0 };
        if (now - m.lastActive > 60000 && s.state === St.Paddle) inp = { buttons: B.sit, steer: 0 }; // idle for a minute: sit up
        // What a human is going for is read from what they are doing: prone, pointed in, paddling, wave close behind.
        m.intent = -1;
        if (s.state === St.Paddle && Math.sin(s.heading) < -0.5 && (inp.buttons & B.paddle)) for (const w of world.waves) { const d = crestZ(w, this.spot, t) - s.z; if (d > 0 && d < 16) m.intent = w.id; }
      }
      m.paddling = (inp.buttons & B.paddle) !== 0 || s.altTimer < T.paddle.altWindow;
      const before = s.cut, wasWave = s.waveId;
      stepSurfer(s, inp, world);
      const e = s.events;
      if (Math.hypot(s.x - m.anchorX, s.z - m.anchorZ) > 6) { m.anchorX = s.x; m.anchorZ = s.z; m.anchorAt = t; }
      if (e & Ev.lift) this.checkSnake(m, world);
      if (e & Ev.popUp) this.checkDropIn(m, world);
      if (e & Ev.wipeout) this.emit(EvKind.Wipeout, m.id, e & Ev.badWipeout ? 1 : 0, 0);
      if (e & Ev.rideEnd) {
        if (this.bonus.get(m.id) === wasWave) { s.score = Math.min(10, Math.round((s.score + 0.8) * 10) / 10); this.respect(m, RESPECT.party); }
        this.bonus.delete(m.id);
        this.emit(EvKind.RideScore, m.id, Math.min(255, Math.round(s.rideTime)), s.score);
      }
      if (e & (Ev.divePerfect | Ev.diveOk | Ev.washed | Ev.turtled)) this.emit(EvKind.Dive, m.id, e & Ev.divePerfect ? 0 : e & Ev.diveOk ? 1 : e & Ev.turtled ? 2 : 3, 0);
      // The server rolls reef cuts, so every screen agrees on who is hurt.
      if (rollReefCut(s, this.rng(), t, m.joinedAt, m.lastCutAt)) { m.lastCutAt = t; this.emit(EvKind.ReefCut, m.id, 0, 0); }
      if (before === 1 && s.cut === 2) this.emit(EvKind.Treated, m.id, this.guard ? 1 : 0, 0);
    }
    this.collide(world);
    this.party(world);
    this.bots.afterStep(world);
    if (this.tick % 600 === 0) { const live = new Set(world.waves.map((w) => w.id)); for (const id of this.shared) if (!live.has(id)) this.shared.delete(id); for (const k of this.cool.keys()) if (this.cool.get(k)! < this.tick) this.cool.delete(k); for (const k of this.together.keys()) if (!live.has(Number(k.split(':')[0]))) { this.together.delete(k); this.partied.delete(k); } }
  }

  /** Taking off in front of someone who has priority. Allowed, and noticed. */
  private checkDropIn(m: Member, w: World): void {
    const wave = w.waves.find((x) => x.id === m.s.waveId);
    if (!wave || this.shared.has(wave.id)) return;
    const dir = peelDir(wave, m.s.x), mine = breakDelay(wave, m.s.x);
    for (const o of this.members.values()) {
      // Priority belongs to whoever is closest to the breaking part and riding it or paddling for it.
      const claims = (o.s.waveId === wave.id && (isRiding(o.s) || o.s.lift > 0)) || (o.intent === wave.id && o.s.state === St.Paddle && crestZ(wave, this.spot, w.t) - o.s.z < 9);
      if (o === m || !claims || peelDir(wave, o.s.x) !== dir) continue;
      if (breakDelay(wave, o.s.x) < mine - 0.3) { this.emit(EvKind.DropIn, m.id, o.id, 0); this.respect(m, RESPECT.dropIn); return; }
    }
  }
  /** Paddling around someone who has been waiting to take the inside from them. */
  private checkSnake(m: Member, w: World): void {
    const wave = w.waves.find((x) => x.id === m.s.waveId);
    if (!wave || w.t - m.anchorAt > 6) return;
    const pk = wave.peaks[0];
    for (const o of this.members.values()) {
      if (o === m || !(o.s.state === St.Sit || o.intent === wave.id) || w.t - o.anchorAt < 15) continue;
      if (Math.hypot(o.s.x - m.s.x, o.s.z - m.s.z) < 10 && Math.abs(m.s.x - pk.x) < Math.abs(o.s.x - pk.x)) { this.emit(EvKind.DropIn, m.id, o.id, 1); this.respect(m, RESPECT.snake); return; }
    }
  }

  private collide(w: World): void {
    const list = [...this.members.values()].filter((m) => solid(m.s));
    for (const u of [0.5, 1]) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.s.x - b.s.x) > 8 || Math.abs(a.s.z - b.s.z) > 8) continue;
      const key = a.id + ':' + b.id;
      if (!solid(a.s) || !solid(b.s)) continue;
      const lerp = (p: number, c: number) => p + (c - p) * u;
      const g = gap(a.s, b.s, lerp(a.prevX, a.s.x), lerp(a.prevZ, a.s.z), lerp(b.prevX, b.s.x), lerp(b.prevZ, b.s.z));
      if (g > 0) continue;
      // Boards never sit inside each other: two paddlers in contact are eased apart every tick, event or not.
      if (!isRiding(a.s) && !isRiding(b.s)) { const dx = a.s.x - b.s.x, dz = a.s.z - b.s.z, d = Math.hypot(dx, dz) || 1, push = Math.min(0.12, -g / 2 + 0.01); a.s.x += (dx / d) * push; a.s.z += (dz / d) * push; b.s.x -= (dx / d) * push; b.s.z -= (dz / d) * push; }
      if ((this.cool.get(key) ?? 0) > this.tick) continue;
      const wave = w.waves.find((x) => x.id === (isRiding(a.s) ? a.s.waveId : b.s.waveId));
      let pa = false, pb = false;
      if (wave && isRiding(a.s) && isRiding(b.s) && a.s.waveId === b.s.waveId && !this.shared.has(wave.id)) { const pr = priorityOn(wave, w.t, [a.s, b.s], peelDir(wave, a.s.x)); pa = pr === 0; pb = pr === 1; }
      const c = resolve(a.s, b.s, w, wave, pa, pb);
      if (!c) continue;
      this.cool.set(key, this.tick + 30);
      this.emit(EvKind.Collision, a.id, b.id, c.hit);
      this.together.delete(`${a.s.waveId}:${key}`); this.partied.add(`${wave?.id}:${key}`); // a crash is not a clean party wave
      if (c.fault) { const who = c.fault === 1 ? a : b; this.respect(who, c.hit === Hit.TakeoffBump ? RESPECT.bumpOff : RESPECT.dropIn); this.emit(EvKind.DropIn, who.id, (c.fault === 1 ? b : a).id, 2); }
      this.bots.onCollision(a, b, c.hit);
    }
  }

  /** Two or more riding the same wave cleanly for two seconds: a party wave. */
  private party(w: World): void {
    const riders = [...this.members.values()].filter((m) => m.s.state === St.Ride);
    for (let i = 0; i < riders.length; i++) for (let j = i + 1; j < riders.length; j++) {
      const a = riders[i], b = riders[j];
      if (a.s.waveId !== b.s.waveId) continue;
      const key = `${a.s.waveId}:${a.id}:${b.id}`, n = (this.together.get(key) ?? 0) + 1;
      this.together.set(key, n);
      if (n * T.tick >= 2 && !this.partied.has(key)) { this.partied.add(key); this.bonus.set(a.id, a.s.waveId); this.bonus.set(b.id, b.s.waveId); this.emit(EvKind.Party, a.id, b.id, 0); this.bots.onParty(a, b, w); }
    }
  }
}
