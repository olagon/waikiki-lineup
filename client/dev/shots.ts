import type { App } from '../app';
import { hstToUtcMs } from '../../shared/sun';
import { activeWaves } from '../../shared/waves';
import { St } from '../../shared/physics';
import { ARCHETYPE_LOOKS } from '../../shared/looks';
import { SurferView, Figure, TREAT_SPOT } from '../characters/surfer';
import { B, Ev, newSurfer, stepSurfer, type World, type Input } from '../../shared/physics';
import { newPilot, pilotInput, rideInput } from '../../shared/autopilot';
import { peelDir, type Wave } from '../../shared/waves';
import { nightFactor } from '../../shared/sun';
import { TUNING as T } from '../../shared/tuning';
import { Director } from '../camera/director';

/** A played-out moment: an autopilot surfer runs the real physics up to a marked event, then we hold `after` seconds past it. */
interface Scenario { when: [number, number, number, number]; who: string; kind?: 'dive'; mark: 'pop' | 'wipe' | 'dive' | 'nose'; after: number; style?: number; force?: 'carve' | 'wipe'; cam?: { off: [number, number, number]; look: [number, number, number]; fov: number } }
const SCENES: Record<string, Scenario> = {
  G3: { when: [2026, 11, 14, 14.6], who: 'charger', kind: 'dive', mark: 'dive', after: 0.42 },
  G5: { when: [2026, 11, 14, 15.6], who: 'charger', mark: 'pop', after: 0.5 },
  G6: { when: [2026, 11, 14, 16.6], who: 'aunty', mark: 'pop', after: 6.5 },
  G7: { when: [2026, 11, 14, 17.3], who: 'uncle', style: 1, mark: 'nose', after: 0.8, cam: { off: [24, 1.4, -11], look: [0, 1.0, 0], fov: 12 } },
  G8: { when: [2026, 11, 14, 14.2], who: 'grom', force: 'wipe', mark: 'wipe', after: 0.25, cam: { off: [4.2, 1.0, -3.2], look: [0, 1.1, 0], fov: 40 } },
  duckdive: { when: [2026, 11, 14, 13.0], who: 'charger', kind: 'dive', mark: 'dive', after: -0.3 },
  takeoff: { when: [2026, 11, 14, 15.6], who: 'aunty', mark: 'pop', after: -0.4 },
  carve: { when: [2026, 11, 14, 16.0], who: 'charger', force: 'carve', mark: 'pop', after: 3 },
  wipeout: { when: [2026, 11, 14, 14.2], who: 'grom', force: 'wipe', mark: 'wipe', after: -0.3, cam: { off: [5.5, 1.3, -3.5], look: [0, 1.0, 0], fov: 42 } },
};

