// @ts-nocheck  (TSL node chains)
// One pool of soft sprites for everything that flies or floats: lip spray, mist, splashes, bubbles.
import * as THREE from 'three/webgpu';
import { instancedDynamicBufferAttribute, uv, length, vec2, vec3, vec4, float, max, mix, step, texture } from 'three/tsl';
import { noiseTex } from './sky';
import { U } from './env';
import { ss } from './tsl';
import { crestSpeed, crestZ, newSample, sampleWave } from '../../shared/waves';
import type { App } from '../app';

export const Kind = { spray: 0, mist: 1, bubble: 2 };
const N = 9000, WIND_Z = 3.2; // trades blow offshore

export class Particles {
  readonly sprite: THREE.Sprite;
  private pos = new Float32Array(N * 3); private vel = new Float32Array(N * 3);
  private data = new Float32Array(N * 4); // size, alpha, kind, random seed
  private life = new Float32Array(N); private span = new Float32Array(N); private size0 = new Float32Array(N);
  private aPos = new THREE.InstancedBufferAttribute(this.pos, 3); private aData = new THREE.InstancedBufferAttribute(this.data, 4);
  private head = 0;
  private sample = newSample();

  constructor() {
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aData.setUsage(THREE.DynamicDrawUsage);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    const d = instancedDynamicBufferAttribute(this.aData, 'vec4');
    mat.positionNode = instancedDynamicBufferAttribute(this.aPos, 'vec3');
    mat.scaleNode = d.x;
    const r = length(uv().sub(0.5)).mul(2), bubble = step(1.5, d.z);
    const white = U.lightColor.mul(max(U.lightDir.y, 0).mul(0.14).add(0.13)).add(U.skyAmbient.mul(1.7));
    // Mist is torn, not round: each puff takes its own piece of noise. Spray is small tight drops. Bubbles are beads, brighter at the edge.
    const wisp = ss(0.3, 0.72, texture(noiseTex, uv().mul(0.21).add(vec2(d.w, d.w.mul(7.3)))).level(0).r.add(ss(1.0, 0.0, r).mul(0.34)));
    const clump = texture(noiseTex, uv().mul(0.09).add(vec2(d.w.mul(3.1), d.w))).level(0).g; // spray is ragged clots of drops, never discs
    const air = mix(ss(1.0, 0.3, r).mul(ss(0.38, 0.6, clump.add(ss(0.9, 0.0, r).mul(0.3)))), ss(1.0, 0.1, r).mul(wisp), step(0.5, d.z));
    const body = mix(air, ss(1.0, 0.55, r).mul(ss(0.0, 0.9, r).mul(0.6).add(0.4)), bubble);
    mat.colorNode = vec4(mix(white, white.mul(vec3(0.8, 1.0, 1.05)), bubble), body.mul(d.y));
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 20;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number): void {
    const i = this.head; this.head = (this.head + 1) % N;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.span[i] = life; this.size0[i] = size; this.data[i * 4 + 2] = kind; this.data[i * 4 + 3] = Math.random();
  }

