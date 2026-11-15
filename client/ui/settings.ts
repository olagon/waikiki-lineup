// Settings and profile: one small store in localStorage and the two modal panels that edit it.
// Also home to the few DOM helpers the menu files share (same idiom as hud.ts). Imports nothing from input/, so
// input.ts, touch.ts, start.ts and overlay.ts can all depend on this file without a cycle.
import { COLORS, DEFAULT_LOOK, HAIR, SKIN, type Look } from '../../shared/looks';

// ---- look and feel (ART.md, "Typography and UI") ----
export const SAND = '#f4efe6', ACCENT = '#ffc46b', INK = '#0b2a3a';
export const EASE = '.24s ease-out';
export const GLASS = 'background:rgba(8,30,40,.45);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)';
export const EDGE = 'box-shadow:inset 0 0 0 1px rgba(244,239,230,.1)'; // a hairline, so glass still reads over dark water
export const PILL = `${GLASS};${EDGE};padding:11px 18px;border-radius:999px`;
export const LABEL = 'font-size:13px;letter-spacing:.02em;text-transform:uppercase;opacity:.65';
const WELL = 'background:rgba(244,239,230,.08)'; // a recessed control inside a glass panel

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.style.cssText = css; if (text !== undefined) e.textContent = text; parent?.append(e); return e;
}
/** A bare button. Hover is a light veil, nothing moves. Add PILL (or any background) through `css`. */
export function button(label: string, css: string, parent: HTMLElement, onClick: () => void): HTMLButtonElement {
  const b = el('button', `pointer-events:auto;cursor:pointer;font:inherit;color:inherit;border:0;margin:0;padding:0;background:none;-webkit-tap-highlight-color:transparent;transition:box-shadow ${EASE},background ${EASE},border-color ${EASE},opacity ${EASE};${css}`, parent, label);
  b.type = 'button'; b.onclick = onClick;
  const rest = b.style.boxShadow;
  b.onpointerenter = () => { b.style.boxShadow = `${rest ? rest + ',' : ''}inset 0 0 0 99px rgba(244,239,230,.09)`; };
  b.onpointerleave = () => { b.style.boxShadow = rest; };
  return b;
}
const ui = (): HTMLElement => document.getElementById('ui')!;
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* private mode or full: the session still works */ } };

// ---- input hold: while a menu is open the game gets neutral input (input.ts and touch.ts read this) ----
let holds = 0;
export const inputHeld = (): boolean => holds > 0;
export function holdInput(on: boolean): void { holds = Math.max(0, holds + (on ? 1 : -1)); }

// ---- settings store ----
export interface Settings {
  quality: 'auto' | 'ultra' | 'high' | 'mobile';
  volume: { master: number; sfx: number; ambience: number }; // 0..1
  reducedMotion: boolean;
  invertSteer: boolean;
  colorblind: boolean; // colorblind-safe priority colors
  keys: Record<string, string>; // action -> KeyboardEvent.code. Overrides only: anything missing uses DEFAULT_KEYS.
}
/** Starting bindings (PROMPT.md, "Controls"). input.ts re-exports this as KEYS. */
export const DEFAULT_KEYS: Record<string, string> = { paddle: 'KeyW', left: 'KeyA', right: 'KeyD', sit: 'KeyS', action: 'Space', dive: 'KeyX', kick: 'KeyE', emote: 'KeyQ', roster: 'Tab' };
export const keyFor = (action: string): string => settings.keys[action] ?? DEFAULT_KEYS[action];

const QUALITY = ['auto', 'ultra', 'high', 'mobile'] as const;
function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem('wl.settings') ?? '{}') ?? {}; } catch { /* corrupt: defaults */ }
  const unit = (v: unknown, d: number): number => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  return {
    quality: QUALITY.includes(s.quality!) ? s.quality! : 'auto',
    volume: { master: unit(s.volume?.master, 0.8), sfx: unit(s.volume?.sfx, 0.8), ambience: unit(s.volume?.ambience, 0.7) },
    reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : matchMedia('(prefers-reduced-motion: reduce)').matches,
    invertSteer: s.invertSteer === true,
    colorblind: s.colorblind === true,
    keys: Object.fromEntries(Object.entries(s.keys ?? {}).filter(([a, code]) => a in DEFAULT_KEYS && typeof code === 'string')),
  };
}
export const settings: Settings = load();
const listeners: ((s: Settings) => void)[] = [];
export function onSettingsChange(cb: (s: Settings) => void): void { listeners.push(cb); }
function commit(): void { store('wl.settings', JSON.stringify(settings)); listeners.forEach((cb) => cb(settings)); }

