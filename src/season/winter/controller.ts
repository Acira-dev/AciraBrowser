/**
 * Noël's controller: the one place that touches the DOM for the snow (`engine.ts` is the numbers, `draw.ts` the pictures).
 *
 *  - CUSHIONS are small pictures (a canvas) that ride INSIDE the thing they sit on (the selected tab's plate, the address field, New Tab's search box), so scrolling, a list sliding
 *    to make room and the plate's own glide move them on the compositor with no script. They are drawn when their snow changes, and never otherwise.
 *  - The SIDEBAR's snow canvas is the bottom-most thing in the sidebar; it exists only while something is in the air. The DRIFT along its foot is its own small picture, drawn when it changes.
 *  - ONE frame loop (30 fps, 24 on a low battery) runs only while something moves: it starts on an input, a shake, a tab drag or a glide, and stops the frame nothing moves.
 *    It rests 10 s after the last input (`data-input-idle`, desktop/input-rest.cjs), and pauses for the length of any sidebar or layout motion (edgeBreath.ts MOTION_FLAGS).
 */
import { MOTION_FLAGS, batterySaverOn } from '../../ui/edgeBreath';
import { shakeGlobe as globeShake, CLASSES, CUSHION_LOW, CUSHION_PAD, DRIFT_PICTURE, INSIDE_NTP, INSIDE_Y, STICK, brushAt, createLedge, createWorld, deposit, disturb, dragDrop, dragLift, dragMove, dropAll, fastForward, meanOf, platePush, resizeLedge, seedField, settleBack, settleLedges, startFlurry, step, sweepAlong, type Ledge, type LedgeId, type Placed, type World } from './engine';
import { drawCushion, drawDrift, drawSnow, makeSprites, type SpriteSet } from './draw';
import type { NoelSnow } from '../noelSettings';

/** `keep` (Settings, Keep snowing; on by default): the snowfall does not rest after a while without input, and it falls while the window can be seen even when another window has the keys. */
export interface NoelConfig { on: boolean; snow: NoelSnow; dark: boolean; reduced: boolean; keep?: boolean }
/** A cap's picture and where its snow lies on its own plate (`geo`): one ledge of snow can have several pictures at once (the selected row and the strip's pill while a
 *  layout switch shows both, the row and its gliding card), and each is drawn with its own plate's line, ends and corner, never with another's (D165). */
interface Geo { y: number; rad: number; x0: number; x1: number }
interface Target { canvas: HTMLCanvasElement; host: HTMLElement; kind: 'row' | 'card'; geo?: Geo }
interface Slot { ledge: Ledge | null; targets: Set<Target> }
const IDS: LedgeId[] = ['sel', 'addr', 'ntp'];
const FRAME_MS = 1000 / 30, FRAME_MS_BATTERY = 1000 / 24;
const dpr = (): number => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

const S = {
  cfg: { on: false, snow: 'sidebar', dark: true, reduced: false, keep: true } as NoelConfig,
  w: Object.assign(createWorld(), { footMelt: true }),   // D176: nothing settles at the sidebar's foot
  slots: { sel: { ledge: null, targets: new Set() }, addr: { ledge: null, targets: new Set() }, ntp: { ledge: null, targets: new Set() } } as Record<LedgeId, Slot>,
  sidebar: null as null | { aside: HTMLElement; snow: HTMLCanvasElement; drift: HTMLCanvasElement },
  sprites: null as null | { dark: boolean; set: SpriteSet },
  loop: 0, lastDraw: 0, battery: false, idle: false, moving: false, away: false,
  /** Elements whose own motion drives the selected cushion's weight (a gliding card, a dragged row): read each frame. */
  follow: new Map<HTMLElement, (() => void) | undefined>(),
  sweep: null as null | { id: LedgeId; t0: number; dur: number },
  settling: false, dragging: false, driftLit: false,
  last: { x: -999, y: -999, t: 0 },
  ro: null as ResizeObserver | null, mo: null as MutationObserver | null, started: false, size: { W: 0, H: 0 },
  /** a sidebar registered and not measured yet (its first observer callback does it: sidebarArrived) */
  sidebarFresh: false,
  /** D168: what changed size while a sidebar or layout move ran (MOTION_FLAGS): each cap and the sidebar are measured and drawn once, when the move ends. */
  held: new Map<Target, LedgeId>(), heldSidebar: false,
  /** what `start` hooked up, so `stop` can take every bit of it down again (the theme off costs nothing: no observer, no listener, no frame) */
  unhook: [] as (() => void)[],
};
/** The world, for tests and for the rigs (`window.__noel`). */
export const noelWorld = (): World => S.w;

