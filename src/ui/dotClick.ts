import { motionScale } from './sharedMotion';

/** R3-36 experiment, behind a flag and OFF by default: a toolbar icon, when clicked, resolves into the classic square dot
 * grid, the grid lights up in a clean ring order from the centre, and the glyph returns (~250ms at Fast, stretched by the
 * animation-speed setting, nothing at Off). Classic grid only: the whole 5×5 square is always there, nothing is drawn in
 * dots (bible §3.7). Compositor only: every dot and the glyph animate opacity. Enable for a try-out with
 * `localStorage.setItem('acira-lab-dot-click', '1')` and reload; remove the key to turn it off. Keep only if the founder
 * finds it premium (bible §3.7 and R3-36), otherwise delete this file and its one call in App. */
const KEY = 'acira-lab-dot-click', SIZE = 5, TOTAL_MS = 250;

export function dotClickEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Plays the effect over `button`'s glyph. Safe to call repeatedly: a running one is replaced. */
export function playDotClick(button: HTMLElement): void {
  const scale = motionScale(), glyph = button.querySelector<SVGElement>('svg');
  if (!scale || !glyph) return;
  button.querySelector('[data-dot-click]')?.remove();
  const box = glyph.getBoundingClientRect(), total = TOTAL_MS * scale;
  button.dataset.dotPlaying = ''; button.style.setProperty('--dot-ms', `${total}ms`);
  const grid = document.createElement('span');
  grid.dataset.dotClick = ''; grid.setAttribute('aria-hidden', 'true');
  Object.assign(grid.style, { position: 'absolute', left: `${box.left - button.getBoundingClientRect().left}px`, top: `${box.top - button.getBoundingClientRect().top}px`, width: `${box.width}px`, height: `${box.height}px`, display: 'grid', gridTemplate: `repeat(${SIZE}, 1fr) / repeat(${SIZE}, 1fr)`, pointerEvents: 'none', color: 'inherit' });
  if (getComputedStyle(button).position === 'static') button.style.position = 'relative';
  const dots: HTMLElement[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const dot = document.createElement('i');
    Object.assign(dot.style, { display: 'block', alignSelf: 'center', justifySelf: 'center', width: '2px', height: '2px', borderRadius: '50%', background: 'currentColor', opacity: '0' });
    grid.append(dot); dots.push(dot);
  }
  button.append(grid);
  // The glyph steps aside for the middle of the effect and comes back whole.
  // The glyph steps aside by a CSS animation on the button's own svg (transient.css), so a glyph a click replaces (Reload becomes Stop) steps aside too.
  const lit = (index: number) => {
    const row = Math.floor(index / SIZE), col = index % SIZE, ring = Math.max(Math.abs(row - 2), Math.abs(col - 2));
    return { ring, order: ring * 3 + ((row + col) % 3) };
  };
  const finished = dots.map((dot, index) => {
    const { ring, order } = lit(index), start = (.16 + ring * .12) + (order % 3) * .012;
    // Unlit dots sit at a quiet 22%; light moves through the grid outwards from the centre, in two intensities.
    return dot.animate([
      { opacity: 0, offset: 0 }, { opacity: .22, offset: .14 },
      { opacity: .22, offset: start }, { opacity: ring % 2 ? .6 : 1, offset: start + .1 }, { opacity: .22, offset: start + .26 },
      { opacity: .22, offset: .72 }, { opacity: 0, offset: .9 },
    ], { duration: total, easing: 'linear' }).finished;
  });
  const done = () => { grid.remove(); delete button.dataset.dotPlaying; button.style.removeProperty('--dot-ms'); };
  Promise.all(finished).then(done, done);
}

/** One capture-phase listener on the toolbar's icon buttons; call once when the flag is on. Returns its remover. */
export function installDotClick(): () => void {
  if (!dotClickEnabled()) return () => {};
  const click = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.<HTMLElement>('.browser-toolbar .icon-button, .acira-persistent-toolbar .icon-button');
    if (button && !button.matches(':disabled')) playDotClick(button);
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
