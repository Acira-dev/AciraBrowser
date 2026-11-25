/**
 * Site glow engine (beta.13, item 19). The open site's colour glows into the frame: two pre-coloured layers behind the sidebar and the bands
 * round the page, cross-faded by OPACITY (compositor only; researcher C measured 0.07-0.14 ms a frame for that against 2.3-3.1 ms for writing
 * the colour variables the whole tree inherits). Nothing in the tree is invalidated: the layers carry their own variables.
 *
 * The washes sit at FIXED places in the frame (left: inside the sidebar column; top and bottom bands), never at the page's edge: a wash tied to the
 * page's rectangle moved with a sidebar slide and stood at its final place ahead of the sliding sidebar, which the regression guard's c1 caught as the
 * old dark-mode line (10 ghost frames, up to 224 px ahead of the edge). A layer that never moves cannot do that.
 *
 * Inputs, from App: the active tab's `siteColor` (read by main from the page: site-colour.cjs), the setting `siteColor` (off|soft|rich), and
 * whether this window or tab keeps Acira's own colours (private, Tor, secured). Outputs: the layers, plus the setting other glows read:
 *   <html data-site-color="off|soft|rich">   the setting, always set
 * (13.8, smoothness: the root no longer carries the site-rgb custom property. No stylesheet ever read it, and a custom property on the root is inherited by every element, so each
 * new site colour (most tab switches and navigations) restyled the whole interface inside the switch's commit for nothing.)
 * Reduce motion: no fade. The washes are held to the finish's lightness band and gated at their peak (siteGlow.ts), so ink stays AA.
 *
 * Beta 14 (F5): the sidebar's two layers draw the EDGE LIGHT (styles/site-glow.css), not a round wash. They take the same fades and transitions as the frame layers, but their own colour and
 * opacity (SITE_EDGE_STRENGTH: Soft has to be seen too, gated at that opacity), and `--ab-edge-y`, the selected row's centre, which travels with the selection (placeEdgeLight).
 */
import { siteTintEnabled, type SiteTintBase } from './siteTint';
import { SITE_EDGE_STRENGTH, SITE_GLOW_STRENGTH, siteGlowColors, type SiteGlowColors, type SiteGlowRequest } from './siteGlow';
import { installEdgeBreath } from './edgeBreath';
import { installAmbient } from './ambient';
import type { SiteColorLevel } from '../runtime/types';
import { sidebarMorphRunning } from './sidebarMorph';
import { cubicBezier, fadeAtRest, fadeShown, type OpacityFade } from './cubicBezier';
import { bandBottom, watchPageBand } from './pageBand';

const FADE_MS = 420;
/** The glow's colours for a site colour, memoised: `siteGlowColors` is a pure function of (colour, strength, the finish's frame / ink / accent) and costs about 1.3 ms (oklch conversions and the contrast gate's loop), twice per colour change
 *  (the frame's and the edge light's strength). A person switching between a handful of tabs asks for the same few answers again and again. */
const glowColourCache = new Map<string, SiteGlowColors>();
export function glowColorsFor(request: SiteGlowRequest, base: SiteTintBase): SiteGlowColors {
  const key = `${request.color}|${request.strength}|${base.dark ? 1 : 0}|${base.frame}|${base.ink}|${base.muted}|${base.accent ?? ''}|${base.marker ?? ''}`;
  const hit = glowColourCache.get(key);
  if (hit) { glowColourCache.delete(key); glowColourCache.set(key, hit); return hit; }
  const made = siteGlowColors(request, base);
  glowColourCache.set(key, made);
  if (glowColourCache.size > 48) glowColourCache.delete(glowColourCache.keys().next().value as string);
  return made;
}
/** Layers: THREE (frame layers, and the sidebar's, one set per index). A colour that arrives while a fade is running (a quick second tab, Ctrl+Tab through several) must not be painted into the layer that is still fading out: with two layers
 *  that layer's colour was swapped while visible and its opacity snapped to 0, and the tint of the frame dropped by a fifth of its strength in one frame (full pass round 5: the toolbar band lost 18 levels). The new colour goes on the
 *  layer, other than the front one, that shows the least; every other layer fades on to nothing from where it is. */
