// The two in-game overlays: a radial emote wheel and a small roster. Both are held open rather than toggled
// (except by touch), so nothing lingers on screen. This file wires itself to the emote and roster controls.
import { onKey } from '../input/input';
import { onLongPress, onTwoFingerTap } from '../input/touch';
import { ACCENT, EASE, GLASS, LABEL, SAND, el } from './settings';

export interface RosterRow { name: string; bot: boolean; you: boolean; respect: number } // respect 0..100
export interface OverlayOptions { onEmote: (emote: number) => void; roster: () => RosterRow[] }
export const EMOTES: string[] = ['Shaka', 'Hoot', 'Go', 'Point', 'Splash', 'Laugh']; // index = emote id

const STEP = Math.PI / 3; // six segments; segment 0 is at the top, then clockwise

export function createOverlay(o: OverlayOptions): { openWheel(): void; closeWheel(): void; toggleRoster(show?: boolean): void } {
  const root = document.getElementById('ui')!;

  // ---- emote wheel ----
  const wheel = el('div', `position:absolute;left:50%;top:50%;width:min(300px,78vmin);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;${GLASS};opacity:0;transition:opacity ${EASE}`, root);
  const at = (r: number, a: number): string => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  wheel.innerHTML = `<svg viewBox="-100 -100 200 200" style="position:absolute;inset:0;width:100%;height:100%">${EMOTES.map((_, i) => {
    const a0 = (i - 2) * STEP, a1 = (i - 1) * STEP; // 60 degrees centered on straight up for i = 0
    return `<path d="M${at(99, a0)}A99 99 0 0 1 ${at(99, a1)}L${at(30, a1)}A30 30 0 0 0 ${at(30, a0)}Z" fill="transparent" stroke="rgba(244,239,230,.14)" stroke-width=".75" style="transition:fill ${EASE}"/>`;
  }).join('')}</svg>`;
  const wedges = [...wheel.querySelectorAll('path')];
  const labels = EMOTES.map((name, i) => { const a = (i - 1.5) * STEP; return el('div', `position:absolute;left:${50 + 33 * Math.cos(a)}%;top:${50 + 33 * Math.sin(a)}%;transform:translate(-50%,-50%);transition:color ${EASE}`, wheel, name); });

  let open = false, pick = -1;
  let px = innerWidth / 2, py = innerHeight / 2, byTouch = false; // last pointer seen
  let ox = 0, oy = 0, sx = 0, sy = 0, raf = 0; // aim origin, pointer position at open, gamepad poll

  const paint = (): void => labels.forEach((l, i) => { const on = i === pick; l.style.color = on ? ACCENT : SAND; l.style.fontWeight = on ? '600' : '400'; wedges[i].setAttribute('fill', on ? 'rgba(255,196,107,.16)' : 'transparent'); });
  /** Point at a segment with any vector; inside `dead` the pick is left alone. */
  const aim = (dx: number, dy: number, dead: number): void => {
    if (Math.hypot(dx, dy) < dead) return;
    const i = ((Math.round(Math.atan2(dy, dx) / STEP + 1.5) % 6) + 6) % 6;
    if (i !== pick) { pick = i; paint(); }
  };
  const track = (e: PointerEvent): void => {
    px = e.clientX; py = e.clientY; byTouch = e.pointerType === 'touch';
    if (!open) return;
    // A mouse points at the segment itself (once it has moved, so a quick tap of the key sends nothing by accident).
    // A finger drags from wherever it rested, like the stick.
    if (byTouch) aim(px - ox, py - oy, 24); else if (Math.hypot(px - sx, py - sy) > 6) aim(px - innerWidth / 2, py - innerHeight / 2, 30);
  };
  const stick = (): void => {
    const pad = navigator.getGamepads?.().find((g) => g);
    if (pad) aim(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.5);
    raf = requestAnimationFrame(stick);
  };
  const openWheel = (): void => {
    if (open) return;
    open = true; pick = -1; ox = sx = px; oy = sy = py; paint();
    wheel.style.opacity = '1'; raf = requestAnimationFrame(stick);
  };
  /** Release: send the highlighted emote, if any. `cancel` closes without sending. */
  const closeWheel = (cancel = false): void => {
    if (!open) return;
    open = false; wheel.style.opacity = '0'; cancelAnimationFrame(raf);
    if (!cancel && pick >= 0) o.onEmote(pick);
  };
  addEventListener('pointerdown', track); addEventListener('pointermove', track);
  addEventListener('pointerup', () => closeWheel()); // lift the finger, or click, to send
  addEventListener('pointercancel', () => closeWheel(true));
  addEventListener('keydown', (e) => { if (open && e.key === 'Escape') closeWheel(true); });
  addEventListener('blur', () => closeWheel(true));
  onKey('emote', (pressed) => (pressed ? openWheel() : closeWheel()));
  onLongPress(openWheel);

  // ---- roster ----
  const list = el('div', `position:absolute;left:max(24px,env(safe-area-inset-left));top:max(24px,env(safe-area-inset-top));box-sizing:border-box;min-width:160px;max-width:min(260px,70vw);max-height:calc(100% - 48px);overflow:hidden;padding:12px 16px;border-radius:14px;${GLASS};opacity:0;transition:opacity ${EASE}`, root);
  let shown = false, timer = 0;
  const render = (): void => {
    const rows = o.roster();
    list.replaceChildren(el('div', `${LABEL};margin-bottom:6px`, undefined, `Lineup · ${rows.length}`));
    for (const r of rows) {
      const row = el('div', `display:flex;align-items:center;gap:10px;padding:3px 0;font-weight:${r.you ? 600 : 400}`, list);
      el('span', `flex:none;width:8px;height:8px;border-radius:50%;background:${r.respect < 35 ? '#e2574c' : r.respect > 70 ? ACCENT : SAND}`, row);
      const name = el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', row, r.name); // textContent: names come from other players
      if (r.bot) el('span', 'font-weight:400;opacity:.55', name, ' · bot');
    }
  };
  const toggleRoster = (show = !shown): void => {
    if (show === shown) return;
    shown = show; list.style.opacity = show ? '1' : '0'; clearInterval(timer);
    if (show) { render(); timer = window.setInterval(render, 500); }
  };
  onKey('roster', (pressed) => toggleRoster(pressed));
  onTwoFingerTap(() => toggleRoster());

  return { openWheel, closeWheel: () => closeWheel(), toggleRoster };
}