  update(dt: number): void {
    const { pos, vel, data, life, span, size0 } = this;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) { data[i * 4] = 0; data[i * 4 + 1] = 0; continue; }
      life[i] -= dt;
      // Expired this frame: hide it now. Past its life, age > 1 and the fade below would be the power of a negative
      // number, a NaN alpha, which bloom then smears into black blocks and white flashes across the screen.
      if (life[i] <= 0) { data[i * 4] = 0; data[i * 4 + 1] = 0; continue; }
      const kind = data[i * 4 + 2], o = i * 3, age = Math.min(1, Math.max(0, 1 - life[i] / span[i]));
      if (kind === Kind.bubble) { vel[o + 1] += (0.9 - vel[o + 1]) * Math.min(1, 3 * dt); vel[o] *= 1 - 2 * dt; vel[o + 2] *= 1 - 2 * dt; }
      else {
        vel[o + 1] -= (kind === Kind.mist ? 1.2 : 7.5) * dt;
        vel[o + 2] += (WIND_Z - vel[o + 2]) * Math.min(1, (kind === Kind.mist ? 2.2 : 0.7) * dt); // blown back off the lip
      }
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      if (kind === Kind.bubble && pos[o + 1] > -0.05) life[i] = 0;
      data[i * 4] = size0[i] * (kind === Kind.mist ? 1 + age * 1.5 : kind === Kind.bubble ? 1 : 1 + age * 0.8);
      data[i * 4 + 1] = Math.min(1, age * 8) * (1 - age) ** (kind === Kind.mist ? 1.5 : 0.7) * (kind === Kind.mist ? 0.34 : kind === Kind.bubble ? 0.7 : 0.9);
    }
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true;
  }

  /** Spray, mist and (when the camera is under) bubbles from the waves near the camera. */
  emitFromWaves(app: App, dt: number, under: boolean): void {
    const t = app.now() / 1000, cam = app.camera.position, R = Math.random, s = this.sample;
    for (const w of app.waves) {
      const zc = crestZ(w, app.spot, t);
      if (Math.abs(zc - cam.z) > 140) continue;
      const c = crestSpeed(w, app.spot, t);
      for (let x = cam.x - 90 + R() * 1.4; x < cam.x + 90; x += 1.4) {
        sampleWave(w, app.spot, x, zc - 0.2, t, s);
        const hf = Math.min(1.3, w.h / 1.4), y = s.amp;
        if (s.amp < 0.25) continue;
        if (s.tau > -4 && s.tau < 0) { // feathering: fine mist torn off the standing lip by the offshore wind
          if (R() < 14 * hf * (1 + s.tau / 4) ** 2 * dt * 1.4) this.emit(x, y + 0.05, zc + 0.15, (R() - 0.5) * 0.5, 0.9 + R() * 1.6, 2 + R() * 2.5, 0.9 + R() * 0.9, 0.16 + R() * 0.3, Kind.mist);
        } else if (s.tau >= 0 && s.tau < 1.2) { // the lip going over
          for (let n = 0; n < 3; n++) if (R() < 13 * hf * dt * 1.4) this.emit(x + R() * 1.4, y * (0.6 + R() * 0.4), zc - R() * 1.2, (R() - 0.5) * 1.6, 1.2 + R() * 3 * hf, -c * 0.45 + R() * 1.8, 0.5 + R() * 0.6, 0.035 + R() * R() * 0.13, Kind.spray);
          if (R() < 5 * hf * dt * 1.4) this.emit(x, y, zc, (R() - 0.5) * 0.6, 0.8 + R() * 1.2, 1 + R() * 2, 0.9 + R() * 0.8, 0.25 + R() * 0.3, Kind.mist);
        } else if (s.power > 0.15) { // the bore: a rolling front throwing chunks
          for (let n = 0; n < 3; n++) if (R() < 7 * s.power * dt * 1.4) this.emit(x + R() * 1.4, y * R() * 0.8, zc - 1 - R() * 1.5, (R() - 0.5) * 2, 0.8 + R() * 2.6 * s.power, -c * (0.6 + R() * 0.25), 0.4 + R() * 0.5, 0.04 + R() * R() * 0.16, Kind.spray);
          if (R() < 2.5 * s.power * dt * 1.4) this.emit(x, y * 0.8, zc, (R() - 0.5) * 0.5, 0.4 + R() * 0.7, R() * 1.5, 0.8 + R() * 0.7, 0.3 + R() * 0.35, Kind.mist);
          if (under && Math.abs(x - cam.x) < 14 && R() < 30 * s.power * dt * 1.4) this.emit(x, -0.15 - R() * 1.3 * hf, zc + R() * 5 - 1.5, (R() - 0.5) * 0.8, -0.6 + R() * 0.5, -c * 0.3, 0.8 + R() * 1.4, 0.012 + R() * R() * 0.07, Kind.bubble);
        }
      }
    }
  }
}
