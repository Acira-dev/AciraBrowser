/* The tabs' travel between the strip along the top and the sidebar's list, played inside the layout morph (D102; the arithmetic and the rules are in ui/tabTravelPlan.ts).
 *
 * The morph (ui/sidebarMorph.ts) calls four things, in this order:
 *   tabTravelFirst()   before it copies the old chrome and switches the layout: where each tab's icon stands now, and where its copy will be found in the copy of the old chrome;
 *   tabTravelStart()   after the switch and BEFORE the morph puts its own marks on the window (the new layout is then drawn as it will stand): the rule is asked (a clear way or no travel) and,
 *                      on the way to the list, where each of those tabs' icons stands in it is READ. Nothing is written in that task (see `Pending`);
 *   (first frame)      the set-up, at the morph's first animation frame: every tab that has an icon in sight in BOTH layouts gets ONE traveller, a copy of its new icon in a layer of its own, over
 *                      the copy of the old chrome. The old icon's copy and the new icon itself are not drawn while it travels, so the tab is drawn once in every frame;
 *   tabTravelFrame()   every frame of the morph, on the morph's clock: each traveller's place and size. A traveller is drawn whole or not at all: never half cut, never over the page; whatever arrives where a traveller passes (a row's title and close
 *                      button, a favorite's tile, the New tab row, a strip tab's title) comes in only when no traveller lies over it any more;
 *   tabTravelEnd()     when the morph takes its own marks off the window: the layer goes and the new icons are drawn again, in the same frame.
 * On the way to the list nothing here reads the layout during a frame except the page's rectangle (one read, after the morph's own). On the way to the strip each traveller's slot and the places
 * of what arrives there are read every frame as well: a strip that has just come glides to its place by its own motion. A morph turned round half way starts every traveller from where it is drawn.
 *
 * A CLEAR WAY OR NO TRAVEL. An icon never crosses anything that is drawn, so the travel plays only where its way is clear: the sidebar comes or goes with the switch (what is in its column then
 * arrives after the icons, or has left before them) and its head row is the icons' own. It does not play, and the tabs leave and arrive with their chrome as they did before there was a travel,
 * where the sidebar STANDS on both sides of the switch (Tabs on top + sidebar <-> a sidebar layout: the Favorites and the Shelf fill its column from edge to edge, real window, 20 Nov: tiles from
 * 12 to 230 pt of 240), on the way INTO a sidebar that holds the address field (the field lands across the whole column under the head row before any icon could come down, and the toolbar's buttons
 * land in the head row itself), or where one of the morph's own travelling pieces would still come within the gap of an icon (ui/tabTravelPlan.ts). */
import type { Box, Direction } from './sidebarMorphPlan';
import { READ_AGAIN, arrivalAt, cameAt, clearAfter, cutUnderPage, drawnOrFirst, planTabTravel, shownAt, stillToPass, sweep, travelBox, type TravelPlan, type TravelTab } from './tabTravelPlan';

type Kind = 'strip' | 'list';
const SHELL = '.app > .browser-root > .browser-shell', RAIL = '.app > .ed-rail';
/** A tab in the strip along the top and its icon; a tab's row in the sidebar's list and its icon. Pinned tabs and Favorites are not tabs here; a tab on its way out of the strip is not either.
 * `arrives`: what of the new chrome a traveller can pass over on its way (each waits for the last one to have passed). */
/** (In the strip the active tab's plate, `.tab-strip-selection`, is one of the things that arrive: it stood empty at the tab's slot from the morph's own arrival and the icons of the tabs after it ran
 * over it on their way, real frames of 20 Nov. It waits for them and for its own icon, as its title does. Its place moves on its own motion values; its strength is only ever a rule's.) */
