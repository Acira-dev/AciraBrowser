import { motionPace, motionScale, reducedMotion } from './sharedMotion';
import { setInstantTransitions } from './motion';
import { arriving, ARRIVE_MS, bowCrossings, hopOpacity, fieldFirstColumnLag, inkOf, BUTTON_IN, LAG_MS, MAIN_LATENCY_MS, NO_BAR, CHROME_IN, captionKeepClear, delayRowChange, totalMs, layoutAt, leaving, LEAVE, moverBox, pageGlide, PILL_IN, planRowMorph, QUICK_LEAVE, QUICK_LEFT_MS, RAIL_IN, retime, rowMorphApplies, schedule, TOP_BLOCK_LAG_MS, topEdgeLag, type Box, type Direction, type Ink, type LayoutNumbers, type Mover, type PageBox, type Schedule, type Still } from './sidebarMorphPlan';
import type { BrowserLayout } from '../runtime/types';
import { rootSidebarSide } from './sidebarSide';
import { tabTravelEnd, tabTravelFirst, tabTravelFrame, tabTravelStart } from './tabTravel';

/** Sidebar mode's morph (the choreography, and why it is timed as it is, is in ui/sidebarMorphPlan.ts).
 *
 * Turning Sidebar mode on or off is not a view transition. A view transition draws two pictures of the window above the live one, cannot be
 * turned round half way and cannot morph the address field's box with its text crisp. This is the live window instead: the interface is
 * measured, switched to its final layout in one step, measured again, and then drawn back at the layout it came from while one clock walks it
 * to the new one:
 *   - the browser's own layout (the sidebar's column, the header, the page card's margins, corner and ring) is overridden by numbers on the
 *     plan's two springs, so the card, the frame's tint and every page the interface draws follow by real layout;
 *   - each piece that exists in both layouts (Back, Reload, Forward, the address field, the sidebar button) is ONE element: its own `translate`
 *     (and, for the address field, its own width) carries it from where it was drawn to where it ends up;
 *   - what exists in one layout only is a copy of the old chrome (`ghost`) that leaves early, or a real element that arrives late.
 * Nothing is drawn twice: the copy of a shared piece inside the ghost is hidden. Main glides the native page on the same spring and lag from the
 * one layout message the update sends (`sidebarMorphSend`), with its layout held, so a heavy site lays out once. Switching again (or any other
 * layout change) while it runs starts a new morph from what is drawn now: a position never jumps. */

const SELECTOR = {
  app: '.app', root: '.app > .browser-root', shell: '.app > .browser-root > .browser-shell', toolbar: '.app > .browser-root > .browser-shell > .acira-persistent-toolbar',
  page: '.app > .browser-root .browser-body > .page-area', rail: '.app > .ed-rail',
} as const;
const NAV = `${SELECTOR.toolbar} .navigation-controls > .icon-button`;
/** The pieces that travel. `resizes`: its box changes size too (the address field). */
const PIECES = [
  { id: 'back', sel: `${NAV}:nth-child(1)`, resizes: false },
  { id: 'forward', sel: `${NAV}:nth-child(2)`, resizes: false },
  { id: 'reload', sel: `${NAV}:nth-child(3)`, resizes: false },
  { id: 'toggle', sel: `${SELECTOR.toolbar} .sidebar-toggle-control`, resizes: false },
  { id: 'address', sel: `${SELECTOR.toolbar} > .address-bar`, resizes: true },
] as const;
const railKind = (child: Element) => `rail:${[...child.classList].find(name => name.startsWith('sb-')) ?? child.tagName.toLowerCase()}`;

interface Seen { id: string; el: HTMLElement; box: Box; resizes: boolean; attached: boolean; ink?: Ink; block?: boolean }
interface Ghosts { app: HTMLElement; root: HTMLElement | null; rail: HTMLElement | null; /** what stands in the old sidebar's copy (not its light), where only that leaves at once */ railRows?: HTMLElement[]; /** the copy's top in the window, where the arriving bar comes down over its head (D108) */ railTop?: number; /** the sidebar's edge light carried over the card's strip beside it (D108) */ railFill?: { el: HTMLElement; top: number }; block: boolean; opacity: number; /** by control of the live header, its copy in the old chrome */ copies: Map<HTMLElement, HTMLElement> }
interface Touched { el: HTMLElement; translate: string; opacity: string; scale: string; clipPath: string; props: string[]; attrs: string[] }
interface Live {
  startedAt: number; sch: Schedule; first: LayoutNumbers; last: LayoutNumbers; movers: Mover[]; moverEls: Map<string, HTMLElement>;
  arrivals: { rail: HTMLElement[]; pill: HTMLElement[]; button: HTMLElement[]; chrome: HTMLElement[]; carry: { rail: number; chrome: number } };
  ghosts: Ghosts | null; railLive: boolean; railWidth: number; addrLeft: number | null; hadBlock: boolean; hasBlock: boolean; touched: Map<HTMLElement, Touched>; frame: number; timer: ReturnType<typeof setTimeout> | undefined;
  app: HTMLElement | null; shell: HTMLElement | null; bar: HTMLElement | null; page: HTMLElement | null; rail: HTMLElement | null; toolbar: HTMLElement | null; railEls: Set<HTMLElement>;
  pinned: BrowserLayout | null;
  /** D92b (Along the top <-> Tabs on top + sidebar): what is drawn for a travelling control outside it, the strip's selection plate under the selected tab: it takes the tab's translate every frame. */
  follow: { el: HTMLElement; of: HTMLElement }[];
  /** The row morph (sidebarMorphPlan.ts, Beta 14.0): by element, the ms from the start at which the place of a control that arrives is clear of every traveller; the copies of the pieces that could not travel (they leave quickly, where they stand). */
  clearAt: Map<HTMLElement, number>; /** read once, when the first frame is written (D100b) */ afterFirst?: (() => void) | null; quick: { el: HTMLElement; from: number }[]; quickIds: string[];
  /** A control that arrives dimmed at rest (Back or Forward with nowhere to go) keeps that strength while it comes in: its own opacity, by element (only those under 1). */
  own: Map<HTMLElement, number>;
  /** ms taken off the start of every arrival: the layout that is left drew no control at all (Hide the toolbar), so nothing has to leave before the block comes in. */
  lead: number;
  /** A piece that could not travel: the real one (already at its new place, not drawn yet) and where its copy is still to be seen. While the copy is drawn a press on it goes to the piece (`install`). */
  handOver: { real: HTMLElement; box: Box; proxy?: HTMLElement }[];
  /** It is the row morph; the controls beyond the five pieces that travel in it (their copies in the old chrome are not drawn); the sidebar button stands at the same place in both layouts (its copy is not drawn either). */
  row: boolean; travelling: HTMLElement[]; toggleStays: boolean;
  /** +1 with the sidebar on the left, -1 on the right: the sign of every offset that rides with the sidebar's edge (the morph is written for the left and mirrored by this). */
  dir: 1 | -1;
  /** The clock waits at 0 until main says when its page glide started (or `WAIT_MS` pass): the page and the card then share one clock to the millisecond. */
  aligned: boolean; waitUntil: number;
  /** The translate each piece was last given, so its own place (where the layout would put it with none) is the box measured now minus this. */
  placed: Map<string, { dx: number; dy: number }>;
}
let pinnedAt = 0;
let live: Live | null = null, sending: { spring: { duration: number; bounce: number }; lag: { x?: number; y?: number } } | null = null, pinned: BrowserLayout | null = null;
const listeners = new Set<() => void>();
const WAIT_MS = 60;
/** Main's `page-glide` message carries the wall-clock time its glide started (the same clock as here: one machine). Install once, from the first script. */
export function installSidebarMorph(): () => void {
  return (window as unknown as { acira?: { subscribeBrowser?: (listener: (event: { type?: string; at?: number }) => void) => () => void } }).acira?.subscribeBrowser?.(event => {
    if (event.type !== 'page-glide' || !live || live.aligned || typeof event.at !== 'number') return;
    live.startedAt = performance.now() - (Date.now() - event.at); live.aligned = true;
  }) ?? (() => {});
}
export const REFIT_EVENT = 'acira-toolbar-refit';

const q = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = document) => scope.querySelector<T>(selector);
const rectOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };

export const sidebarMorphRunning = (): boolean => live !== null;
let lastDirection: Direction = 'in';
/** The direction of the morph that is running (or ran last). */
export const sidebarMorphDirection = (): Direction => lastDirection;
/** Fields for the layout message the update sends while a morph starts: main glides the page on the morph's spring and lag. Null at any other time. */
export const sidebarMorphSend = () => sending;
/** The layout the morph's own send carried; while the morph runs every other send (a popup settling, a toast) repeats its page placement, so main finds nothing to retarget. */
export const sidebarMorphPinned = (): BrowserLayout | null => (live ? pinned : null);
export const sidebarMorphPin = (layout: BrowserLayout): void => { pinned = layout; pinnedAt = performance.now(); };
/** Called once a morph has settled (App sends what it held back). */
export const onSidebarMorphEnd = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Is the element drawn (it has a box and nothing above it up to the window hides it)? */
function drawn(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (Number.parseFloat(style.opacity) < .02 || style.visibility === 'hidden' || style.display === 'none') return false;
  }
  return true;
}

/** The alpha of the card's ring at rest (read when no morph is drawing it); a morph in flight reads its ring as a share of this. */
let ringAlphaAtRest = .08;
const alphaOf = (shadow: string): number => { const match = /rgba?\(([^)]*)\)/.exec(shadow); if (!match) return 0; const parts = match[1].split(/[ ,/]+/).filter(Boolean); return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1; };
function readLayout(): LayoutNumbers {
  const app = q(SELECTOR.app), shell = q(SELECTOR.shell), page = q(SELECTOR.page);
  const px = (value: string) => Number.parseFloat(value) || 0;
  // The sidebar's column is the first one with the sidebar on the left and the second on the right (sidebar-right.css); the card's corner beside it is the matching top corner.
  const right = rootSidebarSide() === 'right', columns = app ? getComputedStyle(app).gridTemplateColumns.split(' ') : [], style = page ? getComputedStyle(page) : null, shadow = style?.boxShadow ?? 'none';
  const drawnAlpha = shadow && shadow !== 'none' ? alphaOf(shadow) : 0;
  if (!live && drawnAlpha > 0) ringAlphaAtRest = drawnAlpha;
  return { col: px(columns[right ? 1 : 0] ?? '0'), hdr: shell ? shell.getBoundingClientRect().height : 0, mt: px(style?.marginTop ?? '0'), mr: px(style?.marginRight ?? '0'), mb: px(style?.marginBottom ?? '0'), ml: px(style?.marginLeft ?? '0'), radius: px((right ? style?.borderTopRightRadius : style?.borderTopLeftRadius) ?? '0'), ring: live ? Math.min(1, drawnAlpha / ringAlphaAtRest) : shadow && shadow !== 'none' ? 1 : 0 };
}
/** The page card as it is drawn now (the row morph plans against it, and cuts the field where it covers it). */
const pageBoxNow = (radius: number): PageBox | null => { const page = q(SELECTOR.page); if (!page) return null; const r = page.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, radius } : null; };
/** Every control of the header that is drawn now and is not one of the five pieces: Home, the tab overview, the buttons on the right, the bookmarks bar's, and the tab strip's own (its sidebar button, its
 * tab-list button, each tab, the +). By element, with its box and what of it is drawn (its glyph; the whole box of a tab or a chip). In the row morph the ones that stand in both layouts travel like the
 * pieces, the ones only one layout has leave or arrive where they stand. */
interface Control { box: Box; ink: Box }
const STRIP = `${SELECTOR.shell} > .acira-tab-row`;
const CONTROLS = `${SELECTOR.toolbar} :is(button, .profile-button, .update-pill, .toolbar-private-chip), ${STRIP} :is(.sidebar-toggle-control, .tab-strip-tools, .browser-tab, .workspace-chip), ${STRIP} .icon-button:not(.sidebar-toggle-control):not(.standard-tabs-scroll), ${SELECTOR.shell} > .acira-bookmarks-row :is(button, a)`;
function controlsOfNow(): Map<HTMLElement, Control> {
  const out = new Map<HTMLElement, Control>(), pieces = PIECES.flatMap(piece => [...document.querySelectorAll<HTMLElement>(piece.sel)]), list = [...document.querySelectorAll<HTMLElement>(CONTROLS)];
  for (const el of list) {
    if (pieces.some(piece => piece === el || piece.contains(el)) || el.closest('[inert]') || !drawn(el)) continue;
    if (list.some(other => other !== el && other.contains(el))) continue;   // a button inside another control (a tab's close, the tab-list box's own button) is part of it
    const box = rectOf(el); if (!(box.width > 0 && box.height > 0)) continue;
    const whole = el.matches('.browser-tab, .workspace-chip, .update-pill, .toolbar-private-chip, .profile-button'), glyph = whole ? null : el.querySelector('svg, img, canvas');
    out.set(el, { box, ink: glyph?.getClientRects().length ? rectOf(glyph) : box });
  }
  return out;
}
/** The sidebar button drawn in the header now (the toolbar's own, or the tab strip's): what of it is drawn. */
const toggleInkNow = (): Box | null => { const el = [...document.querySelectorAll<HTMLElement>(`${SELECTOR.shell} .sidebar-toggle-control`)].find(drawn), glyph = el?.querySelector('svg'); return el ? rectOf(glyph?.getClientRects().length ? glyph : el) : null; };
const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
/** Where an element stands under an ancestor, as child indexes (the same walk finds its copy in a clone of that ancestor). */
function pathUnder(top: Element, el: Element): number[] | null { const path: number[] = []; for (let node: Element | null = el; node && node !== top; node = node.parentElement) { const parent: Element | null = node.parentElement; if (!parent) return null; path.unshift([...parent.children].indexOf(node)); } return path; }
const atPath = (top: Element, path: number[]): HTMLElement | null => { let node: Element | undefined = top; for (const index of path) node = node?.children[index]; return (node as HTMLElement | undefined) ?? null; };
/** The field is cut where the page card covers it (a website's page is drawn above the interface and covers it anyway; a page the interface draws would not): everything but the card's rounded box, in the field's own coordinates. */
function underPageCut(box: Box, page: DOMRect, radius: number): string {
  const pad = 12;
  if (box.x - pad >= page.right || box.x + box.width + pad <= page.left || box.y - pad >= page.bottom || box.y + box.height + pad <= page.top) return '';
  const n = (value: number) => Math.round(value * 100) / 100, l = n(page.left - box.x), t = n(page.top - box.y), r = n(page.right - box.x), b = n(page.bottom - box.y), c = n(Math.max(0, Math.min(radius, (r - l) / 2, (b - t) / 2)));
  return `path(evenodd, "M${-pad} ${-pad}H${n(box.width + pad)}V${n(box.height + pad)}H${-pad}Z M${n(l + c)} ${t}H${n(r - c)}A${c} ${c} 0 0 1 ${r} ${n(t + c)}V${n(b - c)}A${c} ${c} 0 0 1 ${n(r - c)} ${b}H${n(l + c)}A${c} ${c} 0 0 1 ${l} ${n(b - c)}V${n(t + c)}A${c} ${c} 0 0 1 ${n(l + c)} ${t}Z")`;
}
const ringColor = (): string | null => { const page = q(SELECTOR.page); const shadow = page ? getComputedStyle(page).boxShadow : ''; return /rgba?\([^)]*\)/.exec(shadow)?.[0] ?? null; };

function seePieces(column: number): Map<string, Seen> {
  const out = new Map<string, Seen>();
  for (const piece of PIECES) {
    const el = [...document.querySelectorAll<HTMLElement>(piece.sel)].find(drawn);
    if (!el) continue;
    const box = rectOf(el), glyph = piece.resizes ? null : el.querySelector('svg'), mark = glyph?.getClientRects().length ? rectOf(glyph) : null;
    out.set(piece.id, { id: piece.id, el, box, resizes: piece.resizes, attached: rootSidebarSide() === 'right' ? box.x >= window.innerWidth - column - 1 : box.x + box.width <= column + 1, ink: mark && mark.width > 0 ? { dx: mark.x - box.x, dy: mark.y - box.y, width: mark.width, height: mark.height } : undefined });
  }
  // What the sidebar holds moves as blocks (its own top inset changes when the address block arrives), so only its blocks need a place of their own.
  const rail = q(SELECTOR.rail);
  if (rail?.classList.contains('is-expanded')) for (const child of [...rail.children] as HTMLElement[]) {
    if (child.classList.contains('sb-resize') || !child.getClientRects().length) continue;
    const id = railKind(child), box = rectOf(child);
    // A block is something that stands in the sidebar's flow (the caption, the sections, the footer). The glow and Ambient layers fill the whole sidebar and never move: they are not in anything's way.
    if (box.width && box.height && !out.has(id)) out.set(id, { id, el: child, box, resizes: false, attached: false, block: !/^(absolute|fixed)$/.test(getComputedStyle(child).position) });
  }
  return out;
}

