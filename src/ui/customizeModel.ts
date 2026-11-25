import type { SectionId } from './sidebarSections';

/** Customize sidebar, the arrangement of its blocks (Beta 14). Four zones: the TOP and BOTTOM edges, the middle list and the OFF tray.
 * Favorites and the footer's icon row are edge blocks: they sit at the top or the bottom edge and nowhere else (Favorites may also be turned off; the icon row never).
 * The pinned extensions' row sits at the top edge (where it always was) or in the list, and can be turned off; the side panel sites' icons sit at either edge or in the list, and can be turned off.
 * Every other section drags freely among the middle ones, or into the tray (Tabs stays). Pure: the component measures, this decides. */
export type BlockId = SectionId | 'footer';
export type Zone = 'top' | 'middle' | 'off' | 'bottom';
export type Arrange = Record<Zone, BlockId[]>;

/** Where each block may sit. */
const RULES: Record<BlockId, readonly Zone[]> = {
  favorites: ['top', 'bottom', 'off'],
  footer: ['top', 'bottom'],
  extensions: ['top', 'middle', 'off'],
  sidepanel: ['top', 'middle', 'bottom', 'off'],
  pinned: ['middle', 'off'],
  tabs: ['middle'],
  bookmarks: ['middle', 'off'],
  downloads: ['middle', 'off'],
  history: ['middle', 'off'],
  reading: ['middle', 'off'],
};
/** An edge block cannot sit in the list at all (Favorites, the icon row): it is only ever offered an edge. */
export const isEdge = (id: BlockId): boolean => !RULES[id].includes('middle');
/** Where a block may sit. The icon row cannot be turned off (it holds the profile and the way to Settings); Tabs stays in the list where the tabs live there. */
export const canSit = (id: BlockId, zone: Zone): boolean => RULES[id]?.includes(zone) ?? false;
export const ZONES: Zone[] = ['top', 'middle', 'off', 'bottom'];
export const locate = (a: Arrange, id: BlockId): { zone: Zone; index: number } | null => { for (const zone of ZONES) { const index = a[zone].indexOf(id); if (index >= 0) return { zone, index }; } return null; };

/** The arrangement with `id` taken out and put at `index` of `zone` (clamped); the same object when the move is not allowed or changes nothing. */
export function moveBlock(a: Arrange, id: BlockId, zone: Zone, index: number): Arrange {
  const from = locate(a, id);
  if (!from || !canSit(id, zone)) return a;
  const next: Arrange = { top: [...a.top], middle: [...a.middle], off: [...a.off], bottom: [...a.bottom] };
  next[from.zone].splice(from.index, 1);
  const to = Math.max(0, Math.min(next[zone].length, Math.round(index)));
  next[zone].splice(to, 0, id);
  return ZONES.every(name => next[name].length === a[name].length && next[name].every((item, at) => item === a[name][at])) ? a : next;
}

export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Measured { zones: Partial<Record<Zone, Rect>>; items: { id: BlockId; zone: Zone; rect: Rect }[] }
const cx = (r: Rect) => (r.left + r.right) / 2, cy = (r: Rect) => (r.top + r.bottom) / 2;
const gap = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/** Where a dragged block lands when the pointer is at (x, y): the allowed zone the pointer is in (a few pixels of margin), else nothing for an edge block (the gap stays where it last was: there is no place for it in the middle),
 * else the nearest allowed zone within reach for a block that may sit in the list (the empty space under the list is still "the end of the list"). The index counts the other blocks that come before the pointer (down a column; in the tray,
 * which wraps, by reading order: right to left in Arabic and Hebrew). */
export function slotAt(m: Measured, id: BlockId, x: number, y: number, rtl = false): { zone: Zone; index: number } | null {
  const MARGIN = 8, REACH = 64;
  let best: { zone: Zone; d: number } | null = null;
  for (const zone of ZONES) {
    const rect = m.zones[zone];
    if (!rect || !canSit(id, zone)) continue;
    const d = gap(rect, x, y);
    if (!best || d < best.d) best = { zone, d };
  }
  if (!best || best.d > (isEdge(id) ? MARGIN : Math.max(MARGIN, REACH))) return null;
  const others = m.items.filter(item => item.zone === best!.zone && item.id !== id).sort((p, q) => cy(p.rect) - cy(q.rect) || (rtl ? cx(q.rect) - cx(p.rect) : cx(p.rect) - cx(q.rect)));
  if (best.zone === 'off') {
    let index = 0;
    for (const item of others) { const row = y > item.rect.bottom ? 1 : y < item.rect.top ? -1 : 0; if (row > 0 || (row === 0 && (rtl ? x < cx(item.rect) : x > cx(item.rect)))) index++; }
    return { zone: best.zone, index };
  }
  return { zone: best.zone, index: others.filter(item => cy(item.rect) < y).length };
}

