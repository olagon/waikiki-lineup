// Touch controls: a floating stick under the left thumb, hold and swipe under the right, and two small buttons.
// Listeners go on the window and only take touches that land on the canvas, so menus above it are never blocked.
import { B } from '../../shared/physics';
import { EASE, GLASS, SAND, el, inputHeld } from '../ui/settings';

const STICK_R = 56; // px of travel for full deflection
const DEAD = 0.12; // stick dead zone, as a fraction of STICK_R
const SWIPE = 44, SWIPE_MS = 180; // a swipe is this many px inside this window (about 250 px/s or faster)
const PADDLE_MS = 90; // a right-thumb hold starts paddling after this, so a fresh swipe does not also paddle
const PULSE_MS = 160; // taps and swipes stay pressed this long: three ticks at 20 Hz, so the simulation cannot miss them
const LONG_MS = 500, STILL = 10; // long-press time, and how far a finger may drift and still count as still
const TAP_MS = 350, PAIR_MS = 150, PAIR_PX = 180; // two-finger tap: two quick taps, together in time and place

interface Finger {
  role: 'stick' | 'right' | 'idle';
  x: number; y: number; x0: number; y0: number; t0: number; moved: boolean;
  ox: number; oy: number; // stick origin (it follows a thumb that drags past the rim)
  trail: [t: number, x: number, y: number][]; // recent samples; the first is where the finger was SWIPE_MS ago
  hold: boolean; // swiped down and still down: action stays held (the turtle roll)
}

let built = false, installed = false;
let base: HTMLElement, knob: HTMLElement;
const fingers = new Map<number, Finger>();
let steer = 0, push = 0; // stick: x and y, each -1..1
let actionUntil = 0, actionBit = B.action, sitUntil = 0, kickUntil = 0, sitDown = false, kickDown = false;
let longTimer = 0, lastTap: { t: number; t0: number; x: number; y: number } | null = null;
let longPress: (() => void) | null = null, twoFingerTap: (() => void) | null = null;

/** Called when the left thumb rests still for 500 ms (the emote wheel). */
export function onLongPress(cb: () => void): void { longPress = cb; }
/** Called on a two-finger tap (the roster). */
export function onTwoFingerTap(cb: () => void): void { twoFingerTap = cb; }