/** A copy of what is on screen now (the old chrome and sidebar) for the part of the old layout that has no counterpart in the new one. It is its own
 * `.app` (so every selector that reads `.app > …` and `:has(> .ed-rail)` finds the same structure, and none of them see the real window change). */
/** Freeze a copy's layout to what its original is drawn with now (Beta 14.0, Along the top: the copy of the old bar is laid out by rules that read the document's layout, and the update gives the document the
 * new one: the copy of a bar beside a sidebar was re-laid as Along the top's, every control 74 pt to the right, over the live field and buttons on hidden frames, 19 Nov). Every element of the copy takes the
 * box its twin has now, inline: all read first, then all written, one layout. */
const FROZEN = ['display', 'visibility', 'position', 'left', 'right', 'top', 'bottom', 'width', 'height', 'min-width', 'max-width', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'gap', 'flex-basis', 'flex-grow', 'flex-shrink', 'order', 'transform', 'translate', 'justify-content'];
function freezeLayout(live: Element, copy: Element): void {
  const from = [live, ...live.querySelectorAll('*')], to = [copy, ...copy.querySelectorAll('*')];
  if (from.length !== to.length) return;
  const values = from.map(el => { const cs = getComputedStyle(el); return FROZEN.map(name => cs.getPropertyValue(name)); });
  // (not the copy's own box: the caller pins it where its original stands; the original's own `left: auto` put the copy of a sidebar on the right at the window's left edge)
  // (D92b: what is hidden stays hidden, but nothing is written `visible`: a child written visible is drawn under a parent the morph hides, and the copies of the tab, the + and the tab-list button that
  // travel as themselves stood drawn where they had been, a second title fading beside the real one: Along the top <-> Tabs on top + sidebar, real takes and stepped frames, 19 Nov.)
  to.forEach((el, i) => { const style = (el as HTMLElement).style; if (!style || i === 0) return; FROZEN.forEach((name, k) => { if (values[i][k] && !(name === 'visibility' && values[i][k] === 'visible')) style.setProperty(name, values[i][k]); }); });
}
/** Noël's still pictures (a cap's snow, the sidebar's drift) are canvases, and a copy of a canvas is blank: the copies carry them, so the leaving pill or row keeps its snow
 *  through the morph instead of losing it at the first frame (D165: the pill was empty for the whole way back from Tabs on top). Its falling flakes are not copied: frozen they
 *  would read as stuck. Nothing is drawn when Noël is off (there are no such canvases). */
function copyPictures(from: HTMLElement, to: HTMLElement): void {
  const SEL = 'canvas.noel-cushion, canvas.noel-drift', a = from.querySelectorAll<HTMLCanvasElement>(SEL); if (!a.length) return;
  const b = to.querySelectorAll<HTMLCanvasElement>(SEL); if (a.length !== b.length) return;
  a.forEach((c, i) => { const d = b[i]; if (!c.width || !c.height) return; d.width = c.width; d.height = c.height; d.getContext('2d')?.drawImage(c, 0, 0); });
}
function ghostsOfNow(controls: Iterable<HTMLElement> = [], freeze = false): Ghosts | null {
  const app = q(SELECTOR.app), root = q(SELECTOR.root), shell = q(SELECTOR.shell), rail = q(SELECTOR.rail);
  if (!app?.parentElement || !root || !shell) return null;
  const host = app.cloneNode(false) as HTMLElement;
  host.setAttribute('aria-hidden', 'true'); host.setAttribute('inert', ''); host.removeAttribute('id'); host.dataset.smGhost = '';
  Object.assign(host.style, { position: 'fixed', inset: '0', display: 'block', background: 'none', pointerEvents: 'none', zIndex: '20', overflow: 'hidden', transition: 'none' });
  const railBox = rail ? rectOf(rail) : { x: 0, y: 0, width: 0, height: 0 }, rootBox = rectOf(root), shellBox = rectOf(shell);
  let railCopy: HTMLElement | null = null, rootCopy: HTMLElement | null = null; const copies = new Map<HTMLElement, HTMLElement>();
  if (rail?.classList.contains('is-expanded') && railBox.width > 1) {
    railCopy = rail.cloneNode(true) as HTMLElement; copyPictures(rail, railCopy);
    Object.assign(railCopy.style, { position: 'absolute', left: `${railBox.x}px`, top: `${railBox.y}px`, width: `${railBox.width}px`, height: `${railBox.height}px`, margin: '0', translate: '0 0', opacity: '1' });
    if (freeze) freezeLayout(rail, railCopy);
    host.appendChild(railCopy);
  }
  const hadBlock = root.classList.contains('addr-side');
  if (shellBox.height > .5 || hadBlock) {
    rootCopy = root.cloneNode(false) as HTMLElement;
    Object.assign(rootCopy.style, { position: 'absolute', left: `${rootBox.x}px`, top: `${rootBox.y}px`, width: `${rootBox.width}px`, height: `${rootBox.height}px`, margin: '0', overflow: 'visible', pointerEvents: 'none' });
    const shellCopy = shell.cloneNode(true) as HTMLElement; copyPictures(shell, shellCopy);
    if (freeze) freezeLayout(shell, shellCopy);
    shellCopy.style.height = `${shellBox.height}px`;
    // The bar's light is a surface, not a control: the real one stands behind the copy the whole time. Two of them lit the bar over the page 30 levels brighter than either resting picture for the
    // first 50 ms of every switch (real frames, 19 Nov: the top rows of the window, in Sidebar <-> Sidebar + address since the morph was written). The copy keeps its place in the tree: the
    // controls' copies are found by their path.
    shellCopy.querySelectorAll<HTMLElement>('.st-amb-top').forEach(node => { node.style.display = 'none'; });
    // The pieces that travel are the real elements: their copies stay in the old chrome but are not drawn.
    for (const piece of PIECES) shellCopy.querySelectorAll<HTMLElement>(piece.sel.replace(`${SELECTOR.shell} > `, '').replace(`${SELECTOR.toolbar}`, '.acira-persistent-toolbar')).forEach(el => { el.style.visibility = 'hidden'; });
    for (const el of controls) { const path = pathUnder(shell, el), copy = path && atPath(shellCopy, path); if (copy) copies.set(el, copy); }
    rootCopy.appendChild(shellCopy); host.appendChild(rootCopy);
  }
  // A copy is not a tab, a row to flip or a field to find by id.
  for (const node of host.querySelectorAll('[id],[data-tab-id],[data-flip]')) { node.removeAttribute('id'); node.removeAttribute('data-tab-id'); node.removeAttribute('data-flip'); }
  return { app: host, root: rootCopy, rail: railCopy, block: hadBlock, opacity: 1, copies };
}

const touch = (m: Live, el: HTMLElement): Touched => {
  let item = m.touched.get(el);
  if (!item) { item = { el, translate: el.style.translate, opacity: el.style.opacity, scale: el.style.scale, clipPath: el.style.clipPath, props: [], attrs: [] }; m.touched.set(el, item); }
  return item;
};
const setVar = (m: Live, el: HTMLElement | null | undefined, name: string, value: string) => { if (!el) return; const item = touch(m, el); if (!item.props.includes(name)) item.props.push(name); el.style.setProperty(name, value); };
const setAttr = (m: Live, el: HTMLElement, name: string) => { const item = touch(m, el); if (!item.attrs.includes(name)) item.attrs.push(name); el.setAttribute(name, ''); };

/** Take everything the morph put on the window off again (the layout is then the one React drew). */
function teardown(): void {
  const m = live; if (!m) return;
  cancelAnimationFrame(m.frame); clearTimeout(m.timer);
  const root = document.documentElement;
  for (const name of ['data-sm-morph', 'data-sm-rail', 'data-sm-span', 'data-sm-pin', 'data-mode-switch']) { if (name !== 'data-mode-switch' || root.getAttribute('data-mode-switch') === 'morph') root.removeAttribute(name); }
  for (const item of m.touched.values()) {
    if (!item.el.isConnected) continue;
    item.el.style.translate = item.translate; item.el.style.opacity = item.opacity;
    item.el.style.scale = item.scale; item.el.style.clipPath = item.clipPath;
    for (const name of item.props) item.el.style.removeProperty(name);
    for (const name of item.attrs) item.el.removeAttribute(name);
  }
  dropHandOver(m); m.ghosts?.app.remove(); tabTravelEnd();   // (D102: the travellers' layer goes with the old chrome's copy, and the new icons are drawn again)
  live = null; pinned = null;
}

