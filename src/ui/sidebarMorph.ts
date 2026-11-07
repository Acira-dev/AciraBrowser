import { motionScale, motionSpeed, reducedMotion } from './sharedMotion';
import { setInstantTransitions } from './motion';
import { arriving, bowCrossings, BUTTON_IN, MAIN_LATENCY_MS, CHROME_IN, delayRowChange, totalMs, layoutAt, leaving, LEAVE, moverBox, pageGlide, PILL_IN, RAIL_IN, schedule, type Box, type Direction, type LayoutNumbers, type Mover, type Schedule } from './sidebarMorphPlan';
import type { BrowserLayout } from '../runtime/types';

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

interface Seen { id: string; el: HTMLElement; box: Box; resizes: boolean; attached: boolean }
interface Ghosts { app: HTMLElement; root: HTMLElement | null; rail: HTMLElement | null; block: boolean; opacity: number }
interface Touched { el: HTMLElement; translate: string; opacity: string; props: string[]; attrs: string[] }
interface Live {
  startedAt: number; sch: Schedule; first: LayoutNumbers; last: LayoutNumbers; movers: Mover[]; moverEls: Map<string, HTMLElement>;
  arrivals: { rail: HTMLElement[]; pill: HTMLElement[]; button: HTMLElement[]; chrome: HTMLElement[]; carry: { rail: number; chrome: number } };
  ghosts: Ghosts | null; railLive: boolean; railWidth: number; addrLeft: number | null; hadBlock: boolean; hasBlock: boolean; touched: Map<HTMLElement, Touched>; frame: number; timer: ReturnType<typeof setTimeout> | undefined;
  app: HTMLElement | null; shell: HTMLElement | null; bar: HTMLElement | null; page: HTMLElement | null; rail: HTMLElement | null; toolbar: HTMLElement | null; railEls: Set<HTMLElement>;
  pinned: BrowserLayout | null;
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
  const columns = app ? getComputedStyle(app).gridTemplateColumns.split(' ') : [], style = page ? getComputedStyle(page) : null, shadow = style?.boxShadow ?? 'none';
  const drawnAlpha = shadow && shadow !== 'none' ? alphaOf(shadow) : 0;
  if (!live && drawnAlpha > 0) ringAlphaAtRest = drawnAlpha;
  return { col: px(columns[0] ?? '0'), hdr: shell ? shell.getBoundingClientRect().height : 0, mt: px(style?.marginTop ?? '0'), mr: px(style?.marginRight ?? '0'), mb: px(style?.marginBottom ?? '0'), ml: px(style?.marginLeft ?? '0'), radius: px(style?.borderTopLeftRadius ?? '0'), ring: live ? Math.min(1, drawnAlpha / ringAlphaAtRest) : shadow && shadow !== 'none' ? 1 : 0 };
}
const ringColor = (): string | null => { const page = q(SELECTOR.page); const shadow = page ? getComputedStyle(page).boxShadow : ''; return /rgba?\([^)]*\)/.exec(shadow)?.[0] ?? null; };

function seePieces(column: number): Map<string, Seen> {
  const out = new Map<string, Seen>();
  for (const piece of PIECES) {
    const el = [...document.querySelectorAll<HTMLElement>(piece.sel)].find(drawn);
    if (!el) continue;
    const box = rectOf(el);
    out.set(piece.id, { id: piece.id, el, box, resizes: piece.resizes, attached: box.x + box.width <= column + 1 });
  }
  // What the sidebar holds moves as blocks (its own top inset changes when the address block arrives), so only its blocks need a place of their own.
  const rail = q(SELECTOR.rail);
  if (rail?.classList.contains('is-expanded')) for (const child of [...rail.children] as HTMLElement[]) {
    if (child.classList.contains('sb-resize') || !child.getClientRects().length) continue;
    const id = railKind(child), box = rectOf(child);
    if (box.width && box.height && !out.has(id)) out.set(id, { id, el: child, box, resizes: false, attached: false });
  }
  return out;
}