/** The keyboard's walk through the places a block may sit: one step up (-1) or down (+1) the column of zones. The edge blocks hop from one edge to the other (and into the tray, for Favorites). */
export function stepBlock(a: Arrange, id: BlockId, dir: -1 | 1): Arrange {
  const at = locate(a, id);
  if (!at) return a;
  const path: { zone: Zone; index: number }[] = [];
  for (const zone of ZONES) { if (!canSit(id, zone)) continue; const size = a[zone].length - (a[zone].includes(id) ? 1 : 0); for (let index = 0; index <= size; index++) path.push({ zone, index }); }
  const here = path.findIndex(slot => slot.zone === at.zone && slot.index === at.index);
  const goal = path[here + dir];
  return goal ? moveBlock(a, id, goal.zone, goal.index) : a;
}

// --- What is saved, and what the real sidebar draws from it -------------------------------------------------------------------------------------------------------------------------------
/** What a profile keeps (sidebarSections.ts SectionLayout): the order of the sections that can sit in the list (all of them, hidden ones too, so a block that comes back returns to its place), the sections turned off, and the two edges
 * as they were arranged (the blocks on them, in order; Favorites' own edge is the Favorites store's, so Settings and Customize never disagree). */
export interface Placement { order: SectionId[]; hidden: SectionId[]; edges?: { top: string[]; bottom: string[] } }
export interface ArrangeContext {
  /** Top + sidebar: no tab list, so no Tabs and no Pinned tabs blocks. */
  shelf: boolean;
  /** Where the Favorites store keeps the tiles (Settings › Tabs › Sidebar › Favorites). */
  favoritesPlace: 'top' | 'bottom';
  /** The profile has side panel sites: with none, that block does not exist (nothing is drawn until a first site is pinned). */
  sidePanel: boolean;
}
/** Where a block sits when the profile has arranged nothing. Favorites and the extensions' row are at the top (the extensions under the tiles, as they always were); the side panel sites and the icon row at the bottom. */
const DEFAULT_EDGE: Partial<Record<BlockId, 'top' | 'bottom'>> = { favorites: 'top', extensions: 'top', sidepanel: 'bottom', footer: 'bottom' };
const RANK: BlockId[] = ['favorites', 'extensions', 'sidepanel', 'footer'];
const present = (id: BlockId, ctx: ArrangeContext) => id === 'pinned' || id === 'tabs' ? !ctx.shelf : id === 'sidepanel' ? ctx.sidePanel : true;
/** The zone a block goes to when it is turned on from the tray: its own edge, or the end of the list. */
export const homeOf = (id: BlockId): Zone => id === 'favorites' || id === 'extensions' ? 'top' : id === 'sidepanel' || id === 'footer' ? 'bottom' : 'middle';
/** Every block a sidebar can draw, whatever the profile has done with it. */
export const BLOCKS: BlockId[] = ['favorites', 'pinned', 'tabs', 'bookmarks', 'downloads', 'history', 'reading', 'extensions', 'sidepanel', 'footer'];

/** The four zones from what is saved. Pure and total: any saved value (an old profile, a stray id, an edge that may not take the block) gives an arrangement every block of which sits somewhere it may. */
export function arrangeOf(saved: Placement, ctx: ArrangeContext): Arrange {
  const off: BlockId[] = [];
  for (const id of saved.hidden) if (present(id, ctx) && canSit(id, 'off') && !off.includes(id)) off.push(id);
  const hidden = new Set<BlockId>(off);   // only what can really be off: a stray 'footer' in a saved list never takes the icon row away
  const savedTop = saved.edges?.top ?? [], savedBottom = saved.edges?.bottom ?? [];
  const edgeOf = (id: BlockId): 'top' | 'bottom' | null => {
    if (id === 'favorites') return ctx.favoritesPlace;
    const wanted: 'top' | 'bottom' | null = savedTop.includes(id) ? 'top' : savedBottom.includes(id) ? 'bottom' : saved.edges && canSit(id, 'middle') ? null : DEFAULT_EDGE[id] ?? null;
    if (wanted && canSit(id, wanted)) return wanted;
    return canSit(id, 'middle') ? null : (['top', 'bottom'] as const).find(zone => canSit(id, zone)) ?? null;
  };
  const onEdge = (zone: 'top' | 'bottom'): BlockId[] => {
    // a block the edge's saved list does not name yet (turned on again, a Settings change of the Favorites' place) takes its default rank: the Favorites tiles lead their edge, as they always did
    const rank = (id: BlockId) => { const at = (zone === 'top' ? savedTop : savedBottom).indexOf(id); return at >= 0 ? at : id === 'favorites' ? -1 : 1000 + RANK.indexOf(id); };
    return BLOCKS.filter(id => present(id, ctx) && !hidden.has(id) && edgeOf(id) === zone).sort((p, q) => rank(p) - rank(q));
  };
  const top = onEdge('top'), bottom = onEdge('bottom');
  const placed = new Set<BlockId>([...top, ...bottom, ...off]);
  const middle: BlockId[] = [];
  for (const id of saved.order) if (present(id, ctx) && !placed.has(id) && canSit(id, 'middle') && !middle.includes(id)) middle.push(id);
  // a block the saved order does not know (a profile older than the block): the end of the list, except Pinned tabs, which stands before the Tabs list as it always did
  for (const id of BLOCKS) if (present(id, ctx) && !placed.has(id) && !middle.includes(id) && canSit(id, 'middle') && edgeOf(id) === null) { const tabs = middle.indexOf('tabs'); if (id === 'pinned' && tabs >= 0) middle.splice(tabs, 0, id); else middle.push(id); }
  return { top, middle, off, bottom };
}