const keeps = (): boolean => S.cfg.keep !== false;
/** It rests (the flakes melt away) after the app's quiet time, unless Keep snowing is on. */
const resting = (): boolean => S.idle && !keeps();
const eligible = (): boolean => S.cfg.on && S.cfg.snow !== 'off' && !S.cfg.reduced && !document.hidden && (keeps() || !S.away) && !S.battery;
function syncWorld(): void {
  const w = S.w; w.snow = S.cfg.snow; w.dark = S.cfg.dark; w.reduced = S.cfg.reduced; w.eligible = eligible(); w.resting = resting();
}

/* ---------- configuration ---------- */
export function configure(next: NoelConfig): void {
  const was = S.cfg; S.cfg = next; if (next.on) start(); syncWorld();
  if (was.dark !== next.dark) { S.sprites = null; redrawAll(); }
  if (!next.on) { teardown(); stop(); return; }
  if (!was.on) { for (const id of IDS) for (const t of S.slots[id].targets) ensureLedge(id, t); ensureDrift(); redrawAll(); }
  if (was.snow !== next.snow) { if (next.snow === 'off') { S.w.flakes.length = 0; } else if (eligible()) { S.w.rampT0 = performance.now(); seedField(S.w); } }
  if (was.reduced !== next.reduced && next.reduced) { S.w.flakes.length = 0; S.w.clumps.length = 0; S.w.puffs.length = 0; }
  kick();
}
function teardown(): void {
  cancelLoop(); S.w.flakes.length = 0; S.w.clumps.length = 0; S.w.puffs.length = 0; S.w.drift = null; S.w.placed = {}; S.w.def = { d: 0, v: 0, broke: false };
  for (const id of IDS) { const s = S.slots[id]; s.ledge = null; for (const t of s.targets) clearCanvas(t.canvas); }
  S.held.clear(); S.heldSidebar = false;
  if (S.sidebar) { freeSnowCanvas(); clearCanvas(S.sidebar.drift); }
  S.follow.clear(); S.sweep = null; S.settling = false; S.driftLit = false;
}
/** D176 (reported 24 Nov; the team's pick between the team's two outcomes, a nice pile or no precipitation): nothing settles at the sidebar's foot. The drift that stood there read as a flat white line along the window's
 *  bottom edge; it is no longer built, and a flake melts away over the last FOOT_MELT px instead (engine.ts footMelt). Kept as a function so its callers stay as they were. */
function ensureDrift(): void { if (S.w.drift) { S.w.drift = null; drawDriftPicture(); } }

