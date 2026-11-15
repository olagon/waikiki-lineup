// The HUD: almost nothing. A faint stamina ring, a line of help on a first session, a quiet score card.
const el = (tag: string, css: string, parent: HTMLElement): HTMLElement => { const e = document.createElement(tag); e.style.cssText = css; parent.append(e); return e; };

export class Hud {
  private ring: SVGCircleElement; private cross: HTMLElement; private label: HTMLElement; private born = performance.now(); private prompt: HTMLElement; private card: HTMLElement; private marker: HTMLElement;
  private seen = new Set<string>(JSON.parse(localStorage.getItem('wl.seen') ?? '[]'));
  private promptUntil = 0;

  constructor(root = document.getElementById('ui')!) {
    const wrap = el('div', 'position:absolute;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%);width:46px;height:46px;opacity:.55', root);
    wrap.innerHTML = '<svg viewBox="0 0 46 46" width="46" height="46"><circle cx="23" cy="23" r="19" fill="none" stroke="rgba(244,239,230,.22)" stroke-width="3"/><circle id="st" cx="23" cy="23" r="19" fill="none" stroke="#f4efe6" stroke-width="3" stroke-linecap="round" transform="rotate(-90 23 23)" stroke-dasharray="119.4"/></svg>';
    this.ring = wrap.querySelector('#st') as SVGCircleElement;
    this.cross = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#e2574c;font:600 20px/1 ui-sans-serif,system-ui', wrap);
    this.cross.textContent = '+';
    // The ring explains itself when it matters: for the first seconds in the water, and when it is nearly empty.
    this.label = el('div', 'position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:2px;font-size:11px;letter-spacing:.06em;white-space:nowrap;opacity:0;transition:opacity .6s ease-out', wrap);
    const touch = matchMedia('(pointer: coarse)').matches; // on phones the prompt sits above the touch buttons
    this.prompt = el('div', `position:absolute;left:50%;bottom:${touch ? 150 : 92}px;`+'transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(8,30,40,.45);backdrop-filter:blur(16px);font-size:15px;letter-spacing:.02em;opacity:0;transition:opacity .24s ease-out;white-space:nowrap', root);
    this.card = el('div', 'position:absolute;right:max(24px,env(safe-area-inset-right));top:max(24px,env(safe-area-inset-top));padding:14px 18px;border-radius:14px;background:rgba(8,30,40,.45);backdrop-filter:blur(16px);opacity:0;transition:opacity .6s ease-out;text-align:right', root);
    this.marker = el('div', 'position:absolute;top:50%;padding:6px 10px;border-radius:999px;background:rgba(8,30,40,.45);color:#f4efe6;font-size:13px;display:none', root);
  }

  stamina(v: number, cut: boolean): void {
    this.ring.style.strokeDashoffset = String(119.4 * (1 - Math.max(0, Math.min(1, v / 100))));
    this.ring.style.stroke = v <= 0 ? '#e2574c' : '#f4efe6';
    this.cross.style.display = cut ? 'flex' : 'none';
    const low = v < 25;
    this.label.textContent = low ? 'low stamina: sit up to rest' : 'stamina';
    this.label.style.opacity = low || performance.now() - this.born < 15000 ? '1' : '0';
  }

  /** One line of help. With `once`, only ever shown the first time (first-session tutorial). */
  say(text: string, once?: string, seconds = 2.6): void {
    if (once) { if (this.seen.has(once)) return; this.seen.add(once); localStorage.setItem('wl.seen', JSON.stringify([...this.seen])); }
    this.prompt.textContent = text; this.prompt.style.opacity = '1'; this.promptUntil = performance.now() + seconds * 1000;
  }

  score(score: number, seconds: number, extra: string): void {
    this.card.innerHTML = `<div style="font:600 28px/1.1 ui-sans-serif,system-ui">${score.toFixed(1)}</div><div style="font-size:13px;opacity:.8;letter-spacing:.02em">${seconds.toFixed(0)} s ride${extra ? ' · ' + extra : ''}</div>`;
    this.card.style.opacity = '1';
    setTimeout(() => { this.card.style.opacity = '0'; }, 3600);
  }

  /** Point toward the lifeguard tower while hurt. `side`: -1 left, 1 right, 0 hide. */
  tower(side: number): void {
    this.marker.style.display = side ? 'block' : 'none';
    this.marker.style.left = side < 0 ? '16px' : 'auto'; this.marker.style.right = side > 0 ? '16px' : 'auto';
    this.marker.textContent = side < 0 ? '‹ lifeguard' : 'lifeguard ›';
  }

  tick(): void { if (this.promptUntil && performance.now() > this.promptUntil) { this.prompt.style.opacity = '0'; this.promptUntil = 0; } }
}
