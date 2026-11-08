import { useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { BrowserRuntime } from '../runtime/types';
import { motionScale, motionSpeed, registerPageRiseSpring, springEasing, springFor, startModeTransition, type MotionTokenId } from './sharedMotion';
import { noteUse } from '../features/metrics/noteUse';
import { mirrorSpan, rootSidebarSide } from './sidebarSide';

/** R3-68 Seamless, the interface's half. Main (desktop/edge-reveal.cjs) watches the pointer and says when the toolbar (top edge)
 * and the sidebar (left edge) show: `chrome-edge { top, side, pinned }`. This module holds that answer for React, plays the
 * reveal or hide as a view transition (spring tokens, compositor only), tells main what asks for an edge (a key press) and what
 * keeps one open (a popup, a drag, focus in the chrome), and says which spring the native page should follow.
 * Tier B of the spec: the page glides (main's 'slide' page motion) and reflows once. */
export interface EdgeState { top: boolean; side: boolean; pinned: { top: boolean; side: boolean } }
const rest: EdgeState = { top: false, side: false, pinned: { top: false, side: false } };
let edge: EdgeState = rest;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** The edges the interface shows because a key asked for them (the address field has focus, a new tab, F10), so a pointer reveal
 * that arrives for an edge already showing starts no transition. App keeps this current. */
const asks = { top: false, side: false };
export function setEdgeAsks(top: boolean, side: boolean): void {
  // A key that shows the toolbar (Ctrl+L, a new tab) floats it too, so the page under it never moves (R4-24).
  if (top && !asks.top && floatable) setFloat(true);
  if (!top && asks.top && floating && !edge.top && !edge.side) {
    window.clearTimeout(floatTimer);
    const generation = floatGeneration, transition = edgeTransition;
    const finish = () => { if (generation === floatGeneration && !asks.top && !edge.top && !edge.side && (!transition || transition === edgeTransition)) setFloat(false); };
    // Focus can leave the address bar during the sidebar's exit. Its old 200ms timer
    // could lower the frame halfway through the Premium animation or a delayed capture.
    if (transition) void transition.finished.then(finish, finish);
    else floatTimer = window.setTimeout(finish, 200);
  }
  asks.top = top; asks.side = side;
}
let activeTab = '', activeSplit = false;
/** The native bridge, looked up when needed (this module is imported by tests and by the preview, where there is none). */
const bridge = (): BrowserRuntime | undefined => typeof window === 'undefined' ? undefined : (window as unknown as { acira?: BrowserRuntime }).acira;
/** The tab id the interface's edge commands travel with (main wants one on every command). */
export function bindEdgeTab(id: string, split = false): void {
  // A split opening or closing around the same tab changes what is pictured, too: the one page's picture stood over the whole split (and a pane's over the page) while the sidebar was out.
  const changed = id !== activeTab || split !== activeSplit; activeTab = id; activeSplit = split;
  // Another website chosen in the floating sidebar: main holds it outside the window from its first frame; picture it, keeping
  // the previous picture until the new one stands. (An internal page chosen instead ends the picture in setEdgeFloatable.)
  if (!changed || !floating || !floatFrame || !floatNative) return;
  // The previous picture bridges one page to the next; a split's pictures, or one page's over a split, would show the wrong
  // page in the wrong place, so those leave at once (the newly shown sites wait outside the window meanwhile).
  const previous = picture?.map(shot => shot.img), single = !split && previous?.length === 1 && !picture![0].img.closest('.page-pane[data-pane]');
  picture = null;
  if (!single) { previous?.forEach(img => img.remove()); repicture(); } else repicture(previous);
  requestAnimationFrame(() => placeStills(12, split ? undefined : id));
}

export const useChromeEdge = (): EdgeState => useSyncExternalStore(subscribe, () => edge);
export const currentEdge = (): EdgeState => edge;

/** The spring the native page should follow for a transition that has just started (it lasts a little longer than the spring
 * itself, to cover the layout message crossing to main). */
let flight: { duration: number; bounce: number; until: number } | null = null;
let edgeTransition: ReturnType<typeof startModeTransition> = null;
let edgeBusy = false, pendingEdge: EdgeState | null = null;
export function edgePageSpring(): { duration: number; bounce: number } | null {
  return flight && performance.now() < flight.until ? { duration: flight.duration, bounce: flight.bounce } : null;
}

/** Entering Seamless from another view (spec §12, mode switches): the page grows from where the toolbar stood to the card on the toolbar's hide spring,
 * glided by main like an edge hide's. It snapped to the card before. The layout message that follows the switch carries this spring for a moment. */
let entry: { duration: number; bounce: number; until: number } | null = null;
export function noteSeamlessEntry(): void {
  const spec = springFor('seamless.hide', motionSpeed());
  entry = spec ? { duration: spec.duration, bounce: spec.bounce, until: performance.now() + 400 } : null;
}
/** Hide the toolbar turned off (Settings › Appearance › Layout): the toolbar comes back and the page's top edge goes down from the card's rest to under it, on the reveal's spring, glided by main like an
 * entry's (the header's own height spring under a heavy page re-laid it out about twenty times). */
export function noteToolbarReturn(): void {
  const spec = springFor('seamless.reveal', motionSpeed());
  entry = spec ? { duration: spec.duration, bounce: spec.bounce, until: performance.now() + 400 } : null;
}
export function seamlessEntrySpring(): { duration: number; bounce: number } | null {
  return entry && performance.now() < entry.until ? { duration: entry.duration, bounce: entry.bounce } : null;
}

/** Plays `update` (which must apply the change synchronously) as the reveal or hide of an edge. The spring's perceptual duration
 * already carries the speed setting (Premium stretches it); None (Animation speed "None", the Reduce motion switch) applies the change at once: a cut, no fade. */
export function startEdgeTransition(kind: 'reveal' | 'hide', update: () => void, headerHeight = 72): number {
  if (kind === 'reveal') noteUse('seamlessReveals'); // R4-60: counted only while usage sharing is on, as a daily bucket
  const token: MotionTokenId = kind === 'reveal' ? 'seamless.reveal' : 'seamless.hide', spec = springFor(token, motionSpeed());
  const root = document.documentElement;
  if (!spec) {
    edgeTransition = null;
    update();
    return 0;
  }
  // R4-24 (founder: "moves at a linear speed"): a strong ease-out for the reveal (fast start, gentle landing, no overshoot) and an
  // ease-in-out a little quicker for the hide; 200 / 170ms at Fast, stretched by the speed setting (Premium 340 / 289ms).
  const scale = motionScale() || 1, duration = Math.round((kind === 'reveal' ? 200 : 170) * scale);
  const easing = kind === 'reveal' ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.65, 0, 0.35, 1)';
  void springEasing;
  root.style.setProperty('--edge-ms', `${duration}ms`);
  root.style.setProperty('--edge-ease', easing);
  root.style.setProperty('--edge-h', `${headerHeight}px`);
  syncPixelEase();
  flight = { duration: spec.duration, bounce: spec.bounce, until: performance.now() + duration + 400 };
  // Keep the live page clipped while Chromium captures the old frame. Unclipping
  // it beforehand paints one page-tinted frame through the translucent sidebar.
  // The update callback runs with that old frame frozen, before the new capture.
  delete root.dataset.edgeSnapshot;
  edgeTransition = startModeTransition(() => { root.dataset.edgeSnapshot = ''; update(); }, 'edge');
  if (!edgeTransition) delete root.dataset.edgeSnapshot;
  return duration;
}

/** R4-24 Tier A, the side (spec §12.3): a sidebar the pointer or a key reveals floats over the page instead of pushing it. Main raises the
 * interface view over the page views while `floating`; here the page's rect becomes a hole (the window's own background is copied onto
 * a masked layer, the page placeholder hides), the native page keeps its bounds (App's physicalLayout reads isEdgeFloating), and a click
 * or wheel on the page goes on to it. It ends only after the hide has played, so the page is never uncovered by a placeholder. */
