/**
 * D137 (24 Nov 2026): a view switch that widens the page beside a right sidebar puts the page at its final size under the floated interface
 * (desktop/page-float.cjs). While it floats, the interface must not cover the page: the transition's whole-window picture (root) is cut where the
 * page will stand, and the page's two pictures (acira-page, acira-page-content: view-morph.css) are hidden, so the page shows through at every
 * frame and only the moving interface (the sidebar leaving, the bar fading) passes over it. Without the cut the whole-window picture faded in
 * over the page and veiled it to a third of its brightness (real frames, 13:03; hidden pre-check: 0 levels off the page at rest with it).
 * The interface lowers itself two frames before its transition's pictures end: after them its own page area is opaque again (the live
 * interface draws a placeholder where the page stands), so it must be under the page by then. Main lowers at its limit whatever happens.
 */
export type PageRect = { x: number; y: number; width: number; height: number };

/** How long before the pictures end the interface asks to be lowered: the request and main's reorder take about a frame each. */
export const LOWER_EARLY_MS = 34;

/** The rule that cuts the page's rect out of the transition's whole-window picture (an even-odd polygon: the window, then the hole). */
export function holeRule(r: PageRect): string {
  const x = Math.round(r.x), y = Math.round(r.y), x2 = Math.round(r.x + r.width), y2 = Math.round(r.y + r.height);
  return `:root[data-page-float]::view-transition-group(root){clip-path:polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${x}px ${y}px,${x}px ${y2}px,${x2}px ${y2}px,${x2}px ${y}px,${x}px ${y}px)}`;
}

type Timed = { effect: { pseudoElement?: string | null; getComputedTiming(): { endTime?: number | string } } | null; currentTime: number | string | null | { value?: number } };

/** Milliseconds until the last of the transition's pictures ends, less LOWER_EARLY_MS; null while the transition has no pictures yet. */
export function lowerIn(animations: readonly Timed[]): number | null {
  let left: number | null = null;
  for (const a of animations) {
    const pseudo = a.effect?.pseudoElement || '';
    if (!pseudo.startsWith('::view-transition')) continue;
    const end = Number(a.effect?.getComputedTiming().endTime), now = typeof a.currentTime === 'number' ? a.currentTime : Number(a.currentTime ?? NaN);
    if (!Number.isFinite(end) || !Number.isFinite(now)) continue;
    left = Math.max(left ?? 0, end - now);
  }
  return left === null ? null : Math.max(0, left - LOWER_EARLY_MS);
}

let timer = 0, frame = 0, generation = 0, waiting = 0;
/** How long the cut-out waits for main's `chrome-lowered` after the interface asked to be lowered. */
export const LOWERED_WAIT_MS = 250;
const STYLE_ID = 'acira-page-float';

function clear(doc: Document): void {
  window.clearTimeout(timer); window.cancelAnimationFrame(frame); timer = 0; frame = 0;
  delete doc.documentElement.dataset.pageFloat;
  doc.getElementById(STYLE_ID)?.remove();
}

/**
 * Main's `page-float` event: a rect starts the float's cut-out and the lowering; null (main's limit) ends it.
 * `raise` asks main for the float once the cut-out has been drawn (a frame after it is set: main never raises by itself, chrome-float finding 2,
 * and places the page at once when it does); `lower` asks main to lower the interface (edge float:false); `mayLower` says no other float (a
 * Seamless edge reveal) owns the interface now.
 */
export function applyPageFloat(rect: PageRect | null, raise: (rect: PageRect) => void, lower: () => void, mayLower: () => boolean = () => true, doc: Document = document): void {
  const mine = ++generation;
  clear(doc);
  if (!rect) return;
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style); }
  style.textContent = holeRule(rect);
  doc.documentElement.dataset.pageFloat = '';
  frame = window.requestAnimationFrame(() => { if (mine === generation) { raise(rect); frame = window.requestAnimationFrame(look); } });
  // The cut-out stays until main says the interface is lowered (`chrome-lowered`: pageFloatLowered): taken away a frame earlier, the raised
  // interface showed its opaque page area over the page for that frame (hidden pre-check on the build, 15:1x). LOWERED_WAIT_MS if no word comes.
  const finish = () => { if (mine !== generation) return; if (!mayLower()) { clear(doc); return; } waiting = mine; lower(); timer = window.setTimeout(() => { if (mine === generation) clear(doc); }, LOWERED_WAIT_MS); };
  // The pictures may come a frame after main's event: wait for them (a switch with no transition, e.g. reduced motion, lowers after two quiet frames).
  let quiet = 0;
  const look = () => {
    if (mine !== generation) return;
    const left = lowerIn(doc.getAnimations() as unknown as Timed[]);
    if (left !== null) { timer = window.setTimeout(finish, left); return; }
    if (!doc.documentElement.hasAttribute('data-mode-switch') && ++quiet >= 2) { finish(); return; }
    frame = window.requestAnimationFrame(look);
  };
}

/** Main's `chrome-lowered`: the interface is under the page again, so the cut-out may go (only the one that asked for the lowering). */
export function pageFloatLowered(doc: Document = document): void {
  if (waiting && waiting === generation) { waiting = 0; clear(doc); }
}