const LAYERS = 3;
/** Where each frame layer's opacity fade is, from the curve and the clock: a layer's `getComputedStyle` would force a style recalculation on every colour change (the speed pass). */
const glowFades = new WeakMap<HTMLElement, OpacityFade>();
const GLOW_CURVE = cubicBezier(.2, 0, 0, 1);
const glowShown = (layer: HTMLElement) => fadeShown(glowFades.get(layer), parseFloat(layer.style.opacity) || 0, performance.now());
const glowSet = (layer: HTMLElement, to: number, ms: number, from = glowShown(layer)) => { glowFades.set(layer, { from, to, at: performance.now(), ms, ease: GLOW_CURVE }); };
/** The layer that gets the next colour: not the front one, and of the others the one that shows the least (the first on a tie). */
export function pickGlowLayer(shown: number[], front: number): number {
  let toward = -1, least = Infinity;
  for (let i = 0; i < shown.length; i++) { if (i === front) continue; if (shown[i] < least) { least = shown[i]; toward = i; } }
  return toward;
}
let layers: HTMLElement[] = [], bottoms: HTMLElement[] = [], rights: HTMLElement[] = [], front = 0, lastKey = '', lastBase = '', lastColour = '', painted = false, lastFill = false;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
/** The left wash is painted by the sidebar itself (13.5): two layers inside the open sidebar (`.st-glow-rail`, see AciraSidebar) that follow the frame layers' colours,
 *  opacity and fades exactly. A layer behind the frame at a fixed place is not part of what the layout view transition shows under the sidebar column: the sidebar slid in
 *  without its glow and the glow landed on it in one frame at the end. Inside the sidebar the glow travels, and fades, with it. Mounted layers take the current state at once. */
const rails: Set<HTMLElement>[] = Array.from({ length: LAYERS }, () => new Set<HTMLElement>());
/** What each sidebar layer wears (colour, opacity, fade): the edge light's own values, kept so a sidebar that mounts later takes the current state at once. */
const railPaint: (Record<string, string> | null)[] = Array.from({ length: LAYERS }, () => null);
let edgeY = 240, edgeTop = 0;
const edgeAnimations = new WeakMap<HTMLElement, Animation>();
/** Where the sidebar stops being beside the toolbar and starts being beside the page (its distance from the sidebar's top). The edge light is the light of the seam with the PAGE: above that line the
 *  sidebar borders the toolbar, which has no such light, so the rail's own mask fades it to nothing there (styles/site-glow.css, `[data-top]`): no step of light at the corner where the two meet. */
const wearTop = (el: HTMLElement) => { el.style.setProperty('--ab-top-y', edgeTop + 'px'); if (edgeTop > .5) el.setAttribute('data-top', ''); else el.removeAttribute('data-top'); };
/** Measure the band's bottom against the sidebar's top and tell the rails. Run when a sidebar mounts and whenever the page or the toolbar moves. */
function syncEdgeTop() {
  const side = allRails().find(el => el.isConnected)?.parentElement;
  if (side) placeEdgeTop(bandBottom() - side.getBoundingClientRect().top);
}
export function placeEdgeTop(py: number) {
  const next = Math.max(0, Math.round(py * 10) / 10);
  if (next === edgeTop) return;
  edgeTop = next;
  for (const el of allRails()) wearTop(el);
}
/** A glow layer (a frame layer or a rail) wears `data-lit` while its light is showing or still fading away: the stylesheet draws a rail's pseudo-elements only then, and keeps a layer on the compositor
 *  (`will-change`) only then, so an idle layer costs nothing: no style for its pseudo-elements, no full-window compositor surface of its own (styles/site-glow.css). */
