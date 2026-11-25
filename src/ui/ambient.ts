/**
 * Ambient mode in the interface (Beta 14, F6). Main reads the page's edge colours (desktop/ambient-edge.cjs) and calls `window.__aciraAmbient(sample)`; this draws them as light into the two
 * surfaces beside the page: the SIDEBAR (a layer inside it, `.st-amb-side`, so it slides, fades and leaves with the sidebar in every transition, as the site glow's own layers do) and the TOOLBAR
 * (a layer inside `.browser-shell`, `.st-amb-top`, so the panel, its icons and its light are one surface: the Seamless toolbar hides its children as one). Both are drawn from the same two rows of
 * stops over the same page rectangle with the same fall-off, so beside the corner where they meet there is no line, no shadow and no step of tone (ui/ambientColours.ts has the colour rules).
 *
 * Live and cheap: a new read paints a layer that shows nothing and cross-fades to it (never a cut, never a flicker; a read that comes while a fade is running gets a layer of its own and the fades on screen carry on from where they are); a read within a few levels of the last is not painted; nothing is drawn for a white or flat
 * page (the edge light of F5 stands alone there); a resize repaints the layer in place. Off, or told `null` (a private tab, a shared window): the layers fade away. Motion Off: no fade.
 *
 * It opens with its surface: the light's reach (`--amb-reach`, styles/ambient.css) grows from the page-side edge across the surface as it opens, on the surface's own clock, from the first frame.
 *
 * WITH THE SETTING OFF THERE IS NO LAYER AT ALL (fullpass3, guard c2): not a hidden element, no element. Every style recalculation of the interface walks every element and tries every rule, and the Sidebar
 * mode morph recalculates the whole tree on each frame; a span and two layers that are never lit are a cost for everyone who never turns Ambient mode on. The sidebar's host is rendered by
 * `<AmbientSideLayer>` only while `ambientLayers` says so (on, or switched off less than one fade ago: the layers fade away, never cut, and are removed once they are invisible), and the toolbar's is
 * created and removed here.
 */
import { siteGlowBase } from './siteGlowEngine';
import { bandBottomOf, watchPageBand } from './pageBand';
import { ambientGradient, ambientStops, bleedFade, cornerClamp, cornerLight, capRow, cornerRow, fallOff, fieldRow, hasLight, lightLevels, marginEnds, rgba, sameLight, stopAt, type AmbientSample, type AmbientStop, type AmbientStops } from './ambientColours';
import { edgeRestPage } from './chromeEdge';
import { ambientOn } from './ambientGate';
import { frameColours, frameGlowOn } from '../runtime/ownColours';
import { fixedGlowSample } from './frameField';
import { NOEL_LIGHT } from '../season/noelSettings';
import { effectiveView } from '../runtime/windowView';
import { motionPace, scaled } from './sharedMotion';
import { cubicBezier, fadeAtRest, fadeShown, type OpacityFade } from './cubicBezier';
import type { SiteColorLevel } from '../runtime/types';

interface Surface { host: HTMLElement; layers: HTMLElement[]; front: number; kind: 'side' | 'top' | 'far' | 'bottom' | 'head' | 'above' | 'near' | 'lip'; paintedKey: string }
const sides = new Set<Surface>();
/** THE HEAD OF A FLOATING SIDEBAR. While a sidebar floats beside the page's frame (a classic layout's peek) the page keeps its place under it, so the top bar's light is the same row of the page's own colours
 *  from the window's edge to its far edge, with the sidebar hidden, sliding and floating. What the sidebar brings is only the FALL-OFF across it, away from the edge it makes with the page (styles/ambient.css).
 *  So the head's light is not the side layer's corner square (one colour, moving with the sidebar's picture) but a piece of its own: a wrapper that carries the fall-off ACROSS (linear, the sidebar's own curve)
 *  and stays with the sidebar, and inside it the top row's colours laid over the page's real rectangle with the band's own vertical fall-off, exactly the bar's light. In a reveal and a hide the bar's light is
 *  one picture that stands still in the window while one masked window travels with the sidebar's edge (styles/view-morph.css), so the colour on both sides of that edge is the same colour at every frame,
 *  on any page, and what stands at the end of the slide is what the head draws at rest. */
const heads = new Map<Surface, Surface>();
/** The side layers that stand under a head (a floating sidebar's, a docked one's, the Mini rail's): their column begins with the corner's colour and is held near it (cornerRow), and their mask has the corner's clamp. */
const headed = new Set<Surface>();
/** How far under the band's foot the blend at a sidebar's edge goes out (px): the bar's bleed and the column's fade alike, so a slide has no step along the foot (styles/ambient.css). */
const BLEED_TAIL = 40;
/** The NEAR-SIDE STRIP (D111, 20 Nov): with the sidebar hidden the page card rests 6 px in from the window's edge on the sidebar's side as well, and nothing lit that margin (the far side's strip 21 / 53 / 31
 *  against 9 / 9 / 11 there, the square under the card's near corner unlit too). It is the far strip's mirror (a child of the corners' host, from the card's top to the window's bottom), in the near
 *  column's colours, rendered only while no sidebar stands there (`data-cap`; docked, floating or Mini, the card is flush with it and the margin is 0).
 *  The two thin strips round the page card on the sides the sidebar and the toolbar are not on (frame, one surface): the far side and the bottom. They live in the corners' host, so they sit where the card sits and glide with it.
 *  THE STRIP ABOVE THE PAGE (D105, 20 Nov) is the third. Where the frame shows above the page with no bar ending on it (Hide the toolbar: the hidden toolbar's shell has no height and renders none of its
 *  children, so the bar's own light, a child of the shell, is not there), the 6 px above the page were the one side of the card with no light, with a hard edge where the lit sidebar ends. The strip carries
 *  the top row's colours over the page's own rectangle with the band's fall-off, the very light the 6 px band of Sidebar + address has (styles/ambient.css). It does NOT live with the card: it is a child of
 *  the browser's column, at that column's own top, so it stands still whatever the bar and the card do under it (a hidden toolbar revealed puts the bar's row into the layout and the card under it, through
 *  heights of 1 px and more on the way: tied to the card the strip left the window's top for the reveal's first frames). Where there is no such margin it is not rendered. */
let strips: Surface[] = [], cap: Surface | null = null, near: Surface | null = null;
let top: Surface | null = null, sample: AmbientSample | null = null, stops: AmbientStops | null = null, on = false, installed = false, frame = 0;
/** 14.1: the still glow's colours and side while it is on ('' otherwise): main's page reads are not drawn then. */
let fixedKey = '';

