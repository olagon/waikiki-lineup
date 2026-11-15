import * as THREE from 'three/webgpu';
import type { App } from './app';
import { TUNING as T } from '../shared/tuning';
import { B, Board, Ev, St, newSurfer, rollReefCut, stepSurfer, timeToWhitewater, type Input, type Surfer, type World } from '../shared/physics';
import { nightFactor, towerOpen } from '../shared/sun';
import { ARCHETYPE_LOOKS, type Look } from '../shared/looks';
import { pickWave } from '../shared/autopilot';
import { EvKind, type GameEvent } from '../shared/protocol';
import { SurferView, Figure, TREAT_SPOT } from './characters/surfer';
import { sampleInput, rumble } from './input/input';
import { Director } from './camera/director';
import { Hud } from './ui/hud';
import type { Session } from './net/session';
import { NameTag } from './characters/nametag';
import { U } from './render/env';
import { breakDelay, crestZ, peelDir } from '../shared/waves';

export interface Game { me(): Surfer; session: Session | null; others: Map<number, SurferView>; onEvent: (e: GameEvent) => void; director: Director; hud: Hud; paused: boolean; onCue: (name: string, x: number, z: number, gain: number) => void }

/**
 * The game loop. With a session, the room server is the authority and this client predicts its own surfer.
 * Without one (offline: `?offline`, shots, tests), this client is its own authority and there is nobody else out.
 */