const lightRail = (el: HTMLElement, lit: boolean) => { if (lit) el.setAttribute('data-lit', ''); else el.removeAttribute('data-lit'); };
/** Beta 14.1 (RAM): a LIT frame band at rest is not kept on the compositor either. Once its fade has landed it wears `data-glow-still` and the stylesheet drops its
 *  will-change (styles/site-glow.css). Composited, the band (z-index -1, under everything in the frame) made the frame's whole content a full-window layer of its own
 *  (Chromium's "overlap" reason) with the surfaces its blend needs: about 40 MB of GPU memory at rest on every page with a theme colour, the usual case. Drawn with the
 *  frame's own layer the picture is the same: opacity and the dark finish's screen blend are applied by the same rules either way. Every fade takes the mark off first,
 *  so a fade runs on the compositor exactly as before; a change with no fade (an instant one, Reduce motion) never puts the band on the compositor at all. */
const STILL_AFTER_MS = FADE_MS + 80;
let stillTimer: ReturnType<typeof setTimeout> | null = null;
/** Beta 14.1 (RAM): the sidebar's edge light (a rail of the front layer) is marked the same way, and leaves the compositor only in a window that is NOT the active one (styles/site-glow.css): there it sits still (no
 *  breathing, which runs only in the active window) and its composited layer cost about 25 MB of GPU memory more (Sidebar layout, a page with a theme colour). In the active window nothing changes: the selection's glide
 *  repaints the light every frame and the breathing animates it, both on its own layer as before. A rail that glides is unmarked for the glide and marked again when it lands. */
const stillRail = (el: HTMLElement, index: number) => index === front && el.isConnected && el.hasAttribute('data-lit') && !edgeAnimations.has(el);
/** After a glide: the rail is marked again when the light is otherwise at rest (no fade pending: the front band is marked). */
const remarkRail = (el: HTMLElement) => { if (!stillTimer && !waiting && layers[front]?.hasAttribute('data-glow-still') && rails[front].has(el) && stillRail(el, front)) el.setAttribute('data-glow-still', ''); };
function unstill() { if (stillTimer) { clearTimeout(stillTimer); stillTimer = null; } for (const el of layers) el.removeAttribute('data-glow-still'); for (const el of allRails()) el.removeAttribute('data-glow-still'); }
function markStill() {
  for (const [i, el] of layers.entries()) { if (i === front && el.isConnected && el.hasAttribute('data-lit')) el.setAttribute('data-glow-still', ''); else el.removeAttribute('data-glow-still'); }
  for (const [i, set] of rails.entries()) for (const el of set) { if (stillRail(el, i)) el.setAttribute('data-glow-still', ''); else el.removeAttribute('data-glow-still'); }
}
function settleStill(instant: boolean) {
  if (stillTimer) { clearTimeout(stillTimer); stillTimer = null; }
  if (instant) { markStill(); return; }
  stillTimer = setTimeout(() => { stillTimer = null; if (!waiting) markStill(); }, STILL_AFTER_MS);
}
/** After a layer has faded out (or at once when there is no fade), put it away (its frame layers and its rails), unless it has been lit again since. */
const unlightWhenFaded = (index: number, wait: number) => {
  const put = () => { if (railPaint[index]?.opacity === '0') { for (const el of stackOf(index)) lightRail(el, false); for (const el of [bottoms[index], rights[index]]) { el?.removeAttribute('data-fill'); if (el) { fillRuns.get(el)?.cancel(); fillRuns.delete(el); } } } };
  if (wait > 0) setTimeout(put, wait); else put();
};
const paintRail = (el: HTMLElement, paint: Record<string, string> | null) => { lightRail(el, !!paint && parseFloat(paint.opacity ?? '0') > 0); el.style.cssText = ''; if (paint) for (const [name, value] of Object.entries(paint)) { if (name === 'opacity') el.style.opacity = value; else if (name === 'transition') el.style.transition = value; else el.style.setProperty(name, value); } el.style.setProperty('--ab-edge-y', edgeY + 'px'); wearTop(el); };
const railRef = (index: number) => (el: HTMLElement | null) => {
  if (!el) return undefined;
  rails[index].add(el); syncEdgeTop(); paintRail(el, railPaint[index]);
  if (layers[index]?.hasAttribute('data-glow-still') && stillRail(el, index)) el.setAttribute('data-glow-still', '');   // a sidebar that mounts while the light is at rest is at rest too
  return () => { rails[index].delete(el); };
};
/** React refs of the three layers a sidebar renders. */
export const railGlowRef0 = railRef(0), railGlowRef1 = railRef(1), railGlowRef2 = railRef(2);
const stackOf = (index: number): HTMLElement[] => [layers[index], bottoms[index], rights[index], ...rails[index]].filter(Boolean) as HTMLElement[];
const allRails = (): HTMLElement[] => rails.flatMap(set => [...set]);
const hexOf = (triple: string) => '#' + triple.trim().split(/\s+/).map(n => Number(n).toString(16).padStart(2, '0')).join('');