// ---- profile ----
export interface Profile { name: string; look: Look }
const LOOK_MAX: Record<keyof Look, number> = { skin: SKIN.length - 1, build: 3, hair: 3, hairColor: HAIR.length - 1, top: 3, topColor: COLORS.length - 1, shortsColor: COLORS.length - 1, board: 2, boardColor: COLORS.length - 1, stringer: COLORS.length - 1 };
const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, 14) || 'Surfer';

export function loadProfile(): Profile {
  const look = { ...DEFAULT_LOOK } as Record<keyof Look, number>;
  try {
    const raw = JSON.parse(localStorage.getItem('wl.look') ?? '{}') ?? {};
    for (const k of Object.keys(LOOK_MAX) as (keyof Look)[]) if (Number.isInteger(raw[k]) && raw[k] >= 0 && raw[k] <= LOOK_MAX[k]) look[k] = raw[k];
  } catch { /* corrupt: defaults */ }
  return { name: cleanName(localStorage.getItem('wl.name') ?? ''), look: look as Look };
}
export function saveProfile(p: Profile): void { store('wl.name', cleanName(p.name)); store('wl.look', JSON.stringify(p.look)); }

// Words for the description line. Color names follow the comments in shared/looks.ts.
export const BOARD_NAMES = ['shortboard', 'longboard', 'soft-top'];
const COLOR_NAMES = ['cream', 'faded red', 'yellow', 'blue', 'black', 'seafoam', 'coral', 'white', 'deep green', 'orange', 'purple', 'charcoal', 'pale blue'];
const HAIR_COLORS = ['black', 'brown', 'sun-bleached', 'gray'], HAIRS = ['shaved head', 'short', 'long', 'tied-back'], TOPS = ['bare chest', 'rash guard', 'wetsuit top', 'swimsuit'];
const describe = ({ name, look: l }: Profile): string => [
  name, `${COLOR_NAMES[l.boardColor]} ${BOARD_NAMES[l.board]}`,
  l.hair ? `${HAIRS[l.hair]} ${HAIR_COLORS[l.hairColor]} hair` : HAIRS[0],
  l.top ? `${COLOR_NAMES[l.topColor]} ${TOPS[l.top]}` : TOPS[0], `${COLOR_NAMES[l.shortsColor]} shorts`,
].join(' · ');

// ---- panel pieces ----
let grab: ((e: KeyboardEvent) => void) | null = null; // set while a key binding waits for its key

/** A centered glass panel over a dimmed screen. Done, Escape, or a press outside closes it. */
function modal(title: string, onClose: () => void, width = 460): { body: HTMLElement; close(): void } {
  const before = document.activeElement as HTMLElement | null;
  const under = ([...ui().children] as HTMLElement[]).filter((c) => !c.inert); // everything beneath goes inert, so focus and touches stay in the panel
  under.forEach((c) => { c.inert = true; });
  const back = el('div', `position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:rgba(4,18,24,.4);opacity:0;transition:opacity ${EASE}`, ui());
  const body = el('div', `box-sizing:border-box;width:min(${width}px,100%);max-height:100%;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;padding:24px;border-radius:20px;outline:0;${GLASS}`, back);
  body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true'); body.setAttribute('aria-label', title); body.tabIndex = -1;
  const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:16px', body);
  el('div', 'font-size:28px;font-weight:600;line-height:1.2', head, title);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false; grab = null; removeEventListener('keydown', onKeyDown, true); holdInput(false);
    back.style.opacity = '0'; back.inert = true; setTimeout(() => back.remove(), 260);
    under.forEach((c) => { c.inert = false; }); before?.focus?.(); onClose();
  };
  // Capture phase, so a key being bound (or Escape) never reaches the game or the screen underneath.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (grab) { const g = grab; grab = null; e.preventDefault(); e.stopPropagation(); g(e); } else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  addEventListener('keydown', onKeyDown, true);
  // A press outside closes. On click, not pointerdown (or the tap's click would land on whatever is beneath), and
  // only when the press began outside too (a slider drag that ends past the panel edge is not a dismissal).
  let outside = false;
  back.onpointerdown = (e) => { outside = e.target === back; };
  back.onclick = (e) => { if (outside && e.target === back) close(); };
  button('Done', `padding:11px 18px;border-radius:999px;font-weight:600;${WELL}`, head, close);
  holdInput(true); void back.offsetWidth; back.style.opacity = '1'; body.focus();
  return { body, close };
}