const TABS: Record<Kind, { tab: string; icon: string; view: string; arrives: string }> = {
  strip: { tab: `${SHELL} .acira-tab-row .browser-tab[data-tab-id]:not(.pinned):not([data-leaving])`, icon: ':scope > .site-identity-icon', view: `${SHELL} .acira-tab-row .tab-strip-container`,
    arrives: `${SHELL} .acira-tab-row .tab-title, ${SHELL} .acira-tab-row .tab-close, ${SHELL} .acira-tab-row .tab-group-header, ${SHELL} .acira-tab-row .tab-strip-selection, ${SHELL} .acira-tab-row .tab-strip-add, ${SHELL} .acira-tab-row .tab-strip-tools > *` },
  list: { tab: `${RAIL}.is-expanded .sb-tab[data-tab-id]`, icon: '.sb-tab-icon', view: `${RAIL} .sb-sections-wrap`,
    // (the Favorites as ONE piece, their whole block: tiles that waited for an icon one by one made the grid arrive column by column)
    // (a tab group's header row, and its chip in the strip above: a row or a chip that is not a tab's, on the way of the tabs' icons all the same)
    arrives: `${RAIL} .sb-tab-title, ${RAIL} .sb-tab-close, ${RAIL} .sb-group-header, ${RAIL} .sb-apps-region, ${RAIL} .sb-new-tab > *, ${RAIL} .sb-zone-toggle` },
};
/** The address field lives in the sidebar (Sidebar + address): the toolbar block's own mark. */
const ADDRESS_IN_SIDEBAR = '.app > .browser-root.addr-side';
const SELECTED = '.selected, [aria-current="true"], [aria-current="page"], [aria-selected="true"], .is-active';
/** What a traveller keeps of its icon's own drawing once it stands outside the row it was styled in. */
const KEPT = ['width', 'height', 'border-radius', 'object-fit', 'object-position', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'box-shadow', 'opacity', 'filter', 'display', 'align-items', 'justify-content', 'color', 'fill', 'stroke', 'font-size', 'font-weight', 'line-height', 'overflow', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom'];
/** px of the active tab's plate round its travelling icon; px an icon's middle keeps from whatever stands in the sidebar's head row (half an icon and 3); px above and below the icons' middle line that count as the row. */
const MARK_PX = 5, HEAD_CLEAR = 11, HEAD_BAND = 9;
/** macOS: the window's own traffic lights end here, pt from its left edge. */
const LIGHTS_TO = 72;
/** The way out: ms over which a part of the strip comes in once no traveller has to pass over it. */
const ARRIVE_MS = 90;
/** px to each side of a place that arrives which must be clear of every traveller (the gap between a row's icon and its title). */
const ARRIVE_PAD = 8;

/** The way out: the strip that has just come holds its own motion still while the icons travel to it (styles/tab-motion.css), and for HOLD_MS after, until its own layout motion has nothing left to do. */
const HOLD = 'data-tab-travel-hold', HOLD_MS = 420;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
function hold(on: boolean, atOnce = false): void {
  clearTimeout(holdTimer);
  const off = () => { for (const el of document.querySelectorAll(`[${HOLD}]`)) el.removeAttribute(HOLD); };
  if (on) document.querySelector(`${SHELL} .acira-tab-row`)?.setAttribute(HOLD, '');
  else if (atOnce) off();   // (no travel came of it: the strip was never drawn held)
  else holdTimer = setTimeout(off, HOLD_MS);
}

interface Stood { box: Box; host: 'shell' | 'rail'; path: number[] | null }
export interface TravelFirst { kind: Kind | null; icons: Map<string, Stood>; /** the free room of the sidebar's head row, read while the list was the layout on screen */ head: { from: number; to: number } | null; /** an open sidebar stood on screen */ column: boolean; /** a morph turned round half way: where every traveller is drawn, and its places in both layouts */ inflight: { boxes: Map<string, Box>; tabs: Map<string, TravelTab> } | null }
interface Traveller { tab: TravelTab; el: HTMLElement; end: Box; real: HTMLElement; realWas: string; /** the icon's own strength (a sleeping tab's icon is dimmed): kept while it travels */ own: string }
interface Gated { el: HTMLElement; was: string; clearAt: number; /** the way out: when (ms) no traveller had to pass over it any more; null: one still has to */ clearedAt?: number | null; /** its own strength at rest (a close button is not drawn until its row is pointed at): the arrival multiplies it */ own: number }
interface Live { plan: TravelPlan; layer: HTMLElement; travellers: Traveller[]; gated: Gated[]; side: 1 | -1; ms: number; /** the way out: the travellers home on their tabs' slots in the strip that has come (`home`); `again`: what arrives there has not been told yet when it is clear */ homes: boolean; again: boolean; /** what of the new chrome a traveller can pass over */ arrives: string; /** the old strip's tabs and tools in the old chrome's copy (plates, titles, the buttons before the first tab): not drawn from the first frame in which an icon moves */ quick: HTMLElement[] }
let live: Live | null = null;

const seen = (color: string): boolean => { const m = /rgba?\(([^)]*)\)/.exec(color); if (!m) return !!color && color !== 'transparent'; const parts = m[1].split(/[\s,/]+/).filter(Boolean); return parts.length < 4 || Number.parseFloat(parts[3]) > 0; };
/** The fill the active tab's plate is drawn with (the row's own or its plate layer's), or a quiet grey where neither has one. */
function plateOf(tab: HTMLElement): string {
  for (const pseudo of ['::after', '::before', null]) { const color = getComputedStyle(tab, pseudo).backgroundColor; if (seen(color)) return color; }
  return 'rgb(128 128 128 / .24)';
}
const rectOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
function pathUnder(top: Element, el: Element): number[] | null { const path: number[] = []; for (let node: Element | null = el; node && node !== top; node = node.parentElement) { const parent: Element | null = node.parentElement; if (!parent) return null; path.unshift([...parent.children].indexOf(node)); } return path; }
const atPath = (top: Element, path: number[]): HTMLElement | null => { let node: Element | undefined = top; for (const index of path) node = node?.children[index]; return (node as HTMLElement | undefined) ?? null; };
/** The icons of the tabs of one kind that stand in sight (inside their strip's or their list's own window), by tab id. */
function see(kind: Kind, anywhere = false): Map<string, { icon: HTMLElement; tab: HTMLElement; box: Box }> {
  const out = new Map<string, { icon: HTMLElement; tab: HTMLElement; box: Box }>(), view = document.querySelector(TABS[kind].view)?.getBoundingClientRect();
  if (!view || view.width < 1 || view.height < 1) return out;
  for (const tab of document.querySelectorAll<HTMLElement>(TABS[kind].tab)) {
    const id = tab.dataset.tabId, icon = tab.querySelector<HTMLElement>(TABS[kind].icon);
    if (!id || !icon || out.has(id) || tab.closest('[data-sm-ghost], [inert]')) continue;
    const box = rectOf(icon), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (box.width < 1 || box.height < 1 || (!anywhere && (cx < view.left || cx > view.right || cy < view.top || cy > view.bottom))) continue;
    out.set(id, { icon, tab, box });
  }
  return out;
}
/** The free room of the sidebar's head row at height `y` (the strip's icons' own height): the longest stretch of the row, inside the sidebar, that nothing drawn there stands in. Read from the boxes
 * of everything in the window that crosses the row (not by a hit test: the workspace pill takes no presses and a hit test looks straight through it). In the way: anything narrower than most of the
 * sidebar that is a control, a picture or has nothing inside it (a pill, a button, an icon, a label); a row or block that spans the sidebar is not. For the icons' MIDDLES: `HEAD_CLEAR` px inside both
 * ends. Null: no sidebar on screen, or no room. */