/** A copy of what is on screen now (the old chrome and sidebar) for the part of the old layout that has no counterpart in the new one. It is its own
 * `.app` (so every selector that reads `.app > …` and `:has(> .ed-rail)` finds the same structure, and none of them see the real window change). */
function ghostsOfNow(): Ghosts | null {
  const app = q(SELECTOR.app), root = q(SELECTOR.root), shell = q(SELECTOR.shell), rail = q(SELECTOR.rail);
  if (!app?.parentElement || !root || !shell) return null;
  const host = app.cloneNode(false) as HTMLElement;
  host.setAttribute('aria-hidden', 'true'); host.setAttribute('inert', ''); host.removeAttribute('id'); host.dataset.smGhost = '';
  Object.assign(host.style, { position: 'fixed', inset: '0', display: 'block', background: 'none', pointerEvents: 'none', zIndex: '20', overflow: 'hidden', transition: 'none' });
  const railBox = rail ? rectOf(rail) : { x: 0, y: 0, width: 0, height: 0 }, rootBox = rectOf(root), shellBox = rectOf(shell);
  let railCopy: HTMLElement | null = null, rootCopy: HTMLElement | null = null;
  if (rail?.classList.contains('is-expanded') && railBox.width > 1) {
    railCopy = rail.cloneNode(true) as HTMLElement;
    Object.assign(railCopy.style, { position: 'absolute', left: `${railBox.x}px`, top: `${railBox.y}px`, width: `${railBox.width}px`, height: `${railBox.height}px`, margin: '0', translate: '0 0', opacity: '1' });
    host.appendChild(railCopy);
  }
  const hadBlock = root.classList.contains('addr-side');
  if (shellBox.height > .5 || hadBlock) {
    rootCopy = root.cloneNode(false) as HTMLElement;
    Object.assign(rootCopy.style, { position: 'absolute', left: `${rootBox.x}px`, top: `${rootBox.y}px`, width: `${rootBox.width}px`, height: `${rootBox.height}px`, margin: '0', overflow: 'visible', pointerEvents: 'none' });
    const shellCopy = shell.cloneNode(true) as HTMLElement;
    shellCopy.style.height = `${shellBox.height}px`;
    // The pieces that travel are the real elements: their copies stay in the old chrome but are not drawn.
    for (const piece of PIECES) shellCopy.querySelectorAll<HTMLElement>(piece.sel.replace(`${SELECTOR.shell} > `, '').replace(`${SELECTOR.toolbar}`, '.acira-persistent-toolbar')).forEach(el => { el.style.visibility = 'hidden'; });
    rootCopy.appendChild(shellCopy); host.appendChild(rootCopy);
  }
  // A copy is not a tab, a row to flip or a field to find by id.
  for (const node of host.querySelectorAll('[id],[data-tab-id],[data-flip]')) { node.removeAttribute('id'); node.removeAttribute('data-tab-id'); node.removeAttribute('data-flip'); }
  return { app: host, root: rootCopy, rail: railCopy, block: hadBlock, opacity: 1 };
}

const touch = (m: Live, el: HTMLElement): Touched => {
  let item = m.touched.get(el);
  if (!item) { item = { el, translate: el.style.translate, opacity: el.style.opacity, props: [], attrs: [] }; m.touched.set(el, item); }
  return item;
};
const setVar = (m: Live, el: HTMLElement | null | undefined, name: string, value: string) => { if (!el) return; const item = touch(m, el); if (!item.props.includes(name)) item.props.push(name); el.style.setProperty(name, value); };
const setAttr = (m: Live, el: HTMLElement, name: string) => { const item = touch(m, el); if (!item.attrs.includes(name)) item.attrs.push(name); el.setAttribute(name, ''); };