/* R4-54 (founder: "in Seamless, in Settings, I can't get the sidebar to open"): the float is for every page kind, not only a single website.
 * - 'native': the page is a native view (a website, every pane of a split). As above: holes over the page's rects, main raises the
 *   interface, clicks and wheel go on to the pane under the pointer.
 * - 'dom': the page is drawn by the interface itself (Settings, History, Bookmarks, Downloads, Rewind, the new tab page, an error or
 *   reader page). Nothing to cut out or raise: the sidebar and toolbar simply lie over the page (seamless.css), which keeps its place.
 * Either way the sidebar and toolbar leave the layout while they float, so the page never moves or reflows (seamless.css data-edge-float). */
type Hole = { x: number; y: number; w: number; h: number; tabId: string; /** A split pane's title strip, above the hole: the card's own top corner is at the strip's top. */ label?: number };
let floatable = false, floatNative = true, floating = false, floatKind: 'native' | 'dom' = 'native', floatTimer = 0, holes: Hole[] = [], pageRect: DOMRect | null = null;
let connectedFrame = false, floatFrame = false, restHoles: Hole[] = [];
let floatGeneration = 0, nativeFloatRaised = false;
let desktopMaterialKey='',desktopMaterialRevision=0,desktopClip={left:0,top:0},desktopInset={right:0,bottom:0},desktopBand={right:0,bottom:0};
/** Where the page's covered edge and its right and bottom bands stood when the running transition began (see syncDesktopMaterial). */
let desktopStart:{clip:{left:number;top:number};band:{right:number;bottom:number};transition:unknown}|null=null;
/** While the top bar leaves, the frame's tint keeps the cut-out the page card had (its top under the bar). The page's edge climbs over the
 * transition but the new layout's cut-out starts at the final top at once, so the band the card had not yet covered showed bare glass, a
 * lighter flash before the bar's own fade; the tint now stays on that band and the cut-out moves when the transition ends. */
let holdVeil = false;
/** The page card as it stood beside the sidebar: while the sidebar leaves, the frame keeps that cut-out (its bands stay tinted) and the
 * card's own edges grow back to the page's resting place on the slide's curve (founder, 30 Oct: the bottom band blinked out). */
let framedVisible: Hole[] | null = null;
/** The sidebar, its corner pieces, the card's edge and its frame line slide together as separate layers. Between whole screen pixels
 * each one's soft edge met the next one's and left a faint seam down the sidebar's edge and around the corners (founder, 30 Oct: "it
 * should be as if it's one"). The same curve taken in steps of one screen pixel of the slide (--edge-ease-px) puts every frame of
 * those layers on whole pixels, so they meet exactly; --px is one screen pixel, for edges moved by animated lengths instead. */
let pixelEaseKey = '';
export function pixelSteps(bezier: readonly [number, number, number, number], steps: number): string {
  const [x1, y1, x2, y2] = bezier, at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const stops = ['0 0%'];
  for (let k = 1; k <= steps; k++) {
    // The moment the curve passes halfway to the next pixel: the step lands where rounding the smooth curve would.
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const s = (lo + hi) / 2; if (at(y1, y2, s) < (k - .5) / steps) lo = s; else hi = s; }
    const time = (at(x1, x2, (lo + hi) / 2) * 100).toFixed(4);
    stops.push(`${((k - 1) / steps).toFixed(6)} ${time}%`, `${(k / steps).toFixed(6)} ${time}%`);
  }
  return `linear(${stops.join(',')},1 100%)`;
}
/** An edge of the interface as the screen draws it: a box is painted on its nearest whole device pixel, so at 125% the 6px inset (7.5 device px) is drawn from the 8th. The frame's cut-out,
 * the sidebar's slide and the page's covered edge are measured from such edges; taken unsnapped, the cut-out and the picture (or the page) filling it met on half a pixel and left a
 * row or column of half-tinted glass along the card's edge (a thin bright line on Windows at 125% and 175%, founder, 5 Nov), and a slide of 292.5 device pixels moved the sidebar's edge
 * and the page's by different fractions each frame. Whole numbers at 100% and 200% for whole CSS lengths: unchanged there. */
export const snapPx = (value: number): number => { const ratio = window.devicePixelRatio || 1; return Math.round(value * ratio) / ratio; };
function syncPixelEase(): void {
  const root = document.documentElement, ease = root.style.getPropertyValue('--edge-ease').trim(), ratio = window.devicePixelRatio || 1;
  const steps = Math.round((parseFloat(root.style.getPropertyValue('--sf-sidebar-travel')) || 0) * ratio), key = `${ease}|${steps}`;
  root.style.setProperty('--px', `${1 / ratio}px`);
  if (key === pixelEaseKey) return;
  pixelEaseKey = key;
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(ease)?.[1].split(',').map(Number);
  // A curve that overshoots does not pass each pixel once; it keeps the smooth curve.
  if (!bezier || bezier.length !== 4 || bezier.some(n => !Number.isFinite(n)) || bezier[1] < 0 || bezier[1] > 1 || bezier[3] < 0 || bezier[3] > 1 || steps < 2 || steps > 2400) root.style.removeProperty('--edge-ease-px');
  else root.style.setProperty('--edge-ease-px', pixelSteps(bezier as [number, number, number, number], steps));
}
/** The Mac backing samples behind the window, beneath the transparent chrome.
 * Start its mask on the same snapshot-ready boundary as the interface movement. */