/** Can a morph start now? It needs the interface's own chrome, motion on, no other transition drawing, and the plain page card (no floating sidebar, no split). */
function canMorph(): boolean {
  if (typeof document === 'undefined' || reducedMotion() || motionScale() <= 0 || document.visibilityState !== 'visible') return false;
  const root = document.documentElement;
  if (root.hasAttribute('data-mode-switch') || root.hasAttribute('data-edge-float') || root.hasAttribute('data-sidebar-overlay') || root.hasAttribute('data-fr-switch') || root.hasAttribute('data-fr-finale') || root.hasAttribute('data-window-fullscreen')) return false;
  const app = q(SELECTOR.app);
  return !!app && !app.querySelector(':scope > .setup-dialog') && !!q(SELECTOR.shell) && !!q(SELECTOR.page) && !q(SELECTOR.root)?.querySelector('.page-content.split-pages');
}

/** What the layout a switch goes to has, said by whoever starts the morph (runtime/client.ts knows the settings it is about to apply): a sidebar standing, the address block in it, the tab strip above the
 * toolbar. The page's top edge takes its wait from it (sidebarMorphPlan.ts topEdgeLag), and main has to be told that wait with the one layout message the switch sends, before the new layout can be measured. */
export interface MorphTarget { sidebar: boolean; block: boolean; strip: boolean; /** a toolbar row stands over the page (false: Hide the toolbar is in effect there) */ bar?: boolean; /** one side is Along the top: the sidebar's column opens or closes in the row morph */ top?: boolean }
let target: MorphTarget | null = null;
export const noteMorphTarget = (next: MorphTarget | null): void => { target = next; };