/** It draws a plate of its own (a fill, a picture, a rim or a shadow): a pill, a chip. */
const plated = (el: Element): boolean => { const cs = getComputedStyle(el); return seen(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || Number.parseFloat(cs.borderTopWidth) > 0; };
function headRoom(y: number): { from: number; to: number } | null {
  const rail = document.querySelector<HTMLElement>(`${RAIL}.is-expanded`), r = rail?.getBoundingClientRect(), app = document.querySelector('.app');
  if (!rail || !r || !app || r.width < 2 * HEAD_CLEAR + 8 || y < r.top || y > r.bottom) return null;
  const taken: [number, number][] = [], top = y - HEAD_BAND, bottom = y + HEAD_BAND;
  const walk = (el: Element): void => {
    if (el.hasAttribute('data-sm-ghost') || el.hasAttribute('data-tab-travel') || el.hasAttribute('inert')) return;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) { if (el.children.length && getComputedStyle(el).display === 'contents') for (const child of el.children) walk(child); return; }
    if (box.bottom <= top || box.top >= bottom || box.right <= r.left || box.left >= r.right) return;
    const small = box.width < r.width * .6 && box.height < 80;
    if (small && (!el.children.length || /^(button|a|input|select|img|svg|canvas)$/i.test(el.tagName) || el.getAttribute('role') === 'button' || plated(el))) { taken.push([box.left, box.right]); return; }
    for (const child of el.children) walk(child);
  };
  walk(app);
  // The window's own buttons are not the interface's to see. macOS: the traffic lights stand 12 to 72 pt from the window's left edge (platform.css; in fullscreen Acira draws its own there, which the walk
  // finds). Windows: the caption buttons take the last 138 DIP of the first row (sidebarMorph.ts keeps its travellers clear of the same rectangle).
  const platform = document.documentElement.dataset.platform || 'darwin';
  if (platform === 'darwin' && r.left < LIGHTS_TO) taken.push([0, LIGHTS_TO]);
  if (platform === 'win32') { const f = Number.parseFloat(getComputedStyle(app).getPropertyValue('--interface-scale')) || 1; taken.push([innerWidth - 138 / f, innerWidth]); }
  taken.sort((a, b) => a[0] - b[0]);
  // the longest stretch between what is taken, inside the sidebar
  let best: [number, number] = [0, 0], at = r.left + 4;
  for (const [from, to] of [...taken, [r.right - 4, r.right] as [number, number]]) { if (from - at > best[1] - best[0]) best = [at, from]; at = Math.max(at, to); }
  return best[1] - best[0] >= 2 * HEAD_CLEAR ? { from: best[0] + HEAD_CLEAR, to: best[1] - HEAD_CLEAR } : null;
}

