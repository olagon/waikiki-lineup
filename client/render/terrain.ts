// @ts-nocheck  (TSL node chains)
// Beach and sea floor, built from shared/bathy.ts so what you see is what physics uses.
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, attribute, positionWorld, texture, max, mix, clamp, pow, exp, sin, abs, uniform, fwidth } from 'three/tsl';
import { groundY, reefMask, shoreZ, vnoise } from '../../shared/bathy';
import { U } from './env';
import { noiseTex } from './sky';
import { ss } from './tsl';
import { WATER } from '../ocean/ocean';

function patch(x0: number, x1: number, z0: number, z1: number, step: number, sink?: (x: number, z: number) => number): THREE.BufferGeometry {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), info = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, o = (j * nx + i) * 3, e = 0.75;
    pos[o] = x; pos[o + 1] = groundY(x, z) - (sink ? sink(x, z) : 0); pos[o + 2] = z;
    const n = new THREE.Vector3(groundY(x - e, z) - groundY(x + e, z), 2 * e, groundY(x, z - e) - groundY(x, z + e)).normalize();
    nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
    const relief = vnoise(x / 11, z / 11, 11) * 0.65 + vnoise(x / 3.7, z / 3.7, 12) * 0.35;
    info[(j * nx + i) * 2] = reefMask(x, z) * (0.55 + 0.9 * relief); // how much reef shows here
    info[(j * nx + i) * 2 + 1] = shoreZ(x) - z; // meters inland of the waterline
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('info', new THREE.BufferAttribute(info, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Sunlight focused by the surface into a moving web of bright lines on the bottom. */
export const caustics = (p, depth) => {
  const uv = p.add(U.lightDir.xz.mul(depth.mul(0.3))).div(3.1);
  const n1 = texture(noiseTex, uv.add(vec2(U.time.mul(0.03), U.time.mul(0.018)))).r;
  const n2 = texture(noiseTex, uv.mul(1.31).add(vec2(U.time.mul(-0.023), U.time.mul(0.027))).add(0.5)).b;
  const web = pow(clamp(float(1).sub(abs(n1.add(n2).sub(1)).mul(5.5)), 0, 1), 2.2).mul(1.6);
  // The web comes and goes in drifting patches, as the surface above it is rougher here and calmer there.
  const patches = texture(noiseTex, p.div(47).add(vec2(U.time.mul(0.004), 0))).g.mul(1.5).sub(0.2);
  // Far off, the lines are finer than a pixel: settle to their average instead of a flat glare.
  const far = ss(0.012, 0.05, max(fwidth(uv.x), fwidth(uv.y)));
  return mix(web.mul(clamp(patches, 0.25, 1)), float(0.28), far);
};

export function createTerrain(): THREE.Group {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const p = positionWorld.xz, y = positionWorld.y;
  const reef = attribute('info', 'vec2').x, inland = attribute('info', 'vec2').y;
  const depth = max(y.negate(), 0);
  const grain = texture(noiseTex, p.div(7.3)).a, fine = texture(noiseTex, p.div(1.3)).g;

  const sandRipple = sin(p.y.mul(2.4).add(grain.mul(9))).mul(0.035).mul(ss(0.1, 0.6, depth));
  const sand = mix(vec3(0.8, 0.68, 0.46), vec3(0.78, 0.74, 0.62), ss(-0.1, 0.5, depth)).mul(grain.mul(0.22).add(0.86).add(sandRipple));
  const reefCol = mix(vec3(0.1, 0.115, 0.07), vec3(0.2, 0.17, 0.09), fine);
  const reefAmt = ss(0.42, 0.78, reef.add(fine.sub(0.5).mul(0.35)));
  // Behind the beach: a low wall, a pale walkway, then planted ground.
  const walk = mix(vec3(0.5, 0.48, 0.44), vec3(0.11, 0.17, 0.07), ss(40, 48, inland));
  let albedo = mix(mix(sand, reefCol, reefAmt), walk, ss(31, 33, inland));
  const wet = ss(0.45, 0.05, y).mul(ss(-0.6, -0.1, y).oneMinus().mul(0.5).add(0.5));
  albedo = albedo.mul(mix(float(1), float(0.6), wet.mul(ss(-0.2, 0.0, y))));
  // Light loses its red on the way down, the same way it does on the way back up to the eye.
  const sunk = exp(uniform(WATER.absorb).mul(depth).mul(-1.1));
  mat.colorNode = albedo.mul(sunk);
  mat.roughnessNode = mix(float(0.95), float(0.5), wet);
  const under = ss(0.02, 0.3, depth);
  // A shadow on the bottom softens with the water over it; at full strength a surfer's shadow reads as a shark.
  mat.receivedShadowNode = (shadow) => mix(vec3(1), shadow, exp(depth.mul(-0.55)).mul(0.75).add(mix(float(0.25), float(0), under)));
  mat.emissiveNode = albedo.mul(sunk).mul(U.lightColor).mul(max(U.lightDir.y, 0)).mul(caustics(p, depth)).mul(under).mul(exp(depth.mul(-0.22))).mul(0.5);

  const near = new THREE.Mesh(patch(-210, 210, -36, 210, 1.5), mat);
  const inNear = (x: number, z: number) => (Math.abs(x) < 204 && z > -30 && z < 204 ? 0.3 : 0);
  const far = new THREE.Mesh(patch(-1100, 1402, -94, 620, 6, inNear), mat);
  near.receiveShadow = far.receiveShadow = true;
  near.name = 'terrainNear'; far.name = 'terrainFar';
  const g = new THREE.Group();
  g.add(near, far, new THREE.Mesh(patch(-4300, -1100, -92, 620, 16), mat), new THREE.Mesh(patch(1400, 4600, -92, 620, 16), mat));
  return g;
}
