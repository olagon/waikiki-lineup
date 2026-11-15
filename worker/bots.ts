// Bots live in the room on the server. They send the same inputs a human would, through the same physics.
// Each has a look, a board and a temperament; none of them cheats.
import { TUNING as T } from '../shared/tuning';
import { B, St, isRiding, timeToWhitewater, type Input, type World } from '../shared/physics';
import { newPilot, pilotInput, type Pilot } from '../shared/autopilot';
import { breakDelay, crestZ, peelDir, type Wave } from '../shared/waves';
import { ARCHETYPE_LOOKS } from '../shared/looks';
import { EvKind } from '../shared/protocol';
import { Emote, type Member, type Sim } from './sim';

const NAMES = ['Keoni', 'Leilani', 'Kai', 'Malia', 'Noa', 'Kimo', 'Makoa', 'Lani', 'Koa', 'Pua', 'Mele', 'Sione', 'Jun', 'Emi', 'Mika', 'Ben', 'Tasha', 'Carlos', 'Nohea', 'Ikaika'];
// Who is out, in the order they are added. Lessons are a daytime thing, so the instructor and student go home at night.
const DAY = ['uncle', 'grom', 'instructor', 'student', 'charger', 'aunty', 'tourist', 'grom'], NIGHT = ['uncle', 'grom', 'charger', 'aunty', 'tourist', 'aunty', 'charger', 'grom'];

interface Temper { setOnly: boolean; depth: number; off: number; aggression: number; skill: number; friendly: number; style: number }
const TEMPER: Record<string, Temper> = {
  uncle: { setOnly: true, depth: 4, off: 3, aggression: 0.05, skill: 0.95, friendly: 0.6, style: 1 }, // patient, best set waves, walks to the nose
  grom: { setOnly: false, depth: 0, off: 9, aggression: 0.45, skill: 0.7, friendly: 0.5, style: 0 }, // inside, lots of small ones, drops in by accident
  charger: { setOnly: true, depth: 5, off: 1, aggression: 0.4, skill: 0.9, friendly: 0.3, style: 0 }, // sits deepest, paddles hard, snakes sometimes
  aunty: { setOnly: false, depth: 3, off: 6, aggression: 0, skill: 0.9, friendly: 0.95, style: 1 }, // smooth, clean waves, friendly with everyone
  tourist: { setOnly: false, depth: 2, off: 22, aggression: 0.1, skill: 0.35, friendly: 0.7, style: 0 }, // out on the shoulder
  instructor: { setOnly: false, depth: -46, off: 14, aggression: 0, skill: 0.9, friendly: 1, style: 0 },
  student: { setOnly: false, depth: -46, off: 12, aggression: 0, skill: 0.2, friendly: 1, style: 0 },
};

interface Bot {
  m: Member; kind: string; pilot: Pilot; slot: number; temper: Temper;
  decided: Map<number, boolean>; // wave -> going for it or letting it go
  grudge: Map<number, number>; // who dropped in on me, and how often
  react: number; skipDive: boolean; lastHit: number; // this wave's hesitation; whether we misjudge the next whitewater
  say: { e: number; at: number }[]; // emotes queued with a little human delay
  rideLeft: number; hooted: boolean; // student and instructor
}

export class Bots {
  private bots = new Map<number, Bot>();
  constructor(private sim: Sim) {}

  /** Keep the lineup alive: at least five bots, more when few humans are out. */
  manage(w: World): void {
    for (const [id] of this.bots) if (!this.sim.members.has(id)) this.bots.delete(id);
    const humans = this.sim.humans().length, kinds = this.sim.night > 0.5 ? NIGHT : DAY;
    const want = Math.max(T.rooms.minBots, humans < T.rooms.fillBelowHumans ? T.rooms.fillTo - humans : 0);
    // Day turns to night: the lesson ends. Paddle them in by removing them once they are not mid-ride.
    for (const b of this.bots.values()) if (!kinds.includes(b.kind) && !isRiding(b.m.s)) { this.sim.remove(b.m); this.bots.delete(b.m.id); }
    while (this.bots.size < want) {
      const taken = new Set([...this.bots.values()].map((b) => b.slot));
      let slot = 0; while (taken.has(slot)) slot++;
      const kind = kinds[slot % kinds.length], temper = TEMPER[kind], used = new Set([...this.sim.members.values()].map((m) => m.name));
      const m = this.sim.addBot(NAMES.find((n) => !used.has(n)) ?? 'Kai', ARCHETYPE_LOOKS[kind]);
      // Spread across the peak, already out in the water when a human arrives.
      const side = slot % 2 ? 1 : -1, gx = w.spot.centerX + side * (temper.off + slot * 1.5), gz = w.spot.zb + temper.depth + (slot % 3) * 1.2;
      m.s.x = gx; m.s.z = gz; m.s.state = St.Sit;
      this.bots.set(m.id, { m, kind, temper, pilot: newPilot(gx, gz, side * (temper.off + slot * 1.5)), slot, decided: new Map(), grudge: new Map(), react: 0, skipDive: false, lastHit: -1, say: [], rideLeft: 0, hooted: false });
    }
  }