function syncDesktopMaterial(app:HTMLElement,visible:Hole[]):void {
  const root=document.documentElement;if(root.dataset.desktopMaterial!=='ready')return;
  const empty={x:0,y:0,width:0,height:0,radius:0};
  const region=(node:HTMLElement|null)=>{if(!node||node.dataset.seamless==='hidden')return empty;const r=node.getBoundingClientRect();return{x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.max(0,r.width),height:Math.max(0,r.height),radius:parseFloat(getComputedStyle(node).borderTopLeftRadius)||0};};
  const toolbar=region(app.querySelector('.browser-shell')),sidebar=region(app.querySelector('.acira-sidebar.is-peek'));
  root.style.setProperty('--desktop-bg-size',`${innerWidth}px ${innerHeight}px`);
  root.style.setProperty('--desktop-sidebar-bg-position',`${-sidebar.x}px ${-sidebar.y}px`);
  root.style.setProperty('--desktop-toolbar-bg-position',`${-toolbar.x}px ${-toolbar.y}px`);
  const regions=[toolbar,sidebar,...(floatFrame?visible.map(h=>({x:h.x,y:h.y,width:h.w,height:h.h,radius:8})):[])];
  const key=JSON.stringify(regions);if(key===desktopMaterialKey)return;desktopMaterialKey=key;
  // `left`, and `right` below, are the sidebar's side and the far side: with the sidebar on the right the page's covered edge is its right one and the far edge its left.
  const onRight=rootSidebarSide()==='right',clip={left:sidebar.width?Math.max(0,onRight?snapPx(pageRect?.right??innerWidth)-snapPx(sidebar.x):snapPx(sidebar.x+sidebar.width)-snapPx(pageRect?.left||0)):0,top:toolbar.height?Math.max(0,snapPx(toolbar.y+toolbar.height)-snapPx(pageRect?.top||0)):0};
  // One transition can sync more than once (a toolbar arriving with the sidebar measures its height a frame after the layout changes).
  // Its first pass fixes where the page's edges start and later passes move only where they end: otherwise the second pass started
  // the card at its final place while the sidebar was still arriving, with bare glass between them.
  if(!desktopStart||!edgeTransition||desktopStart.transition!==edgeTransition)desktopStart={clip:{...desktopClip},band:{...desktopBand},transition:edgeTransition};
  for(const axis of ['left','top']as const){root.style.setProperty(`--desktop-clip-${axis}-from`,desktopStart.clip[axis]+'px');root.style.setProperty(`--desktop-clip-${axis}-to`,clip[axis]+'px');}
  desktopClip=clip;
  // The page card's right and bottom edges stay put through the slide; a hide keeps the card it leaves from.
  /* The card is every pane together: its right and bottom come from the farthest pane, not the first (a split's later panes were clipped away, and the desktop showed through them) */if(floatFrame&&visible.length&&pageRect)desktopInset={right:Math.max(0,onRight?Math.min(...visible.map(h=>h.x))-pageRect.left:pageRect.right-Math.max(...visible.map(h=>h.x+h.w))),bottom:Math.max(0,pageRect.bottom-Math.max(...visible.map(h=>h.y+h.h)))};
  root.style.setProperty('--desktop-clip-right',desktopInset.right+'px');root.style.setProperty('--desktop-clip-bottom',desktopInset.bottom+'px');
  // The card's right and bottom bands: in from the page's resting edges as the sidebar arrives, back out to them as it leaves.
  const band=sidebar.width>0?desktopInset:{right:0,bottom:0};root.style.setProperty('--desktop-band-frame-bottom',desktopInset.bottom+'px');
  for(const side of ['right','bottom']as const){root.style.setProperty(`--desktop-band-${side}-from`,desktopStart.band[side]+'px');root.style.setProperty(`--desktop-band-${side}-to`,band[side]+'px');}
  desktopBand=band;
  const revision=++desktopMaterialRevision,transition=edgeTransition,duration=root.dataset.modeSwitch==='edge'?parseFloat(root.style.getPropertyValue('--edge-ms'))||0:0,reveal=sidebar.width>0||toolbar.height>0&&edge.top;
  const apply=(ms:number)=>{if(revision===desktopMaterialRevision)send({material:{regions,duration:ms,reveal}});};
  if(duration&&transition)void transition.ready.then(()=>apply(duration),()=>apply(0));else apply(0);
}
/** Over a website the sidebar would float over live page pixels, and no native material can sit between a website and the
 * interface (mac-material.mm). So before the sidebar moves, main takes the page's picture; it stands in the page area exactly
 * over the page, the website steps just outside the window at its own size, and the float plays as for an internal page: the
 * picture is clipped with the sidebar on the compositor and the window's material shows beneath it. The site comes back as
 * the float ends. A split pictures each of its websites in its own pane (founder, 30 Oct: a split's sites showed through the
 * sidebar); its interface pages stay as they are. A slow capture keeps (or returns to) the native float. */
type Shot = { img: HTMLImageElement; tab: string };
let picture: Shot[] | null = null, picturing = false, pictureSkipped = false;
/** A recent still of a page (App's split stills): a split chosen in the floating sidebar shows it in each website pane at once,
 * while that pane's site waits outside the window for its fresh picture, so no pane is ever empty (founder, 30 Oct). */
let stillOf: (tab: string) => string | undefined = () => undefined;
/** Each page's latest picture (a few, most recent last): a page chosen in the floating sidebar shows it at once while its fresh
 * picture is taken, which a heavy page can make take a second; it never stands at another size than the page has now. */
const recent = new Map<string, { url: string; width: number; height: number }>();
function remember(tab: string, img: HTMLImageElement): void {
  recent.delete(tab); recent.set(tab, { url: img.src, width: img.naturalWidth, height: img.naturalHeight });
  while (recent.size > 8) recent.delete(recent.keys().next().value!);
}
export function setEdgeStills(lookup: (tab: string) => string | undefined): void { stillOf = lookup; }
const clearStills = () => document.querySelectorAll('.page-area .edge-page-picture[data-provisional]').forEach(img => img.remove());
function placeStills(tries = 12, single?: string): void {
  if (!floating || !floatFrame) return;
  // One page: its latest picture over the page area, if it was taken at the size the page has now.
  if (single) {
    // Measured against the page's resting place (pageRect): a float that turned native lays the page area out beside the sidebar.
    const content = document.querySelector<HTMLElement>('.page-area .page-content'), shot = recent.get(single), rest = pageRect;
    if (!content || !shot || !rest?.width || content.querySelector('.edge-page-picture') || document.querySelector('.page-area .page-pane[data-pane]')) return;
    if (Math.abs(rest.width / rest.height / (shot.width / shot.height) - 1) > .03) return;
    // The site waits outside the window (holdShownPage), so the page area takes the picture as in a pictured float.
    if (floatKind !== 'dom' && floatNative) { floatKind = 'dom'; refreshEdgeFloat(); }
    const img = new Image(); img.className = 'edge-page-picture'; img.dataset.provisional = ''; img.alt = ''; img.src = shot.url; content.append(img);
    return;
  }
  const panes = [...document.querySelectorAll<HTMLElement>('.page-area .page-pane[data-pane][data-web]')];
  // The split is drawn in the frame after its tab is chosen.
  if (!panes.length) { if (tries > 0) requestAnimationFrame(() => placeStills(tries - 1)); return; }
  for (const pane of panes) {
    const shot = recent.get(pane.dataset.pane!), box = pane.getBoundingClientRect();
    const fits = shot && box.width && Math.abs(box.width / Math.max(1, box.height - (pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0)) / (shot.width / shot.height) - 1) <= .03;
    const url = pane.querySelector('.edge-page-picture') ? undefined : fits ? shot!.url : stillOf(pane.dataset.pane!);
    if (!url) continue;
    const img = new Image(), label = pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0;
    img.className = 'edge-page-picture'; img.dataset.provisional = ''; img.alt = ''; img.src = url;
    img.style.top = `${label}px`; img.style.height = `calc(100% - ${label}px)`; pane.append(img);
  }
}
async function takePicture(shown?: () => void, budget = 220): Promise<'pictured' | 'not-a-site' | 'failed'> {
  const native = bridge(), tab = activeTab;
  if (!native || !tab) return 'failed';
  // What to picture is read from the page area as drawn: a split's panes, or the one page. A tab chosen in the floating sidebar
  // (a split's row) may not be drawn yet when this starts; the targets are read again once pictured and the work redone if
  // they changed, or one pane's picture would stand stretched over the whole page.
  const paneTabs = () => { const ids = [...document.querySelectorAll<HTMLElement>('.page-area .page-pane[data-pane]')].map(pane => pane.dataset.pane!).filter(Boolean); return ids.length > 1 ? ids : [tab]; };
  // The reveal waits on this, so every step is bounded: past the deadline the sidebar floats natively instead. With the
  // sidebar already out (a tab or page chosen in it), main holds the site meanwhile, so a page still loading is waited for longer.
  const deadline = performance.now() + budget, late = () => tab !== activeTab || performance.now() > deadline;
  const within = <T,>(work: Promise<T>, fallback: T) => Promise.race([work.catch(() => fallback), new Promise<T>(resolve => window.setTimeout(resolve, Math.max(0, deadline - performance.now()), fallback))]);
  const command = (still: string, id: string) => Promise.resolve(native.browserCommand({ type: 'edge', tabId: id, still } as never)) as unknown as Promise<unknown>;
  // After a tab change the new site may not be shown yet when this asks; it is asked again until the deadline.
  let targets = paneTabs(), shots: { tab: string; url: string; loading?: boolean }[] = [];
  for (;;) {
    // Every pane is taken at once, so a split is pictured as quickly as one page.
    const take = async (id: string) => {
      let taken: { url?: string; loading?: boolean; none?: boolean } | null = null;
      while (!late()) {
        taken = await within(command('take', id), null) as { url?: string; loading?: boolean; none?: boolean } | null;
        if (taken?.url || taken?.none) break;
        await new Promise(resolve => window.setTimeout(resolve, 60));
      }
      return taken;
    };
    const taken = await Promise.all(targets.map(take));
    if (taken.some(item => !item?.none && !item?.url) || late()) return 'failed';
    shots = targets.flatMap((id, index) => taken[index]?.url ? [{ tab: id, url: taken[index]!.url!, loading: taken[index]!.loading }] : []);
    const now = paneTabs();
    if (now.join() === targets.join()) break;
    targets = now;
  }
  if (!shots.length) return 'not-a-site';
  const imgs = shots.map(shot => { const img = new Image(); img.className = 'edge-page-picture'; img.alt = ''; img.src = shot.url; return img; });
  if (!(await within(Promise.all(imgs.map(img => img.decode())).then(() => true), false)) || late()) return 'failed';
  // Looked up now: after a tab change the page area has been redrawn for the new tab meanwhile. A pane's picture stands below
  // its title, over the website's own place.
  const content = document.querySelector<HTMLElement>('.page-area .page-content'), split = targets.length > 1;
  if (!content || paneTabs().join() !== targets.join()) return 'failed';
  for (const [index, img] of imgs.entries()) {
    remember(shots[index].tab, img);
    if (!split) { content.append(img); content.querySelectorAll(':scope > .edge-page-picture[data-provisional]').forEach(still => still.remove()); continue; }
    const pane = document.querySelector<HTMLElement>(`.page-area .page-pane[data-pane="${CSS.escape(shots[index].tab)}"]`);
    if (!pane) { imgs.forEach(item => item.remove()); return 'failed'; }
    const label = pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0;
    img.style.top = `${label}px`; img.style.height = `calc(100% - ${label}px)`; pane.append(img);
    pane.querySelectorAll('.edge-page-picture[data-provisional]').forEach(still => still.remove());
  }
  shown?.();
  // The picture is painted (beneath the page, or over it when the interface is raised) before the page steps aside.
  await new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); window.setTimeout(resolve, 50); });
  const parked = late() ? [] : await Promise.all(shots.map(shot => command('park', shot.tab).catch(() => false)));
  if (late() || parked.some(ok => !ok)) { imgs.forEach(img => img.remove()); send({ still: 'release' }); return 'failed'; }
  picture = shots.map((shot, index) => ({ img: imgs[index], tab: shot.tab }));
  for (const [index, shot] of shots.entries()) if (shot.loading) window.setTimeout(refreshPicture, 300, picture[index], false);
  return 'pictured';
}
/** A page still loading when pictured (a first visit after launch, a reload) would stay a skeleton for the whole float: retake it
 * while it loads, and once after, as sites draw their content just after loading. Each new picture replaces the old once decoded. */