/** Run `update` (it must apply the new layout synchronously) as the morph, from what is drawn now. Returns false, having done nothing, when it cannot: the caller then switches as it always has. */
export function startSidebarMorph(update: () => void, direction: Direction): boolean {
  if (live) { if (document.visibilityState !== 'visible' || reducedMotion() || motionScale() <= 0) { finishSidebarMorph(); return false; } }
  else if (!canMorph()) return false;
  lastDirection = direction;
  const interrupted = live !== null, sch = schedule(direction, motionPace(), interrupted), root = document.documentElement;
  // --- first: what is drawn now (a morph in flight included)
  const to = target; target = null;
  // D102: the tabs travel between the strip along the top and the sidebar's list (ui/tabTravel.ts): where each tab's icon stands now, read before the old chrome is copied and the layout switched.
  const travelFirst = tabTravelFirst();
  const firstLayout = readLayout(), firstSeen = seePieces(firstLayout.col), firstPage = pageBoxNow(firstLayout.radius), firstControls = controlsOfNow(), firstToggle = toggleInkNow(), firstStrip = !!q(STRIP)?.getClientRects().length, ghosts = ghostsOfNow(firstControls.keys(), !!to?.top), hadBlock = !!q(SELECTOR.root)?.classList.contains('addr-side');
  const shown = (el: HTMLElement | undefined) => (el ? Math.min(1, Number.parseFloat(el.style.opacity || '1') / (live?.own.get(el) ?? 1)) : null);
  const carried = live ? { rail: live.ghosts?.rail ? live.ghosts.opacity : shown(live.arrivals.rail[0]) ?? 0, chrome: live.ghosts?.root && !live.ghosts.block ? live.ghosts.opacity : shown(live.arrivals.chrome[0]) ?? 0 } : null;
  teardown();
  // --- the update: the final layout, drawn at once (nothing framer would glide under it), pinned to what framer will settle on, and its layout message carrying the page's spring and lag
  root.setAttribute('data-sm-pin', ''); root.setAttribute('data-mode-switch', 'morph');
  // Turned round while the bar still holds buttons (they are drawn outside the sidebar's column): the page's top edge must not close the bar over them. It waits as on a fresh switch, a little less
  // (the buttons are part of the way already). Main is told with the layout message below, so this is decided before the update.
  if (interrupted && direction === 'in' && [...firstSeen.values()].some(piece => piece.ink && !piece.attached)) { sch.lagY = Math.round(LAG_MS * .6 * sch.scale); sch.total += sch.lagY; }
  // A fresh switch between two layouts that both have the sidebar standing: the page's top edge waits as that pair needs (Sidebar <-> Sidebar + address: as it always did).
  else if (!interrupted && to?.sidebar && firstLayout.col > 1) { sch.lagY = topEdgeLag(direction, sch.scale, { block: hadBlock, rows: firstLayout.hdr }, to); retime(sch); }
  // Out of Sidebar + address into a layout with no bar over the page (Hide the toolbar on): nothing of the page moves, so its side edges have no bar to wait for. Told to wait the 180 ms a bar takes
  // to open, main began a glide of no distance when that wait ended and the page's top-left corner showed the dark behind it for one frame (real frames, 19 Nov: 26 pixels at 158 ms, the bar's reading
  // 15 against its two rests; the way in had the same from the top edge's wait, 27 to 29, until `bare` took that wait off).
  if (!interrupted && direction === 'out' && to?.bar === false && firstLayout.hdr < NO_BAR) { sch.lagX = 0; retime(sch); }
  // Into Along the top the sidebar's column closes at once, on the drawer's spring, instead of waiting the 180 ms a column waits for a bar to open beside it: the bar's buttons travel left as soon as the
  // morph starts, and a column that stood still meanwhile had them run over the leaving sidebar's caption row (hidden frames, 19 Nov: 256 px^2 at Narrow and on the right).
  // (D100: not out of Sidebar + address. There the field and the three buttons stand IN the column: closed at once, the column's edge dragged Reload 25 pt back on its way and the page's edge ran over
  // the field, which went under the page and came out 496 pt wider in one frame (the regression guard's c2 at 1280 pt, 19 Nov). The column waits there as it always did, the bar opens first, and the
  // buttons wait for the leaving sidebar's rows as the plan says.)
  if (!interrupted && direction === 'out' && to?.top && !to.sidebar && firstLayout.col >= 1 && !hadBlock) { sch.lagX = 0; retime(sch); }
  // D100f: out of Sidebar + address the column never sets off before the field: it waits longer than the field may (sidebarMorphPlan.ts fieldFirstColumnLag), at every speed.
  if (!interrupted && direction === 'out' && to?.top && !to.sidebar && firstLayout.col >= 1 && hadBlock && sch.lagX < fieldFirstColumnLag(sch.scale)) { sch.lagX = fieldFirstColumnLag(sch.scale); retime(sch); }
  // D100: into Sidebar + address from no sidebar at all the page's top edge waits until the field has crossed the bar in sight (sidebarMorphPlan.ts TOP_BLOCK_LAG_MS).
  if (!interrupted && direction === 'in' && to?.top && to.block && firstLayout.col < 1) { sch.lagY = Math.round(TOP_BLOCK_LAG_MS * sch.scale); retime(sch); }
  sending = pageGlide(sch); pinnedAt = 0; setInstantTransitions(true);
  try { update(); } catch (error) { root.removeAttribute('data-sm-pin'); root.removeAttribute('data-mode-switch'); pinned = null; throw error; } finally { setInstantTransitions(false); sending = null; }
  try {
  // The toolbar's own fit (which buttons the row has room for, ui/toolbarOverflow.ts) normally runs a frame after a render and not at all while a morph plays. The row that comes back when the mode goes off was
  // therefore measured unfitted, the field 32 px wider than it ends, and it jumped to its true width when the morph ended and the fit ran (seen on stepped frames, 19 Nov: 340 px for the whole morph, 308 at rest).
  // The fit runs here, on the layout React just drew, so what is measured as the end IS the end. (Into the block in the sidebar the fit only takes the bar's marks off: the block is not fitted, and a
  // mark left on Home or the tab overview would show them there, D82.)
  try { dispatchEvent(new Event(REFIT_EVENT)); } catch { /* no window */ }
  // --- last: the layout React drew
  const lastLayout = readLayout(), lastSeen = seePieces(lastLayout.col), lastControls = controlsOfNow(), hasBlock = !!q(SELECTOR.root)?.classList.contains('addr-side');
  const movers: Mover[] = [], moverEls = new Map<string, HTMLElement>(), arrivals: Live['arrivals'] = { rail: [], pill: [], button: [], chrome: [], carry: { rail: carried?.rail ?? 0, chrome: carried?.chrome ?? 0 } };
  for (const [id, now] of lastSeen) {
    const was = firstSeen.get(id);
    // (reported 20 Nov, on D108's way in, a sidebar that came from nothing bringing its light with its column: 'for this the before is better, keep it'. Its two kinds of light arrive
    // with what stands in it again, after the travellers, as on the release tip before D108.)
    if (!was) { if (id.startsWith('rail:')) arrivals.rail.push(now.el); else if (hasBlock) arrivals.button.push(now.el); else arrivals.chrome.push(now.el); continue; }
    // Only the wide address field rides the sidebar's edge (it must be out of the band before the page's top edge rises into it); the buttons simply travel.
    // A button is drawn at the size it ends with from the first frame: it travels by its middle, so its glyph starts exactly where it was (the Narrow sidebar's buttons are 20 px wide, the bar's 28).
    const ink = now.ink, from = ink ? { x: was.box.x + (was.box.width - now.box.width) / 2, y: was.box.y + (was.box.height - now.box.height) / 2, width: now.box.width, height: now.box.height } : was.box;
    movers.push({ id, first: from, last: now.box, attach0: was.attached && now.resizes, attach1: now.attached && now.resizes, bow: 0, resizes: now.resizes, xDelay: 0, yDelay: 0, ink, block: now.block });
    moverEls.set(id, now.el);
  }
  const rail = q(SELECTOR.rail), railLive = !!rail?.classList.contains('is-expanded') && lastLayout.col > 1, railEls = new Set<HTMLElement>();
  if (rail && railLive) for (const child of [...rail.children] as HTMLElement[]) if (!child.classList.contains('sb-resize')) railEls.add(child);
  const pill = q(`${SELECTOR.toolbar} > .sb-addr-more`); if (pill && !hadBlock) arrivals.pill.push(pill);
  // The pieces' paths. The row morph (the sidebar stands in both layouts: Sidebar <-> Sidebar + address, and the tab strip arriving above the toolbar or leaving) is worked out from the boxes just measured
  // (sidebarMorphPlan.ts planRowMorph: nothing crosses anything); every other switch keeps the plan it had.
  const lastPage = pageBoxNow(lastLayout.radius), clearAt = new Map<HTMLElement, number>(), side: 1 | -1 = rootSidebarSide() === 'right' ? -1 : 1, travelling: HTMLElement[] = [], follow: Live['follow'] = [];
  const row = !!firstPage && !!lastPage && rowMorphApplies(movers, firstLayout, lastLayout, firstPage, lastPage, side, !!to?.top);
  // Nothing of the chrome was drawn before (Hide the toolbar on, turning the mode on): no bar has to empty first. The block's controls come in at once instead of after the 100 ms a bar's buttons take
  // to leave, and the list below the block moves down at once instead of waiting the 180 ms a button needs to be clear of the page's corner (stepped frames, 19 Nov: the window stood still for 100 ms
  // after the press, then the block came, then, 170 ms in, the list moved).
  const bare = !row && direction === 'in' && firstLayout.hdr < NO_BAR && ![...firstSeen.keys()].some(id => !id.startsWith('rail:'));
  let quickIds: string[] = [], toggleStays = false; const handOver: Live['handOver'] = [];
  // D100b: what arrives while the column opens or closes is not drawn at its place (a control of the bar stands in the page's column, the sidebar's own button is carried on its edge). Its place and
  // its middle there are kept, and once the first frame is laid out how far from it each is drawn is read and its arrival timed for where it is drawn (below, after the first frame).
  const colMoves = Math.abs(firstLayout.col - lastLayout.col) > .5, places = new Map<HTMLElement, { place: Box; mid: number }>(); let clearOf: ((place: Box, ride: number) => number) | null = null;
  if (row && firstPage && lastPage) {
    const incoming = hasBlock ? arrivals.button : arrivals.chrome;
    // Every other control that stands in both layouts (Home, the buttons on the right, the bookmarks bar's) travels like the pieces, by its middle; one only the new layout has arrives where it will stand.
    for (const [el, now] of lastControls) {
      const was = firstControls.get(el);
      // (A control of a tab strip that is new comes in with the strip's own parts below: the strip draws more than its controls, the selected tab's plate for one, and a part is one thing.)
      if (!was) { if (!(el.closest(STRIP) && !firstStrip) && !el.closest('.sb-addr-more')) incoming.push(el); continue; }
      const id = `ctl:${travelling.length}`;
      movers.push({ id, first: { x: was.box.x + (was.box.width - now.box.width) / 2, y: was.box.y + (was.box.height - now.box.height) / 2, width: now.box.width, height: now.box.height }, last: now.box, attach0: false, attach1: false, bow: 0, resizes: false, xDelay: 0, yDelay: 0, ink: { dx: now.ink.x - now.box.x, dy: now.ink.y - now.box.y, width: now.ink.width, height: now.ink.height } });
      moverEls.set(id, el); travelling.push(el);
    }
    // The selected tab's plate is the strip's own (.tab-strip-selection, laid out where the selected tab is laid out), not the tab's: with the tab travelling as itself the plate stayed with the strip's
    // layout, a second tab sliding with the opening column beside the real one, and its copy in the old chrome stood where the tab had been (real takes and stepped frames, 19 Nov: Along the top <->
    // Tabs on top + sidebar, the tab and its plate twice for about 75 ms each way). It goes where the tab goes, and its copy is not drawn.
    const plate = q(`${STRIP} .tab-strip-selection`), chosen = travelling.find(el => el.matches('.browser-tab.selected'));
    if (plate && chosen) { const a = rectOf(plate), b = rectOf(chosen); if (Math.abs(a.x - b.x) < 1.5 && Math.abs(a.width - b.width) < 1.5) follow.push({ el: plate, of: chosen }); }
    // A tab strip that is new arrives part by part (its band, its sidebar button, its tab-list button, the workspace chip, the tabs with their plate and the +), each where it will stand.
    const strip = q(STRIP); if (strip && !firstStrip) for (const part of [...strip.children] as HTMLElement[]) { const box = rectOf(part); if (box.width > 0 && box.height > 0 && drawn(part)) arrivals.chrome.push(part); }
    // The sidebar button stands at the same place in both layouts but is not the same element (the toolbar's own in one, the tab strip's in the other): to the eye it is one button, and it stays.
    const comes = incoming.find(el => el.matches('.sidebar-toggle-control')), lastToggle = toggleInkNow();
    if (comes && firstToggle && lastToggle && sameBox(firstToggle, lastToggle)) { incoming.splice(incoming.indexOf(comes), 1); toggleStays = true; }
    const comers = [...arrivals.rail, ...arrivals.pill, ...arrivals.button, ...arrivals.chrome], leavingStills: Still[] = [], arrivingStills: Still[] = [];
    // What leaves where it stands: a control the new layout does not draw, and a piece it does not have (the toolbar's sidebar button where the strip has its own).
    // (Beta 14.0, Along the top: the controls that leave clear the way quickly, as a demoted button does, so the field that changes rows past them need not wait: gone by QUICK_LEFT_MS, see the quick fade below.)
    for (const [el, was] of firstControls) if (!lastControls.has(el) && !(toggleStays && el.matches('.sidebar-toggle-control'))) leavingStills.push({ id: `left:${leavingStills.length}`, box: was.ink, ...(to?.top ? { goneAt: QUICK_LEFT_MS } : {}) });
    // (Beta 14.0, Along the top: a leaving piece whose copy rides with the column, a piece of the old sidebar or of the block in it, moves as the column closes: the plan shifts its box by the column's travel.)
    const inColumn = (box: Box) => (side === 1 ? box.x + box.width <= firstLayout.col + .5 : box.x >= innerWidth - firstLayout.col - .5);
    for (const still of leavingStills) if (hadBlock && inColumn(still.box)) still.rides = true;
    for (const [id, was] of firstSeen) if (!lastSeen.has(id) && was.ink && !(toggleStays && id === 'toggle')) leavingStills.push({ id: `left:${leavingStills.length}`, box: { x: was.box.x + was.ink.dx, y: was.box.y + was.ink.dy, width: was.ink.width, height: was.ink.height }, rides: hadBlock && inColumn(was.box) });
    // The column closes into Along the top: the old sidebar's own pieces (its caption row among them) leave in its copy, riding with the column.
    if (lastLayout.col < 1 && firstLayout.col >= 1) for (const [id, was] of firstSeen) if (id.startsWith('rail:') && !lastSeen.has(id) && was.box.height < 120) leavingStills.push({ id: `left:${leavingStills.length}`, box: was.box, rides: true });
    // (the strip's band lies under everything in its row: it holds nothing back and waits for nothing but the row's own arrival)
    comers.forEach((el, i) => { const box = lastControls.get(el)?.ink ?? rectOf(el); if (box.width > 0 && box.height > 0 && !el.matches('.acira-strip-tone')) arrivingStills.push({ id: `came:${i}`, box }); });
    if (colMoves) for (const el of comers) { const all = rectOf(el); places.set(el, { place: lastControls.get(el)?.ink ?? all, mid: all.x + all.width / 2 }); }
    const plan = planRowMorph({ movers, first: firstLayout, last: lastLayout, page0: firstPage, page1: lastPage, sch, dir: side, band: Math.max(lastLayout.hdr, firstLayout.hdr, 2), leaving: leavingStills, arriving: arrivingStills, standing: [...(toggleStays && lastToggle ? [{ id: 'toggle', box: lastToggle }] : []), ...windowButtons()], fieldFirst: !!to?.top && (hadBlock || hasBlock) });
    comers.forEach((el, i) => { const at = plan.clearAt[`came:${i}`]; if (at !== undefined) clearAt.set(el, at); }); clearOf = plan.clearOf;
    // A piece that cannot travel leaves where it was (its copy in the old chrome, quickly) and arrives where it will be once the travellers have passed.
    for (const gone of plan.demoted) { const el = moverEls.get(gone.id); moverEls.delete(gone.id); if (!el) continue; const at = travelling.indexOf(el); if (at >= 0) travelling.splice(at, 1); incoming.push(el); clearAt.set(el, plan.clearAt[gone.id] ?? 0); if (colMoves) places.set(el, { place: inkOf(gone, gone.last), mid: gone.last.x + gone.last.width / 2 }); handOver.push({ real: el, box: gone.first }); }
    quickIds = plan.demoted.map(item => item.id);
    for (let i = follow.length - 1; i >= 0; i--) if (!travelling.includes(follow[i].of)) follow.splice(i, 1);   // (a tab that could not travel leaves and arrives with its plate, as the strip draws it)
    movers.length = 0; movers.push(...plan.movers);
  } else {
    // The chrome that comes back when the mode goes off (the tab strip, the bookmarks row, the buttons on the right, Home) arrives; the rest of it travels.
    if (!hasBlock) for (const sel of [`${SELECTOR.shell} > .acira-tab-row`, `${SELECTOR.shell} > .acira-bookmarks-row`, `${SELECTOR.toolbar} .toolbar-actions`, `${NAV}:nth-child(n+4)`, `${SELECTOR.toolbar} .expanded-navigation > .toolbar-tab-overview`, `${SELECTOR.toolbar} .acira-compact-tabs`]) for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!el.closest('[inert]')) arrivals.chrome.push(el);
    bowCrossings(movers, Math.max(lastLayout.hdr, firstLayout.hdr, 2)); if (!interrupted && !bare) delayRowChange(movers, sch); sch.total = totalMs(sch, movers);
  }
  // Windows: nothing passes under the caption buttons (captionKeepClear, sidebarMorphPlan.ts): the rectangle is 138 DIP wide (the three buttons) and one toolbar row (36 px) tall, in CSS px: the plate is not drawn in the layouts that morph.
  if ((document.documentElement.dataset.platform || 'darwin') === 'win32') { const f = parseFloat(getComputedStyle(document.querySelector('.app') ?? document.documentElement).getPropertyValue('--interface-scale')) || 1; captionKeepClear(movers, sch, { left: innerWidth - 138 / f, height: 36 }); sch.total = totalMs(sch, movers); }
  // The sidebar blocks that were not there before arrive (the others only move down); the rail itself slides.
  // A control that arrives is brought in by its opacity, set on the element: that replaced the half strength a Back or Forward with nowhere to go is drawn at, so it came in at full strength and dropped
  // to half when the morph ended (probe of the stepped frames, 19 Nov). Its own strength is read here, before anything is set on it, and the arrival multiplies it.
  const own = new Map<HTMLElement, number>();
  for (const el of [...arrivals.button, ...arrivals.chrome]) { const strength = Number.parseFloat(getComputedStyle(el).opacity); if (strength > 0 && strength < 1) own.set(el, strength); }
  const m: Live = { own, lead: bare ? BUTTON_IN[0] : 0, clearAt, quick: [], quickIds, handOver, row, travelling, follow, toggleStays, startedAt: 0, sch, first: firstLayout, last: lastLayout, movers, moverEls, arrivals, ghosts, railLive, railWidth: rail ? rectOf(rail).width : 0, addrLeft: null, hadBlock, hasBlock, touched: new Map(), frame: 0, timer: undefined, aligned: false, waitUntil: 0, placed: new Map(), dir: side, app: q(SELECTOR.app), shell: q(SELECTOR.shell), bar: q(`${SELECTOR.shell} > .acira-bookmarks-row`), page: q(SELECTOR.page), rail, toolbar: q(SELECTOR.toolbar), railEls, pinned: null };
  const left = m.toolbar ? Number.parseFloat(getComputedStyle(m.toolbar).left) : Number.NaN;
  m.addrLeft = hasBlock && Number.isFinite(left) ? left : null;
  // Nothing visibly changes: no morph.
  const quiet = (['col', 'hdr', 'mt', 'mr', 'mb', 'ml'] as const).every(key => Math.abs(firstLayout[key] - lastLayout[key]) < .5) && movers.every(v => Math.abs(v.first.x - v.last.x) < .5 && Math.abs(v.first.y - v.last.y) < .5 && Math.abs(v.first.width - v.last.width) < .5 && Math.abs(v.first.height - v.last.height) < .5) && !arrivals.button.length && !arrivals.chrome.length && !arrivals.pill.length && !arrivals.rail.length && !ghosts?.root && !ghosts?.rail;
  if (quiet) { root.removeAttribute('data-sm-pin'); root.removeAttribute('data-mode-switch'); pinned = null; return true; }
  // Main starts its page glide when the layout message reaches it, which is the moment the update sent it: the morph's clock starts there too, so the page and the card it sits in are never a frame apart.
  // A window that draws no frames (hidden, covered) never runs the animation frame: the morph still ends, and the window it leaves is the plain one.
  // D102: one traveller per tab that has an icon in sight in both layouts, on this morph's clock; the old icons' copies in the old chrome's copy and the new icons are not drawn meanwhile.
  // (Before `install`: the new icons' places are read while the layout is the one React drew, as the morph's own `last` is.)
  // (It is told where this morph's own travelling pieces are at every moment, the toolbar's buttons and field on their way: the travellers keep clear of them.)
  tabTravelStart(travelFirst, { ghostShell: ghosts?.root?.firstElementChild ?? null, ghostRail: ghosts?.rail ?? null, total: sch.total, direction, side, host: m.app?.parentElement ?? null,
    obstacles: ms => { const lay = layoutAt(firstLayout, lastLayout, sch, ms); return movers.filter(mover => !mover.block && !mover.id.startsWith('rail:')).map(mover => { const box = moverBox(mover, firstLayout, lastLayout, lay, sch, ms, side); return mover.ink ? { x: box.x + mover.ink.dx, y: box.y + mover.ink.dy, width: mover.ink.width, height: mover.ink.height } : box; }); } });
  live = m; install(m);
  if (row && to?.top && ghosts) for (const [el] of firstControls) if (!lastControls.has(el)) { const copy = ghosts.copies.get(el); if (copy) m.quick.push({ el: copy, from: Number.parseFloat(copy.style.opacity || '1') }); } m.timer = setTimeout(() => finish(m), sch.total + 700); m.startedAt = (pinnedAt > 0 ? pinnedAt : performance.now()) + MAIN_LATENCY_MS; m.waitUntil = performance.now() + WAIT_MS;
  // Main announces its page glide only when it has ONE website to glide (desktop/main.cjs). A tab the interface draws itself (New Tab, Settings) has none: waiting for the announcement there held the
  // whole window still for WAIT_MS (60 ms, seven frames) after the press and then jumped it 48 ms ahead (found 19 Nov on stepped frames; every Sidebar-mode switch on a New Tab page). No website: the clock starts now.
  if (!(pinned && Array.isArray(pinned.views) && pinned.views.length === 1)) { m.aligned = true; m.startedAt = performance.now(); }
  // D100b: the first frame stands (the column at its first width, every arrival where it is drawn there and not to be seen yet). An arrival drawn away from its place comes in once every traveller
  // has cleared where it is DRAWN from then on, not only its place (sidebarMorphPlan.ts `clearOf`). The layout read here is the one this frame is painted from.
  // (Run by the frame itself once it has written everything of the morph's own: the switch's task still runs the frame once and returns.)
  const read = clearOf; m.afterFirst = read && places.size ? () => {
    let total = sch.total;
    for (const [el, was] of places) { const at0 = clearAt.get(el); if (at0 === undefined) continue; const now = rectOf(el), ride = now.x + now.width / 2 - was.mid; if (Math.abs(ride) < 1) continue; const at = read(was.place, ride); if (at > at0) { clearAt.set(el, at); total = Math.max(total, at + Math.round(ARRIVE_MS * sch.scale)); } }
    if (total > sch.total) { sch.total = total; clearTimeout(m.timer); m.timer = setTimeout(() => finish(m), sch.total + 700); }
  } : null;
  frame(m);
  return true;
  } catch (error) { abort(); throw error; }
}

