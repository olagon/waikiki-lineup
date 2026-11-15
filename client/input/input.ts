import { B, type Input } from '../../shared/physics';
import { DEFAULT_KEYS, inputHeld, keyFor, settings } from '../ui/settings';
import { touchInput } from './touch';

// Default bindings. Values are KeyboardEvent.code; the live binding for an action is keyFor(action), which
// applies any remap from settings.keys on top of these.
export const KEYS: Record<string, string> = DEFAULT_KEYS;

type Hold = 'emote' | 'roster';
const down = new Set<string>();
const subs: Record<Hold, ((pressed: boolean) => void)[]> = { emote: [], roster: [] };
const fire = (action: Hold, pressed: boolean): void => subs[action].forEach((cb) => cb(pressed));
const held = (code: string): Hold | null => (code === keyFor('emote') ? 'emote' : code === keyFor('roster') ? 'roster' : null);

/** Hear the emote or roster control go down and up, whatever key it is bound to (or D-pad up / Select on a gamepad). */
export function onKey(action: Hold, cb: (pressed: boolean) => void): void { subs[action].push(cb); }

addEventListener('keydown', (e) => {
  // Menus own the keyboard while they are open, text fields always, and browser shortcuts stay the browser's.
  if (inputHeld() || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!Object.keys(KEYS).some((a) => keyFor(a) === e.code)) return;
  e.preventDefault();
  if (down.has(e.code)) return; // key repeat
  down.add(e.code);
  const h = held(e.code); if (h) fire(h, true);
});
addEventListener('keyup', (e) => { if (down.delete(e.code)) { const h = held(e.code); if (h) fire(h, false); } });

// Mouse steering: hold the left button on the canvas and drag. Full deflection 120 px from where the drag began.
let dragX: number | null = null, mouseSteer = 0;
const endDrag = (): void => { dragX = null; mouseSteer = 0; };
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0 || !(e.target instanceof HTMLCanvasElement) || inputHeld()) return;
  dragX = e.clientX; e.target.setPointerCapture(e.pointerId); // capture: the release still arrives from outside the window
});
addEventListener('pointermove', (e) => { if (dragX !== null && e.pointerType === 'mouse') mouseSteer = (e.clientX - dragX) / 120; });
addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') endDrag(); });
addEventListener('pointercancel', (e) => { if (e.pointerType === 'mouse') endDrag(); });

addEventListener('blur', () => { for (const code of down) { const h = held(code); if (h) fire(h, false); } down.clear(); endDrag(); });

const padWas: Record<Hold, boolean> = { emote: false, roster: false };
function padHold(action: Hold, pressed: boolean): void { if (pressed !== padWas[action]) { padWas[action] = pressed; fire(action, pressed); } }

/** Sample the current input for one simulation tick: keyboard, mouse drag, the first connected gamepad, and touch. */
export function sampleInput(): Input {
  const pad = navigator.getGamepads?.().find((g) => g);
  const open = !inputHeld();
  padHold('emote', open && !!pad?.buttons[12]?.pressed); // D-pad up
  padHold('roster', open && !!pad?.buttons[8]?.pressed); // Select / Back
  if (!open) return { buttons: 0, steer: 0 };
  let buttons = 0, steer = mouseSteer;
  if (down.has(keyFor('paddle'))) buttons |= B.paddle | B.forward;
  if (down.has(keyFor('sit'))) buttons |= B.sit | B.back;
  if (down.has(keyFor('action'))) buttons |= B.action;
  if (down.has(keyFor('dive'))) buttons |= B.dive;
  if (down.has(keyFor('kick'))) buttons |= B.kick;
  if (down.has(keyFor('left'))) steer -= 1;
  if (down.has(keyFor('right'))) steer += 1;
  if (pad) {
    if (pad.buttons[7]?.value > 0.3) buttons |= B.paddle; // right trigger
    if (pad.buttons[0]?.pressed) buttons |= B.action; // A
    if (pad.buttons[2]?.pressed) buttons |= B.dive; // X
    if (pad.buttons[1]?.pressed) buttons |= B.sit; // B
    if (pad.buttons[3]?.pressed) buttons |= B.kick; // Y
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    if (Math.abs(ax) > 0.15) steer += ax;
    if (ay < -0.5) buttons |= B.forward; else if (ay > 0.5) buttons |= B.back;
  }
  const touch = touchInput();
  if (touch) { buttons |= touch.buttons; steer += touch.steer; }
  steer = Math.max(-1, Math.min(1, steer));
  return { buttons, steer: settings.invertSteer ? -steer : steer };
}

/** Gamepad rumble where the browser supports it. */
export function rumble(strength: number, ms: number): void {
  const pad = navigator.getGamepads?.().find((g) => g) as (Gamepad & { vibrationActuator?: { playEffect(type: string, p: object): Promise<unknown> } }) | undefined;
  pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
}
