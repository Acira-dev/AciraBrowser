/** Beta 14: the motion between Compact's row of chips and Focus's one chip (tabs on top).
 *
 * The two rows are two components (CompactTabs, FocusTab) and the window-view switch is the layout view transition, whose named piece `acira-mini-tabs` shows the new row at once
 * (view-morph.css: "content is never stretched": the chips keep their pixels and the morphing box reveals them), so a plain swap would cut. What the brief asks for is not a cut:
 * entering Focus, the other tabs' chips slide and fade away toward the current tab while the current chip settles; leaving Focus is the exact reverse.
 *
 * So the row that is going away leaves a picture of itself behind as it unmounts (`remember`), and the row that arrives finds it (`take`) and plays it as the
 * departure (entering Focus) or arrival (leaving Focus) of the chips that are not the current one. The pictures are clones of the real chips, placed where they were, inert, drawn
 * by the same CSS; the motion is the layout view transition's own: a leave is 150 ms on cubic-bezier(.3,0,.8,.15), an arrival is the same curve mirrored, so arriving is leaving
 * played backwards (view-morph.css acira-control-leave / -arrive). Every duration reads --motion-scale (Premium 1, Fast .5, Off 0: nothing plays). */
export interface RowPicture { at: number; left: number; top: number; chips: Array<{ node: HTMLElement; x: number; y: number; width: number; height: number; current: boolean }> }

let strip: RowPicture | null = null, chip: RowPicture | null = null;
/** A picture is only the row that was on screen a moment ago: anything older is some other switch (another window, a restored session). */
const FRESH_MS = 400;
const LEAVE = 'cubic-bezier(.3,0,.8,.15)', ARRIVE = 'cubic-bezier(.2,.85,.7,1)';
const DURATION = 150;

const motionScale = () => { const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-scale')); return Number.isFinite(value) ? value : 1; };
const reduced = () => document.documentElement.dataset.reducedMotion === 'true' || document.querySelector('.app')?.getAttribute('data-reduced-motion') === 'true' || motionScale() <= 0;

function picture(root: HTMLElement | null, selector: string): RowPicture | null {
  if (!root) return null;
  const box = root.getBoundingClientRect(), chips = [...root.querySelectorAll<HTMLElement>(selector)].map(node => {
    const rect = node.getBoundingClientRect();
    return { node: node.cloneNode(true) as HTMLElement, x: rect.x - box.x, y: rect.y - box.y, width: rect.width, height: rect.height, current: node.classList.contains('selected') };
  }).filter(item => item.width > 0);
  return chips.length ? { at: performance.now(), left: box.x, top: box.y, chips } : null;
}
const fresh = (picture: RowPicture | null) => picture && performance.now() - picture.at < FRESH_MS ? picture : null;

/** CompactTabs as it unmounts (Focus came on). */
export const rememberStrip = (root: HTMLElement | null) => { strip = picture(root, '.acira-compact-tab'); };
/** FocusTab as it unmounts (Compact or Full came back). */
export const rememberChip = (root: HTMLElement | null) => { chip = picture(root, '.acira-compact-tab'); };
export const takeStrip = () => { const taken = fresh(strip); strip = null; return taken; };
export const takeChip = () => { const taken = fresh(chip); chip = null; return taken; };

/** The clones go back in as inert pictures: placed where the chips were, taking nothing from the pointer or the keyboard. */
function ghost(root: HTMLElement, item: RowPicture['chips'][number]): HTMLElement {
  const node = item.node;
  node.removeAttribute('id'); node.setAttribute('aria-hidden', 'true'); node.setAttribute('inert', ''); node.removeAttribute('data-tab-id'); node.tabIndex = -1;
  Object.assign(node.style, { position: 'absolute', left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, margin: '0', pointerEvents: 'none', zIndex: '0' });
  node.dataset.ghost = 'true';
  root.append(node);
  return node;
}

/** Focus came on: the row's chips go. `target` is the one chip's place in the new row (its x and width inside the row's box). */
export function playDeparture(root: HTMLElement | null, picture: RowPicture | null, target: { x: number; width: number }) {
  if (!root || !picture || reduced()) return;
  const scale = motionScale(), toward = target.x + target.width / 2;
  for (const item of picture.chips) {
    const node = ghost(root, item), away = (toward - (item.x + item.width / 2)) * (item.current ? 0 : .6);
    const gone = { opacity: 0, translate: `${away}px 0`, scale: item.current ? '1' : '.6' };
    const animation = node.animate([{ opacity: 1, translate: '0 0', scale: '1' }, { ...gone, offset: .75 }, gone], { duration: DURATION * scale, easing: LEAVE, fill: 'forwards' });
    const done = () => node.remove();
    animation.addEventListener('finish', done, { once: true }); animation.addEventListener('cancel', done, { once: true });
  }
}

/** Compact (or Full) came back: the chips that were not the current one come in from the current chip's place, the exact reverse of the departure. The current chip's own picture (the one
 * wide chip) fades away over the real narrow one. */
export function playArrival(root: HTMLElement | null, picture: RowPicture | null) {
  if (!root || !picture || reduced()) return;
  const scale = motionScale(), then = picture.chips.find(item => item.current) ?? picture.chips[0], from = then ? then.x + then.width / 2 : 0, box = root.getBoundingClientRect();
  for (const node of root.querySelectorAll<HTMLElement>('.acira-compact-tab')) {
    if (node.classList.contains('selected')) continue;
    const rect = node.getBoundingClientRect(), away = (from - (rect.x - box.x + rect.width / 2)) * .6;
    node.animate([{ opacity: 0, translate: `${away}px 0`, scale: '.6' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: DURATION * scale, easing: ARRIVE, fill: 'backwards' });
  }
  for (const item of picture.chips) {
    const node = ghost(root, item);
    const animation = node.animate([{ opacity: 1 }, { opacity: 0, offset: .75 }, { opacity: 0 }], { duration: DURATION * scale, easing: LEAVE, fill: 'forwards' });
    const done = () => node.remove();
    animation.addEventListener('finish', done, { once: true }); animation.addEventListener('cancel', done, { once: true });
  }
}

/** Focus came on and the one chip is the new row: it fades in over the departing chips so the swap is a cross-fade, not a cut. */
export function playSettle(chipNode: HTMLElement | null) {
  if (!chipNode || reduced()) return;
  chipNode.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION * motionScale(), easing: ARRIVE, fill: 'backwards' });
}