/** D109: the Mac's window buttons stand where they are through every layout switch: three 14 pt discs 9 pt apart, the first 12 pt from the window's left edge, centred in the 36 px top row
 * (desktop/platform.cjs setWindowButtonPosition; fullscreen-lights.css draws the same in a fullscreen window). The interface is zoomed by its scale and the buttons are not: their box in the
 * interface's px is the points over the scale. A button of the bar that changes rows went over them on its diagonal (Back at Narrow, Along the top <-> Sidebar + address, 2 to 3 frames each way,
 * on the release tip too): the plan keeps every glyph off them. They are discs, so their box's corners are empty: nothing is kept clear round it (`clear: 0`). Not on Windows or Linux. */
function windowButtons(): Still[] {
  if ((document.documentElement.dataset.platform || 'darwin') !== 'darwin') return [];
  const f = Number.parseFloat(getComputedStyle(document.querySelector('.app') ?? document.documentElement).getPropertyValue('--interface-scale')) || 1;
  return [{ id: 'lights', box: { x: 12 / f, y: (36 - 14 / f) / 2, width: 60 / f, height: 14 / f }, clear: 0 }];
}

/** Whatever a failed start had set: the window is the plain one again. */
function abort(): void {
  if (live) teardown();
  const root = document.documentElement;
  root.removeAttribute('data-sm-pin'); root.removeAttribute('data-sm-morph'); root.removeAttribute('data-sm-rail'); root.removeAttribute('data-sm-span'); if (root.getAttribute('data-mode-switch') === 'morph') root.removeAttribute('data-mode-switch');
  pinned = null; sending = null; setInstantTransitions(false);
}