export function createGame(app: App, look: Look, session: Session | null, rejoin?: () => Promise<Session>): Game {
  let local = newSurfer(look.board), net = session;
  const view = new SurferView(look);
  const guard = new Figure({ ...ARCHETYPE_LOOKS.instructor, top: 1, topColor: 2, shortsColor: 1 }); // generic uniform: yellow top, red shorts, no insignia
  guard.group.visible = false;
  app.scene.add(view.group, guard.group);
  const director = new Director(), hud = new Hud(), cam = new THREE.Vector3(), fwd = new THREE.Vector3();
  const others = new Map<number, SurferView>(), since = new Map<number, { state: number; at: number }>(), tags = new Map<number, NameTag>();
  const PRIORITY = { you: [1, 0.77, 0.42], other: [0.5, 0.84, 1], youCb: [1, 0.69, 0], otherCb: [0.39, 0.56, 1] };
  const joinedAt = app.now() / 1000;
  let acc = 0, paddling = false, steer = 0, lastCut = -1e9, pops = Number(localStorage.getItem('wl.pops') ?? 0), px = local.x, pz = local.z, vx = 0, vz = 0, seenTick = 0, rejoining = false;
  const game: Game = { me: () => (net ? net.me : local), session: net, others, onEvent: () => {}, director, hud, paused: false, onCue: () => {} };
  const touch = matchMedia('(pointer: coarse)').matches;
  const cb = () => { try { return JSON.parse(localStorage.getItem('wl.settings') ?? '{}').colorblind === true; } catch { return false; } };
  const sample = (): Input => { const i = sampleInput(); steer = i.steer; return i; };

  const onServerEvent = (e: GameEvent) => {
    const mine = net !== null && e.a === net.id;
    if (e.kind === EvKind.RideScore && mine) hud.score(e.value, e.b, '');
    if (e.kind === EvKind.ReefCut && mine) hud.say('Reef cut. Paddle in to the lifeguard tower.', undefined, 5);
    if (e.kind === EvKind.Leave) { const v = others.get(e.a); if (v) { app.scene.remove(v.group); others.delete(e.a); } const tg = tags.get(e.a); if (tg) { app.scene.remove(tg.sprite); tags.delete(e.a); } }
    if (e.kind === EvKind.Emote) { tags.get(e.a)?.say(e.b); if (e.b === 1 && net && (mine || others.has(e.a))) { const src = others.get(e.a)?.group.position; if (mine || (src && src.distanceTo(view.group.position) < 40 && net.me.state === St.Ride)) director.cue('long', 1.6, app.now() / 1000); } }
    const nm = (id: number) => net?.roster.get(id)?.name ?? 'someone';
    if (e.kind === EvKind.DropIn && mine) hud.say(e.value === 1 ? `You snaked ${nm(e.b)}` : `You dropped in on ${nm(e.b)}`, undefined, 2.4);
    if (e.kind === EvKind.DropIn && net && e.b === net.id) hud.say(`${nm(e.a)} dropped in on you`, undefined, 2.4);
    if (e.kind === EvKind.Party && net && (mine || e.b === net.id)) hud.say(`Party wave with ${nm(mine ? e.b : e.a)}`, undefined, 2.4);
    if (e.kind === EvKind.Emote && e.b === 3 && net && net.me.cut === 1 && net.roster.get(e.a)?.bot) hud.say(`${nm(e.a)}: go see the lifeguard`, undefined, 3);
    game.onEvent(e);
  };
  if (net) { net.onEvent = onServerEvent; app.seed = net.seed; app.spot = net.spot; }

  app.updaters.push((dt, utcMs) => {
    if (game.paused) { director.flyover(app.camera, utcMs / 1000); view.group.visible = false; return; }
    view.group.visible = true;
    const me = game.me();
    const open = towerOpen(utcMs, T.lifeguard.open, T.lifeguard.close);
    const world: World = { t: utcMs / 1000, waves: app.waves, spot: app.spot, night: nightFactor(app.env.sunElevation, T.night.fullAt), guard: open };
    let ahead: number;
    if (net) {
      // Online: everyone renders the waves at the room's clock; prediction runs inside the session.
      app.timeOffset = net.offset;
      if (net.closed && !rejoining && rejoin) { rejoining = true; hud.say('Reconnecting…', undefined, 30); rejoin().then((s) => { net = game.session = s; s.onEvent = onServerEvent; rejoining = false; hud.say('Back in the water', undefined, 2); }).catch(() => { rejoining = false; }); }
      net.update(sample, dt);
      ahead = net.ahead();
      if (net.myTick !== seenTick) { vx = (net.me.x - px) / T.tick / Math.max(1, net.myTick - seenTick); vz = (net.me.z - pz) / T.tick / Math.max(1, net.myTick - seenTick); px = net.me.x; pz = net.me.z; seenTick = net.myTick; cues(net.me.events); }
      paddling = (net.input.buttons & B.paddle) !== 0 || net.me.altTimer < T.paddle.altWindow;
    } else {
      acc += dt;
      while (acc >= T.tick) {
        const inp = sample();
        paddling = (inp.buttons & B.paddle) !== 0 || local.altTimer < T.paddle.altWindow;
        px = local.x; pz = local.z;
        stepSurfer(local, inp, world);
        vx = (local.x - px) / T.tick; vz = (local.z - pz) / T.tick;
        acc -= T.tick;
        cues(local.events);
        if (local.events & Ev.rideEnd) hud.score(local.score, local.rideTime, local.noseTime > 1 ? 'nose ride' : local.maneuvers ? `${local.maneuvers} turn${local.maneuvers > 1 ? 's' : ''}` : '');
        if (rollReefCut(local, Math.random(), world.t, joinedAt, lastCut)) { lastCut = world.t; hud.say(open ? 'Reef cut. Paddle in to the lifeguard tower.' : 'Reef cut. Paddle in and patch it up on the beach.', undefined, 5); }
      }
      ahead = acc;
    }
    hud.tick();
    hud.stamina(me.stamina, me.cut === 1);

    // Everyone else in the room.
    if (net) for (const id of net.remoteIds()) {
      const r = net.remote(id), entry = net.roster.get(id);
      if (!r || !entry) continue;
      let v = others.get(id);
      if (!v) { v = new SurferView(entry.look); others.set(id, v); const tg = new NameTag(entry.name); tags.set(id, tg); app.scene.add(v.group, tg.sprite); }
      const st = since.get(id);
      if (!st || st.state !== r.state) since.set(id, { state: r.state, at: utcMs });
      if (r.state === St.Treat) v.updateOnSand(dt, TREAT_SPOT.x + (id % 5) * 0.9, TREAT_SPOT.z - 1 - (id % 3), 0.4, !open);
      else v.update(dt, { x: r.x, z: r.z, heading: r.heading, state: r.state as St, stateTime: (utcMs - since.get(id)!.at) / 1000, speed: r.state === St.Ride ? 0 : r.speed, paddling: r.paddling, stamina: r.stamina, stance: r.stance, steer: 0 }, app);
      tags.get(id)!.update(v.group.position.x, Math.max(v.group.position.y, app.waterY(r.x, r.z)), v.group.position.z, app.camera.position, r.respect, r.cut === 1, U.exposure.value);
    }

    if (me.state === St.Treat) {
      // The lifeguard scene: surfer on the sand with the board, the guard kneeling to seal the cut. After hours, you do it yourself.
      const s = TREAT_SPOT;
      view.updateOnSand(dt, s.x, s.z, 0, !open);
      guard.group.visible = open;
      if (open) guard.update(dt, s.x + 0.85, s.z + 0.12, Math.PI, true);
      app.camera.position.lerp(cam.set(s.x - 2.6, 1.55, s.z + 4.6), 1 - Math.exp(-dt * 3));
      app.camera.lookAt(s.x + 0.9, 1.15, s.z - 0.4);
      hud.tower(0);
      return;
    }
    guard.group.visible = false;
    const riding = me.state === St.Ride || me.state === St.PopUp, ox = net ? net.ox : 0, oz = net ? net.oz : 0;
    view.update(dt, { x: me.x + ox, z: me.z + oz - (riding ? 0 : me.pushV * ahead), heading: me.heading, state: me.state, stateTime: me.stateTime, speed: me.speed, paddling, stamina: me.stamina, stance: me.stance, steer, vx: riding ? vx : undefined, vz: riding ? vz : undefined }, app, ahead);
    const p = view.group.position, surf = app.waterY(p.x, p.z), sink = me.state === St.Dive || me.state === St.Tumble ? Math.max(0, surf - p.y) : 0;
    const mode = me.state === St.PopUp || (me.state === St.Ride && me.rideTime < 0.9) ? 'takeoff' : me.state === St.Ride ? 'ride' : me.state === St.Wipeout ? 'wipeout' : 'paddle';
    // A set wave within 25 m in front while paddling: the camera drops so it looms.
    let loom = 0;
    if (mode === 'paddle' && Math.sin(me.heading) > 0.3) for (const w of app.waves) { const d = crestZ(w, app.spot, world.t) - me.z; if (w.set && d > 0 && d < 25) loom = Math.max(loom, 1 - d / 25); }
    director.update(dt, { x: p.x, y: surf, z: p.z, heading: me.heading, speed: me.speed, under: sink, mode, loom }, app.camera, utcMs / 1000);
    // The camera never gets swallowed by a wave unless the shot is meant to be under water.
    if (!(sink > 0.15) && mode !== 'wipeout') app.camera.position.y = Math.max(app.camera.position.y, app.waterY(app.camera.position.x, app.camera.position.z) + 0.45);

    // Priority glow: on the wave you are going for, in your color if it is yours, in theirs if someone is deeper.
    let glow = 0;
    if (net && (me.lift > 0 || me.state === St.Ride || me.state === St.PopUp || (me.state === St.Paddle && Math.sin(me.heading) < -0.5 && paddling))) {
      const wave = app.waves.find((w) => (me.waveId >= 0 ? w.id === me.waveId : crestZ(w, app.spot, world.t) - me.z > 0 && crestZ(w, app.spot, world.t) - me.z < 16));
      if (wave) {
        const dir = peelDir(wave, me.x), mineAhead = breakDelay(wave, me.x);
        let theirs = false;
        for (const id of net.remoteIds()) { const r = net.remote(id); if (!r || peelDir(wave, r.x) !== dir) continue; const on = r.waveId === (wave.id & 0xffff) || (r.state === St.Paddle && r.paddling && Math.sin(r.heading) < -0.5 && Math.abs(crestZ(wave, app.spot, world.t) - r.z - 6) < 8); if (on && breakDelay(wave, r.x) < mineAhead) theirs = true; }
        const c = theirs ? (cb() ? PRIORITY.otherCb : PRIORITY.other) : (cb() ? PRIORITY.youCb : PRIORITY.you);
        U.priority.value.set(c[0], c[1], c[2], 0); U.priorityAt.value.set(me.x, crestZ(wave, app.spot, world.t) - 1.5);
        glow = me.state === St.Ride ? 0.25 : 0.6;
      }
    }
    U.priority.value.w += (glow - U.priority.value.w) * (1 - Math.exp(-dt * 5));

    // First-session help, shown once each. The two catching prompts stay until three pop-ups have landed.
    if (me.state === St.Paddle && timeToWhitewater(world, me.x, me.z) < 1.3) hud.say(touch ? (me.board === Board.Short ? 'Swipe down: duck dive under the whitewater' : 'Swipe down and hold: roll under the whitewater') : me.board === Board.Short ? 'X: duck dive under the whitewater' : 'Hold X: roll under the whitewater', 'diveX', 3);
    if (me.state === St.Sit && me.z > app.spot.zb - 14 && pickWave(me, world)) hud.say(touch ? 'A wave is coming. Turn in and hold to paddle' : 'A wave is coming. Turn in and paddle (W)', pops < 3 ? undefined : 'go', 3.5);
    if (me.cut === 1) { app.camera.getWorldDirection(fwd); const side = fwd.x * (T.world.spawnZ - app.camera.position.z) - fwd.z * (T.world.towerX - app.camera.position.x); hud.tower(side > 0 ? -1 : 1); } else hud.tower(0);
  });

  /** Things you should feel the instant they happen, predicted locally. Outcomes wait for the server. */
  function cues(e: number): void {
    const me = game.me();
    if (e & Ev.lift) { rumble(0.7, 250); if (pops < 3) hud.say(touch ? 'Swipe up: pop up now' : 'Pop up now (Space)', undefined, 1); game.onCue('lift', me.x, me.z, 1); }
    if (e & Ev.popUp) { localStorage.setItem('wl.pops', String(++pops)); game.onCue('popUp', me.x, me.z, 1); const w = app.waves.find((x) => x.id === me.waveId); if (w && w.set && w.h >= Math.max(...app.waves.map((x) => x.h)) - 0.02) director.cue('punch', 0.6, app.now() / 1000); }
    if (e & Ev.wipeout) game.onCue('wipeout', me.x, me.z, 1);
    if (e & (Ev.washed | Ev.diveOk | Ev.divePerfect | Ev.turtled)) game.onCue('splash', me.x, me.z, e & Ev.washed ? 1 : 0.5);
    if (e & Ev.washed) rumble(1, 400);
    if (e & (Ev.diveOk | Ev.turtled)) rumble(0.4, 150);
    if (e & Ev.wipeout) rumble(1, 500);
  }
  return game;
}