const field = (parent: HTMLElement, label: string): HTMLElement => { const f = el('div', 'margin-top:22px', parent); el('div', `${LABEL};margin-bottom:10px`, f, label); return f; };

/** One choice out of a few, as a row of pills. */
function segmented(parent: HTMLElement, labels: string[], value: number, pick: (i: number) => void): void {
  const row = el('div', `display:flex;gap:4px;padding:4px;border-radius:999px;${WELL}`, parent);
  const paint = (): void => btns.forEach((b, i) => { const on = i === value; b.style.background = on ? 'rgba(244,239,230,.2)' : 'none'; b.style.fontWeight = on ? '600' : '400'; b.style.opacity = on ? '1' : '.75'; b.setAttribute('aria-pressed', String(on)); });
  const btns = labels.map((l, i) => button(l, 'flex:1;min-width:0;padding:8px 4px;border-radius:999px;white-space:nowrap', row, () => { value = i; paint(); pick(i); }));
  paint();
}

/** Color swatches. `colors` are linear RGB (they feed vertex colors), so convert for CSS. */
function swatches(parent: HTMLElement, colors: number[][], names: string[], value: number, pick: (i: number) => void): HTMLElement {
  const row = el('div', `display:flex;flex-wrap:wrap;gap:10px;transition:opacity ${EASE}`, parent);
  const paint = (): void => btns.forEach((b, i) => { const on = i === value; b.style.boxShadow = on ? `0 0 0 2px rgba(8,30,40,.9),0 0 0 4px ${ACCENT}` : 'inset 0 0 0 1px rgba(244,239,230,.3)'; b.setAttribute('aria-pressed', String(on)); });
  const btns = colors.map((c, i) => {
    const b = button('', `width:30px;height:30px;border-radius:50%;background:rgb(${c.map((v) => Math.round(255 * v ** (1 / 2.2))).join(',')})`, row, () => { value = i; paint(); pick(i); });
    b.onpointerenter = b.onpointerleave = null; // the ring is the only state a swatch shows
    b.title = names[i]; b.setAttribute('aria-label', names[i]);
    return b;
  });
  paint();
  return row;
}

function toggle(parent: HTMLElement, label: string, value: boolean, set: (v: boolean) => void): void {
  const b = button('', 'display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:9px 0;border-radius:8px;text-align:left', parent, () => { value = !value; paint(); set(value); });
  b.setAttribute('role', 'switch'); b.onpointerenter = b.onpointerleave = null;
  el('span', '', b, label);
  const track = el('span', `position:relative;flex:none;width:38px;height:22px;border-radius:999px;transition:background ${EASE}`, b);
  const knob = el('span', `position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;transition:transform ${EASE},background ${EASE}`, track);
  const paint = (): void => { track.style.background = value ? ACCENT : 'rgba(244,239,230,.22)'; knob.style.background = value ? INK : SAND; knob.style.transform = `translateX(${value ? 16 : 0}px)`; b.setAttribute('aria-checked', String(value)); };
  paint();
}

function slider(parent: HTMLElement, label: string, value: number, set: (v: number) => void): void {
  const row = el('label', 'display:flex;align-items:center;gap:14px;padding:7px 0', parent);
  el('span', 'flex:none;width:84px', row, label);
  const r = el('input', `flex:1;min-width:0;margin:0;height:22px;pointer-events:auto;cursor:pointer;accent-color:${ACCENT}`, row);
  r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01'; r.value = String(value);
  r.oninput = () => set(Number(r.value));
}