/** Do the layers exist? True while Ambient mode is on, and for one fade after it is switched off (they fade away, then they are removed). The sidebar follows it through `ambientLayers`. */
let mounted = false, removal = 0, enabledAt = -1e9;
const mountListeners = new Set<() => void>();
const setMode = (on: boolean) => { if (typeof document === 'undefined' || !document.documentElement) return; if (on) document.documentElement.setAttribute('data-ambient-mode', ''); else document.documentElement.removeAttribute('data-ambient-mode'); };
const setMounted = (next: boolean) => { if (next === mounted) return; mounted = next; setMode(next); for (const listener of [...mountListeners]) listener(); };   // <html data-ambient-mode> while the layers exist (the setting on, and one fade after it is off): the top's flat paint follows it (styles/ambient.css), so the frame never changes tone as the light comes and goes
export const ambientLayers = { subscribe: (listener: () => void) => { mountListeners.add(listener); return () => { mountListeners.delete(listener); }; }, get: () => mounted };

const root = () => document.documentElement;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
const reduced = () => app()?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The sample's durations, verbatim (item 01 v3 `.b14-amb > i`: "arriving: a slow fade (300ms x the speed setting); leaving: quicker (140ms x)"): the animation speed setting scales them (`--motion-scale`: Premium 1.7, Fast .6),
 *  and Reduce motion (the setting or the system's) plays none. */
/** A read after the page was given a new size (its reason 'resize') fades in evenly (linear) over its own time, the corners with it: a fast-start fade stepped the margin 8 to 12 levels a frame. */
let easeNow: 'linear' | null = null;
const LINEAR = (p: number) => p;
let fadeNow: number | null = null;   // a push that asks for its own fade (a tab's last read on a switch: 140 ms) has it for the one paint it makes
const fadeInMs = () => reduced() ? 0 : fadeNow ?? Math.round(scaled(300)), fadeOutMs = () => reduced() ? 0 : Math.round(scaled(140));
/** The cross-fade's curves are the APPROVED SAMPLE's (item 01 v3, `.b14-amb > i`: in `cubic-bezier(.2, 0, 0, 1)`, "a slow fade"; out `--motion-ease-exit`, `cubic-bezier(.4, 0, 1, 1)`, "quicker, like every exit in the app"):
 *  they stay as they are (the team's exact-sample-parity rule). The corner pieces (styles/ambient.css `.st-amb-corners`) fade on the in curve. */
const FADE_IN_EASE = 'cubic-bezier(.2,0,0,1)', FADE_OUT_EASE = 'cubic-bezier(.4,0,1,1)';
/** Layers per surface. THREE: a read that arrives while a cross-fade is running (the 'on-screen' read and a 'load' read 50 ms apart; a tab switch inside the last fade) must not repaint a layer that is still on screen. */
const LAYERS = 3;

function make(host: HTMLElement, kind: Surface['kind']): Surface {
  const layers = Array.from({ length: LAYERS }, () => { const el = document.createElement('i'); el.className = 'amb-l'; el.setAttribute('aria-hidden', 'true'); el.style.opacity = '0'; host.appendChild(el); return el; });
  return { host, layers, front: 0, kind, paintedKey: '' };
}
/** The page's rectangle against the surface's own: where the light's rows start and how long they run, and where the toolbar band ends. The light is ONE field laid over the L-shaped frame round the page (styles/ambient.css):
 *  the same fall-off by distance from the page's edge on both surfaces, anchored at the same line, the bottom of the toolbar band (where the page begins; in Seamless with a toolbar showing over the page, the toolbar's own
 *  bottom), so at the seam between the sidebar and the toolbar, and round the corner, the two are one light. */
/** Every rectangle a paint reads, read ONCE and before anything is written (a read after a write makes the page recalculate style and layout again for each surface: the speed pass found a paint doing it four times
 *  per surface). `page` is the page card, `shell` the toolbar shell, `band` where the toolbar band ends (pageBand.ts bandBottom, from the same two rectangles), `boxes` each surface's container. */
interface Frame { page: DOMRect | null; rest: DOMRect | null; band: number; boxes: Map<HTMLElement, DOMRect>; corners: { card: DOMRect; body: DOMRect; shell: DOMRect | null; host: HTMLElement | null } | null }
const pageNode = () => document.querySelector<HTMLElement>('.browser-body > .page-area') ?? document.querySelector<HTMLElement>('.page-area');
function measure(list: Surface[], withCorners = false): Frame {
  const page = pageNode(), p = page ? page.getBoundingClientRect() : null, shellNode = document.querySelector<HTMLElement>('.browser-shell'), sr = shellNode ? shellNode.getBoundingClientRect() : null;
  const boxes = new Map<HTMLElement, DOMRect>();
  for (const surface of list) { const box = surface.host.parentElement; if (box && !boxes.has(box)) boxes.set(box, box.getBoundingClientRect()); }
  const band = bandBottomOf(p, sr);
  let corners: Frame['corners'] = null;
  if (withCorners) {
    const body = document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer) .browser-body'), card = body?.querySelector<HTMLElement>(':scope > .page-area');
    if (body && card) corners = { card: card.getBoundingClientRect(), body: body.getBoundingClientRect(), shell: sr, host: null };
  }
  const resting = edgeRestPage(), rest = resting && p && resting.width > 0 && (Math.abs(resting.left - p.left) > .5 || Math.abs(resting.width - p.width) > .5 || Math.abs(resting.top - p.top) > .5 || Math.abs(resting.height - p.height) > .5) ? resting : null;
  return { page: p, rest, band, boxes, corners };
}
function geometry(surface: Surface, frame: Frame) {
  const p = frame.page;
  if (!p || !(p.width > 0) || !(p.height > 0)) return null;
  // the strips round the card depend on the card alone (their host has no size until its first paint, so they never read it): a strip starts where the card does, its first colour is the card's first row
  if (surface.kind === 'far' || surface.kind === 'near') return { from: 0, span: p.height, y0: 0 };
  // (under a floating sidebar the page keeps its place, wider than the card beside the sidebar: the row under the page is laid over the page's real width too, so the strip begins, at the sidebar's edge, with the colour
  // the column beside it ends with. Squeezed into the card it began with the page's own corner colour, which is under the sidebar: a patch of another colour under the page's corner on a strongly coloured page.)
  if ((surface.kind === 'bottom' || surface.kind === 'lip') && frame.rest) return { from: frame.rest.left - p.left, span: frame.rest.width, y0: 0 };
  if (surface.kind === 'bottom' || surface.kind === 'lip') return { from: 0, span: p.width, y0: 0 };
  const box = surface.host.parentElement, b = box ? frame.boxes.get(box) ?? box.getBoundingClientRect() : null;
  if (!b || !(b.width > 0) || !(b.height > 0)) return null;
  // A sidebar floating beside the frame leaves the page where it was (chromeEdge.ts edgeRestPage): the rows are laid over the page's REAL rectangle, so the light does not change when the sidebar comes or goes.
  const rest = frame.rest;
  // the strip above the page begins at its column's own edge, as the bar's light does at the shell's (the column's left border is outside the strip's box): the row is laid over the page's rectangle from there
  if (surface.kind === 'above') { const lead = b.left + (box!.clientLeft || 0); return rest ? { from: rest.left - lead, span: rest.width, y0: 0 } : { from: Math.max(0, p.left - lead), span: p.width, y0: 0 }; }
  if (rest) return surface.kind === 'side' ? { from: rest.top - b.top, span: rest.height, y0: Math.max(0, frame.band - b.top) } : { from: rest.left - b.left, span: rest.width, y0: surface.kind === 'head' ? Math.max(0, frame.band - b.top) : b.height };
  if (surface.kind === 'side') return { from: Math.max(0, p.top - b.top), span: p.height, y0: Math.max(0, frame.band - b.top) };
  return { from: Math.max(0, p.left - b.left), span: p.width, y0: b.height };
}
/** The top row's colour where a floating sidebar cuts the page (the corner the sidebar makes with it): the column beside the cut starts from it and the card's cut-out there takes it. `low`: the same on the row under
 *  the page, where the column ends and the lower cut-out is (the page's own bottom corner on that side is under the sidebar: its colour is not the one the strip beside the sidebar begins with). Null when nothing floats. */