/** The leaving copies are gone: nothing takes a press for them any more. */
function dropHandOver(m: Live): void { for (const item of m.handOver) item.proxy?.remove(); m.handOver.length = 0; }

/** px of the page's card, beside a sidebar that leaves, that carry the sidebar's edge light until the page stands there (D108). */
const RAIL_FILL = 64;
function install(m: Live): void {
  const root = document.documentElement;
  root.setAttribute('data-sm-morph', ''); if (m.railLive) root.setAttribute('data-sm-rail', '');
  setVar(m, m.page, '--sm-ring-color', ringColor() ?? 'rgba(0, 0, 0, .08)');
  setVar(m, m.rail, '--sm-rail-w', `${m.railWidth}`);
  const address = m.moverEls.get('address'); if (address) setAttr(m, address, 'data-sm-size');
  const g = m.ghosts;
  if (g) {
    // The sidebar stays (it only moves down): its copy is not needed. A copy of a header that has nothing in it either.
    if (g.rail && m.railLive) { g.rail.remove(); g.rail = null; }
    if (g.root) for (const piece of PIECES) if (!m.moverEls.has(piece.id)) g.root.querySelectorAll<HTMLElement>(piece.sel.replace(`${SELECTOR.shell} > `, '').replace(SELECTOR.toolbar, '.acira-persistent-toolbar')).forEach(el => { el.style.visibility = ''; if (m.quickIds.includes(piece.id)) m.quick.push({ el, from: Number.parseFloat(el.style.opacity || '1') }); });
    // The controls that travel as themselves are not drawn in the old chrome's copy; nor is the sidebar button where it simply stays.
    for (const el of m.travelling) { const copy = g.copies.get(el); if (copy) copy.style.visibility = 'hidden'; }
    if (m.follow.length && g.root) g.root.querySelectorAll<HTMLElement>('.acira-tab-row .tab-strip-selection').forEach(el => { el.style.visibility = 'hidden'; });
    if (m.toggleStays && g.root) g.root.querySelectorAll<HTMLElement>('.sidebar-toggle-control').forEach(el => { el.style.visibility = 'hidden'; });
    // D100c: a sidebar that leaves for good (Along the top: no column in the end) keeps its surface and its light until its column has closed, riding with the column's edge: only what stands in it
    // leaves at once. The whole copy went in the first 110 ms, while the column stands for 180 ms out of Sidebar + address (the field crosses the bar first, D100): a flat dark column at full width
    // with a hard edge against the lit bar, then that edge sweeping through the bar (real takes, 20 Nov: 15 frames with a step of 28 to 40 levels in the top rows; 6 before D100, the column closing at once).
    if (g.rail && m.last.col < 1 && m.first.col >= 1) g.railRows = ([...g.rail.children] as HTMLElement[]).filter(el => !el.matches('.st-amb-side, .st-glow-rail'));
    // D108, the blend (reported 20 Nov: 'the blend of colours isnt blendy'): out of Sidebar + address the bar arrives from nothing beside a sidebar that leaves. Its light stood only over the
    // page's column, the old sidebar's own light beside it: two fields that never met at rest, meeting in a hard line down the column's edge for as long as the column stood (real frames: the
    // bar's top rows 66 to 71 against the sidebar's 87, and green against the sidebar's warm side lower down), a line that then swept through the bar. As on the way in, where the old bar's
    // light lies across the opening sidebar, the arriving bar's light now reaches across the whole window from its first frame (sidebar-mode-morph.css, data-sm-span: its box is the one it
    // ends with), and the sidebar's copy is cut where the bar stands, so the two never lie on each other: the bar comes down over the sidebar's head, and what is left of the sidebar slides away.
    if (g.railRows && g.rail && m.first.hdr < NO_BAR && m.last.hdr > m.first.hdr + 8) { g.railTop = Number.parseFloat(g.rail.style.top) || 0; root.setAttribute('data-sm-span', ''); }
    // D108 (c): the page is main's, the column the interface's, and which of the two is a few ms ahead changes from launch to launch (main's frames and the interface's are not in step). Where
    // the page is behind, the page's card shows between the closing column and the page: with the sidebar going black nobody saw it, beside a lit sidebar it is a dark strip (real takes of one
    // launch, 20 Nov: up to 32 px in Tabs on top + sidebar -> Along the top, 46 px with the Wide sidebar, six to eight frames, a tenth of the column still to go in every frame; none in the
    // launch before). The sidebar's light at its edge (its copy's own layer, without the fall-off across the sidebar) is carried RAIL_FILL px further, over the card: the page covers it
    // wherever the page stands, and where it does not yet, the strip is the sidebar's edge and not the card's fill.
    const light = g.railRows && g.rail ? g.rail.querySelector<HTMLElement>(':scope > .st-amb-side') : null;
    if (light && g.rail) {
      const fill = light.cloneNode(true) as HTMLElement, left = Number.parseFloat(g.rail.style.left) || 0, top = Number.parseFloat(g.rail.style.top) || 0, width = Number.parseFloat(g.rail.style.width) || 0;
      for (const layer of [...fill.children] as HTMLElement[]) { layer.style.setProperty('-webkit-mask-image', 'none'); layer.style.setProperty('mask-image', 'none'); }
      Object.assign(fill.style, { position: 'absolute', inset: 'auto', left: `${m.dir === 1 ? left + width : left - RAIL_FILL}px`, top: `${top}px`, width: `${RAIL_FILL}px`, height: g.rail.style.height, zIndex: '0' });
      g.app.appendChild(fill); g.railFill = { el: fill, top };
    }
    if (g.root || g.rail) m.app?.parentElement?.appendChild(g.app); else m.ghosts = null;
  }
  // What is drawn takes the press. A piece that could not travel (the sidebar button changing ends of its row) is drawn, for the first moments, as its copy where it stood, while the real button already stands
  // at its new place and is not drawn yet: a press on the copy went to whatever lay under it. For as long as the copy is to be seen, a press there goes to the button.
  for (const item of m.handOver) {
    const proxy = document.createElement('div'); proxy.dataset.smPress = '';
    Object.assign(proxy.style, { position: 'fixed', left: `${item.box.x}px`, top: `${item.box.y}px`, width: `${item.box.width}px`, height: `${item.box.height}px`, zIndex: '70', background: 'none' });
    proxy.style.setProperty('-webkit-app-region', 'no-drag');
    proxy.addEventListener('click', event => { event.stopPropagation(); item.real.click(); });
    (m.app?.parentElement ?? document.body).appendChild(proxy); item.proxy = proxy;
  }
}

