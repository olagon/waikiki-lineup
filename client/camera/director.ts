import * as THREE from 'three/webgpu';

export interface Subject { x: number; y: number; z: number; heading: number; speed: number; under?: number; mode?: 'paddle' | 'takeoff' | 'ride' | 'wipeout'; loom?: number } // loom: 0..1, a set wave is close in front

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Chooses where the camera sits. M1 has the paddling view; later milestones add the rest. */
export class Director {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private heading = Math.PI / 2;
  private started = false;
  private side = 1;
  private fov = 50; private beat: { kind: 'long' | 'punch'; until: number; span: number } | null = null; private swoopT = -1;
  reducedMotion = false;

  /** Start screen: a slow drift over the bay, the skyline and Lēʻahi in frame. */
  flyover(cam: THREE.PerspectiveCamera, t: number): void {
    cam.position.set(-150 + 70 * Math.sin(t * 0.045), 24 + 6 * Math.sin(t * 0.06), 215 + 30 * Math.cos(t * 0.04));
    cam.fov = 45; cam.updateProjectionMatrix();
    cam.lookAt(110 + 30 * Math.sin(t * 0.03), 4, 62);
    this.started = false;
  }
  /** First paddle-out: swoop from over Lēʻahi down to the surfer in the shallows. */
  swoop(): void { if (!this.reducedMotion) this.swoopT = 0; }
  /** A short directed moment: 'long' pulls back onto a long lens (a hoot), 'punch' tightens for a big takeoff. */
  cue(kind: 'long' | 'punch', seconds: number, now: number): void { if (!this.reducedMotion) this.beat = { kind, until: now + seconds, span: seconds }; }


  update(dt: number, s: Subject, cam: THREE.PerspectiveCamera, t: number): void {
    // Follow the heading with a little lag so turns read as turns.
    let dh = s.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * damp(3.2, dt);
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    const bob = Math.sin(t * 1.1) * 0.05;
    // A set wave close in front: ease down to the water so it looms.
    const low = (s.loom ?? 0) * 1.25;
    const wantPos = new THREE.Vector3(s.x - fx * (5.4 - low), Math.max(s.y, 0) + 1.9 - low + bob, s.z - fz * (5.4 - low));
    const wantLook = new THREE.Vector3(s.x + fx * 6, s.y + 0.6 + low * 0.5, s.z + fz * 6);
    // Going under: drop below the surface beside the surfer and look up at what is passing overhead.
    if (s.under && s.under > 0.15) { wantPos.set(s.x - fx * 2.6 - fz * 1.2, s.y - 0.5 - s.under, s.z - fz * 2.6 + fx * 1.2); wantLook.set(s.x + fx * 2, s.y + 0.1, s.z + fz * 2); }
    if (!this.started) { this.pos.copy(wantPos); this.look.copy(wantLook); this.heading = s.heading; this.started = true; }
    // Riding: from the shoulder ahead of the surfer, looking back at them and the curl. Takeoff: swing out to the side to show the drop.
    if (s.mode === 'ride' || s.mode === 'takeoff') {
      const side = Math.abs(Math.cos(s.heading)) > 0.2 ? Math.sign(Math.cos(s.heading)) : this.side;
      this.side = side;
      if (s.mode === 'takeoff') { wantPos.set(s.x + side * 6.5, s.y + 1.1, s.z - 2.2); wantLook.set(s.x, s.y + 0.9, s.z + 0.3); }
      else { wantPos.set(s.x + side * (7 + s.speed * 0.25), s.y + 1.6, s.z - 4.2); wantLook.set(s.x - side * 1.2, s.y + 0.9, s.z + 0.6); }
    }
    if (s.mode === 'wipeout') { wantPos.set(s.x + 1.8, s.y - 1.3, s.z - 2.4); wantLook.set(s.x, s.y - 0.3, s.z + 0.5); }
    this.pos.lerp(wantPos, damp(s.under && s.under > 0.15 ? 9 : s.mode === 'ride' || s.mode === 'takeoff' ? 3.5 : 5, dt));
    this.look.lerp(wantLook, damp(7, dt));
    cam.position.copy(this.pos);
    let fov = 50;
    if (this.beat) {
      const left = this.beat.until - t, k = Math.sin(Math.max(0, Math.min(1, 1 - left / this.beat.span)) * Math.PI);
      if (left <= 0) this.beat = null;
      else if (this.beat.kind === 'long') { cam.position.lerp(this.look, -2.2 * k); fov = 50 - 30 * k; } // back off and zoom: long-lens compression
      else fov = 50 - 7 * k;
    }
    if (this.swoopT >= 0) {
      this.swoopT += dt / 5.5;
      const u = Math.min(1, this.swoopT), e = u * u * (3 - 2 * u);
      cam.position.set(1100, 190, 420).lerp(this.pos, e);
      if (u >= 1) this.swoopT = -1;
    }
    this.fov += (fov - this.fov) * damp(6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.lookAt(this.look);
  }
}
