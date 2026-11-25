/** The Favorites stack grows into the panel that holds every Favorite, and folds back (Beta 14, L5; the team has not approved this take yet: it is built toward his
 *  description and shown to him as a video, see the design notes).
 *
 *  The description: the panel grows out of the stack; THE EXPANSION LEADS and the icons travel inside it, never ahead of its edge. While it grows and shrinks it has no boxy
 *  outline: its edge is soft, and it becomes crisp only when it settles. As that soft edge reaches each Favorite already on screen, that tile disperses, starting from the side
 *  the edge reaches first, and the panel forms out of it, smooth and in the character of our blur-and-fade (never grain, particles, clouds or smoke). The icons arriving inside
 *  get their own soft, staggered entrance. Unhurried at Premium (880 ms), proportionally quicker at Fast (x0.6). Closing is the exact reverse. No dark fringe or chopped square
 *  edge at any frame, and no colour jump when it settles (the surface is the same live token while it moves and when it rests).
 *
 *  One clock (a WAAPI animation on the panel, so a script can pause it at any frame) drives one front: a rectangle growing from the stack's plates to the panel's box plus one band.
 *  Three things read that front each frame:
 *   - the real Favorites (the grid) are cut by it, with a 2px ramp: outside it they are themselves, sharp;
 *   - the disperser (favoritesDisperse.ts, one WebGL quad under the material) draws them inside it, smeared along the direction of travel and thinning across a band `BAND` px deep,
 *     so each tile goes from the side the front meets first to the side it meets last. If it cannot run (or drops out half way) the Favorites take the plain blur-and-fade instead;
 *   - the material condenses over the same band (a CSS mask that rises from -SOFT px outside the front to full at BAND px inside).
 *  The panel's own tiles arrive once the material is whole under them, condensing out of the menus' fixed-blur copy and settling along the direction of travel. The stacked icons
 *  travel from the stack to their tiles. The close runs the same front backwards. */
import { formationEase } from '../../ui/sheetFormation';
import { createDisperser, type Disperser, type Front } from './favoritesDisperse';
const MENU = 'cubic-bezier(.16,1,.3,1)', EXIT = 'cubic-bezier(.4,0,1,1)', INOUT = 'cubic-bezier(.4,0,.2,1)', HERO = 'cubic-bezier(.2,.7,.2,1)';
/** the menus' haze: a copy with this fixed blur, starting at this opacity */
const HAZE_BLUR = 4, HAZE_START = 0.85;
export interface MorphParts { panel: HTMLElement; shade: HTMLElement; stack: HTMLElement; grid: HTMLElement; flyIds: string[]; pace: number; reduced: boolean }
type Box = Front;
/** Timing at Premium (pace 1): the front travels in OPEN_MS (2 x 440ms) on OPEN_CURVE; the close is quicker and leaves the front's own way back. */
export const OPEN_MS = 880, CLOSE_MS = 560;
const BAND = 36, SOFT = 16, ARRIVE = 560;
/** The share of the close the plates are on their way (the sample's rule, favoritesStack.ts r5 closeMorph): they have landed on the real stack's place 50ms before the end and hold there (a settled stack, not a moving one, is what is swapped). */
const landShare = (d: number, pace: number) => Math.max(0.8, 1 - 50 * pace / d);
const OPEN_CURVE: [number, number, number, number] = [0.4, 0.14, 0.22, 1], CLOSE_CURVE: [number, number, number, number] = [0.4, 0, 0.25, 1];
type Shape = (ms: number, pace: number) => number;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const openE: Shape = (ms, pace) => formationEase(clamp(ms / (OPEN_MS * pace)), OPEN_CURVE);
const closeE: Shape = (ms, pace) => 1 - formationEase(clamp(ms / (CLOSE_MS * pace)), CLOSE_CURVE);
let seen: Map<Element, { r: DOMRect; w: number; h: number; dim: string; bg: string; shadow: string }> | null = null;
const facts = (el: Element) => { const known = seen?.get(el); if (known) return known; const node = el as HTMLElement, style = getComputedStyle(node), value = { r: el.getBoundingClientRect(), w: node.offsetWidth || 0, h: node.offsetHeight || 0, dim: style.getPropertyValue('--dim'), bg: style.backgroundColor, shadow: style.boxShadow }; seen?.set(el, value); return value; };
const rect = (el: Element) => facts(el).r;
function measureAll(panel: HTMLElement, stack: HTMLElement, grid: HTMLElement) {
  seen = new Map();
  for (const el of [panel, stack, grid, ...stack.querySelectorAll('.sb-plate'), ...stack.querySelectorAll('.sb-plate>*'), ...grid.querySelectorAll(':scope>.sb-app'), ...grid.querySelectorAll(':scope>.sb-app>*'), ...panel.querySelectorAll('.sb-apps-panel-grid>.sb-app'), ...panel.querySelectorAll('.sb-apps-panel-grid>.sb-app>*')]) facts(el);
}
const box = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
const mix = (a: Box, b: Box, k: number): Box => ({ l: a.l + (b.l - a.l) * k, t: a.t + (b.t - a.t) * k, r: a.r + (b.r - a.r) * k, b: a.b + (b.b - a.b) * k });
const grow = (a: Box, by: number): Box => ({ l: a.l - by, t: a.t - by, r: a.r + by, b: a.b + by });
const iconOf = (tile: Element) => tile.querySelector<HTMLElement>(':scope>img,:scope>svg,:scope>.sb-app-initial') || (tile.firstElementChild as HTMLElement | null);
const fromTo = (a: DOMRect, b: DOMRect) => `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px,${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})`;
/** signed distance to the front's boundary, positive inside */
const depthIn = (f: Box, x: number, y: number) => { const cx = (f.l + f.r) / 2, cy = (f.t + f.b) / 2, hx = Math.max(0, (f.r - f.l) / 2), hy = Math.max(0, (f.b - f.t) / 2), qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy; return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)); };
/** the band is never deeper than about half the front, so the very first frames are not all soft edge */
const bandOf = (f: Box, band: number) => Math.min(band, 0.5 * Math.min(f.r - f.l, f.b - f.t));
const frontAt = (shape: Shape, S: Box, E: Box, ms: number, pace: number) => mix(S, E, shape(ms, pace));
/** When a point first lies `share` of the band deep inside the front (open), or last does (close). */
function crossing(shape: Shape, S: Box, E: Box, band: number, x: number, y: number, pace: number, total: number, share: number, opening: boolean) {
  for (let ms = 0; ms <= total; ms += 4) {
    const f = frontAt(shape, S, E, ms, pace), deep = depthIn(f, x, y) >= bandOf(f, band) * share;
    if (deep !== !opening) return ms;
  }
  return total;
}
const platesBox = (stack: HTMLElement): Box => { let b: Box | null = null; for (const p of stack.querySelectorAll('.sb-plate')) { const r = rect(p); b = b ? { l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) } : box(r); } return b || box(rect(stack)); };

