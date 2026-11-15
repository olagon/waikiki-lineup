// @ts-nocheck  (TSL node chains)
// Foam that surfers leave on the water: a small top-down texture that follows the camera.
// Each frame the old foam is carried over (scrolled, faded) and new splats are stamped on top.
import * as THREE from 'three/webgpu';
import { texture, uniform, uv, vec2, vec4, length, float, max } from 'three/tsl';
import { ss } from '../render/tsl';

const SIZE = 256, SPAN = 96, TEXEL = SPAN / SIZE, MAX_SPLATS = 96;

export class Wake {
  /** Sample with `wake.sample(worldXZ)` in the ocean shader: returns foam 0..1. */
  private rt = [0, 1].map(() => new THREE.RenderTarget(SIZE, SIZE, { depthBuffer: false, type: THREE.UnsignedByteType }));
  private cur = 0;
  private center = new THREE.Vector2(); private uCenter = uniform(new THREE.Vector2());
  private uScroll = uniform(new THREE.Vector2()); private uDecay = uniform(1);
  private prevNode = texture(this.rt[0].texture); private outNode = texture(this.rt[0].texture);
  private scene = new THREE.Scene(); private cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
  private splats: THREE.InstancedMesh; private n = 0; private m = new THREE.Matrix4();

  constructor() {
    const carry = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }));
    const suv = uv().add(this.uScroll), inside = ss(0.0, 0.02, suv.x).mul(ss(1.0, 0.98, suv.x)).mul(ss(0.0, 0.02, suv.y)).mul(ss(1.0, 0.98, suv.y));
    carry.material.colorNode = vec4(this.prevNode.sample(suv).rgb.mul(this.uDecay).mul(inside), 1);
    carry.renderOrder = 0;
    const dot = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    dot.colorNode = vec4(float(1), float(1), float(1), ss(1.0, 0.2, length(uv().sub(0.5)).mul(2)).mul(0.5));
    this.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dot, MAX_SPLATS);
    this.splats.renderOrder = 1; this.splats.frustumCulled = false; this.splats.visible = false;
    this.cam.position.z = 1;
    this.scene.add(carry, this.splats);
    for (const r of this.rt) { r.texture.minFilter = r.texture.magFilter = THREE.LinearFilter; r.texture.wrapS = r.texture.wrapT = THREE.ClampToEdgeWrapping; }
  }

  /** Foam amount at a world position (node). */
  sample(p) {
    const u = p.sub(this.uCenter).div(SPAN).add(0.5);
    const inside = ss(0.0, 0.04, u.x).mul(ss(1.0, 0.96, u.x)).mul(ss(0.0, 0.04, u.y)).mul(ss(1.0, 0.96, u.y));
    return this.outNode.sample(vec2(u.x, float(1).sub(u.y))).r.mul(inside);
  }

  /** Stamp foam at a world position. radius in meters, strength 0..1. */
  splat(x: number, z: number, radius: number, strength: number): void {
    if (this.n >= MAX_SPLATS) return;
    const s = radius * 2 / SPAN;
    this.m.makeScale(s, s, 1).setPosition((x - this.center.x) / SPAN, -(z - this.center.y) / SPAN, 0);
    this.splats.setMatrixAt(this.n, this.m);
    this.splats.setColorAt(this.n++, new THREE.Color(strength, strength, strength));
  }

  update(renderer: THREE.WebGPURenderer, focus: THREE.Vector3, dt: number): void {
    const nx = Math.round(focus.x / TEXEL) * TEXEL, nz = Math.round(focus.z / TEXEL) * TEXEL;
    this.uScroll.value.set((nx - this.center.x) / SPAN, -(nz - this.center.y) / SPAN);
    // Splats were placed against the old center; shift them to the new one.
    for (let i = 0; i < this.n; i++) { this.splats.getMatrixAt(i, this.m); this.m.elements[12] -= (nx - this.center.x) / SPAN; this.m.elements[13] += (nz - this.center.y) / SPAN; this.splats.setMatrixAt(i, this.m); }
    this.center.set(nx, nz); this.uCenter.value.set(nx, nz);
    this.uDecay.value = Math.exp(-dt / 3.2);
    this.splats.count = Math.max(1, this.n); this.splats.visible = this.n > 0; this.splats.instanceMatrix.needsUpdate = true; if (this.splats.instanceColor) this.splats.instanceColor.needsUpdate = true;
    const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
    this.prevNode.value = src.texture;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(dst); renderer.render(this.scene, this.cam); renderer.setRenderTarget(prevTarget);
    this.outNode.value = dst.texture;
    this.cur = 1 - this.cur; this.n = 0;
  }
}
