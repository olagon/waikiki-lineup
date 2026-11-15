import * as THREE from 'three/webgpu';
import { Env, U } from './render/env';
import { Particles } from './render/particles';
import { createSky } from './render/sky';
import { createTerrain } from './render/terrain';
import { createOcean } from './ocean/ocean';
import { Wake } from './ocean/wake';
import { chopHeight } from './ocean/ripples';
import { updateWaveUniforms } from './ocean/wavesGpu';
import { BREAKS, activeWaves, roomSeed, surfaceHeight, type BreakSpec, type Wave } from '../shared/waves';
import { createShore, hazeNode } from './render/shore';
import { createPipeline } from './render/post';

export interface App {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  env: Env;
  backend: 'webgpu' | 'webgl2';
  /** UTC ms the scene shows. Server-synced in play; fixed in shots; offset by the dev panel. */
  now(): number;
  setTime(fixedUtcMs: number | null): void;
  /** Dev clock offset in ms, added to real time. */
  timeOffset: number;
  /** The break and room seed in play, and the waves alive this frame. */
  spot: BreakSpec; seed: number; waves: Wave[];
  /** Height of the water surface (m) at a point right now, as rendered. */
  waterY(x: number, z: number): number;
  particles: Particles;
  wake: Wake;
  tier: Tier;
  /** Comfort setting: no lens effects (the camera director checks its own flag). */
  reducedMotion: boolean;
  /** Compile and warm every pipeline so nothing hitches during play. */
  warm(): Promise<void>;
  /** Call when the camera breaks the surface: wets the lens. */
  wetLens(): void;
  /** Things that tick every frame, in order. */
  updaters: ((dt: number, utcMs: number) => void)[];
  frame(dt: number, sync?: boolean): void;
  start(): void;
}

export type Tier = 'ultra' | 'high' | 'mobile';
const TIERS = {
  ultra: { rings: 360, segs: 512, clouds: 32, shadow: 2048, dpr: 2, target: 16.7 },
  high: { rings: 280, segs: 384, clouds: 20, shadow: 1024, dpr: 1.5, target: 16.7 },
  mobile: { rings: 200, segs: 256, clouds: 12, shadow: 0, dpr: 1.5, target: 33.4 },
};

export async function createApp(canvas: HTMLCanvasElement, opts: { forceWebGL?: boolean; tier?: Tier | 'auto' } = {}): Promise<App> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: !!opts.forceWebGL, reversedDepthBuffer: true } as never);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  // Quality tier: Ultra on WebGPU desktops, High on the WebGL2 fallback, Mobile on phones. Settings can override.
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  const tier: Tier = opts.tier && opts.tier !== 'auto' ? opts.tier : phone ? 'mobile' : backend === 'webgpu' ? 'ultra' : 'high';
  const Q = TIERS[tier];
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.25, 30000);
  camera.position.set(0, 1.6, 120);
  camera.lookAt(0, 1, 0);

  const env = new Env();
  if (Q.shadow) env.sun.shadow.mapSize.set(Q.shadow, Q.shadow); else env.sun.castShadow = false;
  const sky = createSky(env, Q.clouds);
  const wake = new Wake();
  const ocean = createOcean(env, wake, { rings: Q.rings, segs: Q.segs });
  scene.add(sky, env.sun, env.sun.target, env.hemi, createTerrain(), ocean.mesh, await createShore(env));
  scene.fogNode = hazeNode(env);
  const particles = new Particles();
  scene.add(particles.sprite);
  const sunNdc = new THREE.Vector3();
  let wasUnder = false;

  const pipeline = createPipeline(renderer, scene, camera);

  // Adaptive resolution: hold the frame-time target by trading pixels, within the tier's ceiling.
  let scale = 1, slow = 0, fast = 0, ema = Q.target;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Never render more than about 4.6 million pixels: a big retina window would otherwise ask for 9 million.
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr, Math.sqrt(4.6e6 / Math.max(1, w * h))) * scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  let fixed: number | null = null;
  const app: App = {
    renderer, scene, camera, env, backend, tier, particles, wake, updaters: [], timeOffset: 0, reducedMotion: false,
    async warm() {
      // Build every pipeline before play by drawing through the real pipeline from above and from below the surface.
      const keep = camera.position.clone();
      for (const y of [3, -1.5, 3]) { camera.position.y = y; app.frame(0.016, true); await new Promise(requestAnimationFrame); }
      camera.position.copy(keep);
    },
    wetLens: () => { U.lensWet.value = 1; }, spot: BREAKS.canoes, seed: roomSeed('local'), waves: [],
    now: () => fixed ?? Date.now() + app.timeOffset,
    waterY: (x, z) => chopHeight(x, z, (app.now() / 1000) % 3600) + surfaceHeight(app.waves, app.spot, x, z, app.now() / 1000),
    setTime: (ms) => { fixed = ms; },
    frame(dt, sync = false) {
      if (dt > 0 && dt < 0.1) {
        ema += (dt * 1000 - ema) * 0.05;
        slow = ema > Q.target * 1.12 ? slow + dt : 0; fast = ema < Q.target * 0.72 ? fast + dt : 0;
        if (slow > 1 && scale > 0.6) { scale = Math.max(0.6, scale * 0.9); slow = 0; resize(); }
        if (fast > 4 && scale < 1) { scale = Math.min(1, scale * 1.08); fast = 0; resize(); }
      }
      const t = app.now();
      app.waves = activeWaves(app.seed, t / 1000, app.spot);
      updateWaveUniforms(app.waves, app.spot, t / 1000);
      for (const u of app.updaters) u(dt, t);
      env.update(t, dt, sync, camera.position);
      sky.position.copy(camera.position);
      ocean.update(camera);
      // Above or below the surface? Below, fog and post switch to their underwater versions.
      const under = camera.position.y < app.waterY(camera.position.x, camera.position.z) - 0.03;
      if (wasUnder && !under) app.wetLens();
      wasUnder = under;
      U.under.value = under ? 1 : 0;
      U.lensWet.value = app.reducedMotion ? 0 : Math.max(0, U.lensWet.value - dt / 1.7);
      camera.updateMatrixWorld();
      sunNdc.copy(camera.position).addScaledVector(U.lightDir.value, 1000).project(camera);
      U.sunScreen.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.z < 1 ? 0.5 - sunNdc.y * 0.5 : -0.4);
      wake.update(renderer, camera.position, dt);
      particles.emitFromWaves(app, dt, under);
      particles.update(dt);
      pipeline.render();
    },
    start() {
      let last = performance.now();
      renderer.setAnimationLoop((now: number) => { app.frame(Math.min(0.1, (now - last) / 1000)); last = now; });
    },
  };
  return app;
}