/** An open sidebar stands on screen. */
const columnNow = (): boolean => (document.querySelector(`${RAIL}.is-expanded`)?.getBoundingClientRect().width ?? 0) > 1;

/** Before the layout is switched: where every tab's icon stands, and (a morph turned round half way) where every traveller is. */
export function tabTravelFirst(): TravelFirst {
  const inflight = live ? { boxes: new Map(live.travellers.map(item => [item.tab.id, travelBox(live!.plan, item.tab, live!.ms)])), tabs: new Map(live.plan.tabs.map(tab => [tab.id, tab])) } : null;
  const shell = document.querySelector(SHELL), rail = document.querySelector(RAIL), column = columnNow();
  for (const kind of ['strip', 'list'] as const) {
    const found = see(kind);
    if (!found.size) continue;
    const host = kind === 'strip' ? shell : rail, icons = new Map<string, Stood>();
    for (const [id, item] of found) icons.set(id, { box: item.box, host: kind === 'strip' ? 'shell' : 'rail', path: host ? pathUnder(host, item.icon) : null });
    // The strip stands in the window's first row: its icons' middles are half a strip row down (the list is on screen now, the strip is not: its own height is read after the switch).
    const top = rail?.getBoundingClientRect().top ?? 0;
    return { kind, icons, head: kind === 'list' ? headRoom(top + 18) : null, column, inflight };
  }
  return { kind: null, icons: new Map(), head: null, column, inflight };
}

/** After the switch. `ghostShell` / `ghostRail`: the copies of the old toolbar block and of the old sidebar (the old icons' copies are found in them by their path and not drawn);
 * `total`: the morph's length, ms; `side`: 1 with the sidebar on the left, -1 on the right. */