async function runScenario(app: App, sc: Scenario, frame: number): Promise<void> {
  const base = hstToUtcMs(sc.when[0], sc.when[1], sc.when[2], sc.when[3]) / 1000;
  const look = ARCHETYPE_LOOKS[sc.who], dive = sc.kind === 'dive', view = new SurferView(look), director = new Director();
  app.scene.add(view.group);
  const world = (t: number): World => ({ t, waves: activeWaves(app.seed, t, app.spot), spot: app.spot, night: nightFactor(app.env.sunElevation, T.night.fullAt) });
  let wave!: Wave, pk!: Wave['peaks'][0], side = 1, t0 = 0, mark = -1;
  const fresh = () => { const s = newSurfer(look.board); s.x = pk.x + side * (dive ? 1 : 3.5); s.z = app.spot.zb + (dive ? -20 : 3); return { s, pilot: newPilot(s.x, s.z) }; };
  const input = (s: ReturnType<typeof newSurfer>, w: World, pilot: ReturnType<typeof newPilot>): Input => {
    const inp = pilotInput(s, w, pilot);
    if (dive && s.state === 0 && s.lift <= 0) inp.buttons |= B.paddle;
    if (s.state === 6 && sc.style) { const r = rideInput(s, w, sc.style); if (s.stance > 0.8) r.buttons = B.forward; return r; } // once on the nose, stay there for the picture
    if (s.state === 6 && sc.force === 'carve' && s.rideTime > 1.6) inp.steer = Math.max(-1, Math.min(1, inp.steer * 0.5 + Math.sin((s.rideTime - 1.6) * 2.6)));
    if (s.state === 6 && sc.force === 'wipe' && s.rideTime > 2.2) { inp.steer = -peelDir(wave, s.x) * (Math.cos(s.heading) * peelDir(wave, s.x) > 0.25 ? 1 : 0); inp.buttons = B.back; } // stall high until the lip lands
    return inp;
  };
  // Pass 1: find a set wave on which the scripted surfer reaches the marked event, and the tick it happens.
  const seen = new Set<number>();
  for (let t = base; t < base + 1500 && mark < 0; t += 4) for (const cand of activeWaves(app.seed, t, app.spot)) {
    if (mark >= 0 || seen.has(cand.id) || !cand.set || cand.tb < base + 12 || cand.h < 1.5) continue;
    seen.add(cand.id);
    wave = cand; pk = wave.peaks[0]; side = pk.vr <= pk.vl ? 1 : -1; t0 = wave.tb - (dive ? 1 : 8);
    const { s, pilot } = fresh();
    for (let i = 0; i < 34 / T.tick && mark < 0; i++) {
      const w = world(t0 + i * T.tick), was = s.state; stepSurfer(s, input(s, w, pilot), w);
      if (s.waveId >= 0 && s.waveId !== wave.id) break; // took a different wave; try the next candidate
      if ((sc.mark === 'pop' && s.events & Ev.popUp) || (sc.mark === 'wipe' && s.events & Ev.wipeout) || (sc.mark === 'dive' && s.state === 2 && was !== 2) || (sc.mark === 'nose' && s.stance > 0.9)) mark = i;
    }
  }
  if (mark < 0) throw new Error('scenario never reached its mark: ' + sc.mark);
  const end = mark + Math.round((sc.after + frame * 0.1) / T.tick);
  // Pass 2: play it for real, drawing the last two seconds so foam, spray and poses have their history.
  const { s, pilot } = fresh();
  let px = s.x, pz = s.z, steer = 0;
  for (let i = 0; i <= end; i++) {
    const t = t0 + i * T.tick, w = world(t), inp = input(s, w, pilot);
    px = s.x; pz = s.z; steer = inp.steer; stepSurfer(s, inp, w);
    const riding = s.state === 6 || s.state === 5, draw = i > end - 40;
    app.setTime(t * 1000);
    if (draw) { app.waves = w.waves; }
    view.update(T.tick, { x: s.x, z: s.z, heading: s.heading, state: s.state, stateTime: s.stateTime, speed: s.speed, paddling: (inp.buttons & B.paddle) !== 0, stamina: s.stamina, stance: s.stance, steer, vx: riding ? (s.x - px) / T.tick : undefined, vz: riding ? (s.z - pz) / T.tick : undefined }, app);
    const p = view.group.position, surf = app.waterY(p.x, p.z);
    if (sc.cam) { const d = Math.abs(Math.cos(s.heading)) > 0.2 ? Math.sign(Math.cos(s.heading)) : side; app.camera.position.set(p.x + d * sc.cam.off[0], surf + sc.cam.off[1], p.z + sc.cam.off[2]); app.camera.fov = sc.cam.fov; app.camera.updateProjectionMatrix(); app.camera.lookAt(p.x + sc.cam.look[0], surf + sc.cam.look[1], p.z + sc.cam.look[2]); }
    else director.update(T.tick, { x: p.x, y: surf, z: p.z, heading: s.heading, speed: s.speed, under: s.state === 2 || s.state === 4 ? Math.max(0, surf - p.y) : 0, mode: s.state === 5 || (s.state === 6 && s.rideTime < 0.9) ? 'takeoff' : s.state === 6 ? 'ride' : s.state === 7 ? 'wipeout' : 'paddle' }, app.camera, t);
    if (!sc.cam && !(s.state === 2 || s.state === 4 || s.state === 7)) app.camera.position.y = Math.max(app.camera.position.y, app.waterY(app.camera.position.x, app.camera.position.z) + 0.45);
    if (draw) { app.frame(T.tick, i === end - 39); if (i % 8 === 0) await new Promise(requestAnimationFrame); }
  }
  for (let i = 0; i < 3; i++) { app.frame(0); await new Promise(requestAnimationFrame); }
}


declare global { interface Window { __shotReady?: boolean; __shotInfo?: unknown } }

interface Shot {
  when: [number, number, number, number]; cam: [number, number, number]; look: [number, number, number]; fov?: number;
  /** Seconds to nudge the moment within the wave schedule. */
  dt?: number;
  /** Pick the first set wave after `when` that fits, and hold the moment `tau` seconds after it starts to break. cam/look x are then relative to its peak. */
  wave?: { tau: number; minH?: number; twoPeaks?: boolean };
  /** Surfers staged into the scene: [archetype, x, z, heading in degrees (90 faces out to sea), state, paddling]. x is relative to the wave's peak when `wave` is set. */
  cast?: [string, number, number, number, St, boolean][];
}