/* ---------- cushions ---------- */
function ensureLedge(id: LedgeId, t: Target): Ledge | null {
  if (!S.cfg.on) return null; const slot = S.slots[id], width = t.host.offsetWidth; if (width < 8) return slot.ledge;
  if (!slot.ledge) {
    // a cushion is born with a light first snow on it, as if it had snowed a little already: the look is there at once
    const e = createLedge(S.w, id, width, id === 'ntp' ? Math.min(22, t.host.offsetHeight / 2) : id === 'addr' ? Math.min(9, t.host.offsetHeight / 2) : undefined);
    fastForward(S.w, [e], 45); slot.ledge = e;
  }
  // the snow follows its plate's width only while that plate is its one picture: while two different plates show it (a layout switch), resizing it back and forth would
  // resample it each time; each picture is drawn across its own plate (drawCushion spreads the columns between the picture's own ends)
  else if (connectedTargets(id) <= 1) resizeLedge(S.w, slot.ledge, width);
  // a field (the address field, New Tab's search) and a clipped plate (the strip's pill) carry their snow INSIDE their top edge, wholly within their own outline; a tab row
  // carries it on top. The corners are the surface's own: an inside cap is clipped to the plate's outline (its radius, and inside its focus ring); a row's snow curves down
  // with the row's own radius.
  // an inside cap's line runs the plate's outline inset by `y` (its ends start `y` in from the sides, its corners curve with the plate's radius less `y`): concentric with the rim
  const inside = isInside(id, t), R = plateRadius(t), y = inside ? (id === 'ntp' ? INSIDE_NTP : INSIDE_Y) : CUSHION_PAD, rad = inside ? Math.max(0, R - y) : R, e = slot.ledge;
  const x0 = inside ? y : .5, x1 = width - x0, g = t.geo;
  if (!g || g.y !== y || g.rad !== rad || g.x0 !== x0 || g.x1 !== x1) { t.geo = { y, rad, x0, x1 }; e.dirty = true; }
  // the ledge's own geometry (what the engine's deposits and brush read) is its one picture's, or stays as it was while there are several
  if (connectedTargets(id) <= 1 && (e.y !== y || e.rad !== rad || e.x0 !== x0 || e.x1 !== x1)) { e.y = y; e.rad = rad; e.x0 = x0; e.x1 = x1; e.dirty = true; }
  return e;
}
function connectedTargets(id: LedgeId): number { let n = 0; for (const t of S.slots[id].targets) if (t.canvas.isConnected) n++; return n; }
/** The ledge as one picture sees it: its snow, with that picture's own plate line, ends and corner. */
function viewOf(e: Ledge, t: Target): Ledge { return t.geo ? Object.assign(Object.create(e) as Ledge, t.geo) : e; }
/** A cushion's picture rides inside `host` (the plate, the field). Returns the function that lets it go. */
export function registerCushion(id: LedgeId, canvas: HTMLCanvasElement, host: HTMLElement, kind: 'row' | 'card' = 'row'): () => void {
  // nothing is measured here: this runs inside React's commit, often in the middle of a layout motion (Sidebar mode turning back moves the address field, and its cap
  // re-mounts), where reading the plate's size or style forces a synchronous layout of the whole interface (a 40 ms frame in the guard's c2 'full toggle2'). The
  // observer's first callback, after the browser's own layout, measures and draws it (the same path as every resize).
  const t: Target = { canvas, host, kind }; S.slots[id].targets.add(t); start(); S.ro?.observe(host);
  return () => { S.slots[id].targets.delete(t); S.ro?.unobserve(host); clearCanvas(canvas); };
}
const isInside = (id: LedgeId, t: Target): boolean => id !== 'sel' || t.host.hasAttribute('data-inside');
/** The plate the cap sits on (the frost layer's parent), its corner radius (CSS px) and how far inside its outline the focus ring's inner edge stands (active-border.css: a 1px
 *  border at --ab-inset, so 1px at inset 0, nothing for a ring drawn over the plate's own border at -1px). */
