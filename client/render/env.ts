// The environment: real Hawaiʻi time -> sun and moon -> sky lookup texture, lights, exposure.
// Every shader reads its light from the uniforms here.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { sunPosition, moonPosition, bearingToWorld, nightFactor } from '../../shared/sun';
import { skyRadiance, transmittance, lutDir, LUT_W, LUT_H, type V3 } from './atmosphere';

const MOON_RATIO = 0.035; // moon irradiance relative to the sun (artistic; real is ~3e-6)
const MOON_TINT: V3 = [0.78, 0.86, 1.0];
const AIRGLOW: V3 = [0.00012, 0.00016, 0.00028]; // starlight and airglow floor so night sky is never black
const lum = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export const U = {
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  moonDir: uniform(new THREE.Vector3(0, -1, 0)),
  sunColor: uniform(new THREE.Vector3(1, 1, 1)), // direct irradiance at the surface
  moonColor: uniform(new THREE.Vector3()),
  lightDir: uniform(new THREE.Vector3(0, 1, 0)), // whichever of sun/moon is the key light
  lightColor: uniform(new THREE.Vector3(1, 1, 1)),
  skyAmbient: uniform(new THREE.Vector3(0.1, 0.15, 0.25)), // mean radiance of the upper sky
  lutAz: uniform(new THREE.Vector2(1, 0)), // unit xz direction of the lookup texture's azimuth origin (the sun)
  exposure: uniform(1),
  night: uniform(0), // 0 day .. 1 full night
  time: uniform(0), // seconds, wrapped, for animation
  grade: uniform(new THREE.Vector3(1, 1, 1)), // color gain after tone mapping, keyed to sun elevation
  saturation: uniform(1.25),
  under: uniform(0), // 1 while the camera is below the surface
  sunScreen: uniform(new THREE.Vector2(0.5, 1.2)), // where the key light sits on screen, for underwater shafts
  lensWet: uniform(0), // 0..1 water on the lens
  priority: uniform(new THREE.Vector4(1, 0.77, 0.42, 0)), // priority glow on the face: rgb, strength
  priorityAt: uniform(new THREE.Vector2()), // world xz it is centered on
};

export class Env {
  readonly skyLut: THREE.DataTexture;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  sunElevation = 90;
  sunAzimuth = 180;
  private back = new Float32Array(LUT_W * LUT_H * 4);
  private front: Uint16Array;
  private col = LUT_W; // next column to compute; LUT_W = idle
  private lutSunEl = 999; // sun elevation the current/in-progress LUT was computed for
  private jobSun: V3 = [0, 1, 0];
  private jobMoon: V3 = [0, -1, 0];
  private targetExposure = 1;