function refreshPicture(current: Shot, settled: boolean): void {
  const native = bridge();
  if (!native || !picture?.includes(current) || !floating) return;
  void (Promise.resolve(native.browserCommand({ type: 'edge', tabId: current.tab, still: 'take' } as never)) as unknown as Promise<{ url?: string; loading?: boolean } | null>).catch(() => null).then(async taken => {
    if (!picture?.includes(current) || !taken?.url) return;
    const img = new Image(); img.className = 'edge-page-picture'; img.alt = ''; img.src = taken.url;
    try { await img.decode(); } catch { return; }
    if (!picture?.includes(current) || !current.img.isConnected) return;
    current.img.after(img); current.img.remove(); current.img = img; remember(current.tab, img);
    if (taken.loading) window.setTimeout(refreshPicture, 300, current, false);
    else if (!settled) window.setTimeout(refreshPicture, 500, current, true);
  });
}
/** The website returns to its place; the picture leaves once the page covers it again. */
function dropPicture(): void {
  clearStills();
  if (!picture) return;
  const imgs = picture.map(shot => shot.img); picture = null;
  send({ still: 'release' });
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(() => imgs.forEach(img => img.remove()), 60)));
}
/** A website chosen in the floating sidebar (from another site or an internal page) is held by main outside the window from its
 * first frame (holdShownPage), so the float stays on the page area and the new site is pictured like the reveal's page: main's
 * capture waits for its frame. If no picture can be made, the site is released to its place and the float turns native. */
function repicture(previous?: HTMLImageElement[]): void {
  const clear = () => previous?.forEach(img => img.remove());
  if (picture || !floating || !floatFrame || !floatNative) { clear(); return; }
  // A slide in progress, or a picture still being made for the tab before, finishes first (that one ends once its tab is gone).
  if (edgeBusy || picturing) { window.setTimeout(() => repicture(previous), 60); return; }
  picturing = true;
  const show = (kind: 'native' | 'dom') => { if (floating && floatFrame && floatNative && floatKind !== kind) { floatKind = kind; refreshEdgeFloat(); } };
  void takePicture(() => { show('dom'); clear(); }, 3000).catch(() => 'failed' as const).then(result => {
    picturing = false; clear();
    // An internal page chosen instead keeps the page-area float (setEdgeFloatable): only a site that could not be pictured
    // is released to its place, with the native float; turning native for an internal page hid it for a frame.
    if (!picture) { if (result === 'failed' && floating && floatFrame && floatNative) { send({ still: 'release' }); show('native'); } return; }
    if (!floating || !floatFrame || !floatNative) dropPicture();
  });
}
/** View-transition readiness is the first safe native stacking handoff. A fixed timer can expose
 * the old opaque page placeholder before capture, or cut off an exit while capture is delayed. */
function presentFloat(ready?: Promise<void>): void {
  const generation = floatGeneration;
  // Every framed float is raised, so a website that appears while it lasts (a tab chosen in the sidebar, even from an internal
  // page) is placed beneath the sidebar instead of over it.
  // A framed float also asks main to hold such a website outside the window, for its picture (holdShownPage).
  const present = () => { if (generation === floatGeneration && floating && (floatKind === 'native' || floatFrame) && !nativeFloatRaised) { nativeFloatRaised = true; if (floatFrame) send({ still: 'hold' }); send({ float: true }); } };
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(present));
  if (ready) void ready.then(present, afterPaint); else afterPaint();
}
export function setEdgeFloatable(on: boolean, native = true, frame = false): void {
  floatable = on;
  if (picture && (!on || native !== floatNative || frame !== connectedFrame)) dropPicture();
  // Switching between a website and an internal tab changes the hole, not the visible frame's
  // stacking. Lowering and raising the whole interface here flashes it across the page.
  if (floating && on && frame === connectedFrame && native !== floatNative) {
    floatGeneration++;
    // A website chosen from an internal page keeps the page-area float: main holds the site outside the window and it is pictured.
    floatNative = native; floatKind = native && !floatFrame ? 'native' : 'dom'; holes = [];
    const root = document.documentElement;
    if (floatFrame) root.dataset.sidebarOverlay = floatKind; else root.dataset.edgeFloat = floatKind;
    refreshEdgeFloat();
    presentFloat();
    if (native && floatFrame) { repicture(); requestAnimationFrame(() => placeStills(12, document.querySelector('.page-area .page-pane[data-pane]') ? undefined : activeTab)); }
    return;
  }
  // Selecting a tab must not drop the sidebar under the pointer. Swap the native/DOM surface while retaining the reveal.
  if (floating && (!on || native !== floatNative || frame !== connectedFrame)) {
    const resume = on && (edge.side || edge.top || asks.top);
    const rest = pageRect, previousHoles = restHoles;
    setFloat(false); floatNative = native; connectedFrame = frame;
    if (resume) setFloat(true);
    if (resume && frame && rest) { pageRect = rest; restHoles = previousHoles; }
    return;
  }
  floatNative = native; connectedFrame = frame;
}
export const isEdgeFloating = (): boolean => floating;
/** The page's rects in interface px: each split pane under its title, or the page card; with the tab each belongs to. */
function pageHoles(area: DOMRect): Hole[] {
  const panes = [...document.querySelectorAll<HTMLElement>('.page-area .page-pane[data-pane]')];
  if (panes.length < 2) return [{ x: area.left, y: area.top, w: area.width, h: area.height, tabId: activeTab }];
  // A pane keeps its resting place under a floating sidebar or toolbar (the page area is the window onto it), so it counts only as far as the area shows it: like the single page, the
  // card's edge is where the sidebar (left) or the toolbar (top) meets it. The title strip is the card's top: what the area covers of it is not there.
  return panes.map(pane => {
    const r = pane.getBoundingClientRect(), strip = pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0, left = Math.max(r.left, area.left), right = Math.min(r.right, area.right), top = Math.max(r.top, area.top), bottom = Math.min(r.bottom, area.bottom), under = Math.max(top, r.top + strip);
    return { x: left, y: under, w: right - left, h: bottom - under, tabId: pane.dataset.pane || activeTab, label: under - top };
  }).filter(h => h.w > 20 && h.h > 20);
}
/** The holes the native pages need. A split's interface panes (a new tab, Settings) stay drawn by the interface: cut out with the websites they
 * stood see-through, on the desktop, for as long as the float was native (founder, 31 Oct: "this glitched for a second"). */