function readBase(): SiteTintBase | null {
  const node = app(); if (!node) return null;
  const get = (name: string) => node.style.getPropertyValue(name).trim(), rgb = get('--sidebar-rgb');
  if (!/^\d+ \d+ \d+$/.test(rgb)) return null;
  const hex = (v: string) => /^#[\da-f]{6}$/i.test(v) ? v : undefined;
  return { dark: get('--sidebar-tone') === 'dark', frame: hexOf(rgb), ink: get('--sidebar-ink') || '#16181c', muted: get('--sidebar-muted') || '#60636c', accent: hex(get('--chrome-accent')), marker: hex(get('--sidebar-selection-marker')) };
}
/** The finish's frame, ink and muted ink as the glow reads them (ambient mode gates its light the same way). */
export const siteGlowBase = (): SiteTintBase | null => readBase();
function ensureLayers() {
  const node = app(); if (!node) return false;
  if (layers.length === LAYERS && layers.every(l => l.isConnected) && bottoms.every(l => l.isConnected) && rights.length === LAYERS && rights.every(l => l.isConnected)) return true;
  // Two small layers per index, not one full-window layer: the washes are a band along the top (210 px) and one along the bottom (130 px), everything between is alpha 0 (the gradients end in `transparent` at 76 % of their
  // radii: 159 px below the top centre, 106 px above the bottom edge), and with the dark-mode `screen` blend the cost of every fade frame is the area the layer covers: a software compositor blended the whole window per frame.
  const made = Array.from({ length: LAYERS }, () => { const band = (where: 'top' | 'bottom' | 'right') => { const el = document.createElement('div'); el.className = 'st-glow'; el.setAttribute('data-band', where); el.setAttribute('aria-hidden', 'true'); node.prepend(el); return el; }; const top = band('top'); const bottom = band('bottom'); return [top, bottom, band('right')] as const; });
  layers = made.map(trio => trio[0]); bottoms = made.map(trio => trio[1]); rights = made.map(trio => trio[2]);   // the bottom and right bands draw only while a page fills the window (data-fill, styles/site-glow.css)
  installEdgeBreath(); installAmbient(); watchPageBand(syncEdgeTop);
  return true;
}
const reducedMotion = () => app()?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Site color Off must mean off at EVERY frame (reported 17 Nov: the glow flashed on a tab switch with Off). Every glow rule in the stylesheets is written `:root:not([data-site-color=off])`, so a moment with the attribute missing or late is a moment
 *  that draws the site's colour. It is therefore written from the SETTING, at once: at start (from main's initial snapshot, before the first React render and so before the first paint), whenever the setting changes (App, a layout effect), and first thing
 *  in `syncSiteGlow`, ahead of the deferral a layout switch or a sidebar morph puts on the rest. Only the glow layers' cross-fade waits for a switch to finish. */