  input(m: Member, w: World): Input {
    const b = this.bots.get(m.id);
    if (!b) return { buttons: 0, steer: 0 };
    const s = m.s, rng = this.sim.rng, night = this.sim.night;
    m.intent = b.pilot.target;
    while (b.say.length && b.say[0].at <= w.t) this.sim.emote(m, b.say.shift()!.e);
    if (b.kind === 'student' || b.kind === 'instructor') return this.lesson(b, w);

    // Each new piece of whitewater: decide once whether we misjudge it (less skill, more misses).
    if (s.hitWave !== b.lastHit) { b.lastHit = s.hitWave; b.skipDive = rng() < (1 - b.temper.skill) * 0.5; }
    const inp = pilotInput(s, w, b.pilot, {
      style: b.temper.style, skipDive: b.skipDive, react: b.react,
      allow: (wave) => this.goFor(b, wave, w),
    });
    // Steer around humans in the way, most of the time.
    if (s.state === St.Paddle && !isRiding(s)) for (const h of this.sim.humans()) {
      const dx = h.s.x - s.x, dz = h.s.z - s.z, d = Math.hypot(dx, dz), ahead = dx * Math.cos(s.heading) + dz * Math.sin(s.heading);
      if (d < 5 && ahead > 0.5 && (m.id * 7 + Math.floor(w.t / 4)) % 20 < 17) inp.steer = Math.max(-1, Math.min(1, inp.steer + (dx * Math.sin(s.heading) - dz * Math.cos(s.heading) > 0 ? 0.9 : -0.9)));
    }
    // At night everyone is a touch more careful.
    if (night > 0.5 && s.lift > 0 && b.react === 0) b.react = 0.08;
    return inp;
  }

  /** Should this bot go for that wave? Taste, then etiquette: usually yield to whoever is deeper. */
  private goFor(b: Bot, wave: Wave, w: World): boolean {
    const known = b.decided.get(wave.id);
    if (known !== undefined) return known;
    const rng = this.sim.rng, t = b.temper;
    let go = (!t.setOnly || wave.set) && rng() < (this.sim.night > 0.5 ? 0.65 : 0.95);
    if (go) {
      const dir = peelDir(wave, b.m.s.x), mine = breakDelay(wave, b.m.s.x);
      for (const o of this.sim.members.values()) {
        if (o === b.m || peelDir(wave, o.s.x) !== dir) continue;
        const going = o.intent === wave.id || (o.s.waveId === wave.id && (o.s.lift > 0 || isRiding(o.s)));
        if (!going || breakDelay(wave, o.s.x) >= mine) continue;
        // Someone deeper wants it. Yield, unless they gave it away, or we are the type who goes anyway.
        const lowRespect = !o.bot && o.respect < 35, pushy = rng() < t.aggression + (b.grudge.get(o.id) ?? 0) * 0.15 + (lowRespect ? 0.4 : 0);
        if (!this.sim.isShared(wave.id) && !pushy) go = false;
      }
    }
    // A blown takeoff now and then, in proportion to skill.
    b.react = go && rng() < (1 - t.skill) * 0.4 ? 0.45 + rng() * 0.5 : 0;
    // Friendly surfers with priority sometimes wave a nearby human onto it.
    if (go && rng() < t.friendly * 0.25) { const h = this.sim.humans().find((x) => Math.hypot(x.s.x - b.m.s.x, x.s.z - b.m.s.z) < 14 && x.respect >= 35 && !(b.grudge.get(x.id) ?? 0)); if (h) b.say.push({ e: Emote.Go, at: w.t + 0.4 }); }
    // The friendliest surfers also share with whoever is next to them: "go, go!" makes it a party wave.
    if (go && t.friendly > 0.9 && rng() < 0.75 && [...this.bots.values()].some((x) => x !== b && Math.hypot(x.m.s.x - b.m.s.x, x.m.s.z - b.m.s.z) < 22)) b.say.push({ e: Emote.Go, at: w.t + 1.5 });
    b.decided.set(wave.id, go);
    if (b.decided.size > 24) b.decided.delete(b.decided.keys().next().value!);
    return go;
  }