function cutStop(frame: Frame, low = false): AmbientStop | null {
  const rest = frame.rest, p = frame.page, row = stops ? (low ? stops.b : stops.t) : null;
  if (!rest || !p || !row || !row.length) return null;
  const right = sample?.side === 'right';
  return stopAt(row, ((right ? p.right : p.left) - rest.left) / rest.width);
}
/** The field's capped rows and the margins' ends (ambientColours capToField / marginEnds): one per read and frame colour. */
type MarginKind = 'far' | 'bottom' | 'near';
let field: { stops: AmbientStops; frame: string | null; side: 'left' | 'right'; far: AmbientStop[]; bottom: AmbientStop[]; near: AmbientStop[]; ends: Record<MarginKind, { start: AmbientStop | null; end: AmbientStop | null }> } | null = null;
function fieldOf() {
  if (!stops) return null;
  const frameColour = siteGlowBase()?.frame ?? null, side = sample?.side === 'right' ? 'right' : 'left';
  if (field && field.stops === stops && field.frame === frameColour && field.side === side) return field;
  const ends = { far: marginEnds(stops, 'far', side, frameColour), bottom: marginEnds(stops, 'bottom', side, frameColour), near: marginEnds(stops, 'near', side, frameColour) };
  return field = { stops, frame: frameColour, side, far: capRow(stops.r, ends.far.start, ends.far.end, frameColour), bottom: capRow(stops.b, ends.bottom.start, ends.bottom.end, frameColour), near: capRow(stops.l, ends.near.start, ends.near.end, frameColour), ends };
}
function recipe(surface: Surface, frame: Frame) {
  const g = stops && geometry(surface, frame);
  if (!stops || !g) return null;
  const cut = surface.kind === 'side' ? cutStop(frame) : null, cutLow = cut ? cutStop(frame, true) : null;
  // (under a HEAD the column begins with the top row's colour where the bar meets it and its stops near the corner are held up to the straight line round it (ambientColours cornerRow, D51): no dark notch beside the
  // page's corner on a page whose side is plain under a lit top. The same gradient holds that first colour up to the window's top: THE HEAD IS THE COLUMN (styles/ambient.css).)
  const under = surface.kind === 'side' && headed.has(surface), first = cut ?? (under && stops.l.length ? stops.l[0] : null);
  const side = first && stops.l.length > 1 ? [first, ...stops.l.slice(1, -1), cutLow ?? stops.l[stops.l.length - 1]] : stops.l;
  const base = under ? siteGlowBase() : null;
  const row = surface.kind === 'side' ? (under && side.length > 1 && base ? cornerRow(side, side[0], g.span, stop => lightLevels(stop, base.frame)) : side) : surface.kind === 'top' || surface.kind === 'head' || surface.kind === 'above' || surface.kind === 'lip' ? stops.t : surface.kind === 'far' ? stops.r : surface.kind === 'near' ? stops.l : stops.b;
  if (!row.length) return null;
  // THE FRAME IS ONE COLOUR FIELD (ambientColours fieldRow): a margin starts as its neighbour's colour and comes into its own over its first 160 px at each end, its own held within 8 levels of the field's colour
  // (the capped rows and ends are made once per read and frame colour, fieldOf: a strip repainted in every frame of a layout switch only mixes)
  let drawn = row;
  if (surface.kind === 'far' || surface.kind === 'bottom' || surface.kind === 'near') {
    const f = fieldOf(), ends = f?.ends[surface.kind];
    if (f && ends) drawn = fieldRow(f[surface.kind], ends.start, ends.end, g.span);
  }
  const image = ambientGradient(drawn, surface.kind === 'side' || surface.kind === 'far' || surface.kind === 'near' ? 'y' : 'x', g.from, g.span);
  return { image, y0: g.y0, key: image + '|' + g.y0 };
}
/** The layer that gets the next light: not the front one, and of the others the one that shows the least (first on a tie). */
export function pickLayer(shown: number[], front: number): number {
  let toward = -1, least = Infinity;
  for (let i = 0; i < shown.length; i++) { if (i === front) continue; if (shown[i] < least) { least = shown[i]; toward = i; } }
  return toward;
}
/** Where each layer's opacity fade is (a layer's `getComputedStyle` would force a style recalculation: the curve and the clock say where it is). */
const fades = new WeakMap<HTMLElement, OpacityFade>();
const IN_CURVE = cubicBezier(.2, 0, 0, 1), OUT_CURVE = cubicBezier(.4, 0, 1, 1);
const shownOf = (layer: HTMLElement) => fadeShown(fades.get(layer), parseFloat(layer.style.opacity) || 0, performance.now());
const settle = (layer: HTMLElement, to: number, ms: number, ease: (progress: number) => number, from = shownOf(layer)) => { fades.set(layer, { from, to, at: performance.now(), ms, ease }); };
function show(surface: Surface, instant: boolean, frame: Frame = measure([surface])) {
  const r = recipe(surface, frame);
  if (!r) return;
  if (r.key === surface.paintedKey) return;
  const cut = instant || fadeInMs() === 0;
  // The layer that gets the new light is the one (never the front) that shows the least: a layer that is still fading out is not repainted under the person.
  const toward = pickLayer(surface.layers.map(layer => cut ? 0 : shownOf(layer)), surface.front), back = surface.layers[toward];
  surface.host.style.setProperty('--amb-y0', r.y0 + 'px');
  back.style.backgroundImage = r.image;
  surface.paintedKey = r.key;
  if (cut) { for (const layer of surface.layers) { layer.style.transition = 'none'; layer.style.opacity = layer === back ? '1' : '0'; settle(layer, layer === back ? 1 : 0, 0, IN_CURVE); } surface.front = toward; return; }
  // The new layer starts from nothing. A layer at rest at 0 (the usual case) needs no forced style flush for that: it was computed at 0 a frame ago, so a change of its opacity now is a transition from 0. Only a layer that
  // was just set (or is still fading) is reset and flushed.
  const now = performance.now(), atRest = fades.has(back) && fadeAtRest(fades.get(back), now) && shownOf(back) === 0;
  if (!atRest) { back.style.transition = 'none'; back.style.opacity = '0'; void back.offsetWidth; }
  // Every other layer fades from where it is to nothing (a transition retargets from the current value: no step), the new one comes in over them.
  const t = `opacity ${fadeInMs()}ms ${easeNow ?? FADE_IN_EASE}`;
  for (const layer of surface.layers) { settle(layer, layer === back ? 1 : 0, fadeInMs(), easeNow ? LINEAR : IN_CURVE, layer === back ? 0 : shownOf(layer)); layer.style.transition = t; layer.style.opacity = layer === back ? '1' : '0'; }
  surface.front = toward;
}
function hide(surface: Surface) {
  surface.paintedKey = '';
  const t = fadeOutMs() ? `opacity ${fadeOutMs()}ms ${FADE_OUT_EASE}` : 'none';
  for (const layer of surface.layers) { settle(layer, 0, fadeOutMs(), OUT_CURVE); layer.style.transition = t; layer.style.opacity = '0'; }
}
function ensureTop(): Surface | null {
  if (top?.host.isConnected) return top;
  const shell = document.querySelector<HTMLElement>('.app.style-acira .browser-shell');
  if (!shell) { top = null; return null; }
  const host = document.createElement('div'); host.className = 'st-amb-top'; host.setAttribute('aria-hidden', 'true'); shell.prepend(host);
  return top = make(host, 'top');
}
function removeTop() { top?.host.remove(); top = null; }
/** The page card's four corners (styles/ambient.css `.st-amb-corners`): the light in the cut-outs outside the card's rounded corners, so the lit frame meets the page along its curve, as the plain frame does in 13.8, never
 *  at a square corner. A host under the page card, the size of its box, with a piece at each corner; each piece is only the cut-out (a circle mask the card's own radius): the card, and the page in its curve, cover the rest. */