export function applySiteColorLevel(level: SiteColorLevel | undefined | null) {
  if (level !== 'off' && level !== 'soft' && level !== 'rich') return;
  const root = document.documentElement;
  if (root.getAttribute('data-site-color') !== level) root.setAttribute('data-site-color', level);
}
if (typeof window !== 'undefined') applySiteColorLevel((window as unknown as { acira?: { initialSnapshot?: { settings?: { siteColor?: SiteColorLevel } } } }).acira?.initialSnapshot?.settings?.siteColor);

export interface SiteGlowInput { color?: string; level: SiteColorLevel; /** private/Tor window or tab, secured tab: Acira's own colours. */ blocked: boolean;
  /** A page fills the window (Beta 14, "Fullscreen videos fill the window"; the colour is the video's): the light that is on the top bar and the sidebar's edge goes round the whole frame, so the bottom and right bands
   *  (the strips under and beside the page card) are drawn while it lasts. Not part of the colour's key: the same colour with the fill added or taken away only brings those two bands in or out. */
  fill?: boolean }
/** The bottom and right bands of the FRONT layer come in or go out with a fade of their own (the page started or stopped filling the window with the light's colour unchanged: nothing else fades then). A colour that changes with it takes the
 *  layers' own cross-fade instead (the bands of the incoming layer are marked in `syncSiteGlow`, those of the outgoing layer lose the mark when it has faded away: `unlightWhenFaded`). A band is not drawn without the mark (styles/site-glow.css), so
 *  its opacity does not transition from nothing by itself: the fade is an animation. */
const fillRuns = new WeakMap<HTMLElement, Animation>();
const FILL_EASE = 'cubic-bezier(.2, 0, 0, 1)';
function fadeFillBand(el: HTMLElement, from: number, to: number, hold: boolean) {
  fillRuns.get(el)?.cancel(); fillRuns.delete(el);
  if (typeof el.animate !== 'function') return;
  const run = el.animate([{ opacity: from }, { opacity: to }], { duration: FADE_MS, easing: FILL_EASE, fill: hold ? 'forwards' : 'none' });
  fillRuns.set(el, run);
}
function setFillBands(on: boolean, instant: boolean) {
  lastFill = on;
  for (const el of [bottoms[front], rights[front]]) {
    if (!el) continue;
    const shown = parseFloat(el.style.opacity) || 0;
    if (on) { el.setAttribute('data-fill', ''); if (instant) { fillRuns.get(el)?.cancel(); fillRuns.delete(el); } else fadeFillBand(el, 0, shown, false); }
    else if (instant || !el.hasAttribute('data-fill')) { el.removeAttribute('data-fill'); fillRuns.get(el)?.cancel(); fillRuns.delete(el); }
    else {
      el.setAttribute('data-fill', 'out'); fadeFillBand(el, shown, 0, true);
      setTimeout(() => { if (el.getAttribute('data-fill') === 'out') { el.removeAttribute('data-fill'); fillRuns.get(el)?.cancel(); fillRuns.delete(el); } }, FADE_MS + 40);
    }
  }
}
/** Paint the glow for this input. Same colour and level as last time: nothing happens (a theme change alone re-derives at once, with no fade). */
/** A colour never changes in the middle of a mode switch or the Sidebar-mode morph (researcher C, c7): it waits until both are done, then lands
 *  (the glow is a layer behind the frame, so it could not start a view transition anyway; this keeps the picture a transition captures steady). */