/** Take everything the morph put on the window off again (the layout is then the one React drew). */
function teardown(): void {
  const m = live; if (!m) return;
  cancelAnimationFrame(m.frame); clearTimeout(m.timer);
  const root = document.documentElement;
  for (const name of ['data-sm-morph', 'data-sm-rail', 'data-sm-pin', 'data-mode-switch']) { if (name !== 'data-mode-switch' || root.getAttribute('data-mode-switch') === 'morph') root.removeAttribute(name); }
  for (const item of m.touched.values()) {
    if (!item.el.isConnected) continue;
    item.el.style.translate = item.translate; item.el.style.opacity = item.opacity;
    for (const name of item.props) item.el.style.removeProperty(name);
    for (const name of item.attrs) item.el.removeAttribute(name);
  }
  m.ghosts?.app.remove();
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

/** Run `update` (it must apply the new layout synchronously) as the morph, from what is drawn now. Returns false, having done nothing, when it cannot: the caller then switches as it always has. */
export function startSidebarMorph(update: () => void, direction: Direction): boolean {
  if (live) { if (document.visibilityState !== 'visible' || reducedMotion() || motionScale() <= 0) { finishSidebarMorph(); return false; } }
  else if (!canMorph()) return false;
  lastDirection = direction;
  const interrupted = live !== null, sch = schedule(direction, motionSpeed() === 'fast' ? .6 : 1, interrupted), root = document.documentElement;
  // --- first: what is drawn now (a morph in flight included)
  const firstLayout = readLayout(), firstSeen = seePieces(firstLayout.col), ghosts = ghostsOfNow(), hadBlock = !!q(SELECTOR.root)?.classList.contains('addr-side');
  const shown = (el: HTMLElement | undefined) => (el ? Number.parseFloat(el.style.opacity || '1') : null);
  const carried = live ? { rail: live.ghosts?.rail ? live.ghosts.opacity : shown(live.arrivals.rail[0]) ?? 0, chrome: live.ghosts?.root && !live.ghosts.block ? live.ghosts.opacity : shown(live.arrivals.chrome[0]) ?? 0 } : null;
  teardown();
  // --- the update: the final layout, drawn at once (nothing framer would glide under it), pinned to what framer will settle on, and its layout message carrying the page's spring and lag
  root.setAttribute('data-sm-pin', ''); root.setAttribute('data-mode-switch', 'morph');
  sending = pageGlide(sch); pinnedAt = 0; setInstantTransitions(true);
  try { update(); } catch (error) { root.removeAttribute('data-sm-pin'); root.removeAttribute('data-mode-switch'); pinned = null; throw error; } finally { setInstantTransitions(false); sending = null; }
  try {
  // --- last: the layout React drew
  const lastLayout = readLayout(), lastSeen = seePieces(lastLayout.col), hasBlock = !!q(SELECTOR.root)?.classList.contains('addr-side');
  const movers: Mover[] = [], moverEls = new Map<string, HTMLElement>(), arrivals: Live['arrivals'] = { rail: [], pill: [], button: [], chrome: [], carry: { rail: carried?.rail ?? 0, chrome: carried?.chrome ?? 0 } };
  for (const [id, now] of lastSeen) {
    const was = firstSeen.get(id);
    if (!was) { if (id.startsWith('rail:')) arrivals.rail.push(now.el); else if (hasBlock) arrivals.button.push(now.el); else arrivals.chrome.push(now.el); continue; }
    // Only the wide address field rides the sidebar's edge (it must be out of the band before the page's top edge rises into it); the buttons simply travel.
    movers.push({ id, first: was.box, last: now.box, attach0: was.attached && now.resizes, attach1: now.attached && now.resizes, bow: 0, resizes: now.resizes, xDelay: 0, yDelay: 0 });
    moverEls.set(id, now.el);
  }
  bowCrossings(movers, Math.max(lastLayout.hdr, firstLayout.hdr, 2)); if (!interrupted) delayRowChange(movers, sch);
  sch.total = totalMs(sch, movers);
  const rail = q(SELECTOR.rail), railLive = !!rail?.classList.contains('is-expanded') && lastLayout.col > 1, railEls = new Set<HTMLElement>();
  if (rail && railLive) for (const child of [...rail.children] as HTMLElement[]) if (!child.classList.contains('sb-resize')) railEls.add(child);
  const pill = q(`${SELECTOR.toolbar} > .sb-addr-more`); if (pill && !hadBlock) arrivals.pill.push(pill);
  // The chrome that comes back when the mode goes off (the tab strip, the bookmarks row, the buttons on the right, Home) arrives; the rest of it travels.
  if (!hasBlock) for (const sel of [`${SELECTOR.shell} > .acira-tab-row`, `${SELECTOR.shell} > .acira-bookmarks-row`, `${SELECTOR.toolbar} .toolbar-actions`, `${NAV}:nth-child(n+4)`, `${SELECTOR.toolbar} .acira-compact-tabs`]) for (const el of document.querySelectorAll<HTMLElement>(sel)) if (!el.closest('[inert]')) arrivals.chrome.push(el);
  // The sidebar blocks that were not there before arrive (the others only move down); the rail itself slides.
  const m: Live = { startedAt: 0, sch, first: firstLayout, last: lastLayout, movers, moverEls, arrivals, ghosts, railLive, railWidth: rail ? rectOf(rail).width : 0, addrLeft: null, hadBlock, hasBlock, touched: new Map(), frame: 0, timer: undefined, aligned: false, waitUntil: 0, placed: new Map(), app: q(SELECTOR.app), shell: q(SELECTOR.shell), bar: q(`${SELECTOR.shell} > .acira-bookmarks-row`), page: q(SELECTOR.page), rail, toolbar: q(SELECTOR.toolbar), railEls, pinned: null };
  const left = m.toolbar ? Number.parseFloat(getComputedStyle(m.toolbar).left) : Number.NaN;
  m.addrLeft = hasBlock && Number.isFinite(left) ? left : null;
  // Nothing visibly changes: no morph.
  const quiet = (['col', 'hdr', 'mt', 'mr', 'mb', 'ml'] as const).every(key => Math.abs(firstLayout[key] - lastLayout[key]) < .5) && movers.every(v => Math.abs(v.first.x - v.last.x) < .5 && Math.abs(v.first.y - v.last.y) < .5 && Math.abs(v.first.width - v.last.width) < .5 && Math.abs(v.first.height - v.last.height) < .5) && !arrivals.button.length && !arrivals.chrome.length && !arrivals.pill.length && !arrivals.rail.length && !ghosts?.root && !ghosts?.rail;
  if (quiet) { root.removeAttribute('data-sm-pin'); root.removeAttribute('data-mode-switch'); pinned = null; return true; }
  // Main starts its page glide when the layout message reaches it, which is the moment the update sent it: the morph's clock starts there too, so the page and the card it sits in are never a frame apart.
  // A window that draws no frames (hidden, covered) never runs the animation frame: the morph still ends, and the window it leaves is the plain one.
  live = m; install(m); m.timer = setTimeout(() => finish(m), sch.total + 700); m.startedAt = (pinnedAt > 0 ? pinnedAt : performance.now()) + MAIN_LATENCY_MS; m.waitUntil = performance.now() + WAIT_MS; frame(m);
  return true;
  } catch (error) { abort(); throw error; }
}

/** Whatever a failed start had set: the window is the plain one again. */
function abort(): void {
  if (live) teardown();
  const root = document.documentElement;
  root.removeAttribute('data-sm-pin'); root.removeAttribute('data-sm-morph'); root.removeAttribute('data-sm-rail'); if (root.getAttribute('data-mode-switch') === 'morph') root.removeAttribute('data-mode-switch');
  pinned = null; sending = null; setInstantTransitions(false);
}

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
    if (g.root) for (const piece of PIECES) if (!m.moverEls.has(piece.id)) g.root.querySelectorAll<HTMLElement>(piece.sel.replace(`${SELECTOR.shell} > `, '').replace(SELECTOR.toolbar, '.acira-persistent-toolbar')).forEach(el => { el.style.visibility = ''; });
    if (g.root || g.rail) m.app?.parentElement?.appendChild(g.app); else m.ghosts = null;
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
  if (m.railLive) setVar(m, m.rail, '--sm-rail-x', `${lay.col - m.last.col}`);
  // The toolbar's block is laid over the sidebar from the window's left edge: its offset in the page column is minus the column's width, which is what moves.
  if (m.addrLeft !== null) setVar(m, m.toolbar, '--sm-addr-left', `${m.addrLeft + m.last.col - lay.col}`);
  // The pieces that travel: each is one element, drawn at its box of the moment. Everything that changes layout is written first (the size: where a piece stands depends on how wide it is, the
  // address field being centred in its row), then every piece's own place is read once, then the translates are written: one layout pass a frame.
  const boxes = m.movers.map(mover => ({ mover, el: m.moverEls.get(mover.id), box: moverBox(mover, m.first, m.last, lay, sch, ms) }));
  for (const { mover, el, box } of boxes) { if (!el) continue; touch(m, el); if (mover.resizes) { setVar(m, el, '--sm-aw', `${box.width}`); setVar(m, el, '--sm-ah', `${box.height}`); } }
  const standing = boxes.map(({ mover, el }) => { if (!el) return null; const was = m.placed.get(mover.id) ?? { dx: 0, dy: 0 }, now = el.getBoundingClientRect(); return { x: now.x - was.dx, y: now.y - was.dy }; });
  boxes.forEach(({ mover, el, box }, i) => {
    const at = standing[i]; if (!el || !at) return;
    const inRail = m.railEls.has(el) || (m.rail?.contains(el) ?? false), dx = inRail ? 0 : box.x - at.x, dy = box.y - at.y;
    m.placed.set(mover.id, { dx, dy }); el.style.translate = `${dx}px ${dy}px`;
  });
  // What arrives: the sidebar's blocks, the pill, the sidebar button (on the sidebar's edge), the chrome that returns (riding the band's edge).
  const railIn = arriving(RAIL_IN, ms, scale, m.arrivals.carry.rail), chromeIn = arriving(CHROME_IN, ms, scale, m.arrivals.carry.chrome);
  for (const el of m.arrivals.rail) { touch(m, el); el.style.opacity = `${railIn}`; }
  for (const el of m.arrivals.pill) { touch(m, el); el.style.opacity = `${arriving(PILL_IN, ms, scale)}`; }
  for (const el of m.arrivals.button) { touch(m, el); el.style.opacity = `${arriving(BUTTON_IN, ms, scale)}`; el.style.translate = `${lay.col - m.last.col}px 0px`; }
  for (const el of m.arrivals.chrome) { touch(m, el); el.style.opacity = `${chromeIn}`; el.style.translate = `0px ${lay.hdr - m.last.hdr}px`; }
  // What leaves: the copy of the old chrome (riding the band's edge, or the sidebar's) and of the old sidebar.
  const g = m.ghosts;
  if (g) {
    const gone = leaving(LEAVE, ms, scale); g.opacity = gone;
    if (g.root) { g.root.style.opacity = `${gone}`; g.root.style.translate = g.block ? `${lay.col - m.first.col}px 0px` : `0px ${lay.hdr - m.first.hdr}px`; }
    if (g.rail) { g.rail.style.opacity = `${gone}`; g.rail.style.translate = `${lay.col - m.first.col}px 0px`; }
  }
  if (ms >= sch.total + 34) { finish(m); return; }
  m.frame = requestAnimationFrame(() => frame(m));
}

function finish(m: Live): void {
  if (live !== m) return;
  teardown();
  dispatchEvent(new Event(REFIT_EVENT));
  for (const listener of listeners) listener();
}
/** Put the window at the end of the morph now (another transition needs the plain layout, or motion was turned off). */
export function finishSidebarMorph(): void { if (live) finish(live); }