let corners: { host: HTMLElement; key: string } | null = null;
function ensureCorners(): HTMLElement | null {
  if (corners?.host.isConnected) return corners.host;
  const body = document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer) .browser-body'), card = body?.querySelector<HTMLElement>(':scope > .page-area');
  if (!body || !card) { corners = null; return null; }
  const host = document.createElement('div'); host.className = 'st-amb-corners'; host.setAttribute('aria-hidden', 'true');
  // the lip along the card's top edge (D121): FIRST in the host, so the corner pieces (opaque) lie over it outside the card's curve
  const lipStrip = document.createElement('div'); lipStrip.className = 'st-amb-strip'; lipStrip.dataset.s = 'lip'; lipStrip.setAttribute('aria-hidden', 'true'); host.appendChild(lipStrip);
  for (const c of ['tl', 'tr', 'bl', 'br']) { const piece = document.createElement('i'); piece.className = 'st-amb-corner'; piece.dataset.c = c; host.appendChild(piece); }
  strips = (['far', 'bottom', 'near'] as const).map(kind => { const strip = document.createElement('div'); strip.className = 'st-amb-strip'; strip.dataset.s = kind; strip.setAttribute('aria-hidden', 'true'); host.appendChild(strip); return make(strip, kind); });
  near = strips[2];
  strips.push(make(lipStrip, 'lip'));
  if (body.parentElement) { const strip = document.createElement('div'); strip.className = 'st-amb-strip'; strip.dataset.s = 'top'; strip.setAttribute('aria-hidden', 'true'); body.parentElement.prepend(strip); cap = make(strip, 'above'); strips.push(cap); }   // the strip above the page: in the browser's column, at its top
  body.insertBefore(host, card);
  corners = { host, key: '' };
  watchCap();
  return host;
}
/** THE STRIP ABOVE THE PAGE (D105) stands where the frame shows above the page's own top with no bar ending on it. The page's own top is the card's, or, while a bar floats beside the frame (the hidden
 *  toolbar revealed: the bar takes its row in the layout and the card is laid out under it, but the page keeps its place under the bar, chromeEdge.ts edgeRestPage), the top the page rests at. A bar whose
 *  foot IS the page's top (every layout with a bar, the 6 px band of Sidebar + address) leaves no margin. A shell that is HIDDEN lights nothing whatever its height (the Sidebar mode morph holds it at the
 *  old layout's height for its first frames; a private window keeps a 2 px line), and a bar that floats over a page that keeps its place stands OVER the margin (and is 1 px tall, then more, on its way in):
 *  in both the margin is measured from the shell's top. The strip is that tall (`--amb-mt`), from where the margin begins down: the column's top, or the foot of a band that stands above the margin
 *  (`--amb-top`: the Sidebar mode morph grows the new 6 px band from 1 px, and for those frames the margin is what is left under it). `--amb-bar` (on the root: a hover reveal's pictures read it) is the
 *  height of the bar that stands, for the clip that uncovers the strip as a revealed bar leaves (styles/ambient.css). It is written AT REST only: an inherited property written on the root restyles the
 *  whole interface (2 to 6 ms a write; written in every frame of a returning header's ease it cost about five frames of the switch, real takes). */
let capRows = 6;
/** What a bar `bar` px tall leaves the strip's rows short of the strip's own light, as the weight of the strip's picture laid OVER the bar's light (a toolbar that comes back or leaves, styles/ambient.css).
 *  Both lights are the top row's colours with the band's fall-off, the strip's from the page's top, the bar's from its own foot: at the strip's middle row the strip gives fallOff(rows / 2) and the bar
 *  fallOff(bar - rows / 2). A picture laid over another covers a part of it (the light's own strength times the bar's fall-off), so the weight is the difference over what is left uncovered.
 *  `strength`: the light's own, the mean alpha of the top row. */
const CAP_SETTLE_MS = 240;
function capWeight(bar: number): number {
  if (!(bar > capRows)) return 0;
  const own = fallOff(capRows / 2), under = fallOff(bar - capRows / 2), row = stops?.t ?? [], light = row.length ? row.reduce((sum, stop) => sum + (stop.alpha > 0 ? stop.alpha : 0), 0) / row.length : 0;
  return Math.round(Math.min(1, Math.max(0, (own - under) / (own * (1 - Math.min(.9, light * under))))) * 1000) / 1000;
}
/** THE TOOLBAR COMES BACK in a layout switch (Hide the toolbar turned off): the strip is then an old picture alone (`::view-transition-old(acira-amb-cap)`), which shows nothing of itself
 *  (styles/ambient.css), and the bar's light arrives as it always did: whole, from the first frame it shows, by when the header has some height. What the picture still has to give is known only
 *  once the bar has a height, and it differs with how the header takes it:
 *   - while the bar is shorter than the strip (the commit itself, 1 px: never a drawn frame): nothing yet;
 *   - the header EASES to its height (an ordinary profile): the bar's light at 6 px and more IS the strip's light on the strip's rows (the same fall-off from a foot that is still near): nothing;
 *   - the header takes its height AT ONCE (a session started with Reduce motion on: its motion element never eases again): the bar's light is 19% short of the strip's on those rows from one frame
 *     to the next (a 36 px bar; 10 levels), so the picture gives that difference (capWeight, with the light's own strength) and lets it go over 240 ms.
 *  One script animation on the picture, made in the frame the shell takes its size (its size observer runs after layout, before the frame is drawn). Nothing is written on the root here. */