function frame(m: Live): void {
  if (live !== m) return;
  // Until main has said when its glide began the morph stands at its first frame (a few milliseconds); if it never does, the estimate of its latency takes over.
  if (!m.aligned && performance.now() > m.waitUntil) m.aligned = true;
  const ms = m.aligned ? performance.now() - m.startedAt : 0, sch = m.sch, scale = sch.scale, lay = layoutAt(m.first, m.last, sch, ms);
  setVar(m, m.app, '--sm-col', `${lay.col}`); setVar(m, m.shell, '--sm-hdr', `${lay.hdr}`); setVar(m, m.bar, '--sm-hdr', `${lay.hdr}`);
  setVar(m, m.page, '--sm-mt', `${lay.mt}`); setVar(m, m.page, '--sm-mr', `${lay.mr}`); setVar(m, m.page, '--sm-mb', `${lay.mb}`); setVar(m, m.page, '--sm-ml', `${lay.ml}`);
  setVar(m, m.page, '--sm-rad', `${lay.radius}`); setVar(m, m.page, '--sm-ring', `${lay.ring}`);
  // The sidebar's column is the first one on the left: the sidebar (one width, justify-self: start) is pulled out to the column's edge. On the right the column starts at the sidebar's own near edge, so it needs no pull.
  if (m.railLive) setVar(m, m.rail, '--sm-rail-x', `${m.dir === 1 ? lay.col - m.last.col : 0}`);
  // The toolbar's block is laid over the sidebar: from the window's left edge (its offset in the page column is minus the column's width), or on the right from the sidebar's near edge, window width minus the column's. Either way it is the final offset plus how far the column still has to go.
  if (m.addrLeft !== null) setVar(m, m.toolbar, '--sm-addr-left', `${m.addrLeft + m.last.col - lay.col}`);
  // The pieces that travel: each is one element, drawn at its box of the moment. Everything that changes layout is written first (the size: where a piece stands depends on how wide it is, the
  // address field being centred in its row), then every piece's own place is read once, then the translates are written: one layout pass a frame.
  const boxes = m.movers.map(mover => ({ mover, el: m.moverEls.get(mover.id), box: moverBox(mover, m.first, m.last, lay, sch, ms, m.dir) }));
  for (const { mover, el, box } of boxes) { if (!el) continue; touch(m, el); if (mover.resizes) { setVar(m, el, '--sm-aw', `${box.width}`); setVar(m, el, '--sm-ah', `${box.height}`); } }
  const standing = boxes.map(({ mover, el }) => { if (!el) return null; const was = m.placed.get(mover.id) ?? { dx: 0, dy: 0 }, now = el.getBoundingClientRect(); return { x: now.x - was.dx, y: now.y - was.dy }; });
  boxes.forEach(({ mover, el, box }, i) => {
    const at = standing[i]; if (!el || !at) return;
    const inRail = m.railEls.has(el) || (m.rail?.contains(el) ?? false), dx = inRail ? 0 : box.x - at.x, dy = box.y - at.y;
    m.placed.set(mover.id, { dx, dy }); el.style.translate = `${dx}px ${dy}px`;
  });
  for (const { el, of } of m.follow) { touch(m, el); el.style.translate = of.style.translate; }
  // D116: the field on its way round the page's corner fades outside the column's edge and in at its place (sidebarMorphPlan `Hop`): never under the page.
  for (const { mover, el } of boxes) if (el && mover.hop) { touch(m, el); el.style.opacity = `${hopOpacity(mover, ms)}`; }
  // The field on its way under the page is cut where the page card covers it, so a page the interface draws covers it exactly as a website's page (a native view above the interface) does.
  if (m.page) for (const { mover, el, box } of boxes) if (el && mover.dive) el.style.clipPath = underPageCut(box, m.page.getBoundingClientRect(), lay.radius);
  // What arrives: the sidebar's blocks, the pill, the sidebar button (on the sidebar's edge), the chrome that returns (riding the band's edge).
  // In the row morph each of them comes in where it will stand, and only once every traveller has cleared that place (`clearAt`, from the plan): never while something still passes over it.
  const comes = (el: HTMLElement, window: readonly [number, number], carry = 0) => { const at = m.clearAt.get(el); if (at === undefined || scale <= 0) return arriving(m.lead ? [Math.max(0, window[0] - m.lead), window[1] - m.lead] : window, ms, scale, carry); const from = Math.max(window[0], at / scale); return arriving([from, from + Math.min(window[1] - window[0], ARRIVE_MS)], ms, scale, carry); };
  for (const el of m.arrivals.rail) { touch(m, el); el.style.opacity = `${comes(el, RAIL_IN, m.arrivals.carry.rail)}`; }
  for (const el of m.arrivals.pill) { touch(m, el); el.style.opacity = `${comes(el, PILL_IN)}`; }
  for (const el of m.arrivals.button) { touch(m, el); const shown = comes(el, BUTTON_IN); el.style.opacity = `${shown * (m.own.get(el) ?? 1)}`; el.style.translate = `${m.dir * (lay.col - m.last.col)}px 0px`; if (m.clearAt.has(el)) el.style.scale = `${.8 + .2 * shown}`; }
  for (const el of m.arrivals.chrome) { touch(m, el); const shown = comes(el, CHROME_IN, m.arrivals.carry.chrome); el.style.opacity = `${shown * (m.own.get(el) ?? 1)}`; el.style.translate = m.row ? '0px 0px' : `0px ${lay.hdr - m.last.hdr}px`; if (m.row && m.clearAt.has(el) && el.matches('button') && el.offsetWidth <= 40) el.style.scale = `${.8 + .2 * shown}`; }
  // What leaves: the copy of the old chrome (riding the band's edge, or the sidebar's) and of the old sidebar.
  const g = m.ghosts;
  if (g) {
    const gone = leaving(LEAVE, ms, scale); g.opacity = gone;
    if (g.root) { g.root.style.opacity = `${gone}`; g.root.style.translate = g.block ? `${m.dir * (lay.col - m.first.col)}px 0px` : m.row ? '0px 0px' : `0px ${lay.hdr - m.first.hdr}px`; }
    if (g.rail) { if (g.railRows) { for (const el of g.railRows) el.style.opacity = `${gone}`; } else g.rail.style.opacity = `${gone}`; g.rail.style.translate = `${m.dir * (lay.col - m.first.col)}px 0px`; if (g.railTop !== undefined) g.rail.style.clipPath = `inset(${Math.max(0, lay.hdr - g.railTop)}px 0 0 0)`;
      // (the strip stands on the card: from the card's near edge, between its top and its bottom; it slides as far as the copy itself has, the one number both are written from)
      if (g.railFill) { const fill = g.railFill.el.style; fill.translate = `${(Number.parseFloat(g.rail.style.translate) || 0) + (m.dir === 1 ? lay.ml : -lay.mr)}px 0px`; fill.clipPath = `inset(${Math.max(0, lay.hdr + lay.mt - g.railFill.top)}px 0 ${Math.max(0, lay.mb)}px 0)`; } }
    // The copy of a piece that could not travel (the sidebar button changing ends of its row) makes room at once: gone before the first traveller reaches where it stood.
    if (m.quick.length) { const left = leaving(QUICK_LEAVE, ms, scale); for (const { el, from } of m.quick) { el.style.opacity = `${from * left}`; el.style.scale = `${.8 + .2 * left}`; } }
  }
  if (m.handOver.length && ms >= QUICK_LEFT_MS * scale) dropHandOver(m);
  if (m.afterFirst) { const read = m.afterFirst; m.afterFirst = null; read(); }   // (D100b: once, when the morph's own first frame is written)
  tabTravelFrame(ms, m.page);   // D102: the tabs' travellers, after everything of the morph's own is written
  if (ms >= sch.total + 34) { finish(m); return; }
  m.frame = requestAnimationFrame(() => frame(m));
}

function finish(m: Live): void {
  if (live !== m) return;
  teardown();
  // The row is fitted for the layout it has settled in, whatever was answered on the way (the fit remembers its answer by the row's width and skips a repeat).
  for (const row of document.querySelectorAll<HTMLElement>('.acira-persistent-toolbar[data-fit-key]')) row.removeAttribute('data-fit-key');
  dispatchEvent(new Event(REFIT_EVENT));
  for (const listener of listeners) listener();
}
/** Put the window at the end of the morph now (another transition needs the plain layout, or motion was turned off). */
export function finishSidebarMorph(): void { if (live) finish(live); }