/** Test seam (a capture rig that scrubs the clock frame by frame): while set, the safety timers that finish a motion by time stay out of the way. Never set by the app. */
export const holdMotion = () => !!(globalThis as { __aciraFavoritesHold?: boolean }).__aciraFavoritesHold;
/** Drives the masks and the disperser off the clock until the clock ends (or is cancelled). The returned stop is idempotent and always leaves the canvas out of the tree. */
let stopShape: (() => void) | null = null;
function runShape(panel: HTMLElement, grid: HTMLElement, clock: Animation, shape: Shape, S: Box, E: Box, band: number, pace: number, disperser: Disperser | null, hold = false, releaseAt = Infinity, tick?: (ms: number) => void) {
  stopShape?.();
  const P = box(rect(panel)), zoom = facts(panel).w ? (P.r - P.l) / facts(panel).w : 1;
  let raf = 0, done = false;
  const G = box(rect(grid));
  // The front's variables are written on the three layers that read them (the material, the plates' layer, the scroller), not on the panel: favorites-stack.css registers them as not
  // inherited, so a write restyles those layers and not the ~220 elements of the panel's subtree, once a frame for the whole motion (the style work of a Favorites open was ~290 ms, 260 of it this)
  const surface = panel.querySelector<HTMLElement>(':scope>.sb-apps-panel-surface'), scroller = panel.querySelector<HTMLElement>(':scope>.sb-apps-panel-scroll');
  const readers = () => [surface, panel.querySelector<HTMLElement>(':scope>.sb-flight'), scroller].filter((el): el is HTMLElement => !!el);
  panel.setAttribute('data-forming', ''); grid.setAttribute('data-forming-hole', '');
  const stop = () => {
    if (done) return; done = true; cancelAnimationFrame(raf); window.clearTimeout(watchdog);
    // open: the material is whole and the copy draws nothing by now, so these are no-ops on screen. The grid's hole stays (the Favorites under the open panel stay hidden; a
    // translucent material would otherwise show them appear at the very end): the close lifts it.
    if (!hold) { panel.removeAttribute('data-forming'); for (const el of readers()) for (const name of ['--ml', '--mt', '--mr', '--mb', '--mo', '--mi', '--sml', '--smt', '--smr', '--smb']) el.style.removeProperty(name); }
    // the canvas leaves the tree the moment the motion ends, open or close
    disperser?.destroy(); for (const c of panel.querySelectorAll(':scope>.sb-disperse')) c.remove();
    if (stopShape === stop) stopShape = null;
  };
  const set = (el: HTMLElement, name: string, v: number) => el.style.setProperty(name, `${(v / zoom).toFixed(2)}px`);
  const final = () => { const f = frontAt(shape, S, E, 1e9, pace); set(grid, '--gl', f.l - G.l); set(grid, '--gt', f.t - G.t); set(grid, '--gr', G.r - f.r); set(grid, '--gb', G.b - f.b); stop(); };
  const frame = () => {
    if (done) return;
    // a clock that ended (or was finished early) still gets its final front, so the hole and masks always end where the motion ends
    if (clock.playState === 'finished') { final(); return; }
    if (clock.playState === 'idle') { stop(); return; }
    const ms = Number(clock.currentTime) || 0, f = frontAt(shape, S, E, ms, pace), w = bandOf(f, band);
    // close: once the front is back on the stack, the hole lets go, so the real stack can come in under its copies
    grid.toggleAttribute('data-forming-hole', ms < releaseAt);
    const mo = SOFT * zoom * (w / band), flight = panel.querySelector<HTMLElement>(':scope>.sb-flight');
    for (const el of [surface, flight]) if (el) { set(el, '--ml', f.l - P.l); set(el, '--mt', f.t - P.t); set(el, '--mr', P.r - f.r); set(el, '--mb', P.b - f.b); set(el, '--mi', w); set(el, '--mo', mo); }
    if (scroller) { set(scroller, '--sml', f.l - P.l - 6 * zoom); set(scroller, '--smt', f.t - P.t - 6 * zoom); set(scroller, '--smr', P.r - f.r - 6 * zoom); set(scroller, '--smb', P.b - f.b - 6 * zoom); set(scroller, '--mi', w); set(scroller, '--mo', mo); }
    set(grid, '--gl', f.l - G.l); set(grid, '--gt', f.t - G.t); set(grid, '--gr', G.r - f.r); set(grid, '--gb', G.b - f.b);
    disperser?.draw(f, w, Math.min(18 * zoom, 0.5 * Math.min(f.r - f.l, f.b - f.t)));
    tick?.(ms);
    raf = requestAnimationFrame(frame);
  };
  // a hidden or throttled window runs no frames, but the clock still ends: finish there too (final front, canvas gone). The watchdog covers a clock that never ends.
  const total = (clock.effect?.getTiming().duration as number | undefined) ?? 1000;
  const watchdog = window.setTimeout(() => { if (!done && !holdMotion()) final(); }, total + 600);
  stopShape = stop; frame();
  clock.finished.then(() => { if (!done) frame(); }, () => stop());
  return stop;
}
/** The menus' haze row: a still copy of an element with a fixed blur, laid exactly over it in the panel's haze layer over its tiles. Only its opacity and transform move. */
function hazeLayer(panel: HTMLElement) {
  let layer = panel.querySelector<HTMLElement>(':scope>.sb-haze-over');
  if (!layer) { layer = document.createElement('div'); layer.className = 'sb-haze sb-haze-over'; layer.setAttribute('aria-hidden', 'true'); layer.inert = true; layer.style.filter = `blur(${HAZE_BLUR}px)`; panel.appendChild(layer); }
  return layer;
}
function hazeOf(panel: HTMLElement, tile: HTMLElement) {
  const el = iconOf(tile) || tile, layer = hazeLayer(panel), P = rect(panel), r = rect(el), zoom = facts(panel).w ? P.width / facts(panel).w : 1, copy = el.cloneNode(true) as HTMLElement;
  for (const name of ['data-app-id', 'aria-label', 'title', 'tabindex', 'draggable', 'data-drop']) copy.removeAttribute(name);
  copy.setAttribute('tabindex', '-1');
  Object.assign(copy.style, { position: 'absolute', left: `${(r.left - P.left) / zoom}px`, top: `${(r.top - P.top) / zoom}px`, width: `${r.width / zoom}px`, height: `${r.height / zoom}px`, margin: '0', objectFit: 'contain', opacity: '0', pointerEvents: 'none' });
  layer.appendChild(copy); return copy;
}
const clearHaze = (panel: HTMLElement) => { for (const layer of panel.querySelectorAll(':scope>.sb-haze,:scope>.sb-disperse,:scope>.sb-flight')) layer.remove(); };
/** The stand-in for the real stack while its plates travel (Beta 14, L5): a copy of the stack BUTTON (its classes, its selected state, its site colour) with a copy of the stack inside, laid
 *  over the panel at the real button's exact box. The copy has the same markup, the same stylesheet rules and the same snapped variables as the real stack, in the same place, so a copy at rest
 *  and the real stack are the same picture to the pixel: the hand-over between them (the real stack is hidden while the copy is out, and swapped for it in one frame) changes nothing. Each layer
 *  of the copy wears the pose the real one has now (a fanned stack under the pointer stays fanned). Only the PLATES move (their own `translate`, `scale` and `opacity`), never the layers
 *  that carry the stack's own transforms, so at the end of a flight the plate's styles are the real plate's. */