// ---- settings panel ----
const ACTIONS: [string, string][] = [['paddle', 'Paddle'], ['left', 'Steer left'], ['right', 'Steer right'], ['sit', 'Sit / lie down'], ['action', 'Pop up'], ['dive', 'Duck dive / turtle roll'], ['kick', 'Kick out'], ['emote', 'Emotes'], ['roster', 'Roster']];
const keyName = (code: string): string => code.replace(/^(Key|Digit)/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2'); // KeyW -> W, ShiftLeft -> Shift Left
let settingsOpen = false;

/** `onLeave`: in the water, adds the way back to the start screen. */
export function openSettings(onLeave?: () => void): void {
  if (settingsOpen) return;
  settingsOpen = true;
  const { body } = modal('Settings', () => { settingsOpen = false; });

  segmented(field(body, 'Quality'), ['Auto', 'Ultra', 'High', 'Mobile'], QUALITY.indexOf(settings.quality), (i) => { settings.quality = QUALITY[i]; commit(); });

  const volume = field(body, 'Volume');
  for (const [k, label] of [['master', 'Master'], ['sfx', 'Effects'], ['ambience', 'Ambience']] as const) slider(volume, label, settings.volume[k], (v) => { settings.volume[k] = v; commit(); });

  const play = field(body, 'Comfort');
  toggle(play, 'Reduced motion', settings.reducedMotion, (v) => { settings.reducedMotion = v; commit(); });
  toggle(play, 'Invert steering', settings.invertSteer, (v) => { settings.invertSteer = v; commit(); });
  toggle(play, 'Colorblind-safe colors', settings.colorblind, (v) => { settings.colorblind = v; commit(); });

  // Remapping: press a row, then the key. A key already in use swaps with this one, so no two actions share a key.
  const keys = field(body, 'Keyboard'), grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px', keys);
  const paints: (() => void)[] = [], repaint = (): void => paints.forEach((p) => p());
  for (const [action, label] of ACTIONS) {
    const b = button('', `display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:12px;text-align:left;white-space:nowrap;${WELL}`, grid, () => {
      repaint(); key.textContent = 'Press a key'; key.style.color = ACCENT;
      grab = (e) => {
        if (e.key !== 'Escape') {
          const other = ACTIONS.find(([a]) => a !== action && keyFor(a) === e.code)?.[0];
          if (other) settings.keys[other] = keyFor(action);
          settings.keys[action] = e.code; commit();
        }
        repaint();
      };
    });
    el('span', '', b, label);
    const key = el('span', 'font-weight:600', b);
    paints.push(() => { key.textContent = keyName(keyFor(action)); key.style.color = ''; });
  }
  repaint();
  button('Reset keys', 'margin-top:12px;padding:6px 0;font-size:13px;opacity:.75;border-radius:8px', keys, () => { grab = null; settings.keys = {}; commit(); repaint(); });
  if (onLeave) button('Back to start screen', `margin-top:18px;${PILL}`, body, onLeave);
}

// ---- profile editor ----
/** Edits apply as you go and are saved when the panel closes, however it closes. */
export function openProfile(onDone: (p: Profile) => void): void {
  const p = loadProfile(), look = p.look;
  const { body, close } = modal('Profile', () => { p.name = cleanName(name.value); saveProfile(p); onDone(p); }, 560); // wide enough for a row of 13 swatches
  const line = el('div', 'margin-top:6px;font-size:13px;line-height:1.5;opacity:.8;min-height:39px', body);
  const paint = (): void => {
    line.textContent = describe({ name: cleanName(name.value), look });
    hairColor.style.opacity = look.hair ? '1' : '.35'; topColor.style.opacity = look.top ? '1' : '.35'; // dimmed while they have nothing to color
  };
  const set = (k: keyof Look) => (i: number): void => { (look as Record<keyof Look, number>)[k] = i; paint(); };

  const name = el('input', `box-sizing:border-box;width:100%;padding:11px 14px;border:0;border-radius:12px;font:inherit;color:inherit;pointer-events:auto;user-select:text;-webkit-user-select:text;${WELL}`, field(body, 'Name'));
  name.type = 'text'; name.maxLength = 14; name.value = p.name; name.autocomplete = 'off'; name.spellcheck = false; name.enterKeyHint = 'done'; name.setAttribute('aria-label', 'Name');
  name.oninput = paint; name.onkeydown = (e) => { if (e.key === 'Enter') close(); };

  const board = field(body, 'Board');
  segmented(board, ['Shortboard', 'Longboard', 'Soft-top'], look.board, set('board'));
  el('div', 'height:12px', board); swatches(board, COLORS, COLOR_NAMES, look.boardColor, set('boardColor'));

  swatches(field(body, 'Skin tone'), SKIN, SKIN.map((_, i) => `Skin tone ${i + 1}`), look.skin, set('skin'));

  const hair = field(body, 'Hair');
  segmented(hair, ['Shaved', 'Short', 'Long', 'Tied'], look.hair, set('hair'));
  el('div', 'height:12px', hair); const hairColor = swatches(hair, HAIR, HAIR_COLORS, look.hairColor, set('hairColor'));

  const top = field(body, 'Top');
  segmented(top, ['Bare', 'Rash guard', 'Wetsuit', 'Swimsuit'], look.top, set('top'));
  el('div', 'height:12px', top); const topColor = swatches(top, COLORS, COLOR_NAMES, look.topColor, set('topColor'));

  swatches(field(body, 'Shorts'), COLORS, COLOR_NAMES, look.shortsColor, set('shortsColor'));
  paint();
}