  /** The beach-boy instructor and the student: inside, on the whitewater, one soft wave after another. */
  private lesson(b: Bot, w: World): Input {
    const s = b.m.s, rng = this.sim.rng, student = [...this.bots.values()].find((x) => x.kind === 'student');
    const turn = (want: number, gain = 2.5) => Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)) * gain));
    if (b.kind === 'instructor') {
      // Stay just behind and beside the student; call them into waves; hoot when they stand.
      const gx = student ? student.m.s.x + 3.8 : b.pilot.goalX, gz = student ? student.m.s.z + 0.6 : b.pilot.goalZ, d = Math.hypot(gx - s.x, gz - s.z);
      if (student && isRiding(student.m.s) && student.m.s.rideTime > 2 && !b.hooted) { b.hooted = true; b.say.push({ e: Emote.Hoot, at: w.t + 0.2 }); }
      if (student && !isRiding(student.m.s)) b.hooted = false;
      if (student && timeToWhitewater(w, student.m.s.x, student.m.s.z) < 2.4 && student.m.s.state === St.Sit && rng() < 0.2) b.say.push({ e: Emote.Go, at: w.t });
      const hit = timeToWhitewater(w, s.x, s.z);
      if (hit < 0.7 || (s.state === St.Turtle && hit < 1.2)) return { buttons: s.state === St.Sit ? B.sit : B.dive, steer: 0 };
      if (d > (s.state === St.Sit ? 5 : 1.5)) return s.state === St.Sit ? { buttons: B.sit, steer: 0 } : { buttons: B.paddle, steer: turn(Math.atan2(gz - s.z, gx - s.x)) };
      return s.state === St.Sit ? { buttons: 0, steer: turn(Math.PI / 2, 1.5) } : { buttons: s.speed < 0.6 ? B.sit : 0, steer: 0 };
    }
    // Student: ride straight, step off after a few seconds, fall a lot, paddle back, do it again.
    if (isRiding(s)) { if (b.rideLeft <= 0) b.rideLeft = 2.2 + rng() * 3; b.rideLeft -= T.tick; return { buttons: b.rideLeft <= 0.05 ? B.kick : 0, steer: turn(-Math.PI / 2, 2) }; }
    b.rideLeft = 0;
    if (s.state !== St.Paddle && s.state !== St.Sit) return { buttons: 0, steer: 0 };
    if (s.lift > 0) return { buttons: (s.lift < T.catch.popWindow * 1.6 - b.react ? B.action : 0) | B.paddle, steer: turn(-Math.PI / 2) };
    const hit = timeToWhitewater(w, s.x, s.z), d = Math.hypot(b.pilot.goalX - s.x, b.pilot.goalZ - s.z);
    if (hit < 2.6 && d < 14) { // whitewater coming: turn in and paddle
      if (hit > 2.4) b.react = rng() < 0.45 ? 1.2 : 0.1; // nearly half the time, too slow getting up
      if (s.state === St.Sit) return { buttons: B.sit, steer: 0 };
      const aim = turn(-Math.PI / 2);
      return { buttons: B.paddle, steer: Math.abs(aim) < 0.3 ? (Math.floor(w.t * 5) % 2 ? 1 : -1) : aim };
    }
    if (d > 3) return s.state === St.Sit ? { buttons: B.sit, steer: 0 } : { buttons: B.paddle, steer: turn(Math.atan2(b.pilot.goalZ - s.z, b.pilot.goalX - s.x)) };
    return s.state === St.Sit ? { buttons: 0, steer: turn(Math.PI / 2, 1.5) } : { buttons: s.speed < 0.6 ? B.sit : 0, steer: 0 };
  }

  /** React to what happened this tick: hoot good rides, call out drop-ins, tell a hurt human where to go. */
  afterStep(w: World): void {
    const near = (x: number, z: number, max: number, skip?: number) => [...this.bots.values()].filter((b) => b.m.id !== skip && !isRiding(b.m.s) && Math.hypot(b.m.s.x - x, b.m.s.z - z) < max).sort((p, q) => Math.hypot(p.m.s.x - x, p.m.s.z - z) - Math.hypot(q.m.s.x - x, q.m.s.z - z));
    for (const e of this.sim.events) {
      const a = this.sim.members.get(e.a), bo = this.sim.members.get(e.b);
      if (e.kind === EvKind.RideScore && a && e.value >= 4.5) near(a.s.x, a.s.z, 60, a.id).filter((b) => this.sim.rng() < b.temper.friendly).slice(0, 2).forEach((b, i) => b.say.push({ e: Emote.Hoot, at: w.t + 0.3 + i * 0.5 }));
      if (e.kind === EvKind.DropIn && a && bo) {
        const victim = this.bots.get(bo.id), offender = this.bots.get(a.id);
        if (victim) { victim.grudge.set(a.id, (victim.grudge.get(a.id) ?? 0) + 1); victim.say.push({ e: Emote.Point, at: w.t + 0.5 }); } // "Eh!" (the client voices it)
        if (offender) offender.say.push({ e: Emote.Shaka, at: w.t + 1.6 }); // sorry, sorry
        for (const b of near(bo.s.x, bo.s.z, 30, bo.id)) if (b.kind === 'uncle' && b !== victim) b.grudge.set(a.id, (b.grudge.get(a.id) ?? 0) + 1); // uncle saw that
      }
      if (e.kind === EvKind.ReefCut && a && !a.bot) near(a.s.x, a.s.z, 80)[0]?.say.push({ e: Emote.Point, at: w.t + 1.2 }); // go see the lifeguard
    }
    // Bots with a grudge or facing low Respect sit a little deeper than that human.
    if (this.sim.tick % 40 === 0) for (const b of this.bots.values()) {
      if (b.kind === 'student' || b.kind === 'instructor') continue;
      const rude = this.sim.humans().find((h) => h.respect < 35 || (b.grudge.get(h.id) ?? 0) > 0);
      b.pilot.goalZ = w.spot.zb + b.temper.depth + (b.slot % 3) * 1.2 + (rude ? 2 : 0);
      if (rude && Math.abs(rude.s.z - w.spot.zb) < 12) b.pilot.goalX += Math.sign(w.spot.centerX - b.pilot.goalX || 1) * 0.5; // edge toward the peak, inside of them
    }
  }

  onEmote(from: Member, e: number): void {
    const t = this.sim.world?.t ?? 0, b = [...this.bots.values()].filter((x) => !isRiding(x.m.s)).sort((p, q) => Math.hypot(p.m.s.x - from.s.x, p.m.s.z - from.s.z) - Math.hypot(q.m.s.x - from.s.x, q.m.s.z - from.s.z))[0];
    if (!b || Math.hypot(b.m.s.x - from.s.x, b.m.s.z - from.s.z) > 30 || this.sim.rng() > 0.5 + b.temper.friendly * 0.5) return;
    const reply = e === Emote.Shaka || e === Emote.Hoot ? Emote.Shaka : e === Emote.Laugh ? Emote.Laugh : e === Emote.Splash ? Emote.Splash : e === Emote.Go ? Emote.Shaka : -1;
    if (reply >= 0) b.say.push({ e: reply, at: t + 0.6 + this.sim.rng() * 0.7 });
    if (e === Emote.Go) for (const x of this.bots.values()) if (x.pilot.target < 0) x.decided.clear(); // a given wave is worth another look
  }
  /** A wave was given away: anyone who had decided to let it go may think again. */
  onShared(waveId: number): void { for (const b of this.bots.values()) if (b.pilot.target !== waveId) b.decided.delete(waveId); }
  onCollision(a: Member, b: Member, _hit: number): void {
    const t = this.sim.world?.t ?? 0;
    for (const m of [a, b]) { const bot = this.bots.get(m.id); if (bot && this.sim.rng() < 0.4) bot.say.push({ e: this.sim.rng() < bot.temper.friendly ? Emote.Laugh : Emote.Splash, at: t + 0.8 }); }
  }
  onParty(a: Member, b: Member, w: World): void {
    for (const x of this.bots.values()) if (x.m !== a && x.m !== b && !isRiding(x.m.s) && Math.hypot(x.m.s.x - a.s.x, x.m.s.z - a.s.z) < 60 && this.sim.rng() < x.temper.friendly * 0.7) x.say.push({ e: Emote.Hoot, at: w.t + 0.4 + this.sim.rng() });
  }
}
void crestZ;
