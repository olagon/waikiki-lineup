import { createApp } from './app';
import { createGame, type Game } from './game';
import { Session } from './net/session';
import { Director } from './camera/director';
import { hstTime } from '../shared/sun';
import { BREAKS } from '../shared/waves';
import { settings, onSettingsChange, loadProfile, openSettings, type Profile } from './ui/settings';
import { showStart } from './ui/start';
import { createOverlay } from './ui/overlay';
import { installTouch } from './input/touch';
import { GameAudio, type SoundName } from './audio/audio';
import { U } from './render/env';
import { EvKind } from '../shared/protocol';
import { crestZ, newSample, sampleWave } from '../shared/waves';
import * as THREE from 'three/webgpu';

declare global { interface Window { __game?: Game } }
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const leave = (): void => location.assign(location.pathname); // back to the start screen; the page reload also leaves the room
const app = await createApp(canvas, { forceWebGL: params.has('gl'), tier: (params.get('tier') as never) ?? settings.quality });

const shot = params.get('shot');
if (import.meta.env.DEV && shot) {
  const { runShot } = await import('./dev/shots');
  await runShot(app, shot, params);
} else {
  // The session token is per tab, so a reload (or a dropped connection) rejoins the same surfer.
  const token = sessionStorage.getItem('wl.token') ?? crypto.randomUUID().replace(/-/g, '');
  sessionStorage.setItem('wl.token', token);
  let game: Game | null = null, spot = BREAKS[params.get('break') ?? ''] ? params.get('break')! : 'canoes';
  const rooms: Record<string, string | null> = { canoes: null, queens: null, [spot]: params.get('room') };
  const roomFor = async (b: string) => (rooms[b] ??= ((await (await fetch(`/api/join?break=${b}`)).json()) as { room: string }).room);
  for (const b of Object.keys(BREAKS)) roomFor(b).catch(() => {}); // know the room up front so the invite link works before paddling out

  // Sound: everything is synthesized. Browsers want a gesture before audio starts.
  const audio = new GameAudio();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => audio.unlock(), { passive: true });
  audio.setVolumes(settings.volume);
  app.reducedMotion = settings.reducedMotion;
  const fwd = new THREE.Vector3(), smp = newSample(), crashed = new Set<number>();
  let strokeAt = 0;
  app.updaters.push((dt, ms) => {
    const t = ms / 1000, cam = app.camera.position, me = game?.me();
    app.camera.getWorldDirection(fwd);
    // The six strongest patches of whitewater near the listener, and a crash the moment each peak goes.
    const patches: { x: number; z: number; power: number }[] = [];
    for (const w of app.waves) {
      const zc = crestZ(w, app.spot, t);
      for (const dx of [-36, -18, 0, 18, 36]) { const p = sampleWave(w, app.spot, cam.x + dx, zc - 1, t, smp).strength; if (p > 0.08) patches.push({ x: cam.x + dx, z: zc - 1, power: p }); }
      for (const pk of w.peaks) { const key = w.id * 4 + w.peaks.indexOf(pk); if (t >= w.tb + pk.dt && t < w.tb + pk.dt + 0.5 && !crashed.has(key)) { crashed.add(key); audio.play('crash', { x: pk.x, y: 0.5, z: crestZ(w, app.spot, w.tb + pk.dt) }, Math.min(1, w.h / 2)); if (crashed.size > 64) crashed.clear(); } }
    }
    patches.sort((a, b) => b.power / (1 + Math.hypot(b.x - cam.x, b.z - cam.z) / 20) - a.power / (1 + Math.hypot(a.x - cam.x, a.z - cam.z) / 20));
    const riding = me && (me.state === 6 || me.state === 5) ? Math.min(1, me.speed / 7) : 0;
    audio.frame(dt, { listener: { x: cam.x, y: cam.y, z: cam.z, fx: fwd.x, fy: fwd.y, fz: fwd.z }, under: U.under.value > 0.5, night: U.night.value, riding, whitewater: patches.slice(0, 6) });
    // Your own strokes.
    if (me && me.state === 0 && me.speed > 1 && t - strokeAt > 0.8) { strokeAt = t; audio.play('paddle', { x: me.x, y: 0, z: me.z }, 0.7); }
  });
  const voice: Record<number, SoundName> = { 0: 'ui', 1: 'hoot', 2: 'go', 3: 'eh', 4: 'splash', 5: 'laugh' };
  const hook = (g: Game) => {
    g.onCue = (name, x, z, gain) => audio.play(name as SoundName, { x, y: 0.3, z }, gain);
    g.onEvent = (e) => {
      const at = (id: number) => { const p = g.others.get(id)?.group.position ?? app.camera.position; return { x: p.x, y: p.y + 0.5, z: p.z }; };
      if (e.kind === EvKind.Emote && e.b !== 0) audio.play(voice[e.b], at(e.a), 0.9);
      if (e.kind === EvKind.Collision) audio.play('bump', at(e.a), 0.9);
      if (e.kind === EvKind.DropIn) audio.play('eh', at(e.b), 1); // the one who got dropped in on says so
      if (e.kind === EvKind.Party) audio.play('hoot', at(e.a), 0.8);
      if (e.kind === EvKind.Wipeout && g.session && e.a !== g.session.id) audio.play('wipeout', at(e.a), 0.7);
    };
  };

  // Start screen: a slow flyover of the bay behind the menu, at the real time in Hawaiʻi.
  const fly = new Director();
  const flyover = (_dt: number, ms: number) => { if (!game) fly.flyover(app.camera, ms / 1000); };
  app.updaters.push(flyover);
  app.start();
  void app.warm(); // compile every pipeline during the flyover, so nothing hitches in the water

  const timeLabel = () => {
    const h = hstTime(app.now()), hr = Math.floor(h.hours), min = Math.floor((h.hours % 1) * 60), el = app.env.sunElevation;
    const sky = el < -8 ? 'full moon' : el < 0 ? (h.hours < 12 ? 'first light' : 'dusk') : el < 12 ? (h.hours < 12 ? 'morning glass' : 'golden hour') : 'light trades';
    return `Waikīkī · ${((hr + 11) % 12) + 1}:${String(min).padStart(2, '0')} ${hr < 12 ? 'am' : 'pm'} · ${sky}`;
  };
  const begin = async (profile: Profile, online: boolean) => {
    const join = () => roomFor(spot).then((room) => Session.join(location.origin, spot, room, token, profile.name, profile.look));
    let full = false;
    const session = online ? await join().catch((e) => { console.info('Playing offline:', e.message); full = e.message === 'full'; return null; }) : null;
    if (session) history.replaceState(null, '', `?break=${spot}&room=${session.roomId}`); // the address bar is now an invite link
    else { app.spot = BREAKS[spot]; if (import.meta.env.DEV && params.get('hour')) { const n = hstTime(Date.now()); app.timeOffset = (Number(params.get('hour')) - n.hours) * 3600000; } } // dev, offline: ?hour=12.5 sets the Hawaiʻi clock
    game = window.__game = createGame(app, profile.look, session, join);
    game.director.reducedMotion = settings.reducedMotion;
    hook(game);
    if (full) game.hud.say('Every room is full right now. You are surfing on your own.', undefined, 8);
    const menu = document.createElement('button');
    menu.textContent = 'Menu';
    menu.style.cssText = 'position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));pointer-events:auto;cursor:pointer;border:0;border-radius:999px;padding:8px 12px;background:rgba(8,30,40,.45);color:#f4efe6;font:13px ui-sans-serif,system-ui;opacity:.7';
    menu.onclick = () => { menu.blur(); openSettings(leave); }; // blur, or Space (pop up) would press the button again
    document.getElementById('ui')!.append(menu);
    if (!localStorage.getItem('wl.swooped')) { game.director.swoop(); localStorage.setItem('wl.swooped', '1'); } // first join: down from Lēʻahi to the beach
    createOverlay({
      onEmote: (e) => game?.session?.emote(e),
      roster: () => { const s = game?.session; return s ? [...s.roster.values()].map((r) => ({ name: r.name, bot: r.bot, you: r.id === s.id, respect: r.id === s.id ? s.respect : s.remote(r.id)?.respect ?? 60 })) : [{ name: profile.name, bot: false, you: true, respect: 60 }]; },
    });
  };
  installTouch();
  // The menu in the water: Escape, or the small button in the corner. It holds the settings and the way back to the start.
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && game) openSettings(leave); });
  onSettingsChange((s) => { if (game) game.director.reducedMotion = s.reducedMotion; app.reducedMotion = s.reducedMotion; audio.setVolumes(s.volume); });

  if (params.has('offline') || params.has('autoplay')) await begin(loadProfile(), !params.has('offline')); // tests and quick starts skip the menu
  else {
    const start = showStart({
      timeLabel,
      counts: async () => (await fetch('/api/rooms')).json(),
      inviteUrl: () => `${location.origin}/?break=${spot}${rooms[spot] ? '&room=' + rooms[spot] : ''}`,
      firstVisit: localStorage.getItem('wl.look') === null,
      onPlay: (b, profile) => { spot = b; start.close(); void begin(profile, true); },
    });
  }
  if (import.meta.env.DEV) {
    const perf = (await import('./dev/perf')).installPerf(app);
    (await import('./dev/panel')).installPanel(app, perf);
  }
}