function stackGhost(panel: HTMLElement, button: HTMLElement) {
  const P = rect(panel), B = rect(button), zoom = facts(panel).w ? P.width / facts(panel).w : 1;
  const copy = button.cloneNode(false) as HTMLElement;
  for (const name of ['data-folded', 'data-stack-count', 'aria-label', 'title', 'tabindex', 'aria-haspopup', 'aria-expanded', 'data-opener', 'data-drop-over', 'type']) copy.removeAttribute(name);
  copy.setAttribute('aria-hidden', 'true'); copy.inert = true; copy.classList.add('sb-stack-ghost');
  const real = button.querySelector<HTMLElement>('.sb-stack');
  if (real) {
    const inner = real.cloneNode(true) as HTMLElement, from = [...real.querySelectorAll<HTMLElement>('.sb-stack-i')], to = [...inner.querySelectorAll<HTMLElement>('.sb-stack-i')];
    to.forEach((layer, i) => { const pose = from[i] ? getComputedStyle(from[i]).transform : 'none'; layer.style.transition = 'none'; layer.style.transform = pose; });
    copy.appendChild(inner);
  }
  Object.assign(copy.style, { position: 'absolute', left: `${(B.left - P.left) / zoom}px`, top: `${(B.top - P.top) / zoom}px`, width: `${B.width / zoom}px`, height: `${B.height / zoom}px`, margin: '0', opacity: '1', pointerEvents: 'none' });
  flightLayer(panel).appendChild(copy);
  // The copy's box is the real one's to within the engine's layout precision (a sixty-fourth of a px, then the zoom): at 125% or 150% that is a hair of a device pixel, and a hair is enough to draw the
  // edges of a plate a few levels differently. So the copy's own snap offset is set until its stack lies exactly where the real one does (the same transformed box, to the float).
  const realStack = button.querySelector<HTMLElement>('.sb-stack'), copyStack = copy.querySelector<HTMLElement>('.sb-stack');
  if (realStack && copyStack) for (let pass = 0; pass < 2; pass++) {
    const a = realStack.getBoundingClientRect(), b = copyStack.getBoundingClientRect(), dx = (a.left - b.left) / zoom, dy = (a.top - b.top) / zoom;
    if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) break;
    for (const [name, delta] of [['--sfx', dx], ['--sfy', dy]] as const) copyStack.style.setProperty(name, `${(parseFloat(copyStack.style.getPropertyValue(name)) || 0) + delta}px`);
  }
  return { root: copy, plates: [...copy.querySelectorAll<HTMLElement>('.sb-plate')], zoom };
}
/** The stacked plates travel in a layer cut by the same soft front as the material: they never show ahead of the panel's edge. */
function flightLayer(panel: HTMLElement) { let layer = panel.querySelector<HTMLElement>(':scope>.sb-flight'); if (!layer) { layer = document.createElement('div'); layer.className = 'sb-flight'; layer.setAttribute('aria-hidden', 'true'); panel.appendChild(layer); } return layer; }
/** An element's own opacity at rest (a dimmed icon of a Favorite that sleeps in the background, the scroll indicator that rests hidden): what an animation of it has to end on, and start from, to leave no step. */
const restOf = (el: Element) => { const v = parseFloat(getComputedStyle(el).opacity); return Number.isFinite(v) ? v : 1; };
const tilesOf = (grid: HTMLElement, stack: HTMLElement) => [...grid.querySelectorAll<HTMLElement>(':scope>.sb-app')].filter(el => el !== stack && el.hasAttribute('data-app-id'));