let capBack: { anim: Animation | null; done: boolean } | null = null;
function capReturn(bar: number) {
  const back = capBack, shell = capWatched as HTMLElement | null;
  if (!back || back.done || !shell) return;
  const play = (frames: Keyframe[], duration: number) => { back.anim?.cancel(); back.anim = null; try { back.anim = root().animate(frames, { pseudoElement: '::view-transition-old(acira-amb-cap)', duration, fill: 'both' }); } catch { /* no such picture: the switch played without one */ } };
  if (bar < capRows - 1) return;   // not drawn yet: the switch's first drawn frame already has the header at 5 to 10 px, and the bar's light reaches 1 px under its own box (an animation made here, in the commit, landed on that frame over the bar's light: one frame 12 levels over both rests, real takes)
  back.done = true;
  const goal = parseFloat(shell.style.getPropertyValue('--sm-final-hdr')) || bar, weight = bar < goal - .5 ? 0 : capWeight(bar);
  if (weight > 0) play([{ opacity: weight }, { opacity: 0 }], CAP_SETTLE_MS * motionPace()); else { back.anim?.cancel(); back.anim = null; }
}
const capEnd = () => { capBack?.anim?.cancel(); capBack = null; };
/** D119 (21 Nov): THE LAST HALF POINT UNDER A BAND ON ITS WAY IN. At rest a margin of half a point or less is no margin (the card meets the shell, give or take the layout's rounding). But while a layout
 *  switch eases a band down to a page that keeps its place (Hide the toolbar -> Sidebar + address: the morph grows the 6 px band from 1 px), the band's foot comes to the page slowly (5.5, 5.6 ... 5.94 pt
 *  over the ease's last 80 ms) and the band's light ends at its foot (`--amb-y0`, footTop). Dropped at half a point, the strip left the rows between that foot and the page to the bare frame: at 2x one
 *  device row, for 1 to 2 frames on every take (G 53 between a band of 96 and the page, real key-window frames; the interface layer alone, captured every 3 ms: that row at the bare frame's 31 while the
 *  rows over it were lit). So under the foot of a band in a switch the strip stays until the foot meets the page (CAP_MEET); everywhere else, and at rest, the half point stands as it was. */
const CAP_MEET = .02;
function placeCap(c: DOMRect, b: DOMRect, band: DOMRect | null, rest: DOMRect | null, hidden: boolean) {
  if (!cap) return;
  const r = (v: number) => Math.round(v * 100) / 100, pageTop = rest ? rest.top : c.top, underFoot = !!band && band.height > 0 && !hidden && !rest, from = !band ? b.top : underFoot ? band.bottom : band.top;
  const snap = underFoot && root().hasAttribute('data-mode-switch') ? CAP_MEET : .5;
  const above = Math.abs(from - pageTop) <= snap ? 0 : Math.max(0, r(pageTop - from)), down = Math.max(0, r(from - (band ? band.top : b.top))), place = above + '|' + down;
  if (cap.host.dataset.mt !== place) { cap.host.dataset.mt = place; cap.host.style.setProperty('--amb-mt', above + 'px'); cap.host.style.setProperty('--amb-top', down + 'px'); if (above > snap) cap.host.setAttribute('data-cap', ''); else cap.host.removeAttribute('data-cap'); }
  if (above > .5) capRows = above;
  if (band && band.height > 0 && !hidden) { const bar = r(band.height); if (capBack) capReturn(bar); if (!root().hasAttribute('data-mode-switch') && cap.host.dataset.bar !== String(bar)) { cap.host.dataset.bar = String(bar); root().style.setProperty('--amb-bar', bar + 'px'); } }
}
/** THE NEAR-SIDE STRIP (D111) is rendered where the card rests a margin in from the window's edge on the sidebar's side and no sidebar stands there (sides: a docked, floating or Mini sidebar's light). */
function placeNear(live: boolean, margin: number) {
  if (!near) return;
  const shown = live && sides.size === 0 && margin > .5;
  if (shown !== near.host.hasAttribute('data-cap')) { if (shown) near.host.setAttribute('data-cap', ''); else near.host.removeAttribute('data-cap'); }
}
/** The same from the live boxes, in the frame the shell changes size (its own size observer: after layout, before the frame is drawn). The shared watcher repaints two frames after a change: for those
 *  two frames a band that had just been given its height and the strip under its old 1 px were both lit (the Sidebar mode morph, Hide the toolbar to Sidebar + address: one frame 18 levels over, real frames). */
let capWatch: ResizeObserver | null = null, capWatched: Element | null = null, boxWatch: ResizeObserver | null = null, capBody: Element | null = null;
function watchCap() {
  if (typeof ResizeObserver !== 'function') return;
  // D117: the browser's column too, whose height changes in the frame the band above it goes or comes; its own watcher places the corners' host only (the strip keeps its own moments)
  const body = corners?.host.parentElement ?? null;
  if (body !== capBody) { boxWatch?.disconnect(); capBody = body; if (body) { boxWatch ??= new ResizeObserver(settleBox); boxWatch.observe(body); } }
  const shell = document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer) .browser-shell');
  if (shell === capWatched) return;
  capWatch?.disconnect(); capWatched = shell;
  if (!shell) return;
  capWatch ??= new ResizeObserver(settleCap);
  capWatch.observe(shell);
}
function settleBox() { const body = corners?.host.parentElement, card = body?.querySelector<HTMLElement>(':scope > .page-area'); if (!on || !corners || !body || !card) return; placeBox(corners.host, card.getBoundingClientRect(), body.getBoundingClientRect()); }
/** D117 (20 Nov): THE CORNERS' HOST IS PLACED IN THE FRAME THE SHELL CHANGES SIZE, as the strip and the bar's foot are. The host stands in the browser's column at the card's offset; when the shell
 *  above the column changes height (Sidebar + address <-> Hide the toolbar: the band goes, the column rises and the card's offset in it grows) the host rode up with the column until the next paint
 *  re-placed it, a frame later: for that one frame the corner pieces stood 3 to 4 pt above the page's corners (the sidebar's corner lit above the page, 118 to 126 against 91, and dark in the
 *  page's curve, 33 to 37) and the strip under the page ended short of the window's foot (unlit, 35 to 42 against 93), in about half the launches, both ways (real frames, the release tip too). */
