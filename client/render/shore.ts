// @ts-nocheck  (TSL node chains)
// Everything on land: the city ground, skyline massing with window lights, palms, park trees,
// the lifeguard tower, Lēʻahi and the Koʻolau (both from USGS elevation, see ASSETS.md).
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, attribute, positionWorld, positionLocal, normalWorld, cameraPosition, texture, max, mix, clamp, floor, fract, step, sin,
  exp, normalize, fwidth, mx_cell_noise_float, fog, positionView,
} from 'three/tsl';
import { groundY, shoreZ, vnoise } from '../../shared/bathy';
import { rngStream } from '../../shared/rng';
import { U, type Env } from './env';
import { skyLut, noiseTex } from './sky';
import { ss } from './tsl';
import { WATER } from '../ocean/ocean';

/** Accumulates colored geometry with one extra vec4 attribute into a single mesh (one draw call). */
class Builder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; ext: number[] = []; idx: number[] = [];
  vert(p: number[], n: number[], c: number[], e: number[] = [0, 0, 0, 0]): number {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.ext.push(e[0], e[1], e[2], e[3]);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  /** Axis-aligned box rotated by `yaw` about its center. Side faces carry facade coords (u, v in meters). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: number[], seed = 0, yaw = 0, roof = c): void {
    const co = Math.cos(yaw), si = Math.sin(yaw), hx = sx / 2, hz = sz / 2, y0 = cy - sy / 2, y1 = cy + sy / 2;
    const P = (lx: number, y: number, lz: number) => [cx + lx * co - lz * si, y, cz + lx * si + lz * co];
    const Nn = (lx: number, lz: number) => [lx * co - lz * si, 0, lx * si + lz * co];
    const sides: [number[], number[], number[], number][] = [
      [[-hx, hz], [hx, hz], [0, 1], sx], [[hx, hz], [hx, -hz], [1, 0], sz], [[hx, -hz], [-hx, -hz], [0, -1], sx], [[-hx, -hz], [-hx, hz], [-1, 0], sz],
    ];
    for (const [a, b, n, w] of sides) {
      const nn = Nn(n[0], n[1]);
      this.quad(this.vert(P(a[0], y0, a[1]), nn, c, [0, 0, seed, w]), this.vert(P(b[0], y0, b[1]), nn, c, [w, 0, seed, w]),
        this.vert(P(b[0], y1, b[1]), nn, c, [w, sy, seed, w]), this.vert(P(a[0], y1, a[1]), nn, c, [0, sy, seed, w]));
    }
    const up = [0, 1, 0];
    this.quad(this.vert(P(-hx, y1, hz), up, roof), this.vert(P(hx, y1, hz), up, roof), this.vert(P(hx, y1, -hz), up, roof), this.vert(P(-hx, y1, -hz), up, roof));
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('ext', new THREE.Float32BufferAttribute(this.ext, 4));
    g.setIndex(this.idx);
    return g;
  }
}

const jitter = (c: number[], r: () => number, k = 0.08) => { const f = 1 + (r() - 0.5) * 2 * k; return [c[0] * f, c[1] * f, c[2] * f]; };

// ---------------------------------------------------------------- skyline
function skyline(): THREE.Mesh {
  const r = rngStream(101), b = new Builder();
  // Cream, sand, shell pink, butter, sea-glass: colors that still read as colors when the seaward walls are in morning shade.
  const FACADES = [[0.92, 0.85, 0.7], [0.9, 0.77, 0.6], [0.95, 0.93, 0.88], [0.93, 0.74, 0.66], [0.72, 0.84, 0.82], [0.95, 0.87, 0.64], [0.86, 0.68, 0.56], [0.94, 0.9, 0.8], [0.8, 0.86, 0.9]];
  const tower = (x: number, z: number, w: number, d: number, h: number) => {
    const c = jitter(FACADES[Math.floor(r() * FACADES.length)], r), seed = 1 + Math.floor(r() * 9000), yaw = (r() - 0.5) * 0.5, roof = [0.42, 0.42, 0.43];
    b.box(x, 2.5 + h / 2, z, w, h, d, c, seed, yaw, roof);
    if (r() < 0.6) b.box(x + (r() - 0.5) * w * 0.3, 2.5 + h + 2, z, w * (0.3 + r() * 0.3), 4, d * (0.4 + r() * 0.3), jitter(c, r, 0.05), seed, yaw, roof);
    if (r() < 0.3) b.box(x, 2.5 + 6, z + d * 0.7, w * 1.5, 12, d * 0.9, jitter(c, r, 0.05), seed + 1, yaw, roof); // podium
  };
  // Rows step back from the beach; the cluster thins toward the park on the Lēʻahi side.
  const rows: [number, number, number, number, number, number, number][] = [
    // x0, x1, spacing, zNear, zFar, hMin, hMax
    [-980, 500, 46, 58, 92, 14, 112], [-1000, 520, 52, 125, 205, 45, 128], [-1050, 560, 44, 235, 420, 35, 135], [-1400, 600, 70, 450, 800, 30, 120],
    [-3600, -1250, 62, 150, 900, 25, 135], // the far cluster toward town
  ];
  for (const [x0, x1, sp, zn, zf, h0, h1] of rows) {
    for (let x = x0; x < x1; x += sp * (0.55 + r() * 0.9)) {
      const thin = x > 150 ? 1 - (x - 150) / 450 : 1; // fewer and lower near the park
      if (r() > 0.45 + 0.55 * thin) continue;
      const tall = r() ** 1.6;
      tower(x, shoreZ(Math.max(x, -900)) - (zn + r() * (zf - zn)), 20 + r() * 34, 17 + r() * 14, (h0 + tall * (h1 - h0)) * (0.55 + 0.45 * thin));
    }
  }
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0 });
  const e = attribute('ext', 'vec4'), base = attribute('color', 'vec3');
  // Facades. Four building styles picked per building: lanai grid, ribbon windows, glass tower, punched windows.
  const style = floor(mx_cell_noise_float(vec2(e.z, 3.3)).mul(4)); // 0..3
  const side = step(0.5, e.w).mul(ss(0.7, 1.3, e.x)).mul(ss(0.7, 1.3, e.w.sub(e.x))).mul(ss(4.5, 5.5, e.y)); // e.w is the wall's width; 0 on roofs
  const bayW = mx_cell_noise_float(vec2(e.z, 5.9)).mul(1.5).add(3.2); // each building has its own bay width
  const cuv = vec2(e.x.div(bayW), e.y.div(3.05)), cell = floor(cuv), f = fract(cuv);
  const aa = clamp(max(fwidth(cuv.x), fwidth(cuv.y)).mul(1.4), 0, 1); // fade detail before it shimmers
  const is = (k: number) => step(k - 0.5, style).mul(step(style, k + 0.5));
  const rect = (x0: number, x1: number, y0: number, y1: number) => ss(x0, x0 + 0.05, f.x).mul(ss(x1, x1 - 0.05, f.x)).mul(ss(y0, y0 + 0.05, f.y)).mul(ss(y1, y1 - 0.05, f.y));
  const band = ss(0.36, 0.42, f.y).mul(ss(0.92, 0.86, f.y));
  // Lanai towers read as stripes from the water: a pale band of slab edge and railing, then the dark recess behind it,
  // with only a thin party wall between bays. The recess is darkest right under the slab above.
  const recess = rect(0.03, 0.97, 0.47, 0.97), railing = rect(0.03, 0.97, 0.2, 0.47);
  const win = is(0).mul(recess).add(is(1).mul(band)).add(is(2).mul(rect(0.04, 0.96, 0.08, 0.96))).add(is(3).mul(rect(0.3, 0.72, 0.36, 0.84)));
  const cover = is(0).mul(0.47).add(is(1).mul(0.5)).add(is(2).mul(0.8)).add(is(3).mul(0.2)); // mean window area, for distance
  const glass = mix(win, cover, aa).mul(side);
  const slab = mix(step(f.y, 0.2), float(0.2), aa).mul(is(0)).mul(side); // lanai slab edges catch the light
  const rnd = mx_cell_noise_float(vec3(cell, e.z)), rnd2 = mx_cell_noise_float(vec3(cell.add(7.7), e.z));
  // Glass takes its color from the sky, so towers read as glazed by day and dark at night rather than as grids of holes.
  const glassCol = mix(vec3(0.03, 0.04, 0.05), vec3(0.05, 0.08, 0.11), is(2)).add(U.skyAmbient.mul(mix(float(1.5), float(2.3), is(2))));
  const floorLine = mix(step(f.y, 0.07), float(0.07), aa).mul(side).mul(0.1); // a slab edge on every floor
  const rail = mix(railing, float(0.27), aa).mul(is(0)).mul(side); // glass railings: a shade cooler and darker than the slab
  const wall = base.mul(slab.mul(0.12).add(1).add(floorLine)).mul(rail.mul(-0.14).add(1)).mul(ss(-10, 45, e.y).mul(0.14).add(0.9));
  // Behind the glass: mostly dark rooms, some with pale curtains drawn. Deepest shade at the top of each lanai.
  const curtain = step(0.62, rnd2).mul(aa.oneMinus()).mul(0.3);
  const under = mix(float(1), mix(float(0.55), float(1.05), ss(0.97, 0.6, f.y)), is(0).mul(aa.oneMinus()));
  mat.colorNode = mix(wall, mix(glassCol, base.mul(0.8), curtain).mul(under), glass.mul(mix(float(0.62), float(0.82), is(0))));
  mat.roughnessNode = mix(float(0.85), float(0.2), glass);
  // Window lights: a few at golden hour, a fifth or so at night, each building with its own habits.
  const habit = mx_cell_noise_float(vec2(e.z, 9.1)).mul(0.9).add(0.35);
  const frac = mix(float(0.035), float(0.26), ss(0.0, 0.75, U.night)).mul(habit);
  const on = step(float(1).sub(frac), rnd).mul(mix(win, cover.mul(0.6), aa)).mul(side);
  const warm = mix(vec3(1.0, 0.7, 0.4), vec3(0.8, 0.88, 1.0), step(0.88, rnd2));
  mat.emissiveNode = warm.mul(on).mul(rnd2.mul(rnd2).mul(1.1).add(0.25)).mul(float(1.15).div(U.exposure));
  const m = new THREE.Mesh(b.build(), mat);
  m.name = 'skyline';
  return m;
}

// ---------------------------------------------------------------- palms and trees
function vegetation(): THREE.Mesh {
  const r = rngStream(202), b = new Builder();
  const TRUNK = [0.3, 0.24, 0.17], FROND = [0.1, 0.2, 0.05];
  const palm = (x: number, z: number) => {
    const y0 = groundY(x, z), h = 8 + r() * 8, lean = (r() - 0.5) * 3.5, leanZ = 0.8 + r() * 1.8, ph = r() * 6.28, N = 7, S = 5;
    const spine = (t: number) => [x + lean * t * t, y0 + h * t, z + leanZ * t * t];
    let prev: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = spine(t), rad = 0.24 - 0.1 * t, ring: number[] = [];
      for (let k = 0; k < S; k++) {
        const a = (k / S) * 6.283, n = [Math.cos(a), 0, Math.sin(a)];
        ring.push(b.vert([c[0] + n[0] * rad, c[1], c[2] + n[2] * rad], n, jitter(TRUNK, r, 0.12), [t * t * 0.25, ph, 0, 0]));
      }
      if (i) for (let k = 0; k < S; k++) b.quad(prev[k], prev[(k + 1) % S], ring[(k + 1) % S], ring[k]);
      prev = ring;
    }
    const top = spine(1), nf = 10 + Math.floor(r() * 4);
    for (let fI = 0; fI < nf; fI++) {
      const a = (fI / nf) * 6.283 + r() * 0.5, len = 3.2 + r() * 1.4, rise = 0.5 + r() * 0.9, dx = Math.cos(a), dz = Math.sin(a), col = jitter(FROND, r, 0.25), F = 6;
      let pl: number[] = [];
      for (let i = 0; i <= F; i++) {
        const t = i / F, out = len * t, y = rise * Math.sin(t * 2.0) * 1.6 - 2.3 * t * t, w = 0.55 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) + 0.03;
        const c = [top[0] + dx * out, top[1] + y, top[2] + dz * out], sway = [0.25 + t * 0.75, ph + fI, 0, 0];
        // Folded like a real frond: a center rib with two halves angled down.
        const row = [b.vert([c[0] - dz * w, c[1] - w * 0.55, c[2] + dx * w], [0, 1, 0], col, sway), b.vert(c, [0, 1, 0], jitter(col, r, 0.1), sway), b.vert([c[0] + dz * w, c[1] - w * 0.55, c[2] - dx * w], [0, 1, 0], col, sway)];
        if (i) { b.quad(pl[0], pl[1], row[1], row[0]); b.quad(pl[1], pl[2], row[2], row[1]); }
        pl = row;
      }
    }
  };
  // Shade trees: a trunk and a wide, lumpy canopy made of several overlapping lobes.
  const lobeGeo = new THREE.IcosahedronGeometry(1, 1), lp = lobeGeo.attributes.position;
  const blob = (x: number, z: number, rad: number, h: number) => {
    const y0 = Math.max(2.55, groundY(x, z)), c = jitter([0.06, 0.135, 0.04], r, 0.3), ph = r() * 6.28, lobes = 4 + Math.floor(r() * 3);
    b.box(x, y0 + h * 0.35, z, 0.55, h * 0.7, 0.55, TRUNK);
    for (let l = 0; l < lobes; l++) {
      const a = (l / lobes) * 6.283 + r(), off = l === 0 ? 0 : rad * (0.35 + r() * 0.3), lr = rad * (l === 0 ? 0.75 : 0.45 + r() * 0.25);
      const cx = x + Math.cos(a) * off, cz = z + Math.sin(a) * off, cy = y0 + h * 0.78 + (l === 0 ? lr * 0.15 : (r() - 0.5) * lr * 0.4), base = b.pos.length / 3;
      for (let i = 0; i < lp.count; i++) {
        const n = [lp.getX(i), lp.getY(i), lp.getZ(i)];
        const k = 0.82 + 0.36 * vnoise(n[0] * 2.3 + ph + l, n[2] * 2.3 + n[1] * 3.1, 5), shade = 0.5 + 0.5 * Math.max(0, n[1] * 0.6 + 0.55) * k;
        b.vert([cx + n[0] * lr * k, cy + n[1] * lr * 0.5 * k, cz + n[2] * lr * k], n, [c[0] * shade, c[1] * shade, c[2] * shade], [0.05, ph, 0, 0]);
      }
      for (let i = 0; i < lp.count; i += 3) b.idx.push(base + i, base + i + 1, base + i + 2);
    }
  };
  // Palms line the back of the beach, thicker in clumps.
  for (let x = -760; x < 640; x += 5 + r() * 26) {
    const n = r() < 0.25 ? 3 : 1;
    for (let k = 0; k < n; k++) palm(x + k * (2 + r() * 3), shoreZ(x) - 16 - r() * 22);
  }
  // The park toward Lēʻahi: broad shade trees and more palms.
  for (let i = 0; i < 170; i++) {
    const x = 520 + r() * 900, z = shoreZ(x) - 30 - r() * r() * 520;
    if (r() < 0.75) blob(x, z, 7 + r() * 8, 9 + r() * 7); else palm(x, z);
  }
  for (let i = 0; i < 90; i++) { const x = -900 + r() * 1400; blob(x, shoreZ(x) - 36 - r() * 14, 3 + r() * 3.5, 5 + r() * 4); }
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0, roughness: 0.8, side: THREE.DoubleSide });
  const e = attribute('ext', 'vec4');
  // Trade-wind sway: tips move most, each plant on its own phase.
  const gust = sin(U.time.mul(1.4).add(e.y)).mul(0.6).add(sin(U.time.mul(3.1).add(e.y.mul(1.7))).mul(0.4));
  mat.positionNode = positionLocal.add(vec3(-0.17, -0.12, 0.98).mul(gust.mul(e.x).mul(0.55)));
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  m.name = 'vegetation';
  return m;
}

// ---------------------------------------------------------------- lifeguard tower
export const TOWER = { x: 14, z: shoreZ(14) - 15 };
function tower(): THREE.Mesh {
  const b = new Builder(), { x, z } = TOWER, y = groundY(x, z);
  const WOOD = [0.42, 0.34, 0.24], CABIN = [0.82, 0.7, 0.36], TRIM = [0.86, 0.84, 0.78], DARK = [0.06, 0.07, 0.08];
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(x + dx, y + 1.25, z + dz, 0.2, 2.9, 0.2, WOOD);
  b.box(x, y + 2.7, z, 3.6, 0.16, 3.9, TRIM); // deck
  b.box(x, y + 3.85, z - 0.35, 2.7, 2.15, 2.5, CABIN); // cabin
  b.box(x, y + 4.15, z + 0.92, 2.0, 0.9, 0.06, DARK); // seaward window
  b.box(x - 1.36, y + 4.15, z - 0.3, 0.06, 0.9, 1.5, DARK); b.box(x + 1.36, y + 4.15, z - 0.3, 0.06, 0.9, 1.5, DARK);
  b.box(x, y + 5.0, z, 4.0, 0.14, 4.3, TRIM); // roof with overhang
  for (const dx of [-1.7, 1.7]) b.box(x + dx, y + 3.3, z + 1.3, 0.07, 1.0, 0.07, TRIM);
  b.box(x, y + 3.75, z + 1.85, 3.5, 0.07, 0.07, TRIM); // rail
  for (let i = 0; i < 7; i++) b.box(x - 2.2 - i * 0.42, y + 2.5 - i * 0.37, z - 0.9, 0.44, 0.08, 1.1, WOOD); // steps down the side
  b.box(x + 1.95, y + 1.5, z + 0.4, 0.09, 2.9, 0.55, [0.75, 0.16, 0.12]); // rescue board leaning on a post
  const m = new THREE.Mesh(b.build(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0, roughness: 0.7 }));
  m.castShadow = m.receiveShadow = true;
  m.name = 'tower';
  return m;
}

// ---------------------------------------------------------------- land and mountains
function land(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(40000, 16000).rotateX(-Math.PI / 2).translate(0, 2.5, -8089);
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  const n = texture(noiseTex, positionWorld.xz.div(160)).r;
  mat.colorNode = mix(vec3(0.07, 0.11, 0.05), vec3(0.22, 0.2, 0.17), ss(0.42, 0.6, n));
  const m = new THREE.Mesh(g, mat);
  m.name = 'land';
  return m;
}

// Geography. World +x is compass bearing 125°, +z is 215°. Origin: the beach in front of the break.
const LAT0 = 21.2745, LON0 = -157.8262, M_LAT = 110574, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toWorld = (lat: number, lon: number): [number, number] => {
  const e = (lon - LON0) * M_LON, n = (lat - LAT0) * M_LAT;
  return [e * 0.819152 - n * 0.573576, -e * 0.573576 - n * 0.819152];
};
const LEAHI_SUMMIT = toWorld(21.2599, -157.8115), LEAHI_AT: [number, number] = [1750, 250]; // moved closer than life

async function dem(url: string, w: number, h: number, box: [number, number, number, number], stride: number,
  place: (x: number, z: number, elev: number) => [number, number, number]): Promise<THREE.BufferGeometry> {
  const u16 = new Uint16Array(await (await fetch(url)).arrayBuffer());
  const nx = Math.floor((w - 1) / stride) + 1, nz = Math.floor((h - 1) / stride) + 1, pos = new Float32Array(nx * nz * 3);
  const [lon0, lat0, lon1, lat1] = box;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const ci = i * stride, cj = j * stride;
    const [x, z] = toWorld(lat1 + (lat0 - lat1) * (cj / (h - 1)), lon0 + (lon1 - lon0) * (ci / (w - 1))); // row 0 is north
    pos.set(place(x, z, u16[cj * w + ci] / 10), (j * nx + i) * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, bb = a + 1, c = a + nx, d = c + 1;
    if (Math.max(pos[a * 3 + 1], pos[bb * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]) < -6) continue; // under the sea: not worth drawing
    idx.push(a, c, bb, bb, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

async function mountains(env: Env): Promise<THREE.Mesh[]> {
  const sink = (e: number, lo: number, hi: number) => { const t = Math.min(1, Math.max(0, (e - lo) / (hi - lo))); return e * t - 12 * (1 - t); };
  const dx = LEAHI_AT[0] - LEAHI_SUMMIT[0], dz = LEAHI_AT[1] - LEAHI_SUMMIT[1];
  const leahiGeo = await dem('/dem/leahi.u16', 256, 264, [-157.8235, 21.2455, -157.7885, 21.278], 1, (x, z, e) => [x + dx, sink(e, 4, 16) * 1.15, z + dz]);
  const leahiMat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  {
    // Dry grass on the gentle ground, bare rock where it is steep, darker in the gullies that flute the rim.
    const steep = ss(0.9, 0.62, normalWorld.y), y = positionWorld.y;
    const n = texture(noiseTex, positionWorld.xz.div(140)).g, fine = texture(noiseTex, positionWorld.xz.div(23)).r;
    const gully = texture(noiseTex, vec2(positionWorld.x.add(positionWorld.z).div(60), y.div(260))).b;
    const grass = mix(vec3(0.36, 0.33, 0.17), vec3(0.19, 0.25, 0.1), ss(140, 15, y).mul(0.65).add(n.mul(0.35)));
    const rock = mix(vec3(0.31, 0.24, 0.17), vec3(0.2, 0.16, 0.12), ss(0.4, 0.62, gully));
    leahiMat.colorNode = mix(grass, rock, steep.mul(0.85)).mul(fine.mul(0.35).add(0.82));
  }
  const leahi = new THREE.Mesh(leahiGeo, leahiMat);
  leahi.name = 'leahi';

  // The Koʻolau: pulled in to 55% of true distance so the ridges stand over the city as they do through a long lens.
  const K = 0.5, lc = toWorld(21.262, -157.806);
  const kooGeo = await dem('/dem/koolau.u16', 320, 330, [-157.92, 21.25, -157.66, 21.49], 2, (x, z, e) => {
    const nearLeahi = Math.hypot(x - lc[0], z - lc[1]) < 1900;
    return [x * K, sink(e, 30, 70) * Math.min(1, Math.max(0, (Math.hypot(x - lc[0], z - lc[1]) - 1700) / 900)) - (nearLeahi ? 12 : 0), z * K];
  });
  const kooMat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 1 });
  {
    const n = texture(noiseTex, positionWorld.xz.div(700)).r, steep = ss(0.95, 0.6, normalWorld.y);
    const green = mix(vec3(0.085, 0.16, 0.06), vec3(0.05, 0.1, 0.045), steep.mul(0.6).add(n.mul(0.4)));
    // The range sits in thicker, bluer air than the shore: fade the lit surface and add the sky's color in its place.
    const dir = normalize(positionWorld.sub(cameraPosition));
    const veil = float(1).sub(exp(positionView.z.div(4200)));
    kooMat.colorNode = green.mul(veil.oneMinus());
    kooMat.emissiveNode = skyLut(env, normalize(vec3(dir.x, max(dir.y, 0.03), dir.z))).mul(veil).mul(0.85);
  }
  const koo = new THREE.Mesh(kooGeo, kooMat);
  koo.name = 'koolau';
  return [leahi, koo];
}

/**
 * Scene fog. Above water: aerial haze that fades toward the sky color at the horizon in that direction.
 * With the camera under water: thick blue-green water fog instead.
 */
export function hazeNode(env: Env, visibility = WATER.visibility) {
  const dir = normalize(positionWorld.sub(cameraPosition));
  const col = skyLut(env, normalize(vec3(dir.x, max(dir.y, 0.02), dir.z)));
  const waterCol = vec3(WATER.scatter.x, WATER.scatter.y, WATER.scatter.z).mul(U.lightColor.mul(max(U.lightDir.y, 0).mul(0.6)).add(U.skyAmbient.mul(2.2)));
  return fog(mix(col, waterCol, U.under), mix(float(1).sub(exp(positionView.z.div(visibility))), float(1).sub(exp(positionView.z.mul(0.13))), U.under));
}

export async function createShore(env: Env): Promise<THREE.Group> {
  const g = new THREE.Group();
  g.add(land(), skyline(), vegetation(), tower(), ...(await mountains(env)));
  return g;
}