const plateOf = (t: Target): HTMLElement | null => t.host.parentElement;
function plateRadius(t: Target): number { const p = plateOf(t); return p ? parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0 : 0; }
function ringInset(t: Target): number { const p = plateOf(t); if (!p) return 0; const v = parseFloat(getComputedStyle(p).getPropertyValue('--ab-inset')); return Math.max(0, (Number.isFinite(v) ? v : 0) + 1); }
function sizeCushionCanvas(c: HTMLCanvasElement, width: number, e: Ledge, t: Target, id: LedgeId): void {   // `e`: the picture's view (viewOf)
  const k = dpr(), h = e.y + CUSHION_LOW, W = Math.round(width * k), H = Math.round(h * k);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  // an inside cap's picture starts at the plate's top edge (its snow lies below it) and is clipped to the plate's outline (noel.css: --noel-r, and --noel-ring while it has focus)
  const inside = isInside(id, t), top = inside ? '0px' : `${-e.y}px`, ht = `${h}px`; if (c.style.top !== top || c.style.height !== ht) { c.style.top = top; c.style.height = ht; }
  if (inside) { const r = `${plateRadius(t)}px`, ring = `${ringInset(t)}px`; if (c.style.getPropertyValue('--noel-r') !== r) c.style.setProperty('--noel-r', r); if (c.style.getPropertyValue('--noel-ring-w') !== ring) c.style.setProperty('--noel-ring-w', ring); if (!c.hasAttribute('data-clip')) c.setAttribute('data-clip', ''); }
  else if (c.hasAttribute('data-clip')) { c.removeAttribute('data-clip'); c.style.removeProperty('--noel-r'); c.style.removeProperty('--noel-ring-w'); }
}
function clearCanvas(c: HTMLCanvasElement): void { if (c.width) { c.getContext('2d')?.clearRect(0, 0, c.width, c.height); } }
/** Draws one cushion into every picture it has (the row's, and the gliding card's while one flies). */
function drawLedge(id: LedgeId): void {
  const slot = S.slots[id], e = slot.ledge; if (!e) return;
  for (const t of slot.targets) {
    const width = t.host.offsetWidth; if (width < 8) continue;
    if (!t.geo) ensureLedge(id, t);
    const v = viewOf(e, t);
    sizeCushionCanvas(t.canvas, width, v, t, id);
    const g = t.canvas.getContext('2d')!; g.setTransform(dpr(), 0, 0, dpr(), 0, 0); g.clearRect(0, 0, width, v.y + CUSHION_LOW);
    drawCushion(g, v, S.cfg.dark, id === 'sel' ? S.w.def : undefined);
  }
  e.dirty = false;
}
function redrawAll(): void { for (const id of IDS) { const e = S.slots[id].ledge; if (e) e.dirty = true; drawLedge(id); } if (S.w.drift) S.w.drift.dirty = true; drawDriftPicture(); }
/** Where each cushion's plate-top line stands in the sidebar's canvas (px). */
function placedNow(): Record<string, Placed> {
  const out: Record<string, Placed> = {}, sb = S.sidebar; if (!sb) return out;
  const sr = sb.aside.getBoundingClientRect();
  for (const id of IDS) {
    const slot = S.slots[id], e = slot.ledge; if (!e) continue;
    let pick: Target | null = null;
    for (const t of slot.targets) { if (!t.canvas.isConnected || t.host.offsetWidth < 8) continue; if (!pick || (t.kind === 'card' && pick.kind !== 'card')) pick = t; }
    if (!pick) continue;
    const cr = pick.canvas.getBoundingClientRect(), v = viewOf(e, pick); if (cr.width < 8) continue;
    if (cr.left < sr.left - 2 || cr.right > sr.right + 2 || cr.top + v.y < sr.top - 2 || cr.top + v.y > sr.bottom + 2) continue;   // not in the sidebar: nothing lands on it
    out[id] = { e, x0: cr.left - sr.left + v.x0, x1: cr.left - sr.left + v.x1, y: cr.top - sr.top + v.y };
  }
  return out;
}

/* ---------- the sidebar ---------- */
export function registerSidebar(aside: HTMLElement, snow: HTMLCanvasElement, drift: HTMLCanvasElement): () => void {
  // as for a cap: nothing is measured inside the commit; the observer's first callback (after layout) measures the new sidebar and seeds its snow (sidebarArrived)
  S.sidebar = { aside, snow, drift }; S.sidebarFresh = true; start(); S.ro?.observe(aside);
  // the sidebar leaves (Seamless with its float closed, a layout without one): its flakes go with it, so nothing keeps stepping snow nobody can see; it comes back seeded (above)
  return () => { if (S.sidebar?.aside === aside) { freeSnowCanvas(); clearCanvas(drift); S.sidebar = null; S.ro?.unobserve(aside); S.w.flakes.length = 0; S.w.clumps.length = 0; S.w.puffs.length = 0; } };
}
/** A newly registered sidebar, measured after the browser's own layout (its observer's first callback): its size, its drift, and its snow seeded so it is already falling. */
function sidebarArrived(): void {
  S.sidebarFresh = false; measureSidebar(true);
  if (S.cfg.on) { ensureDrift(); drawDriftPicture(); if (eligible()) { S.w.rampT0 = performance.now(); seedField(S.w); } kick(); }
}
function measureSidebar(force = false): void {
  const sb = S.sidebar; if (!sb) return; const W = sb.aside.clientWidth, H = sb.aside.clientHeight;
  if (!force && W === S.size.W && H === S.size.H) return;
  // the sidebar comes back from nothing (Seamless's floating sidebar, an edge reveal): its snow was dropped while it was 0 px wide, so it opens with the snow already falling
  // (the flakes fade in over their first second, as every new flake does) instead of an empty field that takes half a minute to fill. Not at start-up: the first measure has no height before it.
  const reopened = S.size.H > 0 && S.size.W < 8 && W >= 8;
  S.size = { W, H }; S.w.W = W; S.w.H = H;
  if (reopened && S.cfg.on) { syncWorld(); if (S.w.eligible && !S.w.resting && !S.w.flakes.length) { seedField(S.w); kick(); } }
  if (S.cfg.on) drawDriftPicture();
  if (sb.snow.width) { sb.snow.width = 0; }   // resized: the picture is cleared, the next frame draws it again
}
function drawDriftPicture(): void {
  const sb = S.sidebar, w = S.w; if (!sb || !S.cfg.on) return;
  const k = dpr(), W = Math.max(1, Math.round(w.W * k)), H = Math.round(DRIFT_PICTURE * k);
  if (sb.drift.width !== W || sb.drift.height !== H) { sb.drift.width = W; sb.drift.height = H; }
  const g = sb.drift.getContext('2d')!; g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w.W, DRIFT_PICTURE);
  drawDrift(g, w, DRIFT_PICTURE, S.cfg.dark); if (w.drift) w.drift.dirty = false;
}
function freeSnowCanvas(): void { const c = S.sidebar?.snow; if (c && c.width) { c.width = 0; c.height = 0; } }
function snowGraphics(): { g: CanvasRenderingContext2D; sp: SpriteSet } | null {
  const sb = S.sidebar; if (!sb) return null;
  const k = dpr(), W = Math.round(S.w.W * k), H = Math.round(S.w.H * k); if (W < 2 || H < 2) return null;
  if (sb.snow.width !== W || sb.snow.height !== H) { sb.snow.width = W; sb.snow.height = H; }
  if (!S.sprites || S.sprites.dark !== S.cfg.dark) S.sprites = { dark: S.cfg.dark, set: makeSprites(S.cfg.dark) };
  const g = sb.snow.getContext('2d')!; g.setTransform(k, 0, 0, k, 0, 0); return { g, sp: S.sprites.set };
}