export function tabTravelStart(first: TravelFirst, opts: StartOpts): void {
  tabTravelEnd();
  // A travel that cannot be set up leaves the switch as it was before there was one: the tabs leave and arrive with their chrome.
  try { prepare(first, opts); } catch { pending = null; }
  // A morph turned round half way: the travellers that were on screen are set up again in this same task (one frame without them would show the icons at their places for that frame).
  if (pending && first.inflight) { const p = pending; pending = null; try { begin(p); } catch { tabTravelEnd(); } if (!live) hold(false, true); }
}
type StartOpts = { ghostShell: Element | null; ghostRail: Element | null; total: number; direction: Direction; side: 1 | -1; host: Element | null; /** where the morph's own travelling pieces are drawn `ms` after its first frame */ obstacles?: (ms: number) => Box[] };
/** What is read of the layout that came: the tabs with an icon in sight on both sides, the sidebar's head row, each new icon's own drawing, what arrives on the icons' ways. */
interface Seen { tabs: TravelTab[]; pairs: Map<string, { icon: HTMLElement; tab: HTMLElement; box: Box }>; head: { from: number; to: number } | null; drawing: Map<string, { kept: string[][]; mark: string | null }>; arrives: { el: HTMLElement; box: Box; own: number }[] }
/** A travel that is decided and not set up yet. THE TASK OF THE SWITCH DOES ALMOST NOTHING: the release tip's own work in it ends within a millisecond or two of a display frame's deadline (traced, 20 Nov:
 * 22 to 27 ms; the whole set-up here added 1 to 2.6 ms and the first frame came one display frame later in most takes). So in that task only the rule is asked and, on the way to the list, the new
 * places are READ (they must be read before the morph moves the new chrome; the layout is clean, the morph has just read it). The plan, the travellers and every write wait for the first animation
 * frame, which has room. Nothing of the travel is on screen before that: the frame of the press is the old chrome's copy as it stood. */