  constructor() {
    this.front = new Uint16Array(LUT_W * LUT_H * 4);
    this.skyLut = new THREE.DataTexture(this.front, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
    this.skyLut.minFilter = this.skyLut.magFilter = THREE.LinearFilter;
    this.skyLut.wrapS = this.skyLut.wrapT = THREE.ClampToEdgeWrapping;
    this.skyLut.colorSpace = THREE.NoColorSpace;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 3000;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
  }

  /** Advance to a UTC time. `sync` forces the sky to be fully recomputed this call (shots, time jumps). */
  update(utcMs: number, dt: number, sync = false, focus?: THREE.Vector3): void {
    const sp = sunPosition(utcMs), mp = moonPosition(sp);
    this.sunElevation = sp.elevation; this.sunAzimuth = sp.azimuth;
    const s = bearingToWorld(sp.azimuth, sp.elevation), m = bearingToWorld(mp.azimuth, mp.elevation);
    U.sunDir.value.set(s[0], s[1], s[2]);
    U.moonDir.value.set(m[0], m[1], m[2]);
    U.lutAz.value.set(s[0], s[2]).normalize();
    U.night.value = nightFactor(sp.elevation);
    U.time.value = (utcMs / 1000) % 3600;

    // Direct light: the sun until it sets, the moon once it is up; deep twilight has sky fill only.
    const ts: V3 = [0, 0, 0], tm: V3 = [0, 0, 0];
    transmittance(s, ts); transmittance(m, tm);
    const sunFade = THREE.MathUtils.smoothstep(sp.elevation, -1.2, 0.6);
    const moonFade = THREE.MathUtils.smoothstep(mp.elevation, -0.5, 3) * THREE.MathUtils.smoothstep(-sp.elevation, 3, 9);
    U.sunColor.value.set(ts[0], ts[1], ts[2]).multiplyScalar(sunFade);
    U.moonColor.value.set(tm[0] * MOON_TINT[0], tm[1] * MOON_TINT[1], tm[2] * MOON_TINT[2]).multiplyScalar(MOON_RATIO * moonFade);
    const useSun = lum(U.sunColor.value.toArray()) >= lum(U.moonColor.value.toArray());
    U.lightDir.value.copy(useSun ? U.sunDir.value : U.moonDir.value);
    U.lightColor.value.copy(useSun ? U.sunColor.value : U.moonColor.value);

    // Sky lookup texture: restart when the sun's elevation has moved, compute a few columns per frame.
    const jump = Math.abs(sp.elevation - this.lutSunEl);
    if (jump > 0.04 && (this.col >= LUT_W || jump > 1 || sync)) {
      this.col = 0; this.lutSunEl = sp.elevation;
      this.jobSun = [Math.cos(sp.elevation * Math.PI / 180), s[1], 0];
      this.jobMoon = [-Math.cos(mp.elevation * Math.PI / 180), m[1], 0];
    }
    if (this.col < LUT_W) this.computeColumns(sync || jump > 1 ? LUT_W : 3);

    // Grade by sun elevation (ART.md): warm at golden hour, a little rose at dusk, cool and quieter at night.
    const e = sp.elevation, sstep = THREE.MathUtils.smoothstep;
    const golden = sstep(e, -3, 1) * (1 - sstep(e, 7, 16)), duskW = sstep(e, -10, -4) * (1 - sstep(e, -3, 0.5)), nightW = 1 - sstep(e, -12, -6);
    U.grade.value.set(1 + 0.1 * golden + 0.04 * duskW - 0.05 * nightW, 1 - 0.01 * golden - 0.02 * duskW, 1 - 0.13 * golden + 0.05 * duskW + 0.07 * nightW);
    U.saturation.value = 1.26 + 0.06 * golden - 0.06 * duskW - 0.2 * nightW;
    const k = sync ? 1 : 1 - Math.exp(-dt * 1.5);
    U.exposure.value += (this.targetExposure - U.exposure.value) * k;

    const lc = U.lightColor.value, amb = U.skyAmbient.value;
    this.sun.color.setRGB(lc.x, lc.y, lc.z); // intensity stays 1: color carries irradiance
    const f = focus ?? this.sun.target.position;
    this.sun.target.position.copy(f);
    // Ground past the shadow camera's far plane reads as shadowed, so keep the box long and the light off the horizon.
    const ld = U.lightDir.value;
    this.sun.position.set(f.x + ld.x * 1500, f.y + Math.max(ld.y, 0.06) * 1500, f.z + ld.z * 1500);
    this.sun.target.updateMatrixWorld();
    // Fill light is the sky, pulled a third of the way to gray: real shade also gets bounce from everything around it.
    const al = lum(amb.toArray()) * 0.33;
    this.hemi.color.setRGB((amb.x * 0.67 + al) * Math.PI, (amb.y * 0.67 + al) * Math.PI, (amb.z * 0.67 + al) * Math.PI);
    // Light off the sand and the pale water is warm and strong; it is what keeps a shaded wall from going gray.
    const bounce = 0.38 * (lum(amb.toArray()) * Math.PI + lum(lc.toArray()) * Math.max(0, U.lightDir.value.y));
    this.hemi.groundColor.setRGB(bounce * 1.08, bounce, bounce * 0.84);
  }

  private computeColumns(n: number): void {
    const v: V3 = [0, 0, 0], a: V3 = [0, 0, 0], b: V3 = [0, 0, 0];
    const sunUp = this.jobSun[1] > -0.32, moonUp = this.jobMoon[1] > -0.2; // skip lights far below the horizon
    const moonE = MOON_RATIO * THREE.MathUtils.smoothstep(-this.lutSunEl, 3, 9);
    // Twilight is thousands of times dimmer than day. Compress that range so dusk reads as pastel
    // under a bounded exposure, and hands over smoothly to the (also boosted) moonlight.
    const el = this.lutSunEl;
    // The boost peaks around 7° below the horizon and then lets go, so the sun's last light fades out and the moon takes over.
    const dep = Math.max(0, -el), twilight = Math.exp(Math.min(dep, 7) * 0.35 - Math.max(0, dep - 7) * 0.6);
    const dusk = THREE.MathUtils.smoothstep(-el, 0, 5); // 0 day .. 1 deep twilight
    const fill = 0.55 * (el < -2 ? Math.min(1, Math.exp((el + 2) * 0.25)) : THREE.MathUtils.lerp(1, 0.55, THREE.MathUtils.clamp((el + 2) / 8, 0, 1)));
    for (let end = Math.min(LUT_W, this.col + n); this.col < end; this.col++) {
      for (let j = 0; j < LUT_H; j++) {
        lutDir(this.col, j, 0, v);
        a[0] = a[1] = a[2] = b[0] = b[1] = b[2] = 0;
        if (sunUp) { skyRadiance(v, this.jobSun, a, fill, dusk); a[0] *= twilight; a[1] *= twilight; a[2] *= twilight; }
        // Belt of Venus: reddened sunlight back-scattered above the rising earth shadow, opposite the sun.
        if (el < 1 && el > -11.5) {
          const elDeg = Math.asin(v[1]) * 180 / Math.PI, k = 0.02 * Math.max(0, -v[0]) * Math.exp(-(((elDeg - (8 - el * 0.8)) / 7) ** 2)) * THREE.MathUtils.smoothstep(el, -11.5, -8) * THREE.MathUtils.smoothstep(-el, -1, 2);
          a[0] += k; a[1] += k * 0.5; a[2] += k * 0.62;
        }
        if (moonUp) skyRadiance(v, this.jobMoon, b);
        const o = (j * LUT_W + this.col) * 4;
        for (let c = 0; c < 3; c++) this.back[o + c] = a[c] + b[c] * moonE * MOON_TINT[c] + AIRGLOW[c];
        this.back[o + 3] = 1;
      }
    }
    if (this.col < LUT_W) return;
    // Publish, and derive ambient and exposure from the finished sky.
    const amb = [0, 0, 0];
    let wsum = 0, skyMax = 0;
    for (let j = 0; j < LUT_H; j++) {
      const vv = (j + 0.5) / LUT_H, el = vv * vv * Math.PI / 2, w = Math.cos(el) * vv; // solid angle of the sqrt-mapped row
      for (let i = 0; i < LUT_W; i++) { const o = (j * LUT_W + i) * 4; for (let c = 0; c < 3; c++) amb[c] += this.back[o + c] * w; wsum += w; skyMax = Math.max(skyMax, lum(this.back.subarray(o, o + 3))); }
    }
    for (let c = 0; c < 3; c++) amb[c] /= wsum;
    U.skyAmbient.value.set(amb[0], amb[1], amb[2]);
    for (let i = 0; i < this.back.length; i++) this.front[i] = THREE.DataUtils.toHalfFloat(this.back[i]);
    this.skyLut.needsUpdate = true;
    // Expose like a photographer: 18% gray in the key light at mid-gray, unless the sky is the subject (dusk).
    const gray = (0.18 / Math.PI) * (lum(U.lightColor.value.toArray()) * Math.max(0.35, U.lightDir.value.y) + Math.PI * lum(amb));
    const skyKey = THREE.MathUtils.lerp(0.12, 0.6, THREE.MathUtils.smoothstep(-el, -1, 4));
    this.targetExposure = THREE.MathUtils.clamp(0.18 / Math.max(gray, skyKey * skyMax), 2.5, 30);
  }
}