function placeBox(host: HTMLElement, c: DOMRect, b: DOMRect) {
  const r = (v: number) => Math.round(v * 100) / 100;
  const box = `${r(c.left - b.left)}|${r(c.top - b.top)}|${r(c.width)}|${r(c.height)}|${r(b.right - c.right)}|${r(b.bottom - c.bottom)}`;
  if (box !== host.dataset.box) { host.dataset.box = box; host.style.left = r(c.left - b.left) + 'px'; host.style.top = r(c.top - b.top) + 'px'; host.style.width = r(c.width) + 'px'; host.style.height = r(c.height) + 'px'; host.style.setProperty('--amb-mr', Math.max(0, r(b.right - c.right)) + 'px'); host.style.setProperty('--amb-ml', Math.max(0, r(c.left - b.left)) + 'px'); host.style.setProperty('--amb-mb', Math.max(0, r(b.bottom - c.bottom)) + 'px'); }
}
function settleCap() { const sh = capWatched as HTMLElement | null, body = corners?.host.parentElement, card = body?.querySelector<HTMLElement>(':scope > .page-area'); if (!on || !sh) return; const band = sh.getBoundingClientRect(); footTop(sh, band.height); if (!cap || !body || !card) return; const resting = edgeRestPage(), c = card.getBoundingClientRect(), b = body.getBoundingClientRect(); if (corners) placeBox(corners.host, c, b); placeCap(c, b, band, resting && (Math.abs(resting.top - c.top) > .5 || Math.abs(resting.height - c.height) > .5 || Math.abs(resting.left - c.left) > .5 || Math.abs(resting.width - c.width) > .5) ? resting : null, sh.dataset.seamless === 'hidden'); }
/** THE BAR'S LIGHT ENDS AT THE SHELL'S FOOT (`--amb-y0`, the shell's height: `geometry`), kept in the frame the shell changes size, as the strip is. The repaint at a layout switch's commit (the root observer
 *  below) measured a shell still 1 px tall where the header takes its whole height in the next frame (a session started with Reduce motion on), and until the shared watcher painted again two frames later
 *  the whole bar was lit as though the page lay under its top row: the first frame of the toolbar coming back 12 levels over the bar's rest at its top, falling to nothing at its foot (real takes, 1 in 4).
 *  Only the mask's foot moves here; the colours are those already painted (the key keeps the same image). */