export function openMorph({ panel, shade, stack, grid, flyIds, pace, reduced }: MorphParts): Animation[] {
  releaseFan(stack);
  snapStack(stack);
  measureAll(panel, stack, grid);
  const list: Animation[] = [], P = rect(panel), S = rect(stack), under = tilesOf(grid, stack);
  if (reduced) {
    // Reduce motion: one plain quick fade, the stack and the Favorites under the panel fade out as it fades in
    list.push(panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: HERO, fill: 'backwards' }), shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'backwards' }));
    list.push(stack.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }));
    for (const el of under) list.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }));
    seen = null;
    return list;
  }
  clearHaze(panel);
  const zoom = facts(panel).w ? P.width / facts(panel).w : 1, band = BAND * zoom, total = OPEN_MS * pace;
  const ox = S.left + S.width / 2, oy = S.top + S.height / 2;
  // the front starts as the stack's own plates and ends one band past the panel's box, so everything inside has fully condensed
  const from = platesBox(stack), to = grow(box(P), band);
  const plates = flyIds.map((_, depth) => stack.querySelector<HTMLElement>(`[data-depth="${depth}"]>.sb-plate`));
  const hand = stackGhost(panel, stack), ghosts = plates.map((_, depth) => hand.plates[depth] ?? null);
  // a stack with the keyboard on it wears its focus ring: the copy wears it too and lets it go over the first stretch (focus moves into the panel), instead of it vanishing with the real stack
  if (stack.matches(':focus-visible')) { hand.root.setAttribute('data-ring', ''); list.push(hand.root.animate([{ outlineColor: 'var(--sb-ring)' }, { outlineColor: 'transparent' }], { duration: 160 * pace, easing: 'linear', fill: 'forwards' })); }
  let disperser: Disperser | null = null;
  // fail safe: without the WebGL pass (or if it drops out mid-way) the Favorites under the front take the plain blur-and-fade instead
  let plain = false, clock: Animation | null = null;
  const fallback = () => { if (plain) return; plain = true; for (const el of under) list.push(el.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: `blur(${HAZE_BLUR}px)` }], { duration: Math.max(120, total * 0.45 - (Number(clock?.currentTime) || 0)), easing: HERO, fill: 'forwards' })); };
  try { disperser = createDisperser(panel, under, { x: ox, y: oy }, () => { disperser = null; fallback(); }); if (!disperser.ok) { disperser.destroy(); disperser = null; } } catch (error) { console.warn('[favorites] disperser', error); disperser = null; }
  stack.style.opacity = '0';
  clock = motionClock(shade, total + 40 * pace); list.push(clock);
  if (!disperser) fallback();
  // The motion's layers go when they have nothing more to draw, on the motion's own clock, not with the last icon's arrival: the copy of the stack once its last plate is gone (invisible by 45% of its
  // flight), the WebGL canvas once the front has passed the last Favorite. A layer left over the panel for the last stretch makes the engine draw what is under it a few levels differently at
  // 125% and 150% (measured), which would be a change when it goes at the end.
  const flightEnd = (90 + (flyIds.length - 1) * 40) * pace + OPEN_MS * 0.8 * pace;
  const disperseEnd = Math.min(total, Math.max(0, ...under.map(el => { const r = rect(el); return crossing(openE, from, to, band, r.left + r.width / 2, r.top + r.height / 2, pace, total, 1, true); })) + 60 * pace);
  runShape(panel, grid, clock, openE, from, to, band, pace, { draw: (...a) => disperser?.draw(...a), destroy: () => disperser?.destroy(), ok: true }, false, Infinity, ms => {
    if (ms >= flightEnd) for (const layer of panel.querySelectorAll(':scope>.sb-flight')) layer.remove();
    if (disperser && ms >= disperseEnd) { disperser.destroy(); disperser = null; }
  });
  // the shadow (the panel's one edge) only comes with the panel's last stretch, once there is a panel to cast it: while it moves, the panel has no outline
  list.push(shade.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: total + 160 * pace, easing: 'linear', fill: 'backwards' }));
  // the material rises from nothing over the first 120 ms: the front starts as the plates' own box and its soft outer edge reaches a few px past them, a halo that would stand on the very first frame
  // (the picture just before the click had none)
  const material = panel.querySelector<HTMLElement>('.sb-apps-panel-surface');
  if (material) list.push(material.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 * pace, easing: 'linear', fill: 'backwards' }));
  // the expansion leads: the stacked icons leave a beat after the front, on the front's own curve, and are cut by it (the scroller and the flight layer carry the front's mask
  // while it moves), so they travel inside the panel and never ahead of its edge
  const tiles = [...panel.querySelectorAll<HTMLElement>('.sb-apps-panel-grid>.sb-app')], flight = OPEN_MS * 0.8 * pace, FOLLOW = 'cubic-bezier(.4,.14,.22,1)';
  // the panel's view: the rows the scroller shows. A tile scrolled out of it has nothing to arrive into (E4, the team's notes 17 Nov): its haze copy is laid in the panel's own layer, which does not clip, so it
  // showed as a blurred dot below (or above) the panel for 560 ms. Those tiles get no arrival and no copy; they are drawn as they are when the person scrolls to them.
  const scroller = panel.querySelector<HTMLElement>(':scope>.sb-apps-panel-scroll'), view = scroller ? rect(scroller) : null;
  for (const tile of tiles) {
    const id = tile.dataset.appId || '', depth = flyIds.indexOf(id), r = rect(tile);
    if (depth >= 0) {
      const icon = iconOf(tile), plate = plates[depth], g = ghosts[depth], delay = (90 + depth * 40) * pace;
      if (icon && plate && g) {
        const I = rect(icon), pr = rect(plate), dx = (I.left + I.width / 2 - (pr.left + pr.width / 2)) / hand.zoom, dy = (I.top + I.height / 2 - (pr.top + pr.height / 2)) / hand.zoom;
        // the copy's plate moves by its own translate and scale (centred on itself); until its turn (the delay) it is not animated at all, so it is the real plate's picture
        const ride = g.animate([{ translate: '0px 0px', scale: '1' }, { translate: `${dx}px ${dy}px`, scale: String(I.width / pr.width * 1.1) }], { duration: flight, delay, easing: FOLLOW, fill: 'forwards' });
        list.push(g.animate([{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], { duration: flight, delay, easing: 'linear', fill: 'forwards' }));
        list.push(ride);
        const mark = plate.querySelector('img,svg,.sb-app-initial') || plate;
        list.push(icon.animate([{ transform: fromTo(rect(mark), I) }, { transform: 'none' }], { duration: flight, delay, easing: FOLLOW, fill: 'backwards' }));
        // every plate copy carries its mark; the real icon takes over from it on the way (the copy is gone by 45%)
        const rest = restOf(icon); list.push(icon.animate([{ opacity: 0 }, { opacity: rest, offset: 0.35 }, { opacity: rest }], { duration: flight, delay, easing: 'linear', fill: 'backwards' }));
      }
      list.push(tile.animate([{ backgroundColor: 'transparent', offset: 0 }], { duration: 320 * pace, delay: delay + 220 * pace, easing: HERO, fill: 'backwards' }));   // the end is the tile's own colour (no keyframe: a read-back string is rounded and made the fill 1 to 2 levels off)
      // a keyboard open puts the focus on the first folded Favorite (FavoritesPanel.tsx): its ring comes in with its tile, not ahead of it
      if (depth === 0 && stack.dataset.opener === 'key') list.push(tile.animate([{ outlineColor: 'transparent' }, { outlineColor: 'var(--sb-ring)' }], { duration: 320 * pace, delay: delay + 220 * pace, easing: HERO, fill: 'backwards' }));
      continue;
    }
    if (view && (r.bottom <= view.top || r.top >= view.bottom || r.right <= view.left || r.left >= view.right)) continue;
    // the icons arrive once the material is whole under them: condensing out of the menus' fixed-blur copy, settling 5px along the direction of travel and growing from .9, the
    // order set by the front itself
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, len = Math.hypot(cx - ox, cy - oy) || 1;
    const lift = `translate(${(ox - cx) / len * 5}px,${(oy - cy) / len * 5}px) scale(.9)`, delay = crossing(openE, from, to, band, cx, cy, pace, total, 1, true) + 60 * pace, duration = ARRIVE * pace;
    const copy = hazeOf(panel, tile);
    list.push(tile.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration, delay, easing: HERO, fill: 'backwards' }));
    list.push(tile.animate([{ transform: lift }, { transform: 'none' }], { duration, delay, easing: MENU, fill: 'backwards' }));
    list.push(copy.animate([{ opacity: 0, transform: lift }, { opacity: HAZE_START, offset: 0.16 }, { opacity: 0, transform: 'none' }], { duration, delay, easing: MENU, fill: 'both' }));
  }
  // the fold pill comes with the panel's last stretch and leaves first
  for (const el of panel.querySelectorAll<HTMLElement>('[data-panel-chrome]')) list.push(el.animate([{ opacity: 0 }, { opacity: restOf(el) }], { duration: 220 * pace, delay: total * 0.8, easing: HERO, fill: 'backwards' }));
  Promise.all(list.map(animation => animation.finished)).then(() => clearHaze(panel), () => {});
  seen = null;
  return list;
}