// Fixed scenes for golden frames. Times are Hawaiʻi time. See ART.md for what each must show.
const SHOTS: Record<string, Shot> = {
  G1: { when: [2026, 11, 14, 17.5], cam: [-125, 30, 205], look: [125, 2, 62], fov: 45, wave: { tau: 5.5, minH: 1.7, twoPeaks: true },
    cast: [['uncle', 30, 118, 85, St.Sit, false], ['aunty', 12, 121, 95, St.Sit, false], ['charger', 46, 124, 90, St.Sit, false], ['grom', -6, 112, 100, St.Sit, false], ['tourist', 70, 116, 80, St.Sit, false], ['student', -30, 60, 95, St.Paddle, true], ['instructor', -34, 58, 95, St.Paddle, true],
      ['aunty', 95, 119, 90, St.Sit, false], ['uncle', -40, 100, 110, St.Paddle, true], ['grom', 60, 96, 60, St.Paddle, true], ['charger', 110, 126, 95, St.Sit, false]] },
  G2: { when: [2026, 11, 14, 17.2], cam: [-5, 0.5, 109], look: [2, 1.2, 124], fov: 50, wave: { tau: -0.6, minH: 1.8 } },
  G4: { when: [2026, 11, 14, 10.5], cam: [-0.7, 1.5, 104.4], look: [-0.9, 0.8, 124], fov: 46, wave: { tau: -4.4, minH: 1.75 },
    cast: [['tourist', 0.25, 107.3, 92, St.Sit, false], ['grom', -1.8, 111.6, 100, St.Sit, false], ['charger', 0.9, 114.4, -75, St.Paddle, true], ['uncle', -2.9, 117.5, 84, St.Sit, false], ['aunty', 1.9, 120.5, 95, St.Sit, false], ['student', -3.9, 123.6, 80, St.Sit, false]] },
  P1: { when: [2026, 11, 14, 14.0], cam: [0, 1.7, 33], look: [0, 0.4, 40], fov: 55,
    cast: [['uncle', -5, 40, 200, St.Paddle, true], ['grom', -3, 40, 200, St.Paddle, true], ['aunty', -1, 40.5, 160, St.Sit, false], ['charger', 1, 40, 20, St.Sit, false], ['instructor', 3, 40, 200, St.Paddle, false], ['student', 5, 40.5, 180, St.Sit, false], ['tourist', 7, 40, -90, St.Paddle, true]] },
  G3: { when: [2026, 11, 14, 15.0], cam: [6, -1.15, 80.5], look: [9, 0.3, 86.5], fov: 60, wave: { tau: 5.0, minH: 1.7 } },
  G9: { when: [2026, 11, 14, 12.2], cam: [9.5, 4.6, 34.5], look: [-1.5, 0.2, 25.5], fov: 46,
    cast: [['student', -1.2, 25.2, -90, St.Paddle, true], ['grom', -16, 44, 100, St.Paddle, true]] },
  G10: { when: [2026, 6, 21, 19.78], cam: [-150, 2.4, 175], look: [240, 30, 60], fov: 40,
    cast: [['uncle', -128, 168, 95, St.Sit, false], ['aunty', -118, 162, 80, St.Sit, false], ['charger', -100, 171, 100, St.Sit, false], ['grom', -134, 160, 30, St.Paddle, true]] },
  G11: { when: [2026, 11, 14, 19.33], cam: [-20, 1.5, 150], look: [66, 17, 26], fov: 46,
    cast: [['uncle', -9, 137, 100, St.Sit, false], ['aunty', -3, 131, 85, St.Sit, false], ['charger', -14, 128, 95, St.Sit, false], ['tourist', 4, 124, -70, St.Paddle, true]] },
};