/* ---------- the loop ---------- */
function cancelLoop(): void { if (S.loop) { cancelAnimationFrame(S.loop); S.loop = 0; } S.lastDraw = 0; }
export function kick(): void { if (S.loop || !S.cfg.on || S.moving) return; S.loop = requestAnimationFrame(frame); }
const busy = (): boolean => { const w = S.w; return w.flakes.length > 0 || w.clumps.length > 0 || w.puffs.length > 0 || w.weightActive || S.follow.size > 0 || S.settling || !!S.sweep || S.dragging || w.flurry > 0 || (eligible() && !resting() && S.cfg.snow !== 'off' && !!S.sidebar); };
function frame(ts: number): void {
  S.loop = 0; if (!S.cfg.on) return;
  if (S.moving) { S.lastDraw = 0; return; }                  // a sidebar or layout motion runs: the snow holds where it is and goes on after it
  // the snowfall draws at 30 fps (24 on a low battery): its flakes move little per frame. A plate that is on the move (a glide, a drag) and the snow's weight on it follow every frame of the display.
  const fast = S.follow.size > 0 || !!S.sweep || S.dragging || S.w.weightActive || S.w.globe > 0, gap = fast ? 0 : S.battery ? FRAME_MS_BATTERY : FRAME_MS;
  if (gap && S.lastDraw && ts - S.lastDraw < gap - 3) { S.loop = requestAnimationFrame(frame); return; }
  const dt = Math.min(.08, S.lastDraw ? (ts - S.lastDraw) / 1000 : 1 / 30); S.lastDraw = ts;
  syncWorld(); const w = S.w;
  for (const [el, gone] of S.follow) {
    if (!el.isConnected) { S.follow.delete(el); gone?.(); if (!S.follow.size) S.dragging = false; continue; }
    const top = el.getBoundingClientRect().top; platePush(w, top, ts);
    if (S.dragging && S.sidebar) { const sr = S.sidebar.aside.getBoundingClientRect(); dragMove(w, w.plate.v, ts); sweepAlong(w, top - sr.top + el.offsetHeight / 2, w.plate.v); }
  }
  w.placed = placedNow();
  step(w, dt, ts);
  if (S.sweep) stepSweep(ts);
  // Snowfall over the whole window: the flakes over the toolbar and the page are the overlay window's (desktop/season-overlay.cjs); what lands on the address field and on New Tab's search box
  // is fed here, from the flux of flakes that would cross each one (a rate, not flakes), so the two build up as the sidebar's tab does
  if (w.snow === 'window' && w.eligible && !w.resting) feedWindowSnow(dt);
  S.settling = settleBack(w, dt, ts) || settleLedges(w, [S.slots.addr.ledge, S.slots.ntp.ledge].filter((e): e is Ledge => !!e), dt, ts);
  // the sidebar's picture
  const sb = S.sidebar;
  if (sb) {
    if (w.flakes.length || w.clumps.length || w.puffs.length) { const gg = snowGraphics(); if (gg) { gg.g.clearRect(0, 0, w.W, w.H); drawSnow(gg.g, w, gg.sp); } }
    else if (sb.snow.width && !busy()) freeSnowCanvas();
    else if (sb.snow.width) { const gg = snowGraphics(); if (gg) gg.g.clearRect(0, 0, w.W, w.H); }
    if (w.drift?.dirty) drawDriftPicture();
  }
  for (const id of IDS) { const e = S.slots[id].ledge; if (e && (e.dirty || (id === 'sel' && (w.weightActive || Math.abs(w.def.d) > .005)))) drawLedge(id); }
  if (busy()) S.loop = requestAnimationFrame(frame); else { S.lastDraw = 0; if (sb?.snow.width) freeSnowCanvas(); }
}

