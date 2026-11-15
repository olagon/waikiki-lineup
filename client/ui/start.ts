// The start screen: a title, the hour at Waikīkī, two breaks, and a way into the water.
// The flyover behind it is the picture, so this stays low on the screen and out of its way.
import { ACCENT, BOARD_NAMES, EASE, EDGE, GLASS, INK, PILL, button, el, holdInput, loadProfile, openProfile, openSettings, type Profile } from './settings';

export interface StartOptions {
  timeLabel: () => string; // e.g. "Waikīkī · 8:14 pm · full moon"; called about once a second
  counts: () => Promise<Record<string, { rooms: number; humans: number }>>; // keys 'canoes' and 'queens'; polled every 5 s while open
  onPlay: (breakName: 'canoes' | 'queens', profile: Profile) => void;
  inviteUrl: () => string; // for the "Copy invite link" button
  firstVisit: boolean; // if true, the profile editor opens before the first paddle-out
}

const BREAKS = [['canoes', 'Canoes', 'soft rolling peaks, lefts and rights'], ['queens', 'Queens', 'a little steeper and faster, longer rides']] as const;

export function showStart(o: StartOptions): { close(): void } {
  let profile = loadProfile(), pick: 'canoes' | 'queens' = 'canoes', askProfile = o.firstVisit, open = true, copied = 0;

  const root = el('div', `position:absolute;inset:0;opacity:0;transition:opacity ${EASE}`, document.getElementById('ui')!);
  const wrap = el('div', 'position:absolute;left:0;right:0;bottom:0;display:flex;box-sizing:border-box', root);
  // The scrim belongs to the content: it starts a little above the title and deepens toward the bottom edge.
  el('div', 'position:absolute;left:0;right:0;bottom:0;top:-96px;background:linear-gradient(to top,rgba(6,24,32,.62),rgba(6,24,32,.32) 55%,rgba(6,24,32,0))', wrap);
  const col = el('div', 'position:relative;width:min(460px,100%)', wrap);

  el('div', 'font-size:28px;font-weight:600;line-height:1.2;text-shadow:0 1px 20px rgba(4,18,24,.55)', col, 'Waikīkī Lineup');
  const time = el('div', 'margin-top:2px;opacity:.85;text-shadow:0 1px 12px rgba(4,18,24,.6);min-height:21px', col, o.timeLabel());

  // Breaks: two cards, the chosen one outlined in gold.
  const cards = el('div', 'display:flex;gap:10px;margin-top:20px', col);
  const choose = (): void => BREAKS.forEach(([id], i) => { card[i].style.borderColor = id === pick ? ACCENT : 'transparent'; card[i].setAttribute('aria-pressed', String(id === pick)); });
  const out: HTMLElement[] = [];
  const card = BREAKS.map(([id, name, blurb]) => {
    const b = button('', `flex:1;min-width:0;display:flex;flex-direction:column;text-align:left;padding:14px 16px;border:1.5px solid transparent;border-radius:14px;${GLASS};${EDGE}`, cards, () => { pick = id; choose(); });
    el('div', 'font-weight:600', b, name);
    el('div', 'margin-top:2px;font-size:13px;opacity:.8;flex:1', b, blurb);
    out.push(el('div', 'margin-top:10px;font-size:13px;letter-spacing:.02em', b, ' '));
    return b;
  });
  choose();

  // Who is paddling out, and on what. Opens the profile editor.
  const edit = (then?: () => void): void => openProfile((p) => { profile = p; askProfile = false; who.textContent = `${p.name} · ${BOARD_NAMES[p.look.board]}`; then?.(); });
  const me = button('', `display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;margin-top:10px;padding:13px 16px;border-radius:14px;text-align:left;${GLASS};${EDGE}`, col, () => edit());
  const who = el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', me, `${profile.name} · ${BOARD_NAMES[profile.look.board]}`);
  el('span', 'flex:none;font-size:13px;opacity:.65', me, 'Edit');

  const row = el('div', 'display:flex;flex-wrap:wrap;gap:10px;margin-top:16px', col);
  const go = (): void => (askProfile ? edit(go) : o.onPlay(pick, profile));
  const play = button('Paddle out', `padding:13px 30px;border-radius:999px;background:${ACCENT};color:${INK};font-weight:600`, row, go);
  const copy = button('Copy invite link', PILL, row, () => {
    copy.style.minWidth = `${copy.offsetWidth}px`; // the shorter "Copied" must not shuffle the row
    (navigator.clipboard?.writeText(o.inviteUrl()) ?? Promise.reject()).then(() => 'Copied', () => 'Could not copy').then((text) => {
      copy.textContent = text; clearTimeout(copied);
      copied = window.setTimeout(() => { copy.textContent = 'Copy invite link'; }, 2000);
    });
  });
  const more = button('Settings', PILL, row, () => openSettings());

  // Bottom-left on a desktop, bottom-center and full width on a phone; tighter margins when the screen is short.
  const layout = (): void => {
    const narrow = innerWidth < 640, short = innerHeight < 520, side = narrow ? 16 : short ? 28 : 48, foot = narrow ? 24 : short ? 16 : 48;
    wrap.style.padding = `0 max(${side}px,env(safe-area-inset-right)) max(${foot}px,env(safe-area-inset-bottom)) max(${side}px,env(safe-area-inset-left))`;
    wrap.style.justifyContent = narrow ? 'center' : 'flex-start';
    play.style.flex = narrow ? '1 1 100%' : '0 0 auto'; copy.style.flex = more.style.flex = narrow ? '1 1 0' : '0 0 auto';
  };
  layout(); addEventListener('resize', layout);

  const clock = setInterval(() => { time.textContent = o.timeLabel(); }, 1000);
  const count = (): void => { Promise.resolve().then(o.counts).then((c) => BREAKS.forEach(([id], i) => { const n = c[id]?.humans ?? 0; out[i].textContent = n ? `${n} out` : 'nobody out yet'; })).catch(() => { /* keep the last counts */ }); };
  count(); const counting = setInterval(count, 5000);
  const onEnter = (e: KeyboardEvent): void => { if (e.key === 'Enter' && e.target === document.body) go(); };
  addEventListener('keydown', onEnter);

  holdInput(true); void root.offsetWidth; root.style.opacity = '1';
  return {
    close(): void {
      if (!open) return;
      open = false; clearInterval(clock); clearInterval(counting); clearTimeout(copied);
      removeEventListener('resize', layout); removeEventListener('keydown', onEnter); holdInput(false);
      root.inert = true; root.style.opacity = '0'; setTimeout(() => root.remove(), 260);
    },
  };
}