function footTop(shell: HTMLElement, height: number) {
  const key = top?.paintedKey;
  if (!top || !key || !(height > 0) || top.host.parentElement !== shell) return;
  const cut = key.lastIndexOf('|'), y0 = String(height);
  if (key.slice(cut + 1) === y0) return;
  top.host.style.setProperty('--amb-y0', y0 + 'px'); top.paintedKey = key.slice(0, cut + 1) + y0;
}
function removeCorners() { corners?.host.remove(); cap?.host.remove(); capWatch?.disconnect(); capWatched = null; boxWatch?.disconnect(); capBody = null; capEnd(); corners = null; cap = null; near = null; strips = []; }
function paintCorners(live: boolean, instant = false, frame?: Frame) {
  const host = live ? ensureCorners() : corners?.host;
  if (!host || !corners) return;
  watchCap();
  const card = host.parentElement?.querySelector<HTMLElement>(':scope > .page-area'), measured = frame?.corners ?? null;
  const shell = document.querySelector<HTMLElement>('.browser-shell'), band = measured ? measured.shell : shell ? shell.getBoundingClientRect() : null;
  if (card && host.parentElement) {
    // the card's own box against the host's container, to the fraction (an interface scale of 125 or 150 % puts the card between two pixels)
    const c = measured ? measured.card : card.getBoundingClientRect(), b = measured ? measured.body : host.parentElement.getBoundingClientRect();
    placeCap(c, b, band, frame?.rest ?? null, shell?.dataset.seamless === 'hidden');
    placeNear(live, sample?.side === 'right' ? b.right - c.right : c.left - b.left);
    placeBox(host, c, b);
  }
  const side = sample?.side === 'right' ? 'right' : 'left', light = cornerLight(live ? stops : null, side, sides.size > 0 || !!near?.host.hasAttribute('data-cap'), (!!top?.host.isConnected && !!band && band.height > 0) || !!cap?.host.hasAttribute('data-cap'), siteGlowBase()?.frame ?? null);   // lit from above by the bar, or by the strip above the page where there is no bar (D105)
  // Beside a FLOATING sidebar the two cut-outs at the sidebar's edge are not the card's own pieces: they are the pieces that slide with the sidebar (`.sidebar-page-corners`, sidebar-overlay.css), so their light slides with them
  // too (the card's pieces stand at the sidebar's resting edge for the whole slide: the page's corner travelled with a dark notch beside it). The top one takes the top row's colour where the sidebar cuts the page, the
  // bottom one the colour of the row under the page at the same place (the column ends with it); the card's own two pieces at that edge are left clear.
  const cut = live && frame ? cutStop(frame) : null, floats = !!cut && sides.size > 0;
  const lowStop = floats && frame ? cutStop(frame, true) : null;
  const cutTop = floats ? rgba(cut!) : 'transparent', cutLow = floats ? (lowStop ? rgba(lowStop) : side === 'right' ? light.br : light.bl) : 'transparent';
  if (floats) { if (side === 'right') { light.tr = 'rgb(0 0 0 / 0)'; light.br = 'rgb(0 0 0 / 0)'; } else { light.tl = 'rgb(0 0 0 / 0)'; light.bl = 'rgb(0 0 0 / 0)'; } }
  const key = `${light.tl}|${light.tr}|${light.bl}|${light.br}|${cutTop}|${cutLow}`;
  if (key === corners.key) return;
  corners.key = key;
  for (const piece of document.querySelectorAll<HTMLElement>('.sidebar-page-corners')) piece.style.setProperty('--amb-cut', piece.classList.contains('sidebar-page-corners-low') ? cutLow : cutTop);
  // A layout switch (the sidebar docking or leaving, the toolbar coming back) changes which neighbours are lit: the colours are the new state's from its FIRST frame (the switch photographs the new state then; a 320ms colour
  // change would be photographed at its start, transparent, and the card's opening would run with four dark wedges that light up a third of a second after it settles). A change of the page's own colours keeps the glide.
  if (instant) host.style.transition = 'none'; else host.style.transition = easeNow ? (['tl', 'tr', 'bl', 'br'] as const).map(k => `--amb-c-${k} ${fadeInMs()}ms linear`).join(', ') : '';
  for (const k of ['tl', 'tr', 'bl', 'br'] as const) host.style.setProperty(`--amb-c-${k}`, light[k]);
  if (instant) { void host.offsetWidth; host.style.transition = ''; }
}
/** A sidebar's head light: made when its side layer stands in a sidebar that floats beside the frame, or in one that is docked; removed when the sidebar goes. The wrapper is as tall as the top band and the tail under it. */
function syncHeads() {
  const rest = edgeRestPage();
  for (const side of sides) {
    const rail = side.host.parentElement, floats = !!rest && !!rail && rail.classList.contains('is-peek') && side.host.isConnected;
    // THE MINI RAIL AT REST is the same: its light layer stands outside the rail (miniRail.css `.sb-mini-amb`: as wide as the sidebar, its page-side edge at the rail's edge), and the head inside that layer is the rise at the
    // rail's edge over the rail's own fill. It rides with the layer when the rail floats open.
    // DOCKED (reported 18 Nov 23:00, on the collapse work's frames: "none of these lines and discoloration, different colors"): THE HEAD IS THE SIDEBAR in every state. A docked sidebar's head was the quarter circle of
    // ONE FIELD: the bar's light carried 232 px into the sidebar along its top (+17 to +19 levels at the edge, +3 still 80 pt in), a lit band over the head. Now the same piece as the floating sidebar's: the short rise
    // at the edge, the tail below the foot, the column coming in from the foot. Nothing floats here, so the piece stands INSIDE the side layer (it slides, grows and leaves with it in every transition the layer already has)
    // and its colours are the top row over the page card: the corner's colour across the head. Not in Sidebar + address, which has no bar beside the sidebar (the band there is the frame's 6 px).
    const stands = !floats && !!rail && side.host.isConnected && (side.host.classList.contains('sb-mini-amb') || (rail.classList.contains('is-expanded') && !rail.classList.contains('is-peek'))) && !document.querySelector('.browser-shell[data-sbmode]');
    // THE CORNER IS ONE VALUE (the team, 19 Nov, on the real takes of "the head is the column": a ridge at the sidebar's edge, the head 8 to 12 levels over the bar it joins on the window's top rows, and on the
    // first frame of a reveal the arriving head 38 levels over both resting states at the window's edge). Two things follow.
    // 1. In every state the head's light at a point is the column's at the FARTHER of its two distances from the page (across, and up from the bar's foot): at the edge it is the bar's light on every row, further
    //    in the column's. The side layer's own mask does it (`data-headed`, styles/ambient.css; the clamp's four alphas from the band's height, `--amb-d1..4`): a docked sidebar and the Mini rail need no piece.
    // 2. A FLOATING sidebar travels over the bar, and what travels must never be brighter than what stood there: its head is the BAR'S OWN colours, standing still, seen through the sidebar's field (this piece:
    //    the top row, no fall-off of its own, the field on its wrapper and on its travelling picture), and the column joins it over the 40 px under the foot (the piece goes out, the column comes in).
    const wants = floats, lit = floats || stands;
    if (lit) { if (!headed.has(side)) { headed.add(side); side.host.setAttribute('data-headed', ''); } } else if (headed.delete(side)) side.host.removeAttribute('data-headed');
    let has = heads.get(side);
    if (wants && !has?.host.isConnected) {
      const wrap = document.createElement('div'); wrap.className = 'st-amb-head'; wrap.setAttribute('aria-hidden', 'true');
      const host = document.createElement('div'); host.className = 'st-amb-head-in'; wrap.appendChild(host);
      rail!.insertBefore(wrap, side.host.nextSibling);
      heads.set(side, make(host, 'head'));
    } else if (!wants && has) { has.host.parentElement?.remove(); heads.delete(side); }
    if (lit && rail) {
      const page = pageNode(), shellNode = document.querySelector<HTMLElement>('.browser-shell'), p = page ? page.getBoundingClientRect() : null, sr = shellNode ? shellNode.getBoundingClientRect() : null;
      const wrap = heads.get(side)?.host.parentElement, top = (floats ? rail : side.host).getBoundingClientRect().top, foot = Math.max(0, Math.round((bandBottomOf(p, sr) - top) * 100) / 100);
      // The lengths are on the ROOT: the travelling pictures of a reveal read them too (styles/view-morph.css). The band's foot, the 40 px under it, the corner's clamp for a band that tall.
      const key = foot + '/' + BLEED_TAIL;
      if (side.host.dataset.foot !== key) { side.host.dataset.foot = key; const st = document.documentElement.style; st.setProperty('--amb-foot', foot + 'px'); st.setProperty('--amb-tail', BLEED_TAIL + 'px'); cornerClamp(foot).forEach((v, i) => st.setProperty(`--amb-d${i + 1}`, String(v))); }
      const right = sample?.side === 'right', at = p && stops && stops.t.length ? stopAt(stops.t, rest ? ((right ? p.right : p.left) - rest.left) / rest.width : right ? 1 : 0) : null;
      // The 10 px at a TRAVELLING edge (styles/view-morph.css): there the bar's own picture and the head's cross over each other, and both are at the band's strength on their row, not at the light's full
      // share: bent by the share times the band's mean strength (a bend by the full share left the pair 4 % over the bar on the window's top rows: a real take read 80 where the bar had stood at 74).
      // (For EVERY lit sidebar, D54 (c): a docked sidebar's light and the bar's window cross over the same 10 px when the sidebar leaves or arrives in a layout switch, styles/ambient.css. With no bend
      // there, a straight .25 / .5 / .75, the pair stood 10 levels under the bar in the middle of the crossover.)
      const edge = [.25, .5, .75].map(b => bleedFade((at?.alpha ?? 0) * (1 + fallOff(foot)) / 2, b)).join(' ');
      if (side.host.dataset.edge !== edge) { side.host.dataset.edge = edge; edge.split(' ').forEach((v, i) => document.documentElement.style.setProperty(`--amb-e${i + 1}`, v)); }
      if (wrap) {
        const height = foot + BLEED_TAIL + 'px'; if (wrap.style.height !== height) wrap.style.height = height;
        // Under the foot the piece and the column cross over each other as layers, one drawn over the other: the piece's fade is bent by the light's share so that they add up to the straight blend (bleedFade).
        const bend = [.25, .5, .75].map(b => bleedFade(at?.alpha ?? 0, b)).join(' ');
        if (wrap.dataset.bend !== bend) { wrap.dataset.bend = bend; bend.split(' ').forEach((v, i) => document.documentElement.style.setProperty(`--amb-b${i + 1}`, v)); }
      }
    }
  }
  for (const [side, head] of [...heads]) if (!sides.has(side)) { head.host.parentElement?.remove(); heads.delete(side); }
  for (const side of [...headed]) if (!sides.has(side)) headed.delete(side);
}
function surfaces(): Surface[] { syncHeads(); const t = on ? ensureTop() : top; return [...sides, ...heads.values(), ...(t ? [t] : []), ...strips.filter(strip => strip.host.isConnected)]; }
function paint(instant = false) {
  const live = on && hasLight(stops);
  if (live) root().setAttribute('data-ambient-light', ''); else root().removeAttribute('data-ambient-light');
  if (live) ensureCorners();   // the strips round the card are made before they are measured and painted
  const list = surfaces(), frame = live || corners ? measure(list, true) : undefined;   // every rectangle first, then every write
  for (const surface of list) { if (live && (stops && (surface.kind === 'far' ? stops.r.length : surface.kind === 'bottom' ? stops.b.length : surface.kind === 'near' ? stops.l.length : true))) show(surface, instant, frame); else hide(surface); }
  paintCorners(live, instant, frame);
}
function recompute() {
  if (!on || !sample) { stops = null; return; }
  const base = siteGlowBase(); if (!base) return;
  const level = (root().getAttribute('data-site-color') as SiteColorLevel | null) ?? 'soft', next = ambientStops(sample, base, level);
  if (sameLight(next, stops)) return;
  stops = next;
}
function receive(next: (AmbientSample & { reason?: string }) | null) {
  if (!next) { sample = null; stops = null; paint(); return; }
  sample = next; const before = stops; fadeNow = typeof next.fade === 'number' && next.fade >= 0 ? next.fade : null; easeNow = next.reason === 'resize' ? 'linear' : null;
  try { recompute(); if (stops !== before || !stops) paint(); } finally { fadeNow = null; easeNow = null; }
}
/** Mount a sidebar's light (a React ref: the layer is there, and painted, in the very commit that mounts the sidebar). */
export const ambientSideRef = (el: HTMLElement | null) => {
  if (!el) return undefined;
  const surface = make(el, 'side'); sides.add(surface); syncHeads(); const head = heads.get(surface); const frame = measure(head ? [surface, head] : [surface], true); show(surface, performance.now() - enabledAt > 1500, frame); if (head && on && hasLight(stops)) show(head, true, frame);   // switched on a moment ago: the light fades in; arriving with its sidebar: there from the first frame (a floating sidebar's head with it, at full strength: nothing grows after it is on screen)
  if (on && hasLight(stops)) paintCorners(true, true, frame);   // the sidebar is docking: its corners with it, in the same commit
  // A sidebar that MOUNTS inside a layout switch or an edge reveal is arriving: its light grows from the page-side edge on the surface's clock (`data-arrive`, styles/ambient.css). One that is already there
  // when the switch starts is the old state being photographed (the switch's attribute is set before the old picture is taken): it keeps its full light, so a closing begins with the light it had.
  const kind = document.documentElement.dataset?.modeSwitch;
  let arrived = 0;
  if (kind === 'layout' || kind === 'edge') { el.setAttribute('data-arrive', ''); arrived = window.setTimeout(() => el.removeAttribute('data-arrive'), 1200); }
  return () => { sides.delete(surface); const gone = heads.get(surface); if (gone) { gone.host.parentElement?.remove(); heads.delete(surface); } clearTimeout(arrived); queueMicrotask(() => { if (on) paint(true); }); };   // the near strip (D111) is placed in the commit that unmounts the sidebar: a switch takes its new pictures on the next frame
};
const later = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; paint(true); }); };