interface Pending { first: TravelFirst; opts: StartOpts; kind: Kind; column: boolean; seen: Seen | null; /** the morph has run its frame once, in the task of the switch itself */ armed: boolean }
let pending: Pending | null = null;
function prepare(first: TravelFirst, opts: StartOpts): void {
  if (!first.kind || !opts.host || opts.total <= 0) return;
  const kind: Kind = first.kind === 'strip' ? 'list' : 'strip', column = columnNow();
  // A clear way or no travel (see the head of this file): not where the sidebar stands on both sides of the switch, not into a sidebar that holds the address field.
  if ((first.column && column) || (kind === 'list' && document.querySelector(ADDRESS_IN_SIDEBAR))) return;
  // (The way to the strip reads nothing now: a strip that has just come is not at its final layout, its places are read when the travel is set up and again before any icon runs to them.)
  const seen = kind === 'list' ? look(first, kind) : null;
  if (kind === 'list' && !seen) return;
  pending = { first, opts, kind, column, seen, armed: false };
}
/** READS ONLY. */
function look(first: TravelFirst, kind: Kind): Seen | null {
  const found = see(kind, kind === 'strip');
  if (!found.size) return null;
  const tabs: TravelTab[] = [], pairs = new Map<string, { icon: HTMLElement; tab: HTMLElement; box: Box }>();
  for (const [id, now] of found) {
    const was = first.icons.get(id), flying = first.inflight?.tabs.get(id);
    if (!was && !flying) continue;
    // A traveller in flight keeps the place it came from in the layout that is back; the place it goes to is read now.
    const other = flying ? (kind === 'list' ? flying.strip : flying.list) : was!.box;
    tabs.push(kind === 'list' ? { id, strip: other, list: now.box } : { id, strip: now.box, list: other });
    pairs.set(id, now);
  }
  if (!tabs.length) return null;
  // The sidebar's head row: read now where the list has just come (at the strip's icons' own height), or as it stood where the list is what leaves.
  const stripY = tabs.reduce((sum, tab) => sum + tab.strip.y + tab.strip.height / 2, 0) / tabs.length;
  const head = kind === 'list' ? headRoom(stripY) : first.head;
  // No free head row: no travel. (The plan's other way, one bent line round the page's corner, takes an icon under the page for part of its flight; an icon that goes and comes back is not played.)
  if (!head && !first.inflight) return null;
  // The icons' own drawing and what arrives on the travellers' ways (only what stands in the window: a long list's rows below the fold are in nobody's way).
  const drawing = new Map<string, { kept: string[][]; mark: string | null }>();
  for (const tab of tabs) { const pair = pairs.get(tab.id)!, nodes = [pair.icon, ...pair.icon.querySelectorAll<HTMLElement>('*')]; drawing.set(tab.id, { kept: nodes.map(node => { const cs = getComputedStyle(node); return KEPT.map(name => cs.getPropertyValue(name)); }), mark: kind === 'list' && pair.tab.matches(SELECTED) ? plateOf(pair.tab) : null }); }
  // (The mark, on the way to the list only. In the strip the active tab's fill is not the tab's own but a plate of its own, which stands at the tab's slot before any icon is drawn there: an icon
  // with a plate of its own on top of it showed a disc that went out in the frame of the hand-over, real frames of 20 Nov.)
  const arrives = [...document.querySelectorAll<HTMLElement>(TABS[kind].arrives)].filter(el => !el.closest('[data-sm-ghost], [inert]')).map(el => ({ el, box: rectOf(el) })).filter(item => item.box.width > 0 && item.box.height > 0 && item.box.y < innerHeight && item.box.y + item.box.height > 0).map(item => ({ ...item, own: Number.parseFloat(getComputedStyle(item.el).opacity) }));
  return { tabs, pairs, head, drawing, arrives };
}
/** The set-up, in the first animation frame: the plan, then every write. */
function begin(p: Pending): void {
  const { first, opts, kind, column } = p;
  if (!opts.host) return;
  // (A strip that has just come is not at its final layout yet, the bar is still moving: its own motion is held still, every tab of it that has a row in the list is taken, wherever it stands now,
  // and its place is read again before its icon runs to it.)
  if (kind === 'strip') hold(true);
  const seen = p.seen ?? look(first, kind);
  if (!seen) return;
  const { pairs, drawing, arrives } = seen;
  const plan = planTabTravel({ tabs: seen.tabs, direction: kind === 'list' ? 'in' : 'out', total: opts.total, head: seen.head, side: opts.side, column, turned: first.inflight ? first.inflight.boxes : null, obstacles: opts.obstacles ?? null });
  if (!plan.tabs.length) return;
  const layer = document.createElement('div');
  layer.dataset.tabTravel = plan.late ? 'late' : plan.way; layer.setAttribute('aria-hidden', 'true'); layer.setAttribute('inert', '');
  layer.dataset.fouls = `${plan.fouls}`;
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '21', overflow: 'hidden', background: 'none', transition: 'none' });
  // Everything was read first (the icons' own drawing, what arrives on the travellers' ways); from here everything is written: one style pass.
  const swept = sweep(plan);
  const travellers: Traveller[] = [], gated: Gated[] = [];
  for (const tab of plan.tabs) {
    const pair = pairs.get(tab.id)!, { kept, mark } = drawing.get(tab.id)!;
    const end = kind === 'list' ? tab.list : tab.strip, el = pair.icon.cloneNode(true) as HTMLElement;
    [el, ...el.querySelectorAll<HTMLElement>('*')].forEach((node, i) => { node.removeAttribute('id'); const style = node.style; if (style && kept[i]) KEPT.forEach((name, k) => { if (kept[i][k]) style.setProperty(name, kept[i][k]); }); });
    Object.assign(el.style, { position: 'fixed', left: `${end.x}px`, top: `${end.y}px`, width: `${end.width}px`, height: `${end.height}px`, margin: '0', visibility: 'visible', transition: 'none', animation: 'none', transformOrigin: '50% 50%', pointerEvents: 'none', flex: 'none' });
    // On the way to the list the active tab keeps its mark through the travel: a small plate in the active row's own fill round its icon, from the first frame to the last (the wide plates leave and
    // arrive with their chrome).
    if (mark) Object.assign(el.style, { backgroundColor: mark, boxShadow: `0 0 0 ${MARK_PX}px ${mark}`, borderRadius: `${MARK_PX + 2}px` });
    layer.appendChild(el);
    travellers.push({ tab, el, end, real: pair.icon, realWas: pair.icon.style.visibility, own: kept[0]?.[KEPT.indexOf('opacity')] || '1' });
  }
  // What arrives where a traveller passes comes in when the last one has passed (a place no traveller crosses is left alone: it arrives with its chrome).
  // (The way out: where the strip's parts stand is not known yet; all of them wait until the travellers begin to home on their slots, `home`.)
  // (A place reaches ARRIVE_PAD px to each side when it is asked about: a title 8 px right of its icon's place is clear only when the icon stands in that place, not while it is still sliding in.)
  for (const item of arrives) { if (!(item.own > 0)) continue; const clearAt = kind === 'strip' && !first.inflight ? Infinity : clearAfter(plan, { x: item.box.x - ARRIVE_PAD, y: item.box.y, width: item.box.width + 2 * ARRIVE_PAD, height: item.box.height }, swept); if (clearAt > 0) gated.push({ el: item.el, was: item.el.style.opacity, clearAt, own: Number.isFinite(item.own) ? item.own : 1, clearedAt: null }); }
  // The old icons' copies in the copy of the old chrome, and the new icons themselves, are not drawn while their traveller is. (LATE: the old icons leave with the old sidebar's copy, which is gone
  // before the travellers are first drawn.)
  if (!plan.late) for (const tab of plan.tabs) { const was = first.icons.get(tab.id), top = was ? (was.host === 'shell' ? opts.ghostShell : opts.ghostRail) : null, copy = top && was?.path ? atPath(top, was.path) : null; if (copy) { copy.style.visibility = 'hidden'; copy.style.filter = 'opacity(0)'; } }   // (the filter takes the icon's own children with it, whatever visibility is written on them)
  for (const item of travellers) item.real.style.visibility = 'hidden';
  opts.host.appendChild(layer);
  // The strip that leaves: its tabs' plates and titles and the buttons before its first tab (in the old chrome's copy) are not drawn from the first frame in which an icon moves. An icon is fast out
  // of its slot (it has to be in the sidebar's head row before the toolbar's buttons rise into the strip's row: a gentler start met them, twentieth-of-November build, and no line cleared them): in its
  // second frame it is already over the tab before it, so that tab's title cannot fade under it, however fast (real take of 20 Nov: the fourth icon on the word of the third tab, at 50 ms of fade).
  const quick = first.kind === 'strip' && !plan.late && opts.ghostShell ? [...opts.ghostShell.querySelectorAll<HTMLElement>('.acira-tab-row .tab-strip-container, .acira-tab-row .tab-strip-tools')] : [];
  live = { plan, layer, travellers, gated, side: opts.side, ms: 0, quick, homes: kind === 'strip', again: kind === 'strip' && !first.inflight, arrives: TABS[kind].arrives };
}