let waiting: { input: SiteGlowInput; options: { instant?: boolean } } | null = null, waitFrame = 0;
const switching = () => { const kind = document.documentElement.dataset.modeSwitch; return (!!kind && kind !== 'appearance') || sidebarMorphRunning(); };
function whenSteady() {
  if (waitFrame) return;
  const tick = () => { waitFrame = 0; if (!waiting) return; if (switching()) { waitFrame = requestAnimationFrame(tick); return; } const next = waiting; waiting = null; syncSiteGlow(next.input, next.options); };
  waitFrame = requestAnimationFrame(tick);
}
export function syncSiteGlow(input: SiteGlowInput, options: { instant?: boolean } = {}) {
  applySiteColorLevel(input.level);   // the setting is never deferred (see applySiteColorLevel): only the layers wait for a switch
  if (switching()) { waiting = { input, options }; whenSteady(); return; }
  waiting = null;
  const root = document.documentElement;
  const wants = !input.blocked && input.level !== 'off' && !!input.color && /^#[\da-f]{6}$/i.test(input.color);
  const color = wants ? input.color!.toLowerCase() : '';
  const key = color + '|' + input.level, fill = !!color && input.fill === true;
  if (!color && !painted) { lastKey = key; lastColour = ''; lastFill = false; return; } // never had a glow: nothing to take away
  if (!ensureLayers()) return;
  const base = readBase(); if (!base) return;
  const baseKey = base.frame + base.dark;
  if (key === lastKey && baseKey === lastBase) { if (fill !== lastFill && color) setFillBands(fill, !!options.instant || reducedMotion()); return; }
  const sameColour = key === lastKey; // only the finish changed: re-derive at once
  lastKey = key; lastBase = baseKey; lastColour = color; if (color) painted = true;
  const instant = options.instant || sameColour || reducedMotion();
  if (!instant) unstill();   // a fade is coming: every band goes back on the compositor in the same frame its fade starts
  const inIndex = pickGlowLayer(layers.map(layer => instant ? 0 : glowShown(layer)), front), incoming = layers[inIndex], outIndexes = layers.map((_, i) => i).filter(i => i !== inIndex);
  const request: SiteGlowRequest | null = color ? { color, strength: SITE_GLOW_STRENGTH[input.level === 'rich' ? 'rich' : 'soft'] } : null;
  const colors = request ? glowColorsFor(request, base) : null;
  // The sidebar's edge light: its own colour and opacity (Soft has to be seen), the same fades. It is drawn for the colours the frame is drawn for: one that fails the gate there has none here.
  const edge = request && colors && colors.opacity > 0 ? glowColorsFor({ color: request.color, strength: SITE_EDGE_STRENGTH[input.level === 'rich' ? 'rich' : 'soft'] }, base) : null;
  const transition = instant ? 'none' : `opacity ${FADE_MS}ms cubic-bezier(.2,0,0,1)`;
  if (colors && colors.opacity > 0) {
    root.setAttribute('data-site-glow', ''); root.setAttribute('data-site-glow-tone', base.dark ? 'dark' : 'light');
    const isFrame = (el: HTMLElement) => el === layers[inIndex] || el === bottoms[inIndex] || el === rights[inIndex];
    lastFill = fill; for (const el of [bottoms[inIndex], rights[inIndex]]) { if (fill) { el.setAttribute('data-fill', ''); if (!instant) fadeFillBand(el, 0, colors.opacity, false); else { fillRuns.get(el)?.cancel(); fillRuns.delete(el); } } else el.removeAttribute('data-fill'); }
    // The incoming layer starts from nothing. One that is at rest at 0 (the usual case: it faded out a while ago) was computed at 0 a frame ago, so its opacity changing now IS a transition from 0 and needs no reset and no
    // forced style flush; only a layer that was just set (or is still fading), or that was never drawn, is reset and flushed.
    const rest = !instant && glowFades.has(incoming) && fadeAtRest(glowFades.get(incoming), performance.now()) && glowShown(incoming) === 0;
    for (const el of stackOf(inIndex)) lightRail(el, true);
    for (const el of stackOf(inIndex)) {
      const own = !isFrame(el) && edge ? edge : colors;
      el.style.setProperty('--g1', own.g1); el.style.setProperty('--g2', own.g2); el.style.setProperty('--g3', own.g3);
      if (!rest) { el.style.transition = 'none'; el.style.opacity = '0'; }
    }
    if (!rest) void incoming.offsetWidth;
    for (const index of layers.keys()) glowSet(layers[index], index === inIndex ? colors.opacity : 0, instant ? 0 : FADE_MS, index === inIndex ? 0 : glowShown(layers[index]));
    for (const index of layers.keys()) for (const el of stackOf(index)) el.style.transition = transition;
    for (const el of stackOf(inIndex)) el.style.opacity = String(!isFrame(el) && edge ? edge.opacity : colors.opacity);
    for (const index of outIndexes) for (const el of stackOf(index)) el.style.opacity = '0';   // a transition retargets from where the layer is: a fade that is running goes on, no step
    // what a sidebar that mounts later must wear: the incoming layer's colours and opacity, the outgoing layer's nothing
    const wear = (own: typeof colors, opacity: number, fade: string) => ({ '--g1': own.g1, '--g2': own.g2, '--g3': own.g3, opacity: String(opacity), transition: fade });
    railPaint[inIndex] = wear(edge ?? colors, (edge ?? colors).opacity, transition);
    for (const index of outIndexes) { railPaint[index] = { ...(railPaint[index] ?? {}), opacity: '0', transition }; unlightWhenFaded(index, instant ? 0 : FADE_MS + 40); }
    front = inIndex;
    settleStill(instant);
  } else {
    lastFill = false;   // every layer fades away with the bands it carries (their mark goes with `unlightWhenFaded`)
    for (const index of layers.keys()) { glowSet(layers[index], 0, instant ? 0 : FADE_MS); for (const el of stackOf(index)) { el.style.transition = transition; el.style.opacity = '0'; } }
    for (const index of layers.keys()) { railPaint[index] = { ...(railPaint[index] ?? {}), opacity: '0', transition }; unlightWhenFaded(index, instant ? 0 : FADE_MS + 40); }
    if (instant) root.removeAttribute('data-site-glow'); else setTimeout(() => { if (!lastColour) root.removeAttribute('data-site-glow'); }, FADE_MS + 40);
  }
}