/** Dev-only: render a fixed scene for golden-frame capture. `?shot=<id>`; `h`, `date`, `cam`, `look`, `fov` override. */
export async function runShot(app: App, id: string, q: URLSearchParams): Promise<void> {
  if (SCENES[id]) {
    await runScenario(app, SCENES[id], Number(q.get('frame') ?? 0));
    window.__shotInfo = { id, backend: app.backend, sunEl: +app.env.sunElevation.toFixed(2) };
    window.__shotReady = true;
    return;
  }
  if (id === 'G12') {
    // The lifeguard: afternoon light at the tower, the guard kneeling to seal a cut on the surfer's shin.
    app.setTime(hstToUtcMs(2026, 11, 14, Number(q.get('h') ?? 16.3)));
    const surfer = new SurferView(ARCHETYPE_LOOKS.aunty), guard = new Figure({ ...ARCHETYPE_LOOKS.instructor, top: 1, topColor: 2, shortsColor: 1 }), sp = TREAT_SPOT;
    app.scene.add(surfer.group, guard.group);
    app.camera.position.set(sp.x - 2.6, 1.55, sp.z + 4.6); app.camera.fov = 38; app.camera.updateProjectionMatrix(); app.camera.lookAt(sp.x + 0.9, 1.15, sp.z - 0.4);
    for (let i = 0; i < 40; i++) { surfer.updateOnSand(0.05, sp.x, sp.z, 0, false); guard.update(0.05, sp.x + 0.85, sp.z + 0.12, Math.PI, true); app.frame(0.05, i === 0); if (i % 8 === 0) await new Promise(requestAnimationFrame); }
    window.__shotInfo = { id, backend: app.backend }; window.__shotReady = true;
    return;
  }
  const s = SHOTS[id] ?? SHOTS.G1;
  const nums = (k: string) => q.get(k)?.split(',').map(Number);
  const [y, m, d] = nums('date') ?? s.when;
  // `dt` (seconds) nudges the moment within the wave schedule without changing the light.
  let ms = hstToUtcMs(y, m, d, Number(q.get('h') ?? s.when[3])) + 1000 * Number(q.get('dt') ?? s.dt ?? 0), px = 0;
  if (s.wave) {
    for (let t = ms / 1000; t < ms / 1000 + 900; t += 4) {
      const w = activeWaves(app.seed, t, app.spot).find((x) => x.set && x.tb > ms / 1000 && x.h >= (s.wave!.minH ?? 0) && (!s.wave!.twoPeaks || x.peaks.length > 1));
      if (w) { ms = (w.tb + Number(q.get('tau') ?? s.wave.tau)) * 1000; px = w.peaks[0].x; break; }
    }
  }
  app.setTime(ms);
  app.camera.position.set(...((nums('cam') ?? s.cam) as [number, number, number]));
  if (s.wave && id !== 'G1') app.camera.position.x += px;
  app.camera.fov = Number(q.get('fov') ?? s.fov ?? 50);
  app.camera.updateProjectionMatrix();
  const look = (nums('look') ?? s.look) as [number, number, number];
  app.camera.lookAt(look[0] + (s.wave && id !== 'G1' ? px : 0), look[1], look[2]);
  for (const n of q.get('hide')?.split(',') ?? []) { const o = app.scene.getObjectByName(n); if (o) o.visible = false; }
  if (q.has('noshadow')) app.renderer.shadowMap.enabled = false;
  const tw = app.scene.getObjectByName('tower');
  if (tw && q.has('trs')) tw.receiveShadow = false;
  if (tw && q.has('tcs')) tw.castShadow = false;
  const cast = (s.cast ?? []).map(([who, x, z, deg, state, paddling]) => {
    const view = new SurferView(ARCHETYPE_LOOKS[who]);
    app.scene.add(view.group);
    return { view, v: { x: x + (s.wave ? px : 0), z, heading: (deg * Math.PI) / 180, state, stateTime: 0.5, speed: paddling ? 2 : 0, paddling, stamina: 100 } };
  });
  // G9: the beach-boy instructor stands waist deep behind the student's board, pushing them into the wave.
  const coach = id === 'G9' ? new Figure(ARCHETYPE_LOOKS.instructor) : null;
  if (coach) app.scene.add(coach.group);
  app.updaters.push((dt) => { for (const c of cast) c.view.update(dt, c.v, app); coach?.update(dt, -1.2, 27.35, -Math.PI / 2, false, true); });
  // Pre-roll 1.5 s of time so spray, foam and anything else with history is in place, then hold the moment.
  const target = app.now();
  for (let i = 45; i > 0; i--) { app.setTime(target - i * 33); app.frame(0.033, i === 45); if (i % 9 === 0) await new Promise(requestAnimationFrame); }
  app.setTime(target);
  for (let i = 0; i < 4; i++) { app.frame(0); await new Promise(requestAnimationFrame); }
  window.__shotInfo = { id, backend: app.backend, sunEl: +app.env.sunElevation.toFixed(2), sunAz: +app.env.sunAzimuth.toFixed(1) };
  window.__shotReady = true;
}