/** The way out, every frame: where each tab's slot in the strip is NOW. A strip that has just come is not at its final layout when the switch begins and its tabs are still gliding
 * to their places when it ends (their own layout motion): each traveller runs to where its tab's icon is drawn at the moment, so it lands exactly on it. All reads, then (in the frame) all writes. The
 * Returns, by traveller, whether its slot is inside the strip's own window. */
function home(m: Live): boolean[] {
  const view = document.querySelector(TABS.strip.view)?.getBoundingClientRect(), boxes = m.travellers.map(item => rectOf(item.real));
  const inside = boxes.map(box => !!view && box.width >= 1 && box.x + box.width / 2 >= view.left && box.x + box.width / 2 <= view.right);
  m.travellers.forEach((item, i) => { if (boxes[i].width >= 1) item.tab.strip = boxes[i]; });
  // What arrives in the strip comes in when no traveller still has to pass over it: asked every frame of where things are NOW (the strip's parts glide with its tabs). EVERY traveller counts until
  // it stands in its slot, one whose slot is not inside the strip's window at the moment too (the bar is still settling in the first frames, and the rule before this one left such a traveller
  // out; real take, 20 Nov: the fourth tab's title was in by +300 ms and the fifth icon ran over it at +367). A tab's own title waits for its own icon (ARRIVE_PAD). By the landing everything is there.
  const drawn = m.travellers.map(item => drawnOrFirst(m.plan, item.tab, m.ms));
  const places = m.gated.map(item => item.el.getBoundingClientRect());
  m.gated.forEach((item, i) => {
    if (item.clearedAt !== null && item.clearedAt !== undefined) return;
    if (!m.travellers.some((traveller, k) => stillToPass(drawn[k], traveller.tab.strip, places[i], ARRIVE_PAD))) item.clearedAt = m.ms;
  });
  return inside;
}