/** What to keep after an arrangement: the middle blocks lead the order (the ones that are not in the list keep their old relative places after them), what is off, and the two edges. */
export function placementOf(a: Arrange, previous: Placement, ctx: ArrangeContext): Placement {
  const real = (id: BlockId): id is SectionId => id !== 'footer';
  const middle = a.middle.filter(real);
  const order = [...middle, ...previous.order.filter(id => !middle.includes(id))].filter((id, at, all) => all.indexOf(id) === at);
  // what is off here, plus what was off and is not a block of this layout (the Shelf's list is its own, a side panel with no sites has no block)
  const hidden = [...a.off.filter(real), ...previous.hidden.filter(id => !present(id, ctx) && !a.off.includes(id))];
  const edges = { top: [...a.top], bottom: [...a.bottom] };
  // a block that is not here yet (the side panel sites before the first site is pinned) keeps the edge it will come in on: its saved one, else its default, before the icon row; without this the first site pinned after any Customize write landed at the end of the list
  for (const id of BLOCKS) {
    if (present(id, ctx) || hidden.includes(id as SectionId)) continue;
    const was = previous.edges?.top.includes(id) ? 'top' : previous.edges?.bottom.includes(id) ? 'bottom' : DEFAULT_EDGE[id];
    if (was !== 'top' && was !== 'bottom' || !canSit(id, was) || edges.top.includes(id) || edges.bottom.includes(id)) continue;
    const list = edges[was], footer = list.indexOf('footer');
    list.splice(footer >= 0 ? footer : list.length, 0, id);
  }
  return { order, hidden, edges };
}
/** Where in its zone a block goes when it is turned on from the tray: the Favorites tiles lead their edge; the side panel sites stand above the icon row; the rest take the end. */
export function homeIndex(a: Arrange, id: BlockId, zone: Zone): number {
  if (id === 'favorites') return 0;
  const footer = a[zone].indexOf('footer');
  return id === 'sidepanel' && footer >= 0 ? footer : a[zone].length;
}

// --- The ghost ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** How far the carried block may sway from its column while it is a block (px). The list's blocks sit 8 px inside the sidebar and the lifted glass grows 1.25 % a side, so the rim and the glow's near layers have about 2 px to spare
 * before the sidebar's own clip cuts them (the per-frame audit of 18 Nov measured the rim 1.8 px outside at a 7 px sway, 4.8 px at the old 10): the sway is a hint of the pointer's side, not a travel. */
export const SWAY = 1;
export interface GhostGrab { home: { left: number; top: number; w: number; h: number }; press: { x: number; y: number }; grab: { x: number; y: number }; root: { left: number; top: number }; chip: { w: number; h: number } }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Where the carried ghost is for the pointer at `pos` (client coordinates), in the surface's own: `mix` 0 is the block (its column, a little sway, the grab point under the pointer vertically), 1 is the chip it becomes over the Off tray
 * (centred on the pointer), anything between is the morph on its spring (the tab drag's chip: sidebarTabDrag.ts place()). */
export function ghostAt(g: GhostGrab, pos: { x: number; y: number }, mix: number): { x: number; y: number; w: number; h: number } {
  const m = Math.max(0, Math.min(1, mix)), w = lerp(g.home.w, g.chip.w || g.home.w, m), h = lerp(g.home.h, g.chip.h || g.home.h, m);
  const px = pos.x - g.root.left, py = pos.y - g.root.top;
  const sway = Math.max(-SWAY, Math.min(SWAY, pos.x - g.press.x));
  return { x: lerp(g.home.left + sway, px - w / 2, m), y: lerp(py - g.grab.y, py - h / 2, m), w, h };
}