export function installAmbient(): void {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  installed = true;
  // 14.1 Your colours: while the still glow is on (frameGlowOn), the light is the person's colours (fixedGlowSample) and main's reads of the page are not
  // drawn (main does not read them then either: desktop/main.cjs ambientOn).
  (window as unknown as { __aciraAmbient: typeof receive }).__aciraAmbient = (next) => { if (!fixedKey) receive(next); };
  const watch = (raw: { settings?: { ambientMode?: unknown; siteColor?: unknown }; windowUi?: { view?: unknown } } | null | undefined) => {
    if (!raw?.settings) return;
    const view = effectiveView(raw.settings as never, raw.windowUi as never);
    const own = raw.settings as never, noelLight = (raw.settings as { noelOn?: unknown }).noelOn === true && (raw.settings as { colorPreset?: unknown }).colorPreset !== 'Own' && ambientOn(raw.settings, view) ? [NOEL_LIGHT] : [], glow = frameGlowOn(own) && view !== 'seamless' ? frameColours(own) : noelLight, key = glow.length ? `${glow.join(',')}|${(raw.settings as { sidebarSide?: unknown }).sidebarSide === 'right' ? 'right' : 'left'}` : '';
    const wanted = ambientOn(raw.settings, effectiveView(raw.settings as never, raw.windowUi as never)) || !!key;   // the switch AND not Seamless; Site color does not enter it (ambientGate.ts); or the still glow in the person's colours (14.1)
    if (wanted === on) { if (on && key !== fixedKey) { fixedKey = key; receive(key ? fixedGlowSample(glow, key.endsWith('right') ? 'right' : 'left') : null); } return; }
    fixedKey = wanted ? key : '';
    on = wanted; clearTimeout(removal); removal = 0;
    if (!on) {
      sample = null; stops = null; paint();
      // the light has faded away: the layers go (setting off = no element)
      removal = window.setTimeout(() => { removal = 0; if (on) return; removeTop(); removeCorners(); setMounted(false); }, fadeOutMs() ? fadeOutMs() + 120 : 0);
    } else { enabledAt = performance.now(); setMounted(true); recompute(); paint(); if (fixedKey) receive(fixedGlowSample(glow, fixedKey.endsWith('right') ? 'right' : 'left')); }
  };
  try { window.acira?.subscribe?.(watch as never); void window.acira?.getSnapshot?.().then(watch as never); } catch { /* no window to follow */ }
  watchPageBand(later);   // the page or the toolbar changed size, or the view changed: repaint in place
  // THE TOOLBAR HIDDEN, SHOWN OR BACK (D105): placed in the very commit. The watcher above repaints on the second animation frame after a change (its own frame, then `later`'s); a layout switch takes the new
  // state's pictures on the first, so the strip above the page (not rendered until `paintCorners` has measured the card's new place) was not in them: the leaving bar's light and the arriving strip were then
  // two pictures on two clocks, lit twice where they met. The root's mirror of the shell's state (ui/rootMirror.ts, App.tsx) is set in the commit itself, and an observer's callback runs before the next frame.
  // A layout switch that brings the toolbar BACK (the strip was lit, and is not in the new state) arms the strip's old picture (capReturn). And when a switch has ended (`data-mode-switch` gone) the bar's
  // height is taken once more, at rest: the property a reveal's pictures read from the root is written then, never while a switch plays.
  new MutationObserver(records => {
    if (!on) return;
    if (records.some(record => record.attributeName === 'data-m-seamless')) { const lit = !!cap?.host.hasAttribute('data-cap'); paint(true); capEnd(); if (lit && cap && !cap.host.hasAttribute('data-cap') && root().dataset.modeSwitch === 'layout') capBack = { anim: null, done: false }; }
    if (!root().hasAttribute('data-mode-switch')) { capEnd(); settleCap(); }
  }).observe(root(), { attributes: true, attributeFilter: ['data-m-seamless', 'data-mode-switch'] });
  // a different finish, light or dark, or a different Site colour: the colours are derived again from the same sample
  const again = () => { const before = stops; stops = null; recompute(); if (stops !== before) paint(true); };
  new MutationObserver(again).observe(root(), { attributes: true, attributeFilter: ['data-site-color', 'data-site-glow-tone'] });
  let watched: Element | null = null;
  const chrome = () => { const node = app(); if (node && node !== watched) { watched = node; new MutationObserver(again).observe(node, { attributes: true, attributeFilter: ['data-chrome', 'data-appearance'] }); } };
  chrome(); new MutationObserver(chrome).observe(document.body, { childList: true });
}