/** One frame, `ms` after the morph's first. `page`: the page card (what the native page covers is cut off every traveller). */
export function tabTravelFrame(ms: number, page: Element | null): void {
  if (pending) {
    // (The morph runs its frame once in the task of the switch itself, sidebarMorph.ts `install(m); ... frame(m)`: the set-up waits for the next call, its first animation frame.)
    if (!pending.armed) { pending.armed = true; return; }
    const p = pending; pending = null;
    try { begin(p); } catch { tabTravelEnd(); }
    if (!live) hold(false, true);
  }
  const m = live; if (!m) return;
  m.ms = Math.max(0, ms);
  if (m.homes) {
    // (From the first frame: what of the strip no icon has to cross, the + at its end, comes in with the strip.) From READ_AGAIN on, a slot outside the strip's own window (a tab scrolled out): that
    // tab has no place in sight. Its traveller goes and its own icon is drawn with its tab, which the strip cuts at its edge as it does everything of it.
    const inside = home(m);
    if (m.ms >= m.plan.total * READ_AGAIN && inside.includes(false)) m.travellers = m.travellers.filter((item, i) => { if (inside[i]) return true; item.real.style.visibility = item.realWas; item.el.remove(); const at = m.plan.tabs.indexOf(item.tab); if (at >= 0) m.plan.tabs.splice(at, 1); return false; });
  }
  const r = page?.getBoundingClientRect(), under = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  m.travellers.forEach(item => {
    const box = travelBox(m.plan, item.tab, m.ms), scale = item.end.width > 0 ? box.width / item.end.width : 1, style = item.el.style;
    style.translate = `${box.x + box.width / 2 - (item.end.x + item.end.width / 2)}px ${box.y + box.height / 2 - (item.end.y + item.end.height / 2)}px`;
    style.scale = `${scale}`;
    // Drawn whole or not at all: an icon any part of which the page covers is not drawn (the native page is above the interface; a page the interface draws itself must cover it the same way).
    const clear = !under || cutUnderPage(box, under, m.side) === 'none', shown = clear ? shownAt(m.plan, m.ms / m.plan.total) : 0;
    style.opacity = shown >= 1 ? item.own : `${shown * (Number.parseFloat(item.own) || 1)}`;
  });
  // The way out: each part of the strip comes in over ARRIVE_MS from the moment no traveller has to pass over it any more (never under one, to be there by the landing: see cameAt).
  if (m.homes) for (const item of m.gated) item.el.style.opacity = `${cameAt(m.plan, item.clearedAt ?? null, m.ms, ARRIVE_MS) * item.own}`;
  else for (const item of m.gated) item.el.style.opacity = `${arrivalAt(m.plan, item.clearAt, m.ms) * item.own}`;
  // (As a group, by `filter`. Not by `opacity`: the morph fades those copies by their opacity, frame by frame, and writes over one set here. Not by `visibility` either: until D92b a frozen copy's
  // pieces each carried `visible` written on them and a hidden container hid none of them (real frames of 20 Nov: the titles faded on for 80 ms under the icons); the filter takes the whole
  // subtree with it whatever is written inside.)
  if (m.quick.length && m.ms > 0) { for (const el of m.quick) el.style.filter = 'opacity(0)'; m.quick = []; }
}

/** The travel is over (or the morph is taken down): the layer goes, the new icons and what arrived behind the travellers are drawn as the layout draws them. */
export function tabTravelEnd(): void {
  pending = null;
  const m = live; if (!m) return;
  live = null;
  for (const item of m.travellers) item.real.style.visibility = item.realWas;
  for (const item of m.gated) item.el.style.opacity = item.was;
  m.layer.remove();
  if (m.homes) hold(false);
}
export const tabTravelRunning = (): boolean => live !== null || pending !== null;