/** The flux of flakes through a line `width` px long: the middle and near classes at their density and speed, as many as stick (per second). */
function feedWindowSnow(dt: number): void {
  const w = S.w;
  for (const id of ['addr', 'ntp'] as const) {
    const e = S.slots[id].ledge; if (!e) continue; let any = false; for (const t of S.slots[id].targets) if (t.canvas.isConnected && t.host.offsetWidth > 8) any = true; if (!any) continue;
    let rate = 0; for (const c of CLASSES) if (c.id !== 'far') rate += c.dens * w.amount * e.width * ((c.vy[0] + c.vy[1]) / 2);
    rate *= STICK * .8; let n = 0, l = rate * dt, p = 1; const L = Math.exp(-l); do { n++; p *= w.rnd(); } while (p > L); n--;
    for (let i = 0; i < n; i++) deposit(e, e.x0 + w.rnd() * (e.x1 - e.x0), (w.rnd() < .22 ? 1.1 : .6) * 2.4);
  }
}

/* ---------- what the loop waits for ---------- */
function onRoot(): void {
  const root = document.documentElement;
  const idle = root.hasAttribute('data-input-idle'), away = root.getAttribute('data-window-active') === 'false';
  const moving = MOTION_FLAGS.some(n => root.hasAttribute(n) && !(n === 'data-mode-switch' && root.getAttribute(n) === 'appearance'));
  const woke = S.idle && !idle, wasMoving = S.moving;
  S.idle = idle; S.away = away; S.moving = moving; syncWorld();
  if (woke && eligible()) { S.w.rampT0 = performance.now(); }
  if (idle || away) S.w.flurry = idle ? S.w.flurry : 0;
  if (wasMoving && !moving) releaseHeld();
  if ((woke || (wasMoving && !moving) || !away) && S.cfg.on) kick();
}
/** D168: the move ended: what changed size while it ran is measured and drawn once. */
function releaseHeld(): void {
  if (!S.held.size && !S.heldSidebar) return;
  const ids = new Set<LedgeId>();
  for (const [t, id] of S.held) if (t.canvas.isConnected && S.slots[id].targets.has(t)) { const e = ensureLedge(id, t); if (e) { e.dirty = true; ids.add(id); } }
  S.held.clear(); for (const id of ids) drawLedge(id);
  if (S.heldSidebar) { S.heldSidebar = false; if (S.sidebar) measureSidebar(); }
}
function start(): void {
  if (S.started || !S.cfg.on || typeof document === 'undefined') return; S.started = true;
  const root = document.documentElement;
  S.mo = new MutationObserver(onRoot); S.mo.observe(root, { attributes: true, attributeFilter: ['data-input-idle', 'data-window-active', ...MOTION_FLAGS] });
  S.ro = new ResizeObserver(entries => {
    let sidebar = false; const hosts = new Set<Element>(entries.map(e => e.target));
    // D168 (reported 24 Nov: the Sidebar <-> Mini move "is now glitchy when it's snowy"): while a move runs, a cap's plate changes size every frame; measuring and
    // redrawing the cap each frame cost the move ~30 ms of script and ~30 ms of style over 600 ms. It is held instead: its picture rides the plate as it is, and it is
    // measured and drawn once when the move ends (releaseHeld). The sidebar's own first measure is never held.
    // Only the sidebar's own cap (the open tab's) is held: the address field's and New Tab's search box sit outside the moving sidebar and change size at most once in a
    // move (the field jumps to its new width at the start); holding them would show their old picture stretched for the whole move (17 % at Wide), so they redraw at once.
    if (S.moving) {
      for (const t of S.slots.sel.targets) if (hosts.has(t.host)) S.held.set(t, 'sel');
      if (S.sidebar && hosts.has(S.sidebar.aside)) { if (S.sidebarFresh) sidebarArrived(); else S.heldSidebar = true; }
    }
    for (const id of IDS) { if (S.moving && id === 'sel') continue; for (const t of S.slots[id].targets) if (hosts.has(t.host)) { const e = ensureLedge(id, t); if (e) { e.dirty = true; drawLedge(id); } } }
    if (S.moving) return;
    if (S.sidebar && hosts.has(S.sidebar.aside)) sidebar = true;
    if (sidebar && S.sidebarFresh) sidebarArrived();
    else if (sidebar) { measureSidebar(); kick(); }
    else kick();
  });
  // the plates and the sidebar registered while the theme was off are measured from now on
  for (const id of IDS) for (const t of S.slots[id].targets) S.ro.observe(t.host);
  if (S.sidebar) S.ro.observe(S.sidebar.aside);
  const vis = () => { syncWorld(); if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', vis);
  document.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  S.unhook.push(() => document.removeEventListener('visibilitychange', vis), () => document.removeEventListener('pointermove', onPointer, { capture: true }));
  const run = S.unhook;
  try { void (navigator as unknown as { getBattery?: () => Promise<EventTarget & { charging: boolean; level: number }> }).getBattery?.().then(b => { if (S.unhook !== run || !S.started) return; const u = () => { const next = batterySaverOn(b); if (next !== S.battery) { S.battery = next; syncWorld(); if (next) { S.w.flakes.length = 0; } else kick(); } }; b.addEventListener('chargingchange', u); b.addEventListener('levelchange', u); S.unhook.push(() => { b.removeEventListener('chargingchange', u); b.removeEventListener('levelchange', u); }); u(); }).catch(() => undefined); } catch { /* no battery information: it snows as long as the other conditions hold */ }
  onRoot();
}
/** The theme went off: every observer and listener `start` made goes (registrations stay, so turning it on again finds the plates). */
function stop(): void {
  if (!S.started) return; S.started = false;
  S.mo?.disconnect(); S.mo = null; S.ro?.disconnect(); S.ro = null;
  for (const f of S.unhook.splice(0)) { try { f(); } catch { /* gone */ } }
  S.unhook = [];
}

/* ---------- the pointer: parts the flakes, brushes the snow ---------- */
function onPointer(e: PointerEvent): void {
  if (!S.cfg.on) return;
  // the frost clears where the pointer rests (the plate it is over; noel.css grows the clear circle on :hover)
  const host = (e.target as Element | null)?.closest?.('[data-noel-host]') as HTMLElement | null;
  if (host) { const r = host.getBoundingClientRect(); host.style.setProperty('--noel-mx', `${(e.clientX - r.left).toFixed(1)}px`); host.style.setProperty('--noel-my', `${(e.clientY - r.top).toFixed(1)}px`); }
  // the event's own time (the hardware's), not the moment this runs: a busy page must not read a quick stroke as a slow one
  const now = e.timeStamp > 0 ? e.timeStamp : performance.now(), dt = Math.max(8, now - S.last.t), px = S.last.x, vx = (e.clientX - S.last.x) / dt * 1000, vy = (e.clientY - S.last.y) / dt * 1000;
  const had = S.last.t > 0 && now - S.last.t < 120; S.last = { x: e.clientX, y: e.clientY, t: now };
  // the cushions on tabs, the address field and New Tab's search box: a quick sideways sweep brushes the snow off (a slow pass does nothing)
  if (!S.dragging && had && Math.abs(vx) > 420 && Math.abs(vy) < Math.abs(vx) * .7) {
    for (const id of IDS) {
      const slot = S.slots[id], le = slot.ledge; if (!le) continue;
      for (const t of slot.targets) {
        if (!t.canvas.isConnected) continue; const r = t.canvas.getBoundingClientRect(); if (r.width < 8) continue;
        const top = r.top + viewOf(le, t).y;
        if (e.clientY > top - 9 && e.clientY < top + 6 && e.clientX > r.left - 6 && e.clientX < r.right + 6) {
          // the brush covers the whole path since the last pointer event, every 4 px, so one stroke does the same however often the mouse reports
          const from = px > -900 ? px : e.clientX, steps = Math.max(1, Math.ceil(Math.abs(e.clientX - from) / 4)), p = S.w.placed[id];
          for (let j = 1; j <= steps; j++) brushAt(S.w, p, le, from + (e.clientX - from) * j / steps - r.left, vx, now);
          le.dirty = true; S.settling = true; kick(); break;
        }
      }
    }
  }
  // flakes part around the pointer, inside the sidebar, while it snows
  const sb = S.sidebar; if (sb && eligible() && !resting() && S.w.flakes.length) { const r = sb.aside.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right) disturb(S.w, e.clientX - r.left, e.clientY - r.top, vx, vy); }
}
function stepSweep(now: number): void {
  const sw = S.sweep; if (!sw) return; const slot = S.slots[sw.id], e = slot.ledge; if (!e) { S.sweep = null; return; }
  const t = (now - sw.t0) / sw.dur; if (t >= 1) { S.sweep = null; return; }
  const xa = e.x0 - 12, xb = e.x1 + 12; brushAt(S.w, S.w.placed[sw.id], e, xa + (xb - xa) * t, (xb - xa) / sw.dur * 1000, now);
}

