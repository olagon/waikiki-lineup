import * as THREE from 'three/webgpu';

const EMOTE_TEXT = ['shaka', 'hoo!', 'go, go!', 'over there', 'splash', 'ha ha'];
const dotColor = (respect: number) => (respect < 35 ? '#e2574c' : respect > 70 ? '#ffc46b' : '#f4efe6');

/** A small name above a surfer: Respect dot, name, an injury mark, and for a moment whatever they just emoted. */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas'); private tex: THREE.CanvasTexture; private key = ''; private emote = -1; private emoteUntil = 0;

  constructor(private name: string) {
    this.canvas.width = 256; this.canvas.height = 96;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false }));
    this.sprite.renderOrder = 30;
  }
  say(emote: number): void { this.emote = emote; this.emoteUntil = performance.now() + 1800; }

  update(x: number, y: number, z: number, cam: THREE.Vector3, respect: number, cut: boolean, exposure = 1): void {
    const now = performance.now(), em = now < this.emoteUntil ? this.emote : -1, key = `${dotColor(respect)}|${cut}|${em}`;
    if (key !== this.key) {
      this.key = key;
      const c = this.canvas.getContext('2d')!;
      c.clearRect(0, 0, 256, 96);
      c.textBaseline = 'middle'; c.shadowColor = 'rgba(8,30,40,.7)'; c.shadowBlur = 6;
      c.font = '600 30px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      const w = c.measureText(this.name).width, x0 = 128 - (w + 24 + (cut ? 22 : 0)) / 2;
      c.fillStyle = dotColor(respect); c.beginPath(); c.arc(x0 + 7, 66, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f4efe6'; c.fillText(this.name, x0 + 24, 67);
      if (cut) { c.fillStyle = '#e2574c'; c.fillText('+', x0 + 30 + w, 66); }
      if (em >= 0) { c.font = '600 26px ui-sans-serif, system-ui, sans-serif'; c.fillStyle = '#ffc46b'; c.textAlign = 'center'; c.fillText(EMOTE_TEXT[em] ?? '', 128, 24); c.textAlign = 'left'; }
      this.tex.needsUpdate = true;
    }
    // Hold a readable size on screen out to the edge of the lineup, then let it go.
    const d = cam.distanceTo(this.sprite.position.set(x, y + 1.7, z)), s = Math.min(4.5, Math.max(0.75, d / 11));
    this.sprite.scale.set(1.28 * s, 0.48 * s, 1);
    // Sprites are drawn before exposure is applied: scale them down by it so a tag is the same brightness at noon and at midnight.
    (this.sprite.material as THREE.SpriteMaterial).color.setScalar(Math.min(1, 0.85 / exposure));
    this.sprite.visible = d < 90;
  }
}
