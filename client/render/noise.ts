import * as THREE from 'three/webgpu';
import { hash32 } from '../../shared/rng';

/** Tileable value-noise fbm, one independent field per channel. Used by clouds, sand, reef, foam. */
export function makeNoiseTexture(size = 256, seed = 7): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let ch = 0; ch < 4; ch++) {
    const f = new Float32Array(size * size);
    let amp = 0.5, norm = 0;
    for (let period = 8 << (ch & 1); period <= size / 2; period *= 2, amp *= 0.5) {
      norm += amp;
      const cell = size / period;
      const lat = (x: number, y: number) => hash32(seed, ch, period, ((x % period) + period) % period, ((y % period) + period) % period) / 4294967296;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), u = smooth(gx - x0), v = smooth(gy - y0);
        f[y * size + x] += amp * ((lat(x0, y0) * (1 - u) + lat(x0 + 1, y0) * u) * (1 - v) + (lat(x0, y0 + 1) * (1 - u) + lat(x0 + 1, y0 + 1) * u) * v);
      }
    }
    for (let i = 0; i < f.length; i++) data[i * 4 + ch] = Math.round((f[i] / norm) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8; // foam and lace are seen at a slant; without this they blur to flat sheets a short way out
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