/* ---------- what the rest of the browser says ---------- */
/** The tree's press: shake the globe. With no snowfall (or no way to snow) the press only returns false: the caller glints the star. */
export function shake(): boolean {
  if (!S.cfg.on || !eligible()) return false; const now = performance.now();
  S.idle = false; syncWorld(); ensureDrift();
  S.w.rampT0 = now; startFlurry(S.w, now); kick(); return true;
}
/** "Shake the globe" (the tree's menu): the stronger shake (engine.ts shakeGlobe). The tree's own press stays `shake` above. */
export function shakeGlobe(): boolean {
  if (!S.cfg.on || !eligible()) return false; const now = performance.now();
  S.idle = false; syncWorld(); ensureDrift(); S.w.placed = placedNow();
  S.w.rampT0 = now; globeShake(S.w, now);
  for (const id of IDS) if (S.slots[id].ledge) drawLedge(id);
  if (S.w.drift) drawDriftPicture();
  kick(); return true;
}
/** Brush the snow off the selected tab (the tree's menu): one smooth stroke across it in half a second. */
export function brushOff(id: LedgeId = 'sel'): void { if (!S.slots[id].ledge) return; S.sweep = { id, t0: performance.now(), dur: 500 }; kick(); }
/** The selected tab closed: its snow drops as two to four clumps. */
export function dropSelected(): void { const e = S.slots.sel.ledge; if (!e) return; S.w.placed = placedNow(); dropAll(S.w, S.w.placed.sel, e, performance.now()); drawLedge('sel'); S.settling = true; kick(); }
/** A plate is on the move (a card gliding to another tab): its position drives the snow's spring. */
export function followPlate(el: HTMLElement, gone?: () => void): () => void { S.follow.set(el, gone); S.w.plate.t = 0; kick(); return () => { S.follow.delete(el); }; }
/** A tab is picked up (its preview now carries the snow): the snow gives a little and a grain or two rolls off an end. */
export function dragStart(): void { if (!S.cfg.on) return; S.dragging = true; S.w.placed = placedNow(); dragLift(S.w); kick(); }
/** It is put down: the snow presses, bounces once and drops a small clump and three grains. */
export function dragEnd(): void { if (!S.cfg.on) return; S.w.placed = placedNow(); dragDrop(S.w); S.dragging = false; kick(); }
export function ledgeOf(id: LedgeId): Ledge | null { return S.slots[id].ledge; }
export const noelMean = (id: LedgeId): number => { const e = S.slots[id].ledge; return e ? meanOf(e) : 0; };
export { deposit };
/** For the rigs: `window.__noel` shows the controller's state (read only use). */
if (typeof window !== 'undefined') (window as unknown as { __noel: unknown }).__noel = { S, noelWorld, shake, shakeGlobe, brushOff };