/** Call once. Does nothing without a touch screen; the on-screen pieces appear on the first real touch, so a laptop with a touch screen and a mouse stays clean. */
export function installTouch(): void {
  if (installed || !navigator.maxTouchPoints) return;
  installed = true;
  addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

/** Current touch state, or null when there is no touch layer. */
export function touchInput(): { buttons: number; steer: number } | null {
  if (!built) return null;
  const now = performance.now();
  let buttons = 0;
  for (const f of fingers.values()) if (f.role === 'right') buttons |= f.hold ? B.dive : now - f.t0 > PADDLE_MS ? B.paddle : 0;
  if (now < actionUntil) buttons |= actionBit;
  if (sitDown || now < sitUntil) buttons |= B.sit;
  if (kickDown || now < kickUntil) buttons |= B.kick;
  if (push < -0.5) buttons |= B.forward; else if (push > 0.5) buttons |= B.back;
  return { buttons, steer };
}

function build(): void {
  built = true;
  const root = el('div', 'position:absolute;inset:0', document.getElementById('ui')!);
  base = el('div', `position:absolute;left:0;top:0;width:${STICK_R * 2}px;height:${STICK_R * 2}px;margin:${-STICK_R}px;box-sizing:border-box;border-radius:50%;border:1.5px solid rgba(244,239,230,.3);opacity:0;transition:opacity ${EASE}`, root);
  knob = el('div', `position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px;border-radius:50%;${GLASS};box-shadow:inset 0 0 0 1.5px rgba(244,239,230,.45);opacity:0;transition:opacity ${EASE}`, root);
  const round = (size: number, lift: number, label: string, svg: string, set: (on: boolean) => void): void => {
    const b = el('button', `position:absolute;left:calc(50% + 44px);bottom:calc(max(22px,env(safe-area-inset-bottom)) + ${lift}px);width:${size}px;height:${size}px;margin:0 ${(48 - size) / 2}px;padding:0;border:0;border-radius:50%;${GLASS};color:${SAND};pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;opacity:.8;transition:opacity ${EASE}`, root);
    b.type = 'button'; b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto">${svg}</svg>`;
    const press = (on: boolean): void => { set(on); b.style.opacity = on ? '1' : '.8'; };
    b.onpointerdown = (e) => { b.setPointerCapture(e.pointerId); press(true); };
    b.onpointerup = b.onpointercancel = () => press(false);
  };
  // Sit up / lie down: a board seen from above. Kick out: a chevron over the back of the wave.
  round(48, 0, 'Sit up or lie down', '<g transform="rotate(38 12 12)"><path d="M12 1.5c3.2 3.6 4.3 7.2 4.3 10.6S15.2 19 12 22.5C8.8 19 7.7 15.5 7.7 12.1S8.8 5.1 12 1.5z"/><path d="M12 5.5v13" opacity=".5"/></g>', (on) => { sitDown = on; if (on) sitUntil = performance.now() + PULSE_MS; });
  round(40, 58, 'Kick out', '<path d="M6 14.5l6-6 6 6"/>', (on) => { kickDown = on; if (on) kickUntil = performance.now() + PULSE_MS; });
}

const place = (e: HTMLElement, x: number, y: number): void => { e.style.transform = `translate(${x}px,${y}px)`; };
function releaseStick(f: Finger): void { f.role = 'idle'; steer = push = 0; base.style.opacity = knob.style.opacity = '0'; }

function down(e: PointerEvent): void {
  if (e.pointerType !== 'touch' || !(e.target instanceof HTMLCanvasElement) || inputHeld()) return;
  if (!built) build();
  const now = performance.now(), x = e.clientX, y = e.clientY, left = x < innerWidth / 2;
  const hasStick = [...fingers.values()].some((f) => f.role === 'stick');
  const f: Finger = { role: left ? (hasStick ? 'idle' : 'stick') : 'right', x, y, x0: x, y0: y, t0: now, moved: false, ox: x, oy: y, trail: [[now, x, y]], hold: false };
  clearTimeout(longTimer); // a long-press is one thumb, alone and still
  if (f.role === 'stick') {
    place(base, x, y); place(knob, x, y); base.style.opacity = knob.style.opacity = '1';
    if (!fingers.size) longTimer = window.setTimeout(() => { if (f.role === 'stick' && !f.moved && longPress) { releaseStick(f); longPress(); } }, LONG_MS);
  }
  fingers.set(e.pointerId, f);
}

function move(e: PointerEvent): void {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  const now = performance.now();
  f.x = e.clientX; f.y = e.clientY;
  if (!f.moved && Math.hypot(f.x - f.x0, f.y - f.y0) > STILL) { f.moved = true; if (f.role === 'stick') clearTimeout(longTimer); }
  if (f.role === 'stick') {
    let dx = f.x - f.ox, dy = f.y - f.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) { f.ox += dx * (1 - STICK_R / len); f.oy += dy * (1 - STICK_R / len); dx = f.x - f.ox; dy = f.y - f.oy; place(base, f.ox, f.oy); }
    place(knob, f.x, f.y);
    steer = Math.abs(dx) < DEAD * STICK_R ? 0 : dx / STICK_R; push = dy / STICK_R;
  } else if (f.role === 'right' && !f.hold) {
    // Measure against where the finger was SWIPE_MS ago, so a slow drift never adds up to a swipe.
    f.trail.push([now, f.x, f.y]);
    while (f.trail.length > 1 && now - f.trail[1][0] >= SWIPE_MS) f.trail.shift();
    const dx = f.x - f.trail[0][1], dy = f.y - f.trail[0][2];
    if (Math.abs(dy) > SWIPE && Math.abs(dy) > 1.5 * Math.abs(dx)) {
      actionUntil = now + PULSE_MS; actionBit = dy > 0 ? B.dive : B.action; // up: pop up. Down: duck dive, and
      f.hold = dy > 0; // the action stays held while the finger stays down, for the roll
      f.trail = [[now, f.x, f.y]];
    }
  }
}

function up(e: PointerEvent): void {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  fingers.delete(e.pointerId);
  const now = performance.now();
  if (f.role === 'stick') { clearTimeout(longTimer); releaseStick(f); }
  if (f.moved || now - f.t0 > TAP_MS || e.type === 'pointercancel') return;
  // A quick tap. Two of them, close together in time and place, are a two-finger tap.
  if (lastTap && now - lastTap.t < PAIR_MS + 50 && Math.abs(f.t0 - lastTap.t0) < PAIR_MS && Math.hypot(f.x0 - lastTap.x, f.y0 - lastTap.y) < PAIR_PX) { lastTap = null; twoFingerTap?.(); } else lastTap = { t: now, t0: f.t0, x: f.x0, y: f.y0 };
}