/** The panel as the open leaves it, with no motion: for a panel that is already open when its sidebar is drawn again (a workspace switch, Favorites moving between the top and the bottom, a mode change; E6, the extras stay open).
 *  It is what runShape's `final()` and openMorph leave behind: the stack hidden, and the real Favorites under the panel cut out by the final front (the panel's box and one band), which the close lifts. */
export function settleOpen({ panel, stack, grid }: { panel: HTMLElement; stack: HTMLElement; grid: HTMLElement }) {
  releaseFan(stack);
  snapStack(stack);
  const P = panel.getBoundingClientRect(), G = grid.getBoundingClientRect(), zoom = panel.offsetWidth ? P.width / panel.offsetWidth : 1, band = BAND * zoom;
  const set = (name: string, v: number) => grid.style.setProperty(name, `${(v / zoom).toFixed(2)}px`);
  set('--gl', P.left - band - G.left); set('--gt', P.top - band - G.top); set('--gr', G.right - (P.right + band)); set('--gb', G.bottom - (P.bottom + band));
  grid.setAttribute('data-forming-hole', '');
  stack.style.opacity = '0';
}

export function closeMorph({ panel, shade, stack, grid, flyIds, pace, reduced }: MorphParts): Animation[] {
  const list: Animation[] = [], under = tilesOf(grid, stack);
  stopShape?.();
  for (const a of grid.getAnimations({ subtree: true })) a.cancel();
  for (const a of panel.getAnimations({ subtree: true })) a.cancel();
  for (const g of panel.querySelectorAll('.sb-stack-ghost')) g.remove();
  clearHaze(panel);
  // the grid's own tiles are measured and painted as they are at rest (the hole and its variables are off by now)
  grid.removeAttribute('data-forming-hole');
  snapStack(stack);
  measureAll(panel, stack, grid);
  const P = rect(panel), S = rect(stack), d = (reduced ? 100 : CLOSE_MS) * pace;
  if (reduced) {
    list.push(panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, fill: 'forwards' }), shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, fill: 'forwards' }));
    for (const el of under) list.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d, fill: 'backwards' }));
    stack.style.opacity = '0';
    list.push(stack.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 30, delay: Math.max(0, d - 30), fill: 'forwards' }));
    window.setTimeout(() => rowsHome(panel), d * 0.5);
  } else {
    const zoom = facts(panel).w ? P.width / facts(panel).w : 1, band = BAND * zoom, home = platesBox(stack), from = grow(box(P), band);
    const ox = S.left + S.width / 2, oy = S.top + S.height / 2;
    let disperser: Disperser | null = null;
    try { disperser = createDisperser(panel, under, { x: ox, y: oy }); if (!disperser.ok) { disperser.destroy(); disperser = null; } } catch { disperser = null; }
    // The plates fly home on a copy of the stack (stackGhost), and LAND by `land`: from then on the copy is the real stack's picture, not moving, until the motion ends and it is swapped for the real stack
    // in one frame (settleFavorites). There is no cross-fade between the two (two copies of an anti-aliased edge drawn over each other are not the edge of one), and nothing moves at the swap.
    const share = landShare(d, pace), land = d * share, hand = stackGhost(panel, stack), realPlates = flyIds.map((_, depth) => stack.querySelector<HTMLElement>(`[data-depth="${depth}"]>.sb-plate`));
    // a keyboard close (Esc: FavoritesPanel marks the stack data-refocus, and gives it the focus in the frame of the swap) brings the focus ring with it: the copy has the ring come in as the plates land, so the swap does not add it
    if (stack.hasAttribute('data-refocus')) { hand.root.setAttribute('data-ring', ''); list.push(hand.root.animate([{ outlineColor: 'transparent' }, { outlineColor: 'transparent', offset: 0.55 }, { outlineColor: 'var(--sb-ring)' }], { duration: land, easing: 'linear', fill: 'backwards' })); }
    hand.plates.forEach((g, depth) => { if (!flyIds[depth] || !panel.querySelector(`.sb-apps-panel-grid>[data-app-id="${CSS.escape(flyIds[depth])}"]`)) list.push(g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: land, easing: 'linear', fill: 'backwards' })); });
    // the panel's tiles leave first (the menus' exit: opacity and a hair of scale, never a blur)
    for (const tile of panel.querySelectorAll<HTMLElement>('.sb-apps-panel-grid>.sb-app')) {
      const depth = flyIds.indexOf(tile.dataset.appId || '');
      if (depth >= 0) {
        const icon = iconOf(tile), plate = realPlates[depth], g = hand.plates[depth];
        if (icon && plate && g) {
          const I = rect(icon), pr = rect(plate), dx = (I.left + I.width / 2 - (pr.left + pr.width / 2)) / hand.zoom, dy = (I.top + I.height / 2 - (pr.top + pr.height / 2)) / hand.zoom;
          list.push(g.animate([{ translate: `${dx}px ${dy}px`, scale: String(I.width / pr.width * 1.1) }, { translate: '0px 0px', scale: '1' }], { duration: land, easing: INOUT, fill: 'backwards' }));
          list.push(g.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 / share }, { opacity: 1, offset: 0.65 / share }, { opacity: 1 }], { duration: land, easing: 'linear', fill: 'backwards' }));
          const mark = plate.querySelector('img,svg,.sb-app-initial') || plate;
          const rest = restOf(icon), away = fromTo(rect(mark), I);
          list.push(icon.animate([{ transform: 'none', easing: INOUT }, { transform: away, offset: share }, { transform: away }], { duration: d, fill: 'forwards' }));
          list.push(icon.animate([{ opacity: rest }, { opacity: rest, offset: 0.7 * share }, { opacity: 0, offset: share }, { opacity: 0 }], { duration: d, fill: 'forwards' }));   // the sample starts from 1: from the icon's own opacity, so a dimmed one does not flash
        }
        list.push(tile.animate([{ backgroundColor: 'transparent' }], { duration: 120 * pace, fill: 'forwards' }));
        // the current Favorite's ring goes with its tile (it stayed on the panel until the swap, over the grid tile that re-forms in its slot: the highlight read as left on that slot); the stack's own copy carries it from the first frame
        if (tile.hasAttribute('aria-current')) list.push(tile.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 * pace, fill: 'forwards', pseudoElement: '::before' }));   // from the tile's own colour (no keyframe), not a rounded read-back of it
        // the tile that has the keyboard (a keyboard open focused it) lets its ring go with its background, not at the swap
        if (tile.matches(':focus-visible')) list.push(tile.animate([{ outlineColor: 'var(--sb-ring)' }, { outlineColor: 'transparent' }], { duration: 120 * pace, fill: 'forwards' }));
      } else list.push(tile.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 270 * pace, delay: 90 * pace, easing: 'linear', fill: 'both' }));   // 14.0.1: the panel's other tiles stay until the Favorites re-form under them (they were gone by 180ms, the grid was back by 330: about 15 frames of an almost empty panel), so the two cross over
    }
    const clock = motionClock(shade, d, true); list.push(clock);
    // the same front, backwards: the material thins from the far side in, and the Favorites re-form out of it as it leaves them
    panel.setAttribute('data-closing', '');
    // The swap, in one frame, the moment the plates have landed (not when the motion ends): the copy's layer is not left over the Favorites for the last stretch (a layer laid over them makes the engine
    // draw their rounded corners a few levels differently), and the real stack, shown in the same frame, takes the keyboard back if Esc closed the panel (focus ring and fan come with it).
    let swapped = false;
    const swap = () => { if (swapped) return; swapped = true; for (const layer of panel.querySelectorAll(':scope>.sb-flight')) layer.remove(); stack.style.opacity = ''; holdFan(stack); };
    runShape(panel, grid, clock, closeE, home, from, band, pace, disperser, true, d - 100 * pace, ms => { if (ms >= land) swap(); if (ms >= d - 100 * pace) disperser?.destroy(); if (ms >= d * 0.9) rowsHome(panel); });
    // the material's last soft edge round the stack goes with the front, over its last 30%: nothing of the panel is left at the swap
    const surface = panel.querySelector<HTMLElement>('.sb-apps-panel-surface');
    if (surface) list.push(surface.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 * share }, { opacity: 0, offset: share }, { opacity: 0 }], { duration: d, easing: 'linear', fill: 'forwards' }));
    list.push(shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.45, easing: EXIT, fill: 'forwards' }));
    stack.style.opacity = '0';
    // the fold pill leaves first, as it came last
    for (const el of panel.querySelectorAll<HTMLElement>('[data-panel-chrome]')) list.push(el.animate([{ opacity: restOf(el) }, { opacity: 0 }], { duration: 100 * pace, fill: 'forwards' }));
  }
  seen = null;
  return list;
}