function webHoles(list: Hole[]): Hole[] {
  const web = list.filter(hole => { const pane = document.querySelector(`.page-area .page-pane[data-pane="${CSS.escape(hole.tabId)}"]`); return !pane || pane.hasAttribute('data-web'); });
  return web.length ? web : list;
}
function paintPageHoles(app: HTMLElement, areaNow: DOMRect): void {
  // Written for a sidebar on the left. On the right the same rules run on the window's mirror image (`flip*`: x measured from the window's right edge, so the sidebar is "the left"
  // one) and what they make is mirrored back where it is drawn: the SVG masks carry a mirroring group, the card's frame line a mirrored holder (sidebar-right.css).
  const right = rootSidebarSide() === 'right', W = Math.ceil(window.innerWidth), H = Math.ceil(window.innerHeight);
  const flipHole = (h: Hole): Hole => right ? { ...h, x: mirrorSpan(h.x, h.w, W).x } : h;
  const flipRect = (r: DOMRect): DOMRect => right ? { left: W - r.right, right: W - r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height, x: W - r.right, y: r.top } as DOMRect : r;
  const area = flipRect(areaNow), pr = pageRect ? flipRect(pageRect) : null;
  const mirroring = (inner: string, width: number) => right ? `<g transform='matrix(-1 0 0 1 ${width} 0)'>${inner}</g>` : inner;
  const leaving = floatFrame && !!framedVisible && !document.querySelector('.acira-sidebar.is-peek, .browser-shell[data-seamless="shown"]');
  const actual = leaving ? framedVisible!.map(hole => ({ ...hole })) : pageHoles(areaNow), visible = actual.map(flipHole);
  if (floatFrame && !leaving && document.querySelector('.acira-sidebar.is-peek')) framedVisible = actual.map(hole => ({ ...hole }));
  const resting = !floatFrame || !pr ? visible : visible.map(hole => {
    const saved = restHoles.find(item => item.tabId === hole.tabId);
    if (saved) return flipHole({ ...saved });
    if (visible.length === 1) return { x: pr.left, y: pr.top, w: pr.width, h: pr.height, tabId: hole.tabId };
    return { ...hole, x: pr.left + (hole.x - area.left) * pr.width / area.width, w: hole.w * pr.width / area.width };
  });
  holes = resting.map(flipHole);
  // The card beside a floating sidebar is where its resting place and the page area now meet. Seamless insets the card 6px all round and the
  // layout beside the sidebar drops that inset, so the current rect alone put the corner curve 6px above the page's real corner (founder, 31 Oct:
  // "its corner is a square"); the resting rect alone cut the glass 6px too deep where the docked card keeps its bottom inset, and the strip
  // shone through unveiled. Its left edge is where the sidebar meets it now.
  const rows = visible.map(hole => {
    const rest = floatFrame && pr ? resting.find(item => item.tabId === hole.tabId) : undefined;
    if (!rest) return hole;
    const top = Math.max(hole.y, rest.y), bottom = Math.min(hole.y + hole.h, rest.y + rest.h);
    return bottom > top ? { ...hole, y: top, h: bottom - top } : hole;
  });
  const r = 8;
  // The frame's cut-out and its pieces take the edges the screen paints (snapPx), so the picture or the page filling the hole covers it to its last pixel.
  const veil = rows.map(hole => { const x = snapPx(hole.x), y = snapPx(hole.y); return { ...hole, x, y, w: snapPx(hole.x + hole.w) - x, h: snapPx(hole.y + hole.h) - y }; });
  // The page's own clip rounds the card's corners at the sidebar's edge only at its top and its bottom. Stacked panes meet the edge in between too: each pane the sidebar covers is cut there with the
  // same curve (split-groups.css), or the upper one kept a wedge of its page under the corner piece's tint and the lower one a square corner.
  const panes = document.querySelectorAll<HTMLElement>('.page-area .page-pane[data-pane]');
  for (const pane of panes) {
    const cover = panes.length > 1 ? area.left - (right ? W - pane.getBoundingClientRect().right : pane.getBoundingClientRect().left) : 0;
    if (cover > .5) { pane.dataset.sfCover = ''; pane.style.setProperty('--sf-pane-cover', `${cover}px`); } else { delete pane.dataset.sfCover; pane.style.removeProperty('--sf-pane-cover'); }
  }
  // The frame's own veil covers the bands above and below the page; the moving sidebar's copy leaves them to it (sidebar-overlay.css).
  app.style.setProperty('--sf-frame-top', `${Math.max(0, Math.min(...veil.map(h => h.y)))}px`);
  app.style.setProperty('--sf-frame-bottom', `${Math.max(0, H - Math.max(...veil.map(h => h.y + h.h)))}px`);
  // The moving sidebar carries its own copy of the shared finish. Keep the frame's hole over
  // the resting page, so a full-width opaque strip cannot snap in ahead of the sliding contents.
  const firstLeft = Math.min(...visible.map(h => h.x)), veilLeft = Math.min(...veil.map(h => h.x));
  // Where the hole reaches back under the sidebar, its left corners stay beneath the sidebar's own copy of the finish:
  // square them, or the frame's veil doubles in those two corners over the desktop material.
  // A pinned sidebar sits beside the page, so the page's resting left edge is already its own: the hole stayed at the sidebar's edge and the frame's veil covered the whole column too, under the
  // sidebar's own copy (a column darker than the band above it, 19 against 27, for as long as the top bar stood with it).
  const solid = webHoles(veil), under = (h: Hole) => snapPx(pr!.left) < h.x || (edge.pinned.side && h.x > 0), backing: (Hole & { square?: boolean })[] = floatFrame && pr ? solid.map(h => h.x === veilLeft ? ({ ...h, square: under(h) }) : h) : solid;
  // The sidebar's own copy of the finish tints its whole column between the frame's bands, so the frame's veil is cut out of that column as well, not only behind the panes: in a stacked
  // split the strip and the gap between two panes (and a pane the interface draws) stood in the veil there and read a darker stripe across the sidebar (26 against 41 in dark).
  const column = floatFrame && pr && veil.some(h => h.x === veilLeft && under(h)) ? ` M0 ${Math.max(0, Math.min(...veil.map(h => h.y)))}H${veilLeft}V${Math.min(H, Math.max(...veil.map(h => h.y + h.h)))}H0Z` : '';
  const d = `M0 0H${W}V${H}H0Z` + column + backing.map(({ x, y, w, h, square }) => square ? ` M${x} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x}Z` : ` M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`).join('');
  if (!holdVeil) app.style.setProperty('--sf-mask', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'>${mirroring(`<path fill-rule='evenodd' d='${d}'/>`, W)}</svg>`)}")`);
  // A narrow, independently moving part of the same frame carries the page's rounded left
  // corners. It sits outside the sidebar's existing content clip; the website stays untouched.
  // Its top and bottom corners are two pieces: the bottom one also follows the card's bottom edge while that moves (sidebar-overlay.css).
  const firsts = veil.filter(h => h.x === veilLeft), mask = (path: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${r}' height='${H}'>${mirroring(`<path d='${path}'/>`, r)}</svg>`)}")`;
  app.style.setProperty('--sf-corner-x', `${firstLeft}px`);
  // Where the frame's tint has its cut-out begins: the top corner piece is drawn from here down only while it rides the page's edge, since above it the frame's own tint is
  // already there and a second one read as a darker notch (held with the tint while the top bar leaves).
  if (!holdVeil) document.documentElement.style.setProperty('--sf-hole-top', `${Math.min(...firsts.map(h => h.y))}px`);
  // A split pane's title strip is the card's top: the frame's tint already stands under it (its cut-out begins where the website does), so the strip's own corner at the sidebar's edge
  // is curved by the page's clip alone, and a piece here would tint it twice (a darker wedge). The piece belongs at the page's top, where a pane has no strip showing.
  app.style.setProperty('--sf-corner-mask', mask(firsts.filter(h => !h.label).map(({ y }) => `M0 ${y}H${r}A${r} ${r} 0 0 0 0 ${y + r}Z`).join(' ')));
  // Only the card's own bottom corner gets a piece. Where another pane stands below, the corner reveals the split's ground (the colour of the gap between the panes) and a piece would tint it
  // twice, a dark wedge at the upper pane's corner (22 against 31 for the gap, 39 for the sidebar).
  const cardBottom = Math.max(...veil.map(h => h.y + h.h));
  app.style.setProperty('--sf-corner-mask-low', mask(firsts.filter(h => h.y + h.h > cardBottom - 1).map(({ y, h }) => `M0 ${y + h}V${y + h - r}A${r} ${r} 0 0 0 ${r} ${y + h}Z`).join(' ')));
  // The card's frame line (its top, right and bottom; the docked card's ring) in two pieces, so the bottom can follow the card's
  // bottom edge while the top stays (sidebar-overlay.css). Both reach back to the page's resting left edge; at rest their holders
  // clip them where the left corners' curves end, and while the sidebar slides a clip travelling with its edge shows them from
  // there, so the line stays joined to the sidebar and stretches or shortens with it (founder, 30 Oct: "it looks cut off").
  const card = { top: Math.min(...rows.map(h => h.y)), right: Math.max(...rows.map(h => h.x + h.w)), bottom: Math.max(...rows.map(h => h.y + h.h)) };
  const reach = pr?.left ?? firstLeft, mid = Math.round((card.top + card.bottom) / 2), o = r + .5, root = document.documentElement;
  // The left end wears the card's curve and edge like the right (the lining used to stop where the curve began): a separate stroke up the sidebar's
  // edge, round the corner and into the line, so the ring is the whole card's outline wherever the sidebar meets it.
  const left = firstLeft - .5, sidebarEdge = pr && firstLeft > pr.left;
  // The stroke up the sidebar's edge is its own path (.rim-edge): it waits for the sidebar while that slides in (data-edge-rim, sidebar-overlay.css). The line's row starts 2px inside the end of the
  // curve (--sf-rim-line-x), so the stroke's arc stops there, where the line takes over: two separate paths, each with the stroke's alpha, would paint the 2px they share twice (as one path they painted the union).
  const joint = Math.sqrt(o * o - 4);
  app.querySelector('.sidebar-page-rim-top path')?.setAttribute('d', `M${reach} ${card.top - .5}H${card.right - r}A${o} ${o} 0 0 1 ${card.right + .5} ${card.top + r}V${mid}`);
  app.querySelector('.sidebar-page-rim-top .rim-edge')?.setAttribute('d', sidebarEdge ? `M${left} ${mid}V${card.top + r}A${o} ${o} 0 0 1 ${firstLeft + r - 2} ${card.top + r - joint}` : '');
  app.querySelector('.sidebar-page-rim-low path')?.setAttribute('d', `M${reach} ${card.bottom + .5}H${card.right - r}A${o} ${o} 0 0 0 ${card.right + .5} ${card.bottom - r}V${mid - 16}`);
  app.querySelector('.sidebar-page-rim-low .rim-edge')?.setAttribute('d', sidebarEdge ? `M${left} ${mid - 16}V${card.bottom - r}A${o} ${o} 0 0 0 ${firstLeft + r - 2} ${card.bottom - r + joint}` : '');
  for (const [name, value] of [['x', sidebarEdge ? firstLeft - 1 : firstLeft + r], ['line-x', sidebarEdge ? firstLeft + r - 2 : firstLeft + r], ['top', card.top], ['right', card.right], ['bottom', card.bottom], ['mid', mid]] as const) root.style.setProperty(`--sf-rim-${name}`, `${value}px`);
  // Retain the outgoing travel when React collapses the layout for the exit snapshot.
  if (!pr || firstLeft > pr.left) root.style.setProperty('--sf-sidebar-travel', `${pr ? snapPx(firstLeft) - snapPx(pr.left) : snapPx(firstLeft)}px`);
  // Where the line's left end is, relative to the card beside the sidebar: in from the page's left edge as the sidebar arrives, back
  // out to it as the sidebar leaves.
  // A top bar arriving or leaving with the sidebar staying (data-edge-top in / out): the line's left end has nowhere to travel. It ran in from the sidebar's width away as if the
  // sidebar were arriving, and the old top line (6px in) showed as a 1px line sliding across the sidebar's top for the first third of the slide.
  const away = `${-(parseFloat(root.style.getPropertyValue('--sf-sidebar-travel')) || 0)}px`, stays = root.dataset.edgeTop === 'in' || root.dataset.edgeTop === 'out', arriving = !stays && !leaving && !!document.querySelector('.acira-sidebar.is-peek');
  root.style.setProperty('--sf-rim-shift-from', arriving ? away : '0px'); root.style.setProperty('--sf-rim-shift-to', arriving || stays ? '0px' : away);
  syncPixelEase();
  syncDesktopMaterial(app,actual);
}
/** The card's frame line ends in a stroke up the sidebar's edge and round the corner (the left end of its ring). While the sidebar leaves, each piece of the line is shown through a clip that
 * follows the sidebar's edge and its own picture is held still, which is right for the top and bottom runs (they stretch out with the sidebar) and wrong for that stroke: it stood where the
 * sidebar's edge was, a card edge with a rounded corner and a hairline through the text, for most of the hide, beside the real edge sliding away with the sidebar (a second page card in
 * Compact and Focus, 2-3 frames at full speed, most of the slide when slowed). The stroke leaves the line before its picture is taken; the card's edge is the page's own clip and the corner pieces. */
function dropRimEdge(): void {
  for (const path of document.querySelectorAll('.sidebar-page-rim .rim-edge')) path.setAttribute('d', '');
}
/** Rebind page input after choosing another tab or changing split panes, without replaying the reveal. */
export function refreshEdgeFloat(): void {
  if (!floating) return;
  const app = document.querySelector<HTMLElement>('.app'), area = document.querySelector('.page-area')?.getBoundingClientRect();
  if (!app || !area || area.width < 40 || area.height < 40) return;
  if (floatFrame && pageRect) {
    const root = document.documentElement;
    // Read the original expanded frame's paint, without changing its layout, finish, controls or corner styling.
    delete root.dataset.sidebarOverlay;
    const cs = getComputedStyle(app);
    for (const [name, value] of [['image', cs.backgroundImage], ['size', cs.backgroundSize], ['position', cs.backgroundPosition], ['repeat', cs.backgroundRepeat], ['color', cs.backgroundColor]]) app.style.setProperty(`--sf-bg-${name}`, value);
    root.style.setProperty('--sidebar-page-width', `${pageRect.width}px`);
    root.style.setProperty('--sidebar-page-height', `${pageRect.height}px`);
    root.style.setProperty('--sidebar-page-left', `${pageRect.left - area.left}px`);
    root.style.setProperty('--sidebar-page-top', `${pageRect.top - area.top}px`);
    root.dataset.sidebarOverlay = floatKind;
  } else pageRect = area;
  paintPageHoles(app, area);
}
function setFloat(on: boolean, deferPresentation = false): void {
  window.clearTimeout(floatTimer);
  if (floating === on) return;
  floatGeneration++;
  const root = document.documentElement, app = document.querySelector<HTMLElement>('.app');
  if (on) {
    const area = document.querySelector('.page-area')?.getBoundingClientRect();
    if (!app || !area || area.width < 40 || area.height < 40) return;
    pageRect = area; floating = true; floatKind = floatNative && !picture ? 'native' : 'dom'; floatFrame = connectedFrame;
    // A sidebar pinned beside the page covers none of it. The travel an earlier reveal left (kept for that reveal's exit) would cut that much off the page's left edge
    // as the top bar floats in: the page drawn from the sidebar's edge but clipped 234px in, bare glass in the gap for as long as both stood.
    if (edge.pinned.side) root.style.setProperty('--sf-sidebar-travel', '0px');
    if (floatFrame) {
      restHoles = pageHoles(area);
      // Prepare a transparent page hole before the old snapshot, too. The native page remains
      // visible through it when the interface is raised for the animation.
      refreshEdgeFloat();
      if (!deferPresentation) presentFloat();
      return;
    }
    // A native float temporarily clears the app background. Reusing that transparent surface during a tab change would
    // erase the joined frame; retain the finish captured before the reveal instead.
    if (root.dataset.edgeFloat !== 'native') {
      const cs = getComputedStyle(app);
      for (const [name, value] of [['image', cs.backgroundImage], ['size', cs.backgroundSize], ['position', cs.backgroundPosition], ['repeat', cs.backgroundRepeat], ['color', cs.backgroundColor]]) app.style.setProperty(`--sf-bg-${name}`, value);
    }
    if (floatKind === 'dom') { holes = []; root.dataset.edgeFloat = 'dom'; return; }
    paintPageHoles(app, area);
    root.dataset.edgeFloat = 'native';
    // Raised only once a frame with the hole has been presented (two frames), or the old opaque placeholder flashes over the page.
    presentFloat();
    return;
  }
  // Lowered first, then the interface paints its page placeholder again (under the page, so never seen).
  const wasNative = floatKind === 'native' || nativeFloatRaised;
  floating = false; holes = []; pageRect = null; restHoles = [];
  desktopMaterialKey='';desktopMaterialRevision++;desktopClip={left:0,top:0};desktopBand={right:0,bottom:0};framedVisible=null;
  if (nativeFloatRaised) { nativeFloatRaised = false; send({ float: false }); }
  // A site main held while the float lasted returns even if it was never pictured (main also returns it when lowered).
  pictureSkipped = false; clearStills(); if (picture) dropPicture(); else send({ still: 'release' });
  delete root.dataset.sidebarOverlay;
  floatTimer = window.setTimeout(() => { if (!floating) delete root.dataset.edgeFloat; }, wasNative ? 120 : 0);
}
function forwardInput(event: Event): void {
  if (!floating || !pageRect) return;
  const target = event.target as Element | null;
  // Everything over the page's rect goes on to the page, except what the interface draws there itself: the sidebar, the toolbar,
  // popups, dialogs and toasts keep their own clicks.
  if (target?.closest?.('.ed-rail, .browser-shell, .browser-popup, [role=dialog], [role=alertdialog], [role=status], [role=alert], [class*=toast]')) return;
  const point = event as MouseEvent;
  // A page the interface draws (Settings, History, the new tab page) takes its own click; the press only sends the sidebar away.
  // A website's picture is not the page: its clicks and wheel go on to the website, which takes them while it waits outside.
  if (floatKind === 'dom' && !picture) {
    const r = pageRect;
    if (event.type === 'pointerdown' && point.clientX >= r.left && point.clientX <= r.right && point.clientY >= r.top && point.clientY <= r.bottom) dismissEdge('side');
    return;
  }
  if (target?.closest?.('button, a, input')) return;
  const hit = holes.find(h => point.clientX >= h.x && point.clientX <= h.x + h.w && point.clientY >= h.y && point.clientY <= h.y + h.h);
  if (!hit) return;
  // A split's interface page (a new tab, Settings) is drawn here, not a website: it takes its own click, as on a page of its own.
  const pane = document.querySelector<HTMLElement>(`.page-area .page-pane[data-pane="${CSS.escape(hit.tabId)}"]`);
  if (pane && !pane.hasAttribute('data-web')) { if (event.type === 'pointerdown') dismissEdge('side'); return; }
  const x = point.clientX - hit.x, y = point.clientY - hit.y, tabId = hit.tabId && hit.tabId !== activeTab ? { tabId: hit.tabId } : {};
  event.preventDefault(); event.stopPropagation();
  if (event.type === 'wheel') { const wheel = event as WheelEvent; send({ forward: { type: 'mouseWheel', x, y, deltaX: wheel.deltaX, deltaY: wheel.deltaY, ...tabId } }); return; }
  const button = point.button === 1 ? 'middle' : point.button === 2 ? 'right' : 'left';
  send({ forward: { type: event.type === 'pointerdown' ? 'mouseDown' : 'mouseUp', x, y, button, clickCount: 1, ...tabId } });
  if (event.type === 'pointerdown') dismissEdge('side');
}
/** For tests: the float's state (kind and the page holes in interface px). */
export const edgeFloatInfo = (): { floating: boolean; kind: 'native' | 'dom'; holes: Hole[] } => ({ floating, kind: floatKind, holes: holes.map(h => ({ ...h })) });

/** Controls whose width follows the sidebar (the address field, Compact's tab strip). Their view-transition group animates left AND width, and
 * a width animation cannot run on the compositor, so the field started a frame after the buttons that only move and sat on the one before it
 * (the tab-count icon) in the first frame of a reveal. Their pictures are anchored left and never stretch, so the width carries nothing: they glide
 * by their left edge alone (seamless.css edge-glide-*), from the offset measured here (the old left minus the new). */
const glided: ReadonlyArray<readonly [selector: string, property: string]> = [['.browser-shell .address-bar', '--edge-address-dx'], ['.browser-shell .acira-compact-tabs', '--edge-tabs-dx']];
const glideLefts = (): (number | undefined)[] => glided.map(([selector]) => [...document.querySelectorAll(selector)].find(node => node.getBoundingClientRect().width)?.getBoundingClientRect().left);
function setGlide(before: (number | undefined)[]): void {
  const now = glideLefts();
  glided.forEach(([, property], index) => document.documentElement.style.setProperty(property, `${before[index] !== undefined && now[index] !== undefined ? before[index]! - now[index]! : 0}px`));
}

let headerPx = 72;
export function setEdgeHeaderHeight(px: number): void { headerPx = px; }

/** Main said the edges changed. A change that alters what is on screen plays as a transition. */
export function applyEdge(next: EdgeState): void {
  // Keep the most recent request while the current snapshot is being captured or animated.
  // Committing halfway through it would snap the live frame underneath an older snapshot.
  if (edgeBusy) { pendingEdge = next; return; }
  const prev = edge;
  if (prev.top === next.top && prev.side === next.side && prev.pinned.top === next.pinned.top && prev.pinned.side === next.pinned.side) return;
  const shownBefore = { top: prev.top || asks.top, side: prev.side || asks.side }, shownAfter = { top: next.top || asks.top, side: next.side || asks.side };
  const reveal = (shownAfter.top && !shownBefore.top) || (shownAfter.side && !shownBefore.side), hide = (!shownAfter.top && shownBefore.top) || (!shownAfter.side && shownBefore.side);
  // The toolbar or sidebar entering or leaving the layout moves the page area under the pinned page: the pin (--sidebar-page-*) is read again in the
  // same commit, or the page stood a frame or two where the layout put it before it "fixed itself" (founder, 31 Oct, Seamless top bar).
  const before = glideLefts();
  const update = () => { flushSync(() => { edge = next; emit(); }); refreshEdgeFloat(); setGlide(before); };
  // The side floats when the pointer or a key reveals it; a pin docks it over the page's place as before (the page resizes once).
  // The toolbar floats the same way (R4-24: the page no longer glides down under it, so no strip of page background shows).
  const enteringFloat = floatable && ((next.side && !next.pinned.side && !prev.side) || (next.top && !next.pinned.top && !prev.top));
  // Over a website, the reveal waits (bounded) for the page's picture; a later edge change replaces the waiting one.
  if (enteringFloat && connectedFrame && floatNative && !picture && !pictureSkipped) {
    pendingEdge = next;
    if (picturing) return;
    picturing = true; edgeBusy = true;
    void takePicture().finally(() => {
      picturing = false; edgeBusy = false; if (!picture) pictureSkipped = true;
      const requested = pendingEdge; pendingEdge = null;
      if (requested) applyEdge(requested);
      if (!floating) { pictureSkipped = false; dropPicture(); }
    });
    return;
  }
  if (enteringFloat) setFloat(true, connectedFrame);
  if (floating && ((next.pinned.side && !next.top) || (next.pinned.top && !next.side))) setFloat(false);
  if (!reveal && !hide) { edge = next; emit(); return; }
  // A toolbar that stays shown while only the sidebar comes or goes moves like Compact's: each control glides from its old place
  // to its new one (seamless.css). Drawn as one slab, its new picture started at the slab's old left edge, with the first control
  // over the traffic lights and the arriving sidebar, and a leaving sidebar made the controls jump a caption's width at once.
  document.documentElement.dataset.edgeToolbar = shownBefore.top && shownAfter.top ? 'stays' : 'slab';
  // The stroke up the sidebar's edge (the left end of the card's ring) is not drawn while the sidebar slides in: held at its final place it stood alone ahead of the moving edge, a second
  // rounded card outline for most of the slide (founder, 7 Nov, dark: "a line glitching on the lining of the sidebar"). It fades in once the sidebar has landed (sidebar-overlay.css).
  if (shownAfter.side && !shownBefore.side) document.documentElement.dataset.edgeRim = 'wait'; else delete document.documentElement.dataset.edgeRim;
  // Whether the top bar arrives or leaves: the page's top corner beside the sidebar rides the card's moving top edge (sidebar-overlay.css edge-corner-lift-*).
  // Only while the sidebar stays: when it comes or goes with the bar, the layout is measured again after the layout change (the bar's height lands a frame later), so the
  // offsets the corner rides are not yet known when the pieces are captured.
  // 'diag' (the bar and the sidebar together, or the bar without a sidebar): the corner piece is left off for the slide.
  if (shownAfter.top !== shownBefore.top) document.documentElement.dataset.edgeTop = shownBefore.side && shownAfter.side ? (shownAfter.top ? 'in' : 'out') : 'diag'; else delete document.documentElement.dataset.edgeTop;
  holdVeil = shownBefore.top && !shownAfter.top && floatFrame;
  if (shownBefore.side && !shownAfter.side) dropRimEdge();
  const ms = startEdgeTransition(reveal ? 'reveal' : 'hide', update, headerPx);
  if (!edgeTransition) { delete document.documentElement.dataset.edgeToolbar; delete document.documentElement.dataset.edgeTop; delete document.documentElement.dataset.edgeRim; holdVeil = false; }
  if (edgeTransition) {
    edgeBusy = true;
    const settled = () => { edgeBusy = false; delete document.documentElement.dataset.edgeToolbar; delete document.documentElement.dataset.edgeTop; delete document.documentElement.dataset.edgeRim; if (holdVeil) { holdVeil = false; refreshEdgeFloat(); } const requested = pendingEdge; pendingEdge = null; if (requested) applyEdge(requested); };
    void edgeTransition.finished.then(settled, settled);
  }
  if (enteringFloat && floatFrame) presentFloat(edgeTransition?.ready);
  if (floating && !next.side && !next.top && (prev.side || prev.top)) {
    const generation = floatGeneration;
    const transition = edgeTransition;
    const finish = () => { if (transition && transition !== edgeTransition) return; if (generation === floatGeneration && !edge.side && !edge.top && !asks.top) setFloat(false); };
    if (floatFrame && transition) void transition.finished.then(finish, finish);
    else floatTimer = window.setTimeout(finish, ms + 60);
  }
}

/** Wire main's events in; returns the unsubscribe. */
export function installChromeEdge(): () => void {
  const off = bridge()?.subscribeBrowser?.(raw => {
    const event = raw as unknown as { type: string; top?: boolean; side?: boolean; pinned?: { top?: boolean; side?: boolean } };
    if (event.type !== 'chrome-edge') return;
    applyEdge({ top: !!event.top, side: !!event.side, pinned: { top: !!event.pinned?.top, side: !!event.pinned?.side } });
  });
  const names = ['pointerdown', 'pointerup', 'wheel'] as const;
  for (const name of names) window.addEventListener(name, forwardInput, { capture: true, passive: false });
  return () => { off?.(); for (const name of names) window.removeEventListener(name, forwardInput, { capture: true }); setFloat(false); edge = rest; emit(); };
}

const send = (patch: Record<string, unknown>) => { const native = bridge(); if (activeTab && native) void Promise.resolve(native.browserCommand({ type: 'edge', tabId: activeTab, ...patch } as never)).catch(() => {}); };
const sent = { holds: '', keys: '' };
/** What keeps a showing edge open, and what asks for one (only when they change). */
export function sendEdgeFlags(holds: { top: boolean; side: boolean }, keys: { top: boolean; side: boolean }): void {
  const h = `${holds.top}|${holds.side}`, k = `${keys.top}|${keys.side}`;
  if (h !== sent.holds) { sent.holds = h; send({ holds }); }
  if (k !== sent.keys) { sent.keys = k; send({ keys }); }
}
export function pinEdge(zone: 'top' | 'side', on: boolean): void { send({ pin: { zone, on } }); }
/** Esc, or opening the sidebar for good: hide the edge now (and unpin it). */
export function dismissEdge(zone: 'top' | 'side'): void {
  if (zone === 'side' ? !edge.side && !edge.pinned.side : !edge.top && !edge.pinned.top) return;
  send({ dismiss: zone });
}

/** True from a primary press that starts on the toolbar or the sidebar until it ends (a tab, bookmark or group drag, a resize
 * handle, a scrollbar): the edge must not leave under a hand that is still holding something. */
export function useChromePress(): boolean {
  const [pressing, setPressing] = useState(false);
  useEffect(() => {
    let down = false;
    const start = (event: PointerEvent) => { if (event.button === 0 && event.target instanceof Element && event.target.closest('.browser-shell,.acira-sidebar')) { down = true; setPressing(true); } };
    const end = () => { if (down) { down = false; setPressing(false); } };
    window.addEventListener('pointerdown', start, true);
    const names = ['pointerup', 'pointercancel', 'dragend', 'drop', 'blur'];
    for (const name of names) window.addEventListener(name, end, true);
    return () => { window.removeEventListener('pointerdown', start, true); for (const name of names) window.removeEventListener(name, end, true); };
  }, []);
  return pressing;
}
registerPageRiseSpring(seamlessEntrySpring);
