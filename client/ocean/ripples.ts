import * as THREE from 'three/webgpu';
import { rngStream } from '../../shared/rng';

/**
 * Tileable ripple field stored as surface slopes (d/dx in R, d/dz in G, 0.5 = flat).
 * Slopes add and mip correctly, which normals do not. `slopeScale` maps texel range to slope.
 */
export const RIPPLE_SLOPE = 0.9;
export function makeRippleTexture(size = 256, seed = 3): THREE.DataTexture {
  const rnd = rngStream(seed), waves: number[][] = [];
  for (let i = 0; i < 56; i++) {
    // Integer wave vectors keep it tileable. Bias directions toward +z (offshore wind).
    const k = 3 + Math.floor(rnd() ** 1.7 * 44), ang = Math.PI / 2 + (rnd() - 0.5) * 2.2;
    const kx = Math.round(k * Math.cos(ang)), kz = Math.round(k * Math.sin(ang));
    waves.push([kx, kz, 1 / Math.hypot(kx, kz) ** 1.25, rnd() * Math.PI * 2]);
  }
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  let rms = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let ax = 0, az = 0;
    for (const [kx, kz, amp, ph] of waves) {
      const c = Math.cos(((kx * x + kz * y) / size) * Math.PI * 2 + ph) * amp;
      ax += c * kx; az += c * kz;
    }
    sx[y * size + x] = ax; sz[y * size + x] = az; rms += ax * ax + az * az;
  }
  const norm = 0.24 / Math.sqrt(rms / (size * size)) / RIPPLE_SLOPE; // rms slope 0.24 per layer
  // Half-float, not 8-bit: quantized slopes show up as contour rings in smooth reflections.
  const data = new Uint16Array(size * size * 4), hf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = hf(sx[i] * norm * 0.5 + 0.5); data[i * 4 + 1] = hf(sz[i] * norm * 0.5 + 0.5); data[i * 4 + 3] = hf(1);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Small wind chop: [dirX, dirZ, wavelength m, amplitude m, phase]. Offshore wind, so it runs seaward. */
export const CHOP: [number, number, number, number, number][] = [
  [-0.26, 0.97, 15, 0.05, 0.3], [0.31, 0.95, 9.5, 0.04, 1.9], [-0.5, 0.87, 6.2, 0.028, 4.1],
  [0.09, 1.0, 4.1, 0.02, 2.6], [0.64, 0.77, 2.7, 0.012, 5.2],
];
/** Angular frequency for a chop wavelength, snapped so the animation loops when the hour-long time base wraps. */
export const chopOmega = (len: number) => (Math.round((Math.sqrt((9.81 * 2 * Math.PI) / len) / (2 * Math.PI)) * 3600) / 3600) * 2 * Math.PI;
/** Height of the chop at a point; `t` is seconds on the same wrapped time base the shader uses. Cosmetic: bobs boards. */
export function chopHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const [dx, dz, len, amp, ph] of CHOP) h += amp * Math.sin(((2 * Math.PI) / len) * (dx * x + dz * z) - chopOmega(len) * t + ph);
  return h;
}