/** Everything the morph leaves on the panel's neighbours, put back whatever way the panel went (closed, unmounted, a restart of the open): the grid's cut and its variables, the
 *  stack's opacity, the canvas and the copies. Safe to call at any time. */
export function settleFavorites(grid: HTMLElement | null, stack: HTMLElement | null, panel?: HTMLElement | null) {
  stopShape?.();
  if (grid) { grid.removeAttribute('data-forming-hole'); for (const name of ['--gl', '--gt', '--gr', '--gb']) grid.style.removeProperty(name); for (const a of grid.getAnimations({ subtree: true })) a.cancel(); }
  if (stack) stack.style.opacity = '';
  if (panel) for (const el of panel.querySelectorAll(':scope>.sb-disperse,:scope>.sb-flight,:scope>.sb-haze')) el.remove();
}

/** Where the pointer last was. The panel covers the stack while it is open, so `:hover` cannot say whether the pointer rests over the stack that is about to come back. */
const lastPointer = { x: -1e4, y: -1e4 };
if (typeof window !== 'undefined') for (const type of ['pointermove', 'pointerdown'] as const) window.addEventListener(type, event => { lastPointer.x = event.clientX; lastPointer.y = event.clientY; }, { capture: true, passive: true });
const within = (el: Element, x: number, y: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
const fanHolds = new WeakMap<Element, () => void>();
/** The panel has just folded back into the stack. If the pointer rests where the stack comes back, or the keyboard's focus returns to it, the stack keeps its rest pose and holds its tooltip
 *  (data-no-fan, favorites-stack.css): the fan and the tip would otherwise start the instant the panel goes, a change after the motion has ended. Both wait until the pointer has left the
 *  stack and come back (or the focus has left it). Safe to call more than once. The keyboard's focus, when Esc asked for it (data-refocus), is given back here, after the hold is on. */
export function holdFan(stack: HTMLElement) {
  if (fanHolds.has(stack)) return;
  const refocus = stack.hasAttribute('data-refocus'), onPointer = within(stack, lastPointer.x, lastPointer.y);
  if (!refocus && !onPointer && !stack.matches(':focus-visible')) return;
  stack.setAttribute('data-no-fan', '');
  const title = stack.getAttribute('title'); if (title !== null) stack.removeAttribute('title');
  if (refocus) { stack.removeAttribute('data-refocus'); stack.focus({ preventScroll: true }); }
  let byPointer = onPointer, byFocus = document.activeElement === stack && stack.matches(':focus-visible');
  const lift = () => {
    if (byPointer || byFocus) return;
    window.removeEventListener('pointermove', move, true); stack.removeEventListener('pointerleave', leave); stack.removeEventListener('blur', blur); fanHolds.delete(stack);
    stack.removeAttribute('data-no-fan');
    if (title !== null && !stack.hasAttribute('title') && stack.dataset.tipTitle === undefined) stack.setAttribute('title', title);
  };
  const move = (event: PointerEvent) => { if (byPointer && !within(stack, event.clientX, event.clientY)) { byPointer = false; lift(); } };
  // the pointer leaving for the web page is no pointermove of this document: the stack's own pointerleave says it
  const leave = () => { byPointer = false; lift(); };
  const blur = () => { byFocus = false; lift(); };
  window.addEventListener('pointermove', move, { capture: true, passive: true }); stack.addEventListener('pointerleave', leave); stack.addEventListener('blur', blur);
  fanHolds.set(stack, () => { byPointer = byFocus = false; lift(); });
  lift();
}
/** The hold ends when the panel opens again (the stack is hidden under it then). */
export const releaseFan = (stack: HTMLElement | null) => { if (stack) fanHolds.get(stack)?.(); };

/** The motion's clock: an animation that draws nothing and only keeps time (the front, the swap and the landing follow its currentTime, and its end ends the motion). It animates a custom property of
 *  the shade, a leaf that is not in the panel: an opacity animation on the panel made the panel an isolated group while the motion ran, which changes how the translucent tile fills are
 *  composited (2 to 4 levels over every tile, measured), a step in the first frame of the close that was not there in the open panel. */
function motionClock(on: HTMLElement, duration: number, hold = false) {
  const clock = on.animate([{ '--favorites-clock': 0 }, { '--favorites-clock': 1 }], hold ? { duration, fill: 'forwards' } : { duration });
  clock.id = 'favorites-clock'; return clock;
}
/** The stack's layers sit on whole device pixels. The plates behind step by fractional CSS px (5.25 / 3.25); at 125% or 150% one CSS px is 1.875 or 2.25 device px, so each
 *  layer's edge could round to a different device pixel and the steps look uneven (reported: "one is higher than the other"). Here every step is snapped to a whole number of
 *  device pixels (--ssx / --ssy, read from the stack's own --step-x / --step-y), and the stack itself is moved by the sub-pixel remainder of its box (--sfx / --sfy), so every
 *  plate edge sits on the device grid and every layer is offset from the one in front by the identical number of screen pixels. Re-done on resize, zoom (interface size), display
 *  change and stack changes. */
export function snapStack(button: HTMLElement | null) {
  const stack = button?.querySelector<HTMLElement>('.sb-stack'); if (!stack) return;
  const r = stack.getBoundingClientRect(), z = stack.offsetWidth ? r.width / stack.offsetWidth : 1, dpr = window.devicePixelRatio || 1;
  // the stack box is in zoomed CSS px (r), its own styles in layout px: one layout px = z CSS px = z * dpr device px (Chromium's devicePixelRatio already includes the page zoom)
  const devPerLayout = dpr * z, cs = getComputedStyle(stack);
  const sx = parseFloat(cs.getPropertyValue('--step-x')) || 0, sy = parseFloat(cs.getPropertyValue('--step-y')) || 0;
  const snap = (v: number) => Math.round(v * devPerLayout) / devPerLayout;
  stack.style.setProperty('--ssx', `${snap(sx)}px`); stack.style.setProperty('--ssy', `${snap(sy)}px`);
  // base: measured without the previous correction, then moved onto the grid
  stack.style.setProperty('--sfx', '0px'); stack.style.setProperty('--sfy', '0px');
  const b = stack.getBoundingClientRect(), fx = b.left * dpr - Math.round(b.left * dpr), fy = b.top * dpr - Math.round(b.top * dpr);
  stack.style.setProperty('--sfx', `${-fx / devPerLayout}px`); stack.style.setProperty('--sfy', `${-fy / devPerLayout}px`);
}
/** While the panel is out the sidebar says so with plain attributes (`data-fav-panel` open | closing, `data-fav-bottom`), which favorites-stack.css reads: the rows below move down, the
 *  divider fades, the list is clipped. They replace `:has()` selectors on the whole sidebar, whose matching is style work the sidebar would pay on every change, with or without
 *  Favorites. Returns what takes them off again. */
export function markPanel(from: Element | null, phase: 'open' | 'closing' | null, bottom: boolean) {
  const side = from?.closest('.acira-sidebar'); if (!side) return;
  // Changed in place, never taken off and put back: React runs every effect's cleanup before any effect's setup, so a cleanup that removed the attributes let the closing panel's own
  // measuring (a forced style recalculation, in a child's effect that runs in between) resolve the rows at home with no attribute, and the rows jumped home in one frame at the click.
  // With the attribute changed from `open` to `closing` in place, the rows' translate transition runs.
  if (!phase) { for (const name of ['data-fav-panel', 'data-fav-bottom', 'data-fav-home']) side.removeAttribute(name); return; }
  side.setAttribute('data-fav-panel', phase); side.removeAttribute('data-fav-home'); side.toggleAttribute('data-fav-bottom', bottom);
}
/** The close has brought the rows home (their translate is done): the list's clip, needed only while they are pushed past its edge, goes now and not with the motion's last frame, so nothing about
 *  how the rows are drawn changes when the motion ends (at 125% a clip that came off at the end changed the text edges of a strip of the list by up to 8/255). */
const rowsHome = (panel: Element) => { panel.closest('.acira-sidebar')?.setAttribute('data-fav-home', ''); };
/** The Sidebar mode morph and a drag on the sidebar's edge move the sidebar on every frame: nothing to snap until they end (the same rule as the toolbar's overflow measuring). */
const MOVING = ['data-sm-morph', 'data-sm-pin', 'data-sidebar-resizing'];
const sidebarMoving = () => MOVING.some(name => document.documentElement.hasAttribute(name));
/** Keeps the snap current while the stack is on screen: one pass after a resize, a zoom or a screen change, never while the sidebar is in motion (a pass is two forced layouts; on every frame of
 *  a morph that is work the frame does not have), and one pass when the motion ends. Returns what stops it. */
export function watchStackSnap(button: HTMLElement | null) {
  if (!button) return () => {};
  let raf = 0, late = 0;
  const pass = () => { cancelAnimationFrame(raf); if (sidebarMoving()) return; raf = requestAnimationFrame(() => { if (!sidebarMoving()) snapStack(button); }); };
  // a zoom (interface size) or a resize settles over a few hundred ms (the zoom glides): one more pass after it, or the stack stays where the glide's first frame put it
  const run = () => { pass(); window.clearTimeout(late); late = window.setTimeout(pass, 400); };
  run(); window.addEventListener('resize', run);
  let mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); const onDpr = () => { run(); mq.removeEventListener('change', onDpr); mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); mq.addEventListener('change', onDpr); }; mq.addEventListener('change', onDpr);
  const side = button.closest('.acira-sidebar'), watch = new ResizeObserver(run); if (side) watch.observe(side); watch.observe(button);
  const motion = new MutationObserver(run); motion.observe(document.documentElement, {attributes: true, attributeFilter: MOVING});
  // the pointer coming to the stack or the keyboard reaching it: the moment to be sure it is on the grid (it is about to fan or to open)
  button.addEventListener('pointerenter', pass); button.addEventListener('focus', pass);
  return () => { cancelAnimationFrame(raf); window.clearTimeout(late); window.removeEventListener('resize', run); mq.removeEventListener('change', onDpr); watch.disconnect(); motion.disconnect(); button.removeEventListener('pointerenter', pass); button.removeEventListener('focus', pass); };
}