/** The edge light's place: the selected row's centre, in the sidebar's own pixels (`--ab-edge-y` on both layers). A change of SELECTION glides there on the same spring as the card that
 *  glides to the row (the caller passes its time and easing); anything else (scrolling, a resize) moves the light at once, so it never lags a drag. */
export function placeEdgeLight(y: number, motion?: { ms: number; easing: string }) {
  const target = Math.round(y * 10) / 10, all = allRails().filter(el => el.isConnected);
  for (const el of all) {
    // a glide still in flight is taken over from where it is drawn now, never from where it was going
    const flying = edgeAnimations.get(el), now = flying ? parseFloat(getComputedStyle(el).getPropertyValue('--ab-edge-y')) : NaN, from = Number.isFinite(now) ? now : edgeY;
    flying?.cancel(); edgeAnimations.delete(el);
    el.style.setProperty('--ab-edge-y', target + 'px');
    if (motion && motion.ms > 0 && Math.abs(target - from) > .5 && typeof el.animate === 'function') {
      el.removeAttribute('data-glow-still');   // the glide repaints the light every frame: on its own layer, as before (Beta 14.1 RAM, see markStill)
      const run = el.animate([{ '--ab-edge-y': from + 'px' }, { '--ab-edge-y': target + 'px' }] as unknown as Keyframe[], { duration: motion.ms, easing: motion.easing });
      edgeAnimations.set(el, run);
      run.onfinish = run.oncancel = () => { if (edgeAnimations.get(el) !== run) return; edgeAnimations.delete(el); remarkRail(el); };
    } else if (flying) remarkRail(el);   // a glide cut short by a move with no motion: at rest again
  }
  edgeY = target;
}

// Dev rig hook (flag only): paint a colour on a tab without a page behind it.
declare global { interface Window { __aciraSiteGlow?: unknown } }
if (typeof window !== 'undefined' && siteTintEnabled()) {
  window.__aciraSiteGlow = { sync: (input: SiteGlowInput, options?: { instant?: boolean }) => syncSiteGlow(input, options), status: () => ({ lastKey, front, layers: layers.length }) };
}
