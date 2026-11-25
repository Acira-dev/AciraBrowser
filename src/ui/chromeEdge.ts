import { useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { BrowserRuntime } from '../runtime/types';
import { watchSlideClock } from './slideClock';
import { abortEdgeWarm } from './edgeWarm';
import { PAGE_FOLLOW_END, motionPace, motionScale, motionSpeed, registerPageRiseSpring, springEasing, springFor, startModeTransition, type MotionTokenId } from './sharedMotion';
import { noteUse } from '../features/metrics/noteUse';
import { mirrorSpan, rootSidebarSide } from './sidebarSide';
import { edgeVar, removeEdgeVar, setEdgeVar } from './edgeVars';
import { glideLayout } from './addressGlide';
import { applyPageFloat, pageFloatLowered, type PageRect } from './pageFloat';

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
/** D151: the tabs whose page has not drawn anything yet (main's `page-blank`, desktop/page-blank.cjs). A page view that has not drawn is
 * see-through, and while the sidebar floats over the live page the interface's page area is a hole (data-sidebar-overlay=native): the
 * window's material, then black, then the material again showed there until a slow page drew (reported 23 Nov). While the page on show is
 * blank, `data-page-blank` keeps the interface's own page surface over the hole (sidebar-overlay.css), as docked shows it beneath the page,
 * and the hole opens once, when the page has drawn. A split is left as it is (its panes are holes of their own). */
const blankTabs = new Set<string>();
function markBlank(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement, on = !activeSplit && !!activeTab && blankTabs.has(activeTab);
  if (on) { if (root.dataset.pageBlank !== '') root.dataset.pageBlank = ''; } else if ('pageBlank' in root.dataset) delete root.dataset.pageBlank;
}
const blankListeners = new Set<() => void>();
/** Main says whether a tab's page has drawn yet. */
export function notePageBlank(tabId: string, blank: boolean): void {
  if (!tabId) return;
  if (blank) blankTabs.add(tabId); else blankTabs.delete(tabId);
  markBlank();
  for (const listener of [...blankListeners]) listener();
}
/** D151 (reported: "at least put maybe just like a loading [state]"): true while `tabId`'s page has nothing to show yet (the page area's loading sign, PageLoading.tsx). */
export function usePageBlank(tabId: string): boolean {
  return useSyncExternalStore(subscribePageBlank, () => pageBlankNow(tabId), () => false);
}
export function subscribePageBlank(listener: () => void): () => void { blankListeners.add(listener); return () => { blankListeners.delete(listener); }; }
export const pageBlankNow = (tabId: string): boolean => blankTabs.has(tabId);
/** The tab id the interface's edge commands travel with (main wants one on every command). */
export function bindEdgeTab(id: string, split = false): void {
  // A split opening or closing around the same tab changes what is pictured, too: the one page's picture stood over the whole split (and a pane's over the page) while the sidebar was out.
  const changed = id !== activeTab || split !== activeSplit; activeTab = id; activeSplit = split;
  markBlank();
  if (changed) dropPrepared();   // a picture taken for a rest at the edge is of the page that was showing
  if (changed && floating && floatLive) refreshGlass();
  // Another website chosen in the floating sidebar: main holds it outside the window from its first frame; picture it, keeping
  // the previous picture until the new one stands. (An internal page chosen instead ends the picture in setEdgeFloatable.)
  if (!changed || !floating || !floatFrame || !floatNative || liveFloatOn()) return;
  // The previous picture bridges one page to the next; a split's pictures, or one page's over a split, would show the wrong
  // page in the wrong place, so those leave at once (the newly shown sites wait outside the window meanwhile).
  const previous = picture?.map(shot => shot.img), single = !split && previous?.length === 1 && !picture![0].img.closest('.page-pane[data-pane]');
  picture = null;
  if (!single) { previous?.forEach(img => img.remove()); repicture(); } else repicture(previous);
  requestAnimationFrame(() => placeStills(12, split ? undefined : id));
}

export const useChromeEdge = (): EdgeState => useSyncExternalStore(subscribe, () => edge);
// macOS windowed Seamless (13.10 follow-up, earlier work "Seen, not fixed"): the window's own traffic lights are native buttons, which cannot ride a view transition. They used to be turned on in the
// layout that starts the top bar's reveal, so they stood alone at their place while the bar was still sliding in. `topLanding` is true from the update of a pointer-driven top reveal until its transition has
// finished (the slide has landed); App.tsx keeps `captionHidden` on until then. A hide has no landing: its layout hides them at its first frame. Nothing is delayed when no transition runs.
let topLanding = false, topLandingGuard = 0;
export const useTopLanding = (): boolean => useSyncExternalStore(subscribe, () => topLanding);
export const topLandingNow = (): boolean => topLanding;
const TOP_LANDING_MAX = 1800;   // the slide lasts 280-340 ms (x the animation speed's pace); a transition that never finishes does not keep the lights away
/** Set quietly: the edge update that follows emits, and its render already keeps the lights off. */
function armTopLanding(): void { topLanding = true; window.clearTimeout(topLandingGuard); topLandingGuard = window.setTimeout(() => setTopLanding(false), TOP_LANDING_MAX); }
export function setTopLanding(on: boolean): void {
  window.clearTimeout(topLandingGuard);
  if (topLanding === on) return;
  topLanding = on; emit();
}
// D135 (22 Nov): the warm-up (playWarmReveal) puts `edge.side` on for the real sidebar's mounting and the transition, but it is no edge anyone asked for. What reads the edge as the PERSON'S state (the sidebar
// button's label, icon and press, Escape, the screen-reader line) reads this one: the edge as it was before the warm-up while it plays. Only the sidebar's own mounting and the layout read the raw one (useChromeEdge).
let warmBefore: EdgeState | null = null;
export const currentEdge = (): EdgeState => warmBefore ?? edge;
export const useRealEdge = (): EdgeState => useSyncExternalStore(subscribe, () => warmBefore ?? edge);

/** The spring the native page should follow for a transition that has just started (it lasts a little longer than the spring
 * itself, to cover the layout message crossing to main). */
let flight: { duration: number; bounce: number; until: number } | null = null;
let edgeTransition: ReturnType<typeof startModeTransition> = null;
let edgeBusy = false, pendingEdge: EdgeState | null = null, warmingNow = false;
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
/** The slide's animations wait for the early raise's answer (main re-adds the interface view over the pages, which stalls presentation for ~40 ms on the Mac and tens of ms on Windows and WSLg): the view
 * transition is set up beside the raise, its pseudo-elements stand paused at their first frame (seamless.css, data-edge-hold) and start when main has answered, or after RAISE_WAIT_MAX at the latest.
 * Returns the function that lets go (also called when the transition ends or never began). */
const RAISE_WAIT_MAX = 300;
/** A raise that is sent at the transition's ready (no picture, a refused early raise) has no answer when the slide is set up: the hold takes this one and presentFloat settles it. */
let lateRaise: ((ok: boolean) => void) | null = null;
function expectLateRaise(): void {
  if (nativeFloatRaised || raising) return;
  raising = new Promise<boolean>(resolve => { lateRaise = resolve; });
}
/** ACIRA_EDGE_TRACE (main sets data-edge-trace and forwards the line): the steps of one reveal in ms from the edge event, to find the one that stalls (round 5, the laptop's never-activated first reveal). */
let stepClock = 0, steps: Record<string, number | string> = {};
const stepNote = (name: string, extra?: string): void => { if (document.documentElement.dataset.edgeTrace !== 'on') return; if (name === 'edge' && stepClock && performance.now() - stepClock > 3000) stepClock = 0; /* a line nobody flushed (a prime, an edge that played nothing) is not the next reveal's */ if (!stepClock) { stepClock = performance.now(); steps = {}; } if (name in steps) return; steps[name] = Math.round(performance.now() - stepClock) + (extra ? ' ' + extra : ''); };
const stepFlush = (): void => { if (!stepClock) return; try { console.warn('[edge-step]', JSON.stringify(steps)); } catch { /* console */ } stepClock = 0; steps = {}; };
function holdSlide(): () => void {
  const waiting = raising; raising = null;
  const root = document.documentElement;
  if (!waiting) return () => {};
  root.dataset.edgeHold = '';
  let timer = 0;
  stepNote('hold-set');
  const release = () => { window.clearTimeout(timer); if (root.dataset.edgeHold !== undefined) stepNote('hold-released'); delete root.dataset.edgeHold; };
  timer = window.setTimeout(release, RAISE_WAIT_MAX);
  void waiting.then(ok => { if (!ok && floating) { nativeFloatRaised = true; send({ float: true }); } release(); }, release);
  return release;
}
export function startEdgeTransition(kind: 'reveal' | 'hide', update: () => void, headerHeight = 72, sidebarAlone = false): number {
  if (kind === 'reveal' && !warmingNow) noteUse('seamlessReveals'); // R4-60: counted only while usage sharing is on, as a daily bucket
  const token: MotionTokenId = kind === 'reveal' ? 'seamless.reveal' : 'seamless.hide', spec = springFor(token, motionSpeed());
  const root = document.documentElement;
  if (!spec) {
    edgeTransition = null;
    update();
    return 0;
  }
  // R4-24 (founder: "moves at a linear speed"): a strong ease-out for the reveal (fast start, gentle landing, no overshoot) and an
  // ease-in-out a little quicker for the hide; 200 / 170ms at Fast, stretched by the speed setting (Premium 340 / 289ms).
  const scale = motionScale() || 1;
  // 13.10 round 3: a sidebar that comes or goes ALONE slides on values of its own (280 ms x pace, opening cubic-bezier(.4,0,.2,1), closing its reverse
  // cubic-bezier(.8,0,.6,1)). The old reveal curve (0.16, 1, 0.3, 1) is nearly all in its first frames (80 % after 40 ms), so any hitch at the start of the slide showed as a jump; the new curve starts
  // from rest. The top bar keeps its own (the laptop's strips: smooth).
  const duration = sidebarAlone ? Math.round(280 * motionPace()) : Math.round((kind === 'reveal' ? 200 : 170) * scale);
  const easing = sidebarAlone ? (kind === 'reveal' ? 'cubic-bezier(0.4, 0, 0.2, 1)' : 'cubic-bezier(0.8, 0, 0.6, 1)') : kind === 'reveal' ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.65, 0, 0.35, 1)';
  void springEasing;
  setEdgeVar('--edge-ms', `${duration}ms`);
  setEdgeVar('--edge-ease', easing);
  setEdgeVar('--edge-h', `${headerHeight}px`);
  syncPixelEase();
  flight = { duration: spec.duration, bounce: spec.bounce, until: performance.now() + duration + 400 };
  // Keep the live page clipped while Chromium captures the old frame. Unclipping
  // it beforehand paints one page-tinted frame through the translucent sidebar.
  // The update callback runs with that old frame frozen, before the new capture.
  delete root.dataset.edgeSnapshot;
  const release = holdSlide();
  edgeTransition = startModeTransition(() => { root.dataset.edgeSnapshot = ''; update(); }, 'edge');
  if (!edgeTransition) { delete root.dataset.edgeSnapshot; release(); } else void edgeTransition.finished.then(release, release);
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
/** The early raise (takePicture) that main has not answered yet: the slide's animations wait for it (holdSlide), the work around the slide does not. */
let raising: Promise<boolean> | null = null;
let desktopMaterialKey='',desktopMaterialRevision=0,desktopClip={left:0,top:0},desktopInset={right:0,bottom:0},desktopBand={right:0,bottom:0};
/** Where the page's covered edge and its right and bottom bands stood when the running transition began (see syncDesktopMaterial). */
let desktopStart:{clip:{left:number;top:number};band:{right:number;bottom:number};transition:unknown}|null=null;
/** While the top bar leaves, the frame's tint keeps the cut-out the page card had (its top under the bar). The page's edge climbs over the
 * transition but the new layout's cut-out starts at the final top at once, so the band the card had not yet covered showed bare glass, a
 * lighter flash before the bar's own fade; the tint now stays on that band and the cut-out moves when the transition ends. */
let holdVeil = false;
/** The page card as it stood beside the sidebar: while the sidebar leaves, the frame keeps that cut-out (its bands stay tinted) and the
 * card's own edges grow back to the page's resting place on the slide's curve (reported 30 Oct: the bottom band blinked out). */
let framedVisible: Hole[] | null = null;
/** The sidebar, its corner pieces, the card's edge and its frame line slide together as separate layers. Between whole screen pixels
 * each one's soft edge met the next one's and left a faint seam down the sidebar's edge and around the corners (reported 30 Oct: "it
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
 * row or column of half-tinted glass along the card's edge (a thin bright line on Windows at 125% and 175%, reported 5 Nov), and a slide of 292.5 device pixels moved the sidebar's edge
 * and the page's by different fractions each frame. Whole numbers at 100% and 200% for whole CSS lengths: unchanged there. */
export const snapPx = (value: number): number => { const ratio = window.devicePixelRatio || 1; return Math.round(value * ratio) / ratio; };
function syncPixelEase(): void {
  const ease = edgeVar('--edge-ease').trim(), ratio = window.devicePixelRatio || 1;
  const steps = Math.round((parseFloat(edgeVar('--sf-sidebar-travel')) || 0) * ratio), key = `${ease}|${steps}`;
  setEdgeVar('--px', `${1 / ratio}px`);
  if (key === pixelEaseKey) return;
  pixelEaseKey = key;
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(ease)?.[1].split(',').map(Number);
  // A curve that overshoots does not pass each pixel once; it keeps the smooth curve.
  if (!bezier || bezier.length !== 4 || bezier.some(n => !Number.isFinite(n)) || bezier[1] < 0 || bezier[1] > 1 || bezier[3] < 0 || bezier[3] > 1 || steps < 2 || steps > 2400) removeEdgeVar('--edge-ease-px');
  else setEdgeVar('--edge-ease-px', pixelSteps(bezier as [number, number, number, number], steps));
}
/** The Mac backing samples behind the window, beneath the transparent chrome.
 * Start its mask on the same snapshot-ready boundary as the interface movement. */
function syncDesktopMaterial(app:HTMLElement,visible:Hole[]):void {
  const root=document.documentElement;if(root.dataset.desktopMaterial!=='ready')return;
  const empty={x:0,y:0,width:0,height:0,radius:0};
  const region=(node:HTMLElement|null)=>{if(!node||node.dataset.seamless==='hidden')return empty;const r=node.getBoundingClientRect();return{x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.max(0,r.width),height:Math.max(0,r.height),radius:parseFloat(getComputedStyle(node).borderTopLeftRadius)||0};};
  const toolbar=region(app.querySelector('.browser-shell')),sidebar=region(app.querySelector('.acira-sidebar.is-peek'));
  setEdgeVar('--desktop-bg-size',`${innerWidth}px ${innerHeight}px`);
  setEdgeVar('--desktop-sidebar-bg-position',`${-sidebar.x}px ${-sidebar.y}px`);
  setEdgeVar('--desktop-toolbar-bg-position',`${-toolbar.x}px ${-toolbar.y}px`);
  const regions=[toolbar,sidebar,...(floatFrame?visible.map(h=>({x:h.x,y:h.y,width:h.w,height:h.h,radius:8})):[])];
  const key=JSON.stringify(regions);if(key===desktopMaterialKey)return;desktopMaterialKey=key;
  // `left`, and `right` below, are the sidebar's side and the far side: with the sidebar on the right the page's covered edge is its right one and the far edge its left.
  const onRight=rootSidebarSide()==='right',clip={left:sidebar.width?Math.max(0,onRight?snapPx(pageRect?.right??innerWidth)-snapPx(sidebar.x):snapPx(sidebar.x+sidebar.width)-snapPx(pageRect?.left||0)):0,top:toolbar.height?Math.max(0,snapPx(toolbar.y+toolbar.height)-snapPx(pageRect?.top||0)):0};
  // One transition can sync more than once (a toolbar arriving with the sidebar measures its height a frame after the layout changes).
  // Its first pass fixes where the page's edges start and later passes move only where they end: otherwise the second pass started
  // the card at its final place while the sidebar was still arriving, with bare glass between them.
  if(!desktopStart||!edgeTransition||desktopStart.transition!==edgeTransition)desktopStart={clip:{...desktopClip},band:{...desktopBand},transition:edgeTransition};
  // Beta 14 (reported 17 Nov recording: "the top bar slides in see-through over the page header"): a top bar ARRIVING (the clip's top grows) has the page's top edge stand at its final place, under the bar's band, from the first frame. The edge used to travel down with the bar, but the
  // page's layer (custom-property animation, main thread) could start frames after the bar's (compositor), and for those frames the page's header showed crisp through and above the bar's translucent band; with the edge already at the bar's foot nothing of the page is ever under the band
  // (the root's new picture has the band's veil there), whatever the page layer's clock does. The corner pieces and the frame line ride `to - from` (edge-corner-lift), so they stand at their final place too. A leaving bar keeps its edge travelling up with it.
  const topFrom=clip.top>desktopStart.clip.top?clip.top:desktopStart.clip.top;
  for(const axis of ['left','top']as const){setEdgeVar(`--desktop-clip-${axis}-from`,(axis==='top'?topFrom:desktopStart.clip[axis])+'px');setEdgeVar(`--desktop-clip-${axis}-to`,clip[axis]+'px');}
  desktopClip=clip;
  // The page card's right and bottom edges stay put through the slide; a hide keeps the card it leaves from.
  /* The card is every pane together: its right and bottom come from the farthest pane, not the first (a split's later panes were clipped away, and the desktop showed through them) */if(floatFrame&&visible.length&&pageRect)desktopInset={right:Math.max(0,onRight?Math.min(...visible.map(h=>h.x))-pageRect.left:pageRect.right-Math.max(...visible.map(h=>h.x+h.w))),bottom:Math.max(0,pageRect.bottom-Math.max(...visible.map(h=>h.y+h.h)))};
  setEdgeVar('--desktop-clip-right',desktopInset.right+'px');setEdgeVar('--desktop-clip-bottom',desktopInset.bottom+'px');
  // The card's right and bottom bands: in from the page's resting edges as the sidebar arrives, back out to them as it leaves.
  const band=sidebar.width>0?desktopInset:{right:0,bottom:0};setEdgeVar('--desktop-band-frame-bottom',desktopInset.bottom+'px');
  for(const side of ['right','bottom']as const){setEdgeVar(`--desktop-band-${side}-from`,desktopStart.band[side]+'px');setEdgeVar(`--desktop-band-${side}-to`,band[side]+'px');}
  desktopBand=band;
  const revision=++desktopMaterialRevision,transition=edgeTransition,duration=root.dataset.modeSwitch==='edge'?parseFloat(edgeVar('--edge-ms'))||0:0,reveal=sidebar.width>0||toolbar.height>0&&edge.top;
  const apply=(ms:number)=>{if(revision===desktopMaterialRevision)send({material:{regions,duration:ms,reveal}});};
  if(duration&&transition)void transition.ready.then(()=>apply(duration),()=>apply(0));else apply(0);
}
/** Over a website the sidebar would float over live page pixels, and no native material can sit between a website and the
 * interface (mac-material.mm). So before the sidebar moves, main takes the page's picture; it stands in the page area exactly
 * over the page, the website steps just outside the window at its own size, and the float plays as for an internal page: the
 * picture is clipped with the sidebar on the compositor and the window's material shows beneath it. The site comes back as
 * the float ends. A split pictures each of its websites in its own pane (reported 30 Oct: a split's sites showed through the
 * sidebar); its interface pages stay as they are. A slow capture keeps (or returns to) the native float. */
type Shot = { img: HTMLImageElement; tab: string };
let picture: Shot[] | null = null, picturing = false, pictureSkipped = false;
/** A recent still of a page (App's split stills): a split chosen in the floating sidebar shows it in each website pane at once,
 * while that pane's site waits outside the window for its fresh picture, so no pane is ever empty (reported 30 Oct). */
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
  if (!floating || !floatFrame || liveFloatOn()) return;
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
/** 13.10 (Discord: "the graphics of the current tab freeze while the sidebar is out"): the picture is what keeps the page from being laid out beside the sidebar, and what shows the window's material under it,
 * at the price of a frozen page for as long as the sidebar floats (the page is parked outside the window and runs at about a third of its rate: a video stops moving while its sound goes on). The LIVE float keeps the page
 * itself in place under the interface (raised over it, the page's rect a hole) and takes no picture of it at all: nothing freezes, nothing is parked, nothing is held, and the reveal has no capture to wait for.
 * Beta 14.1 (reported 20 Nov, in public: "we're looking at keeping videos moving under the sidebar"): the live float is the DEFAULT for the Seamless sidebar and the Seamless top bar, over one website and over a split.
 * No native material can sit between a website and the interface (mac-material.mm), so over the live page they wear a GLASS: a blurred wash of the strip of the page under each, taken as a quarter-size still while the dwell runs,
 * under the Mini sidebar's own fill (sidebar-overlay.css). `window.__floatMode` ('glass' | 'solid' | 'picture') is for rigs and testers; ACIRA_SEAMLESS_GLASS=0 brings the picture back for a whole run.
 * 'solid' is the 13.10 optional float: live, the opaque finish, no still at all. */
type FloatMode = 'glass' | 'solid' | 'picture';
const SEAMLESS_LIVE_FLOAT = false;
const FLOAT_DEFAULT: FloatMode = 'glass';
/** Whom the live float is for: every page ('always', the default), or only a page (or a split pane) that is playing media ('playing': the 14.0 picture float, translucent over the window's material, for a page that is not moving). */
type FloatPolicy = 'always' | 'playing';
const FLOAT_POLICY: FloatPolicy = 'always';
let mediaPlaying = false;
/** App keeps this current: a tab on screen has media playing (`tab.media`, set by main). Read when a reveal begins. */
export function setEdgeMedia(playing: boolean): void { mediaPlaying = playing; }
/** The live float is for a window whose page does not reflow when an edge reveals: the Seamless view, or any view whose toolbar stays (the sidebar's peek). With "Hide the toolbar" in Compact / Full / Focus the interface lays the page out beneath the revealed toolbar and the native page
 *  follows it (found with the stepped rig on 21 Nov: 28 setBounds, the page gliding down 30 pt under the raised interface and back up when the float ended; 14.0 parks the page under its picture there): such a window keeps 14.0's picture float for every edge. App keeps this current. */
let liveable = true;
export function setEdgeLiveable(value: boolean): void { liveable = value; }
function floatMode(): FloatMode {
  const g = globalThis as unknown as { __floatMode?: string; __floatPolicy?: string; __seamlessLive?: boolean; __seamlessGlass?: boolean };
  if (g.__floatMode === 'glass' || g.__floatMode === 'solid' || g.__floatMode === 'picture') return g.__floatMode;
  if (g.__seamlessLive === true || SEAMLESS_LIVE_FLOAT) return 'solid';
  if (g.__seamlessGlass === false) return 'picture';
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.seamlessGlassPreview === 'off') return 'picture';
  if ((g.__floatPolicy === 'playing' || g.__floatPolicy === 'always' ? g.__floatPolicy : FLOAT_POLICY) === 'playing' && !mediaPlaying) return 'picture';
  return FLOAT_DEFAULT;
}
const liveSeamless = (): boolean => floatMode() === 'solid';
let floatLive = false;
const glassSwitch = (): boolean => floatMode() === 'glass';
/** The Seamless sidebar and top bar float over the live page with a glass, over one page or over a split's panes (D191 fault 3, 24 Nov 2026: a split used to take the picture float, a still per pane with every pane parked outside the window, so every video stopped while the sidebar
 *  was out). 14.1 kept a split out because the interface laid a split's panes and title strips out again beside a floating sidebar while the native panes stayed where they were (found with the split stand-in on 21 Nov: a veil strip over the first pane). Since D128's split
 *  change (sidebar-overlay.css holds a split's content at its resting geometry in this float, like the picture float) the interface's panes and title strips stand at rest with the native panes, and the glass already takes each pane's part of its strip (prepareGlass). */
const wantsGlass = (side: boolean, top: boolean): boolean => glassSwitch() && liveable && (side || top);
/** Any float over the LIVE page: Seamless's (above), the Seamless glass float while it lasts, or the Mini sidebar's (quietMini, further down). */
const liveFloatOn = (): boolean => liveSeamless() || floatLive || quietMini();
/** What the reveal's picture needs before it can be placed: every pane's still taken and decoded. */
type Prepared = { tab: string; targets: string[]; shots: { tab: string; url: string; loading?: boolean }[]; imgs: HTMLImageElement[]; at: number; placed: boolean };
/** 13.10 (Discord, "still kinda slow, responsive"): the picture used to be taken AFTER the dwell had run out, so every reveal paid the whole pipeline (capture, JPEG, decode, paint, park:
 * 100 to 250 ms) before its first moving frame. Main now says a rest is about to reveal (`chrome-edge-prime`, desktop/edge-reveal.cjs PRIME_LEAD) and the picture is taken, decoded and
 * painted under the page meanwhile; the reveal only parks the page. A prepared picture is used only while it is fresh and of the page that is showing; a rest that ends without a reveal lets it go. */
let prepared: Prepared | null = null, preparing: Promise<Prepared | 'not-a-site' | 'failed'> | null = null, prepareTimer = 0, prepareToken = 0;
const PREPARED_MAX_AGE = 700, PREPARED_KEEP = 900;
const paneTabs = (tab: string): string[] => { const ids = [...document.querySelectorAll<HTMLElement>('.page-area .page-pane[data-pane]')].map(pane => pane.dataset.pane!).filter(Boolean); return ids.length > 1 ? ids : [tab]; };
function dropPrepared(): void {
  window.clearTimeout(prepareTimer); prepareToken++;
  const gone = prepared; prepared = null;
  gone?.imgs.forEach(img => img.remove());
}
/** Steps one to four of a picture: take every pane's still and decode it. Nothing is placed. */
async function preparePicture(budget: number): Promise<Prepared | 'not-a-site' | 'failed'> {
  const native = bridge(), tab = activeTab;
  if (!native || !tab) return 'failed';
  // What to picture is read from the page area as drawn: a split's panes, or the one page. A tab chosen in the floating sidebar
  // (a split's row) may not be drawn yet when this starts; the targets are read again once pictured and the work redone if
  // they changed, or one pane's picture would stand stretched over the whole page.
  // The reveal waits on this, so every step is bounded: past the deadline the sidebar floats natively instead. With the
  // sidebar already out (a tab or page chosen in it), main holds the site meanwhile, so a page still loading is waited for longer.
  const deadline = performance.now() + budget, late = () => tab !== activeTab || performance.now() > deadline;
  const within = <T,>(work: Promise<T>, fallback: T) => Promise.race([work.catch(() => fallback), new Promise<T>(resolve => window.setTimeout(resolve, Math.max(0, deadline - performance.now()), fallback))]);
  const command = (still: string, id: string) => Promise.resolve(native.browserCommand({ type: 'edge', tabId: id, still } as never)) as unknown as Promise<unknown>;
  // After a tab change the new site may not be shown yet when this asks; it is asked again until the deadline.
  let targets = paneTabs(tab), shots: { tab: string; url: string; loading?: boolean }[] = [];
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
    const now = paneTabs(tab);
    if (now.join() === targets.join()) break;
    targets = now;
  }
  if (!shots.length) return 'not-a-site';
  const imgs = shots.map(shot => { const img = new Image(); img.className = 'edge-page-picture'; img.alt = ''; img.src = shot.url; return img; });
  if (!(await within(Promise.all(imgs.map(img => img.decode())).then(() => true), false)) || late()) return 'failed';
  return { tab, targets, shots, imgs, at: performance.now(), placed: false };
}
/** Step five: the pictures go over the page area (a pane's below its title). False when the page area is no longer what they were taken of. */
function placePictures(prep: Prepared): boolean {
  // Looked up now: after a tab change the page area has been redrawn for the new tab meanwhile. A pane's picture stands below
  // its title, over the website's own place.
  const content = document.querySelector<HTMLElement>('.page-area .page-content'), split = prep.targets.length > 1;
  if (!content || paneTabs(activeTab).join() !== prep.targets.join()) return false;
  for (const [index, img] of prep.imgs.entries()) {
    if (img.isConnected) continue;
    remember(prep.shots[index].tab, img);
    if (!split) { content.append(img); content.querySelectorAll(':scope > .edge-page-picture[data-provisional]').forEach(still => still.remove()); continue; }
    const pane = document.querySelector<HTMLElement>(`.page-area .page-pane[data-pane="${CSS.escape(prep.shots[index].tab)}"]`);
    if (!pane) { prep.imgs.forEach(item => item.remove()); return false; }
    const label = pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0;
    img.style.top = `${label}px`; img.style.height = `calc(100% - ${label}px)`; pane.append(img);
    pane.querySelectorAll('.edge-page-picture[data-provisional]').forEach(still => still.remove());
  }
  return true;
}
/** D143: how long `edgeBusy` / `picturing` may stay set before the watchdog ends the busy period itself. A reveal's slide is 0.2-0.7 s and a picture's deadline 0.22 s, so 1.5 s is only ever reached by a transition that never
 *  finishes or an answer that never comes. */
const BUSY_MAX = 1500;
/** The end of a busy period (a picture being taken, a view transition playing): `fn` runs ONCE, by whichever comes first, the normal end or the watchdog. The watchdog says so (`[edge-busy-watchdog]`, `[edge-step] busy-watchdog`). */
function guardedBusy(what: string, fn: () => void): () => void {
  let over = false, timer = 0;
  const end = (): void => { if (over) return; over = true; window.clearTimeout(timer); fn(); };
  timer = window.setTimeout(() => {
    if (over) return;
    stepNote('busy-watchdog', what);
    try { console.warn('[edge-busy-watchdog]', what, BUSY_MAX + ' ms'); } catch { /* console */ }
    if (what === 'picture') { send({ still: 'release' }); if (nativeFloatRaised) { nativeFloatRaised = false; send({ float: false }); } }   // pages that a park of this picture may have moved are put back
    end();
  }, BUSY_MAX);
  return end;
}
const paintWait = () => new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); window.setTimeout(resolve, 50); });

/** The glass of the Seamless sidebar and of the Seamless top bar over the LIVE page: the strip of the page that will be under each, taken as one quarter-size still (main's `edge still: strip`, only that strip of the page, never the whole page),
 * drawn on a canvas that is the sidebar's (or the bar's) box plus GLASS_BLEED on every side, blurred and tinted by the Mini float's own fill (sidebar-overlay.css; the wash is blurred 32px, nothing finer is seen). It is taken while the dwell runs
 * (primeEdge) and put into the sidebar / the bar the moment it is made (placeGlass, inside the reveal's own update, so the first frame of the slide already carries it). Over a split each pane's part of the strip is taken and drawn where it stands.
 * Without one (a page that could not be pictured, a strip that took too long) the sidebar or the bar wears the opaque finish: it is never held back. */
type GlassKind = 'side' | 'top';
type Glass = { canvas: HTMLCanvasElement; tab: string; at: number; key: string };
const glasses: Record<GlassKind, Glass | null> = { side: null, top: null };
const glassWork: Record<GlassKind, Promise<Glass | null> | null> = { side: null, top: null };
let glassBusy = false, glassTried = false, glassTimer = 0;
const GLASS_MAX_AGE = 900, GLASS_SCALE = 4, GLASS_BLEED = 64, GLASS_TINT = 0.05;
/** The neutral tone of the window's material under today's translucent sidebar and top bar, fitted to the real window (21 Nov, the team's own Mac): with the theme's colour over it (sidebar-overlay.css: .82 at the top to .73 at the foot in the dark look, the frame veil's own
 *  vertical gradient; .76 in the light look) the glass is (26,28,29) at the top and (31,32,33) at the foot against today's frame (26,28,29) / (31,32,33) beside it, and (240,241,241) in the light look: every join of the glass with the frame within 3 levels. */
const GLASS_NEUTRAL: Record<GlassKind, { dark: string; light: string }> = { side: { dark: 'rgb(71 72 71)', light: 'rgb(236 240 237)' }, top: { dark: 'rgb(71 72 71)', light: 'rgb(236 240 237)' } };
type Region = { x: number; y: number; w: number; h: number };
/** Where the glass lies in the window (interface px), bleed included: the sidebar's column on its side, or the top bar's band (beside the sidebar when it floats too). Null when the interface has no size yet. */
function glassRegion(kind: GlassKind): Region | null {
  const root = document.documentElement, W = window.innerWidth, H = window.innerHeight, onRight = rootSidebarSide() === 'right';
  if (!W || !H) return null;
  const rail = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')) || sidebarPx;
  if (kind === 'side') return { x: (onRight ? W - rail : 0) - GLASS_BLEED, y: -GLASS_BLEED, w: rail + 2 * GLASS_BLEED, h: H + 2 * GLASS_BLEED };
  const beside = edge.side || asks.side || document.querySelector('.app > .acira-sidebar.is-peek') ? rail : 0, left = onRight ? 0 : beside, right = onRight ? W - beside : W;
  return { x: left - GLASS_BLEED, y: -GLASS_BLEED, w: right - left + 2 * GLASS_BLEED, h: headerPx + 2 * GLASS_BLEED };
}
/** The page rects the glass is made from: at rest the page area's panes; while another edge already floats, where the page rests. */
function glassHoles(): Hole[] {
  const area = document.querySelector('.page-area')?.getBoundingClientRect();
  const current = area && area.width > 40 && area.height > 40 ? pageHoles(area) : [];
  let list = current;
  // While a float lasts the page keeps its resting place, but the pages in it may change (a site chosen in the open sidebar): the rects are the resting ones, the tabs are the ones showing now. (A split chosen there is read as it is drawn.)
  if (floating && restHoles.length) {
    if (restHoles.length === 1 && current.length === 1) list = [{ ...restHoles[0], tabId: current[0].tabId }];
    else if (restHoles.length === current.length && restHoles.every(hole => current.some(item => item.tabId === hole.tabId))) list = restHoles;
  }
  return webHoles(list).filter(hole => !!hole.tabId);
}
const glassKey = (kind: GlassKind): string | null => {
  const region = glassRegion(kind); if (!region) return null;
  return `${activeTab}|${kind}|${[region.x, region.y, region.w, region.h].map(Math.round).join(',')}|${glassHoles().map(hole => [hole.tabId, hole.x, hole.y, hole.w, hole.h].map(value => typeof value === 'number' ? Math.round(value) : value).join(':')).join(';')}`;
};
const glassFresh = (kind: GlassKind): boolean => { const made = glasses[kind]; return !!made && made.tab === activeTab && performance.now() - made.at < GLASS_MAX_AGE && made.key === glassKey(kind); };
type Strip = { url?: string; none?: boolean; loading?: boolean };
async function prepareGlass(kind: GlassKind, budget = 600): Promise<Glass | null> {
  const native = bridge(), tab = activeTab, key = glassKey(kind), region = glassRegion(kind);
  if (!native || !tab || !key || !region) return null;
  // Each pane's part of the region: its rect in the pane's own pixels.
  const parts = glassHoles().flatMap(hole => {
    const x0 = Math.max(hole.x, region.x), y0 = Math.max(hole.y, region.y), x1 = Math.min(hole.x + hole.w, region.x + region.w), y1 = Math.min(hole.y + hole.h, region.y + region.h);
    return x1 - x0 > 2 && y1 - y0 > 2 ? [{ tab: hole.tabId, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rect: { x: x0 - hole.x, y: y0 - hole.y, width: x1 - x0, height: y1 - y0 } }] : [];
  });
  if (!parts.length) return null;
  const deadline = performance.now() + budget;
  const take = async (part: (typeof parts)[number]): Promise<Strip | null> => {
    let taken: Strip | null = null;
    while (performance.now() < deadline && tab === activeTab) {
      taken = await Promise.race([Promise.resolve(native.browserCommand({ type: 'edge', tabId: part.tab, still: 'strip', rect: part.rect, scale: 1 / GLASS_SCALE } as never)).then(value => value as unknown as Strip | null, () => null), new Promise<null>(resolve => window.setTimeout(resolve, Math.max(0, deadline - performance.now()), null))]);
      if (taken?.url || taken?.none) break;
      await new Promise(resolve => window.setTimeout(resolve, 40));
    }
    return taken;
  };
  const taken = await Promise.all(parts.map(take));
  if (tab !== activeTab || taken.some(item => !item?.url && !item?.none)) return null;
  const drawn = parts.flatMap((part, index) => taken[index]?.url ? [{ part, img: Object.assign(new Image(), { src: taken[index]!.url! }) }] : []);
  if (!drawn.length) return null;
  try { await Promise.all(drawn.map(item => item.img.decode())); } catch { return null; }
  if (tab !== activeTab) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.w / GLASS_SCALE)); canvas.height = Math.max(1, Math.round(region.h / GLASS_SCALE)); canvas.className = kind === 'side' ? 'sb-live-glass' : 'bar-live-glass-canvas';
  const context = canvas.getContext('2d');
  if (!context) return null;
  for (const { part, img } of drawn) context.drawImage(img, (part.x - region.x) / GLASS_SCALE, (part.y - region.y) / GLASS_SCALE, part.w / GLASS_SCALE, part.h / GLASS_SCALE);
  // What no pane covers (the frame's margin, a split's gap, the bleed past the window) is the mean colour of what was drawn, so the blur never fades to nothing at an edge.
  try {
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i + 3] > 200) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    if (n) { context.globalCompositeOperation = 'destination-over'; context.fillStyle = `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`; context.fillRect(0, 0, canvas.width, canvas.height); }
  } catch { /* a canvas that cannot be read keeps what was drawn */ }
  // What the window's material is under today's translucent sidebar: a tone of its own that the page does not decide (real window, 21 Nov: today's sidebar measured (29,31,32) in the dark look and (240,241,241) in the light look over a dark, a white and a
  // blue page alike). The wash keeps only GLASS_TINT of the page's colour and takes the rest from the neutral, and the fill over it is the theme's own colour (sidebar-overlay.css): the 14.0 prototype's page-tinted glass (the Mini float's)
  // made a dark sidebar mid-grey (102) over a white page and a blue one navy, 36 levels off today's on average; this one stays within 3 of the frame beside it on those pages (tone model checked against the real stills).
  const tint = typeof (globalThis as unknown as { __glassTint?: number }).__glassTint === 'number' ? (globalThis as unknown as { __glassTint: number }).__glassTint : GLASS_TINT;
  if (tint < 1) { context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1 - tint; context.fillStyle = GLASS_NEUTRAL[kind][document.querySelector('.app')?.getAttribute('data-chrome') === 'dark' ? 'dark' : 'light']; context.fillRect(0, 0, canvas.width, canvas.height); context.globalAlpha = 1; }
  return { canvas, tab, at: performance.now(), key };
}
function primeGlass(kinds: GlassKind[]): void {
  for (const kind of kinds) {
    if (glassFresh(kind) || glassWork[kind]) continue;
    const work = prepareGlass(kind).then(made => { if (made) glasses[kind] = made; return made; });
    glassWork[kind] = work; void work.finally(() => { if (glassWork[kind] === work) glassWork[kind] = null; });
  }
}
/** Wait (bounded) for the glass of the page that is showing; true when every one asked for is there. */
async function ensureGlass(kinds: GlassKind[], budget: number): Promise<boolean> {
  primeGlass(kinds);
  const pending = kinds.map(kind => glassWork[kind]).filter((work): work is Promise<Glass | null> => !!work);
  if (pending.length) await Promise.race([Promise.all(pending), new Promise(resolve => window.setTimeout(resolve, budget))]);
  return kinds.every(glassFresh);
}
/** The card's two ROUND top corners at the bar's foot (14.1 live float). The page runs on under the bar with square corners; the card the team knows begins under the bar with round ones. Two small wedges in the bar's tone hang from the bar's foot
 *  (sidebar-overlay.css `.bar-live-feet`): children of the bar, so the bar's own slide carries them. Where they stand: the page area's own left and right edges, measured from the bar's sides (the page area itself stays at its resting place under the bar in the live float:
 *  only its sides are read, the wedges hang from the bar's foot, wherever that is). The wedge at a floating sidebar's edge (`data-near`) waits for the edge transitions to end and fades in (the sidebar or the bar that arrives is not beside it yet: it stood alone over the page for the first frames).
 *  `.bar-live-lap`: the bar narrows to the sidebar's edge the moment the sidebar arrives (the interface root is laid out beside a floating sidebar and clips what lies outside it), and the strip it leaves would show the live page's header until the sliding sidebar has covered it:
 *  a flat piece in the bar's tone stands there, under the sidebar (a child of the app, outside the root's clip, under the sidebar's z-index). */
function placeFeet(shell: HTMLElement): void {
  let feet = shell.querySelector<HTMLElement>(':scope > .bar-live-feet');
  if (!feet) { feet = document.createElement('div'); feet.className = 'bar-live-feet bar-live-tone'; shell.append(feet); }
  const app = document.querySelector<HTMLElement>('.app');
  let lap = app?.querySelector<HTMLElement>(':scope > .bar-live-lap') ?? null;
  if (app && !lap) { lap = document.createElement('div'); lap.className = 'bar-live-lap bar-live-tone'; app.append(lap); }
  const area = document.querySelector('.page-area')?.getBoundingClientRect(), bar = shell.getBoundingClientRect();
  if (!area || area.width < 40 || !bar.width) return;
  const put = (node: HTMLElement, name: string, value: number) => { const text = `${Math.round(value * 100) / 100}px`; if (node.style.getPropertyValue(name) !== text) node.style.setProperty(name, text); };
  put(feet, '--foot-l', Math.max(0, area.left - bar.left)); put(feet, '--foot-r', Math.max(0, bar.right - area.right));
  if (lap) { put(lap, '--lap-l', Math.max(0, bar.left)); put(lap, '--lap-r', Math.max(0, window.innerWidth - bar.right)); put(lap, '--lap-h', shell.clientHeight || bar.height); }
  const near = document.querySelector('.app > .acira-sidebar.is-peek') ? (rootSidebarSide() === 'right' ? 'r' : 'l') : '';
  if ((feet.dataset.near || '') !== near) { if (near) feet.dataset.near = near; else delete feet.dataset.near; }
}
/** Into the sidebar and the bar that have just been rendered (inside the reveal's update, so the new frame has them). A glass made for another page is not shown. */
function placeGlass(): void {
  const sidebar = document.querySelector<HTMLElement>('.app > .acira-sidebar.is-peek'), side = glasses.side;
  if (sidebar) {
    const glass = !!side && side.tab === activeTab;
    if (!glass) sidebar.removeAttribute('data-live-glass');
    else { const old = sidebar.querySelector(':scope > .sb-live-glass'); if (old !== side!.canvas) { old?.remove(); sidebar.insertBefore(side!.canvas, sidebar.firstChild); } sidebar.setAttribute('data-live-glass', ''); }
    // The page's two corner pieces beside the sidebar are opaque in the glass's tone (sidebar-overlay.css): they carry its attribute.
    for (const piece of document.querySelectorAll<HTMLElement>('.sidebar-page-corners')) { if (glass) piece.setAttribute('data-live-glass', ''); else piece.removeAttribute('data-live-glass'); }
  }
  const shell = document.querySelector<HTMLElement>('.app .browser-shell[data-seamless="shown"]'), top = glasses.top;
  if (shell) {
    placeFeet(shell);
    const barGlass = !!top && top.tab === activeTab;
    // The bar's wedges and the strip it vacates are in its tone (opaque): they carry the glass's attribute, as the sidebar's corner pieces do.
    for (const tone of document.querySelectorAll<HTMLElement>('.bar-live-tone')) { if (barGlass) tone.setAttribute('data-live-glass', ''); else tone.removeAttribute('data-live-glass'); }
    if (!barGlass) { shell.removeAttribute('data-live-glass'); return; }
    let holder = shell.querySelector<HTMLElement>(':scope > .bar-live-glass');
    if (!holder) { holder = document.createElement('div'); holder.className = 'bar-live-glass'; shell.insertBefore(holder, shell.firstChild); }
    if (holder.firstChild !== top!.canvas) { holder.replaceChildren(top!.canvas); }
    shell.setAttribute('data-live-glass', '');
  } else document.querySelector('.app > .bar-live-lap')?.remove();   // the bar has gone: the strip it vacated goes with it (it would stand over the live page when the sidebar leaves)
}
/** Another page chosen in the floating sidebar: its strips replace the old ones as soon as they are made. */
function refreshGlass(): void {
  const tab = activeTab;
  for (const kind of ['side', 'top'] as const) {
    if (!glasses[kind]) continue;
    glasses[kind] = null;
    void prepareGlass(kind).then(made => { if (!made || tab !== activeTab || !floating || !floatLive) return; glasses[kind] = made; placeGlass(); });
  }
}
function dropGlass(): void {
  window.clearTimeout(glassTimer); glasses.side = null; glasses.top = null;
  document.querySelectorAll('.app > .acira-sidebar > .sb-live-glass, .app .browser-shell > .bar-live-glass, .app .browser-shell > .bar-live-feet, .app > .bar-live-lap').forEach(node => node.remove());
  document.querySelectorAll('[data-live-glass]').forEach(node => node.removeAttribute('data-live-glass'));
}
/** The glass an edge needs when it reveals: the sidebar's and / or the bar's, for what is not already showing. */
const glassKindsFor = (on: { top: boolean; side: boolean }): GlassKind[] => [...(on.side && !edge.side && !asks.side ? ['side' as const] : []), ...(on.top && !edge.top && !asks.top ? ['top' as const] : [])];
/** Main says a rest at an edge is about to reveal: take the picture now (and place it under the page), or, when the rest ended, let it go. */
export function primeEdge(on: { top: boolean; side: boolean }): void {
  abortEdgeWarm();
  if (!on.top && !on.side) {
    // A reveal that has just fired still needs it (the event order is: the edge, then the end of the rest): only what nothing has used in a moment is dropped.
    window.clearTimeout(prepareTimer); const token = ++prepareToken;
    prepareTimer = window.setTimeout(() => { if (token === prepareToken && !picturing) dropPrepared(); }, 300);
    window.clearTimeout(glassTimer); glassTimer = window.setTimeout(() => { if (!floating && !glassBusy) { glasses.side = null; glasses.top = null; } }, 400);
    return;
  }
  window.clearTimeout(prepareTimer); prepareToken++;
  // The glass float (the default, 14.1): the strip of the page under the sidebar and / or the top bar is taken while the dwell runs. A second edge reveals while the first floats too.
  if (floatable && connectedFrame && floatNative && (!floating || floatLive) && !edgeBusy && !picturing && wantsGlass(on.side, on.top)) { primeGlass(glassKindsFor(on)); return; }
  if (liveFloatOn() || !floatable || !connectedFrame || !floatNative || picture || pictureSkipped || floating || edgeBusy || picturing || preparing || !bridge() || !activeTab) return;
  if (prepared && prepared.tab === activeTab && performance.now() - prepared.at < PREPARED_MAX_AGE) return;
  dropPrepared();
  const token = prepareToken, tab = activeTab;
  const work = preparePicture(1200).then(async result => {
    if (typeof result === 'string') return result;
    // Let go (a reveal that did not come, a tab change) while the picture was being taken: nothing is placed.
    if (token !== prepareToken || tab !== activeTab || result.shots.some(shot => shot.loading) || !placePictures(result)) { result.imgs.forEach(img => img.remove()); return 'failed' as const; }
    prepared = result;
    await paintWait();
    if (prepared === result) { result.placed = true; result.at = performance.now(); window.clearTimeout(prepareTimer); prepareTimer = window.setTimeout(() => { if (prepared === result && !picturing) dropPrepared(); }, PREPARED_KEEP); }
    return result;
  });
  preparing = work; void work.finally(() => { if (preparing === work) preparing = null; });
}
async function takePicture(shown?: () => void, budget = 220): Promise<'pictured' | 'not-a-site' | 'failed'> {
  const native = bridge(), tab = activeTab;
  if (!native || !tab) return 'failed';
  const deadline = performance.now() + budget, late = () => tab !== activeTab || performance.now() > deadline;
  const within = <T,>(work: Promise<T>, fallback: T) => Promise.race([work.catch(() => fallback), new Promise<T>(resolve => window.setTimeout(resolve, Math.max(0, deadline - performance.now()), fallback))]);
  const command = (still: string, id: string) => Promise.resolve(native.browserCommand({ type: 'edge', tabId: id, still } as never)) as unknown as Promise<unknown>;
  // The picture of a rest that is about to reveal: ready (it was taken while the dwell ran), or still being taken (waited for, within the same bound).
  let prep: Prepared | 'not-a-site' | 'failed' | null = null;
  if (!prepared && preparing) await within(preparing, 'failed' as const);
  if (prepared && prepared.tab === tab && performance.now() - prepared.at < PREPARED_MAX_AGE && paneTabs(tab).join() === prepared.targets.join() && prepared.imgs.every(img => img.isConnected)) { prep = prepared; window.clearTimeout(prepareTimer); prepared = null; prepareToken++; }
  else dropPrepared();
  const wasPlaced = !!(prep && typeof prep !== 'string' && prep.placed);
  if (!prep) prep = await preparePicture(Math.max(0, deadline - performance.now()));
  if (typeof prep === 'string') return prep;
  if (late() || !placePictures(prep)) { prep.imgs.forEach(img => img.remove()); return 'failed'; }
  const {shots, imgs, targets} = prep;
  shown?.();
  // The picture is painted (beneath the page, or over it when the interface is raised) before the page steps aside. (A prepared one has been for as long as it has stood under the page.)
  if (!wasPlaced) await paintWait();
  // 13.10 round 3 (laptop, Windows and WSLg: "the rail strip for 1-5 samples, then the panel jumps"; WSLg: the panel in ONE displayed frame ~130 ms after the picture): the interface used to be raised over the
  // pages by an IPC sent at the view transition's READY, a frame into the slide, and re-adding the interface view stalls presentation for tens of ms on Windows and WSLg while the slide's clock runs on:
  // the first frame at 11 %, the next one at 80 %. The reveal's own picture (the page goes off the window anyway, the picture under it is the whole page) now raises the interface together with the park,
  // before the slide starts, so the stall falls into the transition's set-up and the first frame of the slide is the first frame of the slide.
  const early = !floating && connectedFrame && floatNative && !liveFloatOn() && !nativeFloatRaised;
  // Beta 14 (the Mac's first frame, +33..40 ms in round 3): the raise is sent right behind the parks and the hold (main handles them in this order) but is NOT waited for here: waiting put the whole raise
  // (re-adding the interface view, ~40 ms of main on the Mac) in front of the transition's own set-up, one after the other. The transition now starts at once and its animations wait for the raise's answer
  // (holdSlide): the raise and the set-up run side by side, the slide starts when both are done, and what the raise stalls still falls before the first frame of the slide, never into it.
  const work = late() ? [] : shots.map(shot => command('park', shot.tab).catch(error => { edgeCommandFailed({ still: 'park' }, error); return false; }));
  if (early && !late()) work.push(command('hold', tab).catch(error => { edgeCommandFailed({ still: 'hold' }, error); return false; }));
  const raise = early && !late() ? Promise.resolve(native.browserCommand({ type: 'edge', tabId: tab, float: true } as never)).then(() => true, error => { edgeCommandFailed({ float: true }, error); return false; }) : null;
  stepNote('park-sent');
  // D143: the answers of main to the parks and the hold are waited for within the picture's own deadline, like every other step here. An answer that never comes (main stalled, an IPC that lost it) used to
  // leave this await, `picturing` and `edgeBusy` set for good: every later edge request (a pin, an unpin, the pointer) was only kept as `pendingEdge` and never applied. Past the deadline this is a failed
  // picture: the pages are released (`still: 'release'`, or `float: false` when the raise went early: main handles the park and then the release in order, so a park that arrives late is undone), and the
  // reveal goes on without the still picture (the sidebar floats natively over the live page, `pictureSkipped`).
  const results = late() ? [] : await within(Promise.all(work), [] as boolean[]);
  stepNote('parks-answered', late() ? 'late' : '');
  if (raise) void raise.then(ok => stepNote('raise-answered', ok ? 'ok' : 'refused'));
  const parked = results.slice(0, shots.length);
  if (late() || parked.length < shots.length || parked.some(ok => !ok)) { stepNote('picture', 'failed' + (late() ? ' (late)' : '')); imgs.forEach(img => img.remove()); send(early ? { float: false } : { still: 'release' }); return 'failed'; }
  stepNote('picture', 'ok');
  // A raise counts as done once main accepted it; a refused one leaves the raise to the transition's ready, as before round 3.
  if (raise && results[shots.length] !== false) {
    nativeFloatRaised = true;
    const answer = raise.then(ok => { if (!ok) nativeFloatRaised = false; return ok; });
    raising = answer;
  }
  picture = shots.map((shot, index) => ({ img: imgs[index], tab: shot.tab }));
  void targets;
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
  if (picture || !floating || !floatFrame || !floatNative || liveFloatOn()) { clear(); return; }
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
  const present = () => { const gate = lateRaise; lateRaise = null; if (generation === floatGeneration && floating && (floatKind === 'native' || floatFrame) && !nativeFloatRaised) { nativeFloatRaised = true; if (floatFrame && !liveFloatOn()) send({ still: 'hold' }); stepNote('raise-at-ready-sent'); const native = bridge(); const answered = activeTab && native ? Promise.resolve(native.browserCommand({ type: 'edge', tabId: activeTab, float: true } as never)).then(() => true, error => { edgeCommandFailed({ float: true }, error); return false; }) : Promise.resolve(false); void answered.then(ok => { stepNote('raise-at-ready-answered'); gate?.(ok); }); } else gate?.(true); };
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(present));
  if (ready) void ready.then(present, afterPaint); else afterPaint();
}
export function setEdgeFloatable(on: boolean, native = true, frame = false): void {
  floatable = on;
  if (picture && (!on || native !== floatNative || frame !== connectedFrame)) dropPicture();
  if (prepared && (!on || native !== floatNative || frame !== connectedFrame)) dropPrepared();
  // Switching between a website and an internal tab changes the hole, not the visible frame's
  // stacking. Lowering and raising the whole interface here flashes it across the page.
  if (floating && on && frame === connectedFrame && native !== floatNative) {
    floatGeneration++;
    // A website chosen from an internal page keeps the page-area float: main holds the site outside the window and it is pictured.
    floatNative = native; floatKind = native && (!floatFrame || liveFloatOn()) ? 'native' : 'dom'; holes = [];   // the live float (Mini's, or Seamless's) never pictures a website: it is the live view under a hole (an internal page is drawn by the interface)
    const root = document.documentElement;
    if (floatFrame) root.dataset.sidebarOverlay = floatKind; else root.dataset.edgeFloat = floatKind;
    refreshEdgeFloat();
    presentFloat();
    if (native && floatFrame && !quietMini()) { repicture(); requestAnimationFrame(() => placeStills(12, document.querySelector('.page-area .page-pane[data-pane]') ? undefined : activeTab)); }
    return;
  }
  // Selecting a tab must not drop the sidebar under the pointer. Swap the native/DOM surface while retaining the reveal.
  if (floating && (!on || native !== floatNative || frame !== connectedFrame)) {
    const resume = on && (edge.side || edge.top || asks.top);
    const rest = pageRect, previousHoles = restHoles;
    const wasLive = floatLive;
    setFloat(false); floatNative = native; connectedFrame = frame;
    if (resume) { floatLive = wasLive; setFloat(true); }
    if (resume && frame && rest) { pageRect = rest; restHoles = previousHoles; }
    return;
  }
  floatNative = native; connectedFrame = frame;
}
export const isEdgeFloating = (): boolean => floating;
/** Where the page REALLY is while a sidebar floats beside the page's frame (the classic layouts' peek): the page keeps its resting place and size under the floating sidebar and is only cut where the sidebar meets it,
 *  so its edges are still where they were. The frame's light (ui/ambient.ts) is anchored to this rectangle, not to the card the layout draws beside the sidebar: the light over the top bar is then the same field with
 *  the sidebar hidden, sliding and floating (the team 18 Nov: "no black and just the same interface everywhere"). Null when nothing floats over a framed page. */
export const edgeRestPage = (): DOMRect | null => floating && floatFrame && pageRect ? pageRect : null;
/** The warm-up transition may play: a website is showing (the reveal's layers lie under the native page, which covers them) and nothing of the edge is going on: no edge shown or asked, no float, no picture being taken or held, nothing busy. */
export const edgeQuiet = (): boolean => floatable && floatNative && connectedFrame && !floating && !edgeBusy && !picturing && !picture && !preparing && !prepared && !edge.top && !edge.side && !asks.top && !asks.side && !pendingEdge;
/** 13.11 round 8 (laptop: after a Full -> Seamless switch, itself a real view transition with the interface's own layers, the first reveal looked like a second one: its sidebar's first frame 31-172 px wide against 111-228 seeded).
 * The `real` warm-up (edgeWarm.ts): play ONE real reveal transition once after launch, at idle, with the real sidebar mounted (its rows, favicons, workspaces) at 1 % opacity (sidebar-overlay.css), nothing sent to main:
 * no picture, no park, no raise. The page stays where it is (the layout's float rules hold it: floatHold.ts), nothing is counted as a reveal, and `cancel()` puts everything back at once (an edge or a prime came). */
export function playWarmReveal(): { cancel: () => void; finished: Promise<void> } | null {
  if (warmRunning || !warmRealOk || !edgeQuiet()) return null;
  const root = document.documentElement, before = edge;
  warmRunning = true; warmingNow = true; warmBefore = before;
  root.dataset.edgeWarming = 'real';
  let over = false, resolve!: () => void;
  const finished = new Promise<void>(done => { resolve = done; });
  const end = () => { if (over) return; over = true; warmRunning = false; warmingNow = false; warmBefore = null; delete root.dataset.edgeWarming; delete root.dataset.edgeToolbar; delete root.dataset.edgeRim; try { flushSync(() => { edge = before; emit(); }); } catch { edge = before; emit(); } resolve(); };
  const update = () => { flushSync(() => { edge = { top: false, side: true, pinned: { top: false, side: false } }; emit(); }); };
  root.dataset.edgeToolbar = 'slab';
  const duration = startEdgeTransition('reveal', update, headerPx, true);
  warmingNow = false;
  const transition = edgeTransition;
  void duration;
  if (!transition) { end(); return { cancel: end, finished }; }   // no transitions (reduced motion): the update ran; put it back
  void transition.finished.then(end, end);
  const cancel = () => { try { (transition as unknown as { skipTransition?: () => void }).skipTransition?.(); } catch { /* over */ } if (root.dataset.modeSwitch === 'edge') delete root.dataset.modeSwitch; end(); };
  return { cancel, finished };
}
let warmRunning = false;
/** D138 (found with D135, 22 Nov): the real warm-up sets `edge.side`, which the layout draws for real in a window whose toolbar is shown (Full, Compact, Focus with a closed sidebar, Mini, Hide the toolbar): for ~0.3 s the left 240 pt turned into
 * a dark column, the toolbar's controls slid aside and the page card narrowed (the hover sidebar's layout, with the sidebar itself at 1 %). It was only ever checked in Seamless / Hide the toolbar, where the toolbar is hidden and the
 * layout holds the page (floatHold.ts). So the real reveal is played only in the Seamless view (App.tsx); every other window, Hide the toolbar included (its page reflows), gets the synthetic layers (edgeWarm.ts), which have no state of their own. */
let warmRealOk = false;
export function setEdgeWarmReal(on: boolean): void { warmRealOk = on; }
/* B14 Mini sidebar (AJ): the rail's float. The rail is docked beside the page; when it opens, the sidebar floats over the LIVE page: main raises the
 * interface view over the page views (`float: true`) and the page's rect is a hole in the interface, so the website keeps its bounds, keeps running and is
 * never parked, pictured or held. A page's still is taken only for the glass (miniStill, miniRail.ts). The sidebar's own clip does the motion
 * (miniRail.ts, miniRail.css): no edge transition plays and nothing leaves the layout. A tab chosen in the open sidebar is shown by main at once under it
 * (no `still: 'hold'`, so no wait for a picture: the sample's 80-130 ms pick of a loading tab was that wait). */
let miniFloating = false;
/** Rig only (a QA rig): `window.__miniSamplePath = true` brings back the sample's float path (hold the shown website outside the window, picture it) for the before/after numbers of flaw 3. */
const quietMini = (): boolean => miniFloating && (globalThis as unknown as { __miniSamplePath?: boolean }).__miniSamplePath !== true;
/** The page's still for the float's glass only (main's capturePage of the live page; the page is neither parked nor replaced). */
export async function miniStill(): Promise<string | null> {
  const native = bridge(), tab = activeTab;
  if (!native || !tab) return null;
  try { const taken = await Promise.resolve(native.browserCommand({ type: 'edge', tabId: tab, still: 'take' } as never)) as unknown as { url?: string } | null; return taken?.url ?? null; } catch { return null; }
}
/** The rest ended before the open: nothing was taken that needs giving back (the still is the glass's, not the page's). */
export function miniRelease(): void { /* the live page was never moved */ }
/** Raise (on) or lower (off) the float for the rail. */
export function miniFloat(on: boolean, afterGlide = false): void {
  // The Mini float owns the raise only when this call made it: a float the toolbar's reveal already holds stays that float's (it lowers it), and a raise that bailed owns nothing.
  if (on) { if (!floatable || floating) return; miniFloating = true; setFloat(true); if (!floating) miniFloating = false; return; }
  if (!miniFloating) return;
  // `afterGlide`: the page is gliding to its new place under the sidebar (an undock): main lowers the interface on the glide's last frame, never before.
  setFloat(false, false, afterGlide);
}
export const isMiniFloating = (): boolean => miniFloating;
/** The tab the interface's edge commands travel with (the sidebar's still is of this one). */
export const edgeActiveTab = (): string => activeTab;

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
 * stood see-through, on the desktop, for as long as the float was native (reported 31 Oct: "this glitched for a second"). */
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
  // layout beside the sidebar drops that inset, so the current rect alone put the corner curve 6px above the page's real corner (reported 31 Oct:
  // "its corner is a square"); the resting rect alone cut the glass 6px too deep where the docked card keeps its bottom inset, and the strip
  // shone through unveiled. Its left edge is where the sidebar meets it now.
  const rows = visible.map(hole => {
    const rest = floatFrame && pr ? resting.find(item => item.tabId === hole.tabId) : undefined;
    if (!rest) return hole;
    // Beta 14.1: a float over the LIVE page keeps the card's whole resting height. The picture float starts the card at the top bar's foot (the page area is laid out beneath the bar) and veils the band above it, which is right over a picture
    // clipped to that card; over the live page the band is page pixels: the translucent veil laid a dimmed ghost of the page's header there for the first third of the bar's slide (and again at its end), before the bar had reached it.
    // The page keeps its place under the bar and the bar's opaque glass covers it, exactly as the sidebar's covers the page at its side.
    const top = (floatLive || liveSeamless()) && !quietMini() ? rest.y : Math.max(hole.y, rest.y), bottom = Math.min(hole.y + hole.h, rest.y + rest.h);
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
  setEdgeVar('--sf-frame-top', `${Math.max(0, Math.min(...veil.map(h => h.y)))}px`);
  setEdgeVar('--sf-frame-bottom', `${Math.max(0, H - Math.max(...veil.map(h => h.y + h.h)))}px`);
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
  if (!holdVeil) setEdgeVar('--sf-mask', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'>${mirroring(`<path fill-rule='evenodd' d='${d}'/>`, W)}</svg>`)}")`);
  // The same hole for the site glow's top band (styles/sidebar-overlay.css): the band is flipped by `scaleX(-1)` with the sidebar on the right, so it takes the hole as the window's own (unmirrored) path.
  if (!holdVeil) setEdgeVar('--sf-mask-flat', right ? `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><path fill-rule='evenodd' d='${d}'/></svg>`)}")` : 'var(--sf-mask)');
  // A narrow, independently moving part of the same frame carries the page's rounded left
  // corners. It sits outside the sidebar's existing content clip; the website stays untouched.
  // Its top and bottom corners are two pieces: the bottom one also follows the card's bottom edge while that moves (sidebar-overlay.css).
  const firsts = veil.filter(h => h.x === veilLeft), mask = (path: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${r}' height='${H}'>${mirroring(`<path d='${path}'/>`, r)}</svg>`)}")`;
  setEdgeVar('--sf-corner-x', `${firstLeft}px`);
  // Where the frame's tint has its cut-out begins: the top corner piece is drawn from here down only while it rides the page's edge, since above it the frame's own tint is
  // already there and a second one read as a darker notch (held with the tint while the top bar leaves).
  if (!holdVeil) setEdgeVar('--sf-hole-top', `${Math.min(...firsts.map(h => h.y))}px`);
  // A split pane's title strip is the card's top: the frame's tint already stands under it (its cut-out begins where the website does), so the strip's own corner at the sidebar's edge
  // is curved by the page's clip alone, and a piece here would tint it twice (a darker wedge). The piece belongs at the page's top, where a pane has no strip showing.
  // Beta 14.1 (live float): the page keeps its resting top beneath the top bar, so the card's visible corner beside the sidebar stands at the BAR'S FOOT while the bar is shown. The piece that carries that corner (it rides the sidebar's slide and, with the bar arriving or leaving, the card's moving top edge:
  // sidebar-overlay.css) draws it there: the wedge is present in every frame of an arrival and of a departure, like 14.0's (a wedge that waited for the transition's end read as a square corner for the whole 340 ms slide and the 140 ms fade after it: ~58 frames at 120 Hz).
  const foot = liveBarFoot();
  setEdgeVar('--sf-corner-mask', mask(firsts.filter(h => !h.label).map(({ y }) => { const top = Math.max(y, foot); return `M0 ${top}H${r}A${r} ${r} 0 0 0 0 ${top + r}Z`; }).join(' ')));
  // Only the card's own bottom corner gets a piece. Where another pane stands below, the corner reveals the split's ground (the colour of the gap between the panes) and a piece would tint it
  // twice, a dark wedge at the upper pane's corner (22 against 31 for the gap, 39 for the sidebar).
  const cardBottom = Math.max(...veil.map(h => h.y + h.h));
  setEdgeVar('--sf-corner-mask-low', mask(firsts.filter(h => h.y + h.h > cardBottom - 1).map(({ y, h }) => `M0 ${y + h}V${y + h - r}A${r} ${r} 0 0 0 ${r} ${y + h}Z`).join(' ')));
  // The card's frame line (its top, right and bottom; the docked card's ring) in two pieces, so the bottom can follow the card's
  // bottom edge while the top stays (sidebar-overlay.css). Both reach back to the page's resting left edge; at rest their holders
  // clip them where the left corners' curves end, and while the sidebar slides a clip travelling with its edge shows them from
  // there, so the line stays joined to the sidebar and stretches or shortens with it (reported 30 Oct: "it looks cut off").
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
  for (const [name, value] of [['x', sidebarEdge ? firstLeft - 1 : firstLeft + r], ['line-x', sidebarEdge ? firstLeft + r - 2 : firstLeft + r], ['top', card.top], ['right', card.right], ['bottom', card.bottom], ['mid', mid]] as const) setEdgeVar(`--sf-rim-${name}`, `${value}px`);
  // Retain the outgoing travel when React collapses the layout for the exit snapshot.
  if (!pr || firstLeft > pr.left) setEdgeVar('--sf-sidebar-travel', `${pr ? snapPx(firstLeft) - snapPx(pr.left) : snapPx(firstLeft)}px`);
  // Where the line's left end is, relative to the card beside the sidebar: in from the page's left edge as the sidebar arrives, back
  // out to it as the sidebar leaves.
  // A top bar arriving or leaving with the sidebar staying (data-edge-top in / out): the line's left end has nowhere to travel. It ran in from the sidebar's width away as if the
  // sidebar were arriving, and the old top line (6px in) showed as a 1px line sliding across the sidebar's top for the first third of the slide.
  const away = `${-(parseFloat(edgeVar('--sf-sidebar-travel')) || 0)}px`, stays = root.dataset.edgeTop === 'in' || root.dataset.edgeTop === 'out', arriving = !stays && !leaving && !!document.querySelector('.acira-sidebar.is-peek');
  setEdgeVar('--sf-rim-shift-from', arriving ? away : '0px'); setEdgeVar('--sf-rim-shift-to', arriving || stays ? '0px' : away);
  syncPixelEase();
  syncDesktopMaterial(app,actual);
  syncLiveCornerRide(pr?.top ?? 0, foot);
}
/** The bottom of the Seamless top bar over the LIVE page (0 when it is not shown or the float is not live): where the card's visible top stands beside a floating sidebar. */
function liveBarFoot(): number {
  if (!((floatLive || liveSeamless()) && !quietMini())) return 0;
  const shell = document.querySelector<HTMLElement>('.app .browser-shell[data-seamless="shown"]');
  if (!shell) return 0;
  const box = shell.getBoundingClientRect();
  return snapPx(box.top + (shell.clientTop || 0) + (shell.clientHeight || box.height));
}
/** The corner piece beside a floating sidebar rides the card's top edge while the bar arrives or leaves (sidebar-overlay.css edge-corner-lift-*, the variables main-side 14.0 set for the picture float). Over the live page the page's header stays visible until the bar covers it, so the corner travels
 *  WITH the bar from where it stood (the card's resting top) to the bar's foot, and back: from 0 to the travel when the bar arrives, from the travel to 0 when it leaves (14.0's own picture float stands the corner at its final place from the first frame: a veil band above it hides the page there). */
let lastBarFoot = 0;
function syncLiveCornerRide(restTop: number, foot: number): void {
  if (!((floatLive || liveSeamless()) && !quietMini())) return;
  if (foot) lastBarFoot = foot;
  const mode = document.documentElement.dataset.edgeTop;
  if (mode !== 'in' && mode !== 'out') return;
  const travel = Math.max(0, (mode === 'in' ? foot : lastBarFoot) - restTop);
  setEdgeVar('--desktop-clip-top-from', `${mode === 'in' ? 0 : travel}px`); setEdgeVar('--desktop-clip-top-to', `${mode === 'in' ? travel : 0}px`);
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
    for (const [name, value] of [['image', cs.backgroundImage], ['size', cs.backgroundSize], ['position', cs.backgroundPosition], ['repeat', cs.backgroundRepeat], ['color', cs.backgroundColor]]) setEdgeVar(`--sf-bg-${name}`, value);
    setEdgeVar('--sidebar-page-width', `${pageRect.width}px`);
    setEdgeVar('--sidebar-page-height', `${pageRect.height}px`);
    setEdgeVar('--sidebar-page-left', `${pageRect.left - area.left}px`);
    setEdgeVar('--sidebar-page-top', `${pageRect.top - area.top}px`);
    root.dataset.sidebarOverlay = floatKind;
  } else pageRect = area;
  paintPageHoles(app, area);
}
function setFloat(on: boolean, deferPresentation = false, afterGlide?: boolean): void {
  window.clearTimeout(floatTimer);
  if (floating === on) return;
  floatGeneration++;
  const root = document.documentElement, app = document.querySelector<HTMLElement>('.app');
  if (on) {
    const area = document.querySelector('.page-area')?.getBoundingClientRect();
    if (!app || !area || area.width < 40 || area.height < 40) return;
    overlayHeld = false; window.clearTimeout(overlayTimer);
    pageRect = area; floating = true; floatKind = floatNative && !picture ? 'native' : 'dom'; floatFrame = connectedFrame;
    // A sidebar pinned beside the page covers none of it. The travel an earlier reveal left (kept for that reveal's exit) would cut that much off the page's left edge
    // as the top bar floats in: the page drawn from the sidebar's edge but clipped 234px in, bare glass in the gap for as long as both stood.
    if (edge.pinned.side) setEdgeVar('--sf-sidebar-travel', '0px');
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
      for (const [name, value] of [['image', cs.backgroundImage], ['size', cs.backgroundSize], ['position', cs.backgroundPosition], ['repeat', cs.backgroundRepeat], ['color', cs.backgroundColor]]) setEdgeVar(`--sf-bg-${name}`, value);
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
  const liveEnded = floatLive || liveSeamless();   // a float over the LIVE page (the glass float, the solid one): the interface is raised over the page until main lowers it
  floatLive = false; dropGlass();
  floating = false; holes = []; pageRect = null; restHoles = [];
  desktopMaterialKey='';desktopMaterialRevision++;desktopClip={left:0,top:0};desktopBand={right:0,bottom:0};framedVisible=null;
  // The Mini float lowered because the layout docked the sidebar (Keep open) or because an undock's close has finished: the page glide that goes with the layout switch is still running, and
  // the interface is lowered by main only on its last frame (afterGlide), so no page view is above the floated sidebar at any moment of the slide (the sample's flaw 1).
  const behind = (afterGlide ?? quietMini()) && quietMini() ? { afterGlide: true } : {};
  const lowering = nativeFloatRaised;
  if (nativeFloatRaised) { nativeFloatRaised = false; send({ float: false, ...behind }); }
  miniFloating = false;
  // A site main held while the float lasted returns even if it was never pictured (main also returns it when lowered).
  pictureSkipped = false; clearStills(); if (picture) dropPicture(); else send({ still: 'release' });
  // While main keeps the interface raised until the page glide has landed (`afterGlide`), the page's rect stays a hole: without `data-sidebar-overlay` the interface paints its own opaque page
  // placeholder over the page for the whole glide. The attribute goes when main says the interface is lowered (`chrome-lowered`), or after a net timeout.
  // Beta 14.1: the same for the Seamless live float. Its page rect is a hole in the interface while the interface is above the page; the cut-out goes only once main has put the interface back under the page (`chrome-lowered`), or the interface
  // paints its own opaque page placeholder over the live page for the frames between this style change and the native lowering (a dark or a white flash over a playing video).
  const keepCutOut = lowering && ('afterGlide' in behind || (liveEnded && (globalThis as unknown as { __floatNoHold?: boolean }).__floatNoHold !== true /* rig only: the before of the held cut-out */));
  if (keepCutOut && (globalThis as unknown as { __miniNoHold?: boolean }).__miniNoHold !== true /* rig only: the before of the held cut-out */) { overlayHeld = true; window.clearTimeout(overlayTimer); overlayTimer = window.setTimeout(releaseOverlay, 2600); }
  else delete root.dataset.sidebarOverlay;
  floatTimer = window.setTimeout(() => { if (!floating) delete root.dataset.edgeFloat; }, wasNative ? 120 : 0);
  // 13.10 (laptop: the page could stay at the wrong rectangle after an unfocused reveal until a resize): when the float has ended the page is at its resting place, so the layout is measured and sent once more
  // from that. The page area's own size observer only speaks when the area changes size, and a page that main left somewhere else while parked never made it. Main ignores a layout that is the one it has.
  try { window.dispatchEvent?.(new Event(PAGE_FOLLOW_END)); } catch { /* a window that cannot dispatch */ }
}
let overlayHeld = false, overlayTimer = 0;
/** Main lowered the interface (or the net timer ran out): the held page cut-out can go. */
function releaseOverlay(): void { window.clearTimeout(overlayTimer); if (!overlayHeld) return; overlayHeld = false; if (!floating) delete document.documentElement.dataset.sidebarOverlay; }
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
  glided.forEach(([, property], index) => setEdgeVar(property, `${before[index] !== undefined && now[index] !== undefined ? before[index]! - now[index]! : 0}px`));
}
/** The address field while the SIDEBAR comes or goes (seamless.css, "THE ADDRESS FIELD WHILE THE SIDEBAR COMES OR GOES"): its box is the new picture stretched from the old box's width (`--edge-address-sx`)
 * and its text glides from where it was (`--edge-text-dx`), so nothing of it is drawn twice. WHERE THE TEXT IS is worked out, not read: the field centres its at-rest text itself in a ResizeObserver
 * (AddressField, `--af-center`), which has not run when the transition's update returns, and had not run either when the transition was ready (measured: the text began the slide a whole field-shift away
 * and came back). So both places come from the field's own rule (addressGlide.ts glideLayout) on what is already true: the field's box and the text's width. In visual px (the interface may be zoomed). */
type AddressBox = { width: number; text: number };
function addressBox(): AddressBox | undefined {
  const bar = [...document.querySelectorAll<HTMLElement>('.browser-shell .address-bar')].find(node => node.getBoundingClientRect().width);
  const field = bar?.querySelector<HTMLElement>('.address-field'); if (!bar || !field) return undefined;
  const box = field.getBoundingClientRect(), shown = field.querySelector<HTMLElement>('.address-display'), zoom = field.offsetWidth ? box.width / field.offsetWidth : 1;
  let shift = 0;   // a field in use with no at-rest text: the text is at the left
  if (shown) {
    const range = document.createRange(); range.selectNodeContents(shown);
    const layout = glideLayout({ fieldWidth: field.clientWidth, textWidth: range.getBoundingClientRect().width / (zoom || 1), hiddenPrefixWidth: parseFloat(field.style.getPropertyValue('--af-pre')) || 0 });
    shift = (field.hasAttribute('data-aligned') ? layout.pre : layout.center) * zoom;
  }
  return { width: bar.getBoundingClientRect().width, text: box.left + shift };
}
function setAddressMorph(before: AddressBox | undefined): void {
  const now = addressBox();
  if (!before || !now || !now.width) { setEdgeVar('--edge-address-sx', '1'); setEdgeVar('--edge-text-dx', '0px'); return; }
  setEdgeVar('--edge-address-sx', String(Math.round(before.width / now.width * 1e5) / 1e5));
  setEdgeVar('--edge-text-dx', `${Math.round((before.text - now.text) * 100) / 100}px`);
}

let headerPx = 72;
export function setEdgeHeaderHeight(px: number): void { headerPx = px; }
/** The sidebar's width in interface px (App keeps it current): the strip of the page its glass is made of. */
let sidebarPx = 240;
export function setEdgeSidebarWidth(px: number): void { if (Number.isFinite(px) && px > 80) sidebarPx = px; }

/** Main said the edges changed. A change that alters what is on screen plays as a transition. */
export function applyEdge(next: EdgeState): void {
  // Keep the most recent request while the current snapshot is being captured or animated.
  // Committing halfway through it would snap the live frame underneath an older snapshot.
  abortEdgeWarm();
  if (edgeBusy) { pendingEdge = next; return; }
  stepNote('edge');
  const prev = edge;
  if (prev.top === next.top && prev.side === next.side && prev.pinned.top === next.pinned.top && prev.pinned.side === next.pinned.side) return;
  const shownBefore = { top: prev.top || asks.top, side: prev.side || asks.side }, shownAfter = { top: next.top || asks.top, side: next.side || asks.side };
  const reveal = (shownAfter.top && !shownBefore.top) || (shownAfter.side && !shownBefore.side), hide = (!shownAfter.top && shownBefore.top) || (!shownAfter.side && shownBefore.side);
  // The toolbar or sidebar entering or leaving the layout moves the page area under the pinned page: the pin (--sidebar-page-*) is read again in the
  // same commit, or the page stood a frame or two where the layout put it before it "fixed itself" (reported 31 Oct, Seamless top bar).
  const before = glideLefts(), addressBefore = addressBox();
  // A pointer-driven top reveal that plays as a view transition keeps the macOS lights off until it has finished (`topLanding`, above); a key or the address field asks for the toolbar through `asks`: no landing.
  const landing = reveal && shownAfter.top && !shownBefore.top && !asks.top;
  const update = () => { if (landing && document.documentElement.dataset.modeSwitch === 'edge') armTopLanding(); flushSync(() => { edge = next; emit(); }); if (floatLive) placeGlass(); refreshEdgeFloat(); setGlide(before); setAddressMorph(addressBefore); };
  // The side floats when the pointer or a key reveals it; a pin docks it over the page's place as before (the page resizes once).
  // The toolbar floats the same way (R4-24: the page no longer glides down under it, so no strip of page background shows).
  const enteringFloat = floatable && ((next.side && !next.pinned.side && !prev.side) || (next.top && !next.pinned.top && !prev.top));
  // Over a website, the reveal waits (bounded) for the page's picture; a later edge change replaces the waiting one.
  // Beta 14.1: the sidebar and the top bar over a website (or a split) float over the LIVE page with the glass (no picture, nothing parked); the reveal waits (bounded) for the glass of the strip under each.
  const live = enteringFloat && connectedFrame && floatNative && !picture && (liveSeamless() || wantsGlass(next.side, next.top));
  const kinds = live && glassSwitch() ? glassKindsFor({ side: next.side && !next.pinned.side, top: next.top && !next.pinned.top }) : [];
  if (kinds.length && !kinds.every(glassFresh) && !glassTried) {
    pendingEdge = next;
    if (glassBusy) return;
    glassBusy = true; edgeBusy = true;
    void ensureGlass(kinds, 160).finally(() => {
      glassBusy = false; edgeBusy = false; glassTried = true;
      const requested = pendingEdge; pendingEdge = null;
      try { if (requested) applyEdge(requested); } finally { glassTried = false; }
    });
    return;
  }
  if (live) floatLive = true;
  if (enteringFloat && connectedFrame && floatNative && !picture && !pictureSkipped && !live && !liveFloatOn()) {
    pendingEdge = next;
    if (picturing) return;
    picturing = true; edgeBusy = true;
    const pictured = guardedBusy('picture', () => {
      picturing = false; edgeBusy = false; if (!picture) pictureSkipped = true;
      const requested = pendingEdge; pendingEdge = null;
      if (requested) applyEdge(requested);
      if (!floating) { pictureSkipped = false; if (nativeFloatRaised) { nativeFloatRaised = false; send({ float: false }); } dropPicture(); }
    });
    void takePicture().finally(pictured);
    return;
  }
  if (enteringFloat) setFloat(true, connectedFrame);
  if (floating && ((next.pinned.side && !next.top) || (next.pinned.top && !next.side))) setFloat(false);
  if (!reveal && !hide) { edge = next; emit(); return; }
  // A toolbar that stays shown while only the sidebar comes or goes moves like Compact's: each control glides from its old place
  // to its new one (seamless.css). Drawn as one slab, its new picture started at the slab's old left edge, with the first control
  // over the traffic lights and the arriving sidebar, and a leaving sidebar made the controls jump a caption's width at once.
  if (enteringFloat && floatFrame) expectLateRaise();   // (a raise sent at the transition's ready is waited for too)
  stepNote('transition-start');
  document.documentElement.dataset.edgeToolbar = shownBefore.top && shownAfter.top ? 'stays' : 'slab';
  // The stroke up the sidebar's edge (the left end of the card's ring) is not drawn while the sidebar slides in: held at its final place it stood alone ahead of the moving edge, a second
  // rounded card outline for most of the slide (reported 7 Nov, dark: "a line glitching on the lining of the sidebar"). It fades in once the sidebar has landed (sidebar-overlay.css).
  if (shownAfter.side && !shownBefore.side) document.documentElement.dataset.edgeRim = 'wait'; else delete document.documentElement.dataset.edgeRim;
  // The sidebar arrives ('in') or leaves ('out') in this transition: the top bar's light is cut by a window that travels with the sidebar's edge, and the sidebar's head light by one that travels the same way (styles/view-morph.css, the end block).
  if (shownAfter.side !== shownBefore.side) document.documentElement.dataset.edgeSide = shownAfter.side ? 'in' : 'out'; else delete document.documentElement.dataset.edgeSide;
  // D1: the panel's content stands still and is uncovered by the panel's edge (seamless.css, `data-edge-content`), instead of sliding in ahead of it. Only where a row STARTS at the window's edge (the sidebar
  // on the left in a left-to-right language, on the right in a right-to-left one): there the slide brought every row in tail first. On the other side the slide itself brings each row's start in first,
  // and a reveal from the window's edge would show its tail first (real frames, sidebar on the right: 'ocs' before 'Docs'). Not in Sidebar + address: the window buttons and the address block travel
  // with the panel by design.
  // THE OTHER SIDE SLIDES ON PURPOSE (D78, tried and taken out again on 19 Nov): with the content standing still there, every row came tail first ('ocs', 'ocs', 'rade - Docs', icons and first letters still
  // under the page's edge), which is what D1 cured on this side. As a drawer, each row arrives from its icon and first letter; tiles cut by the window's edge while they travel are the smaller evil.
  const rowsStartAtEdge = (document.documentElement.dataset.sidebarSide === 'right') === (document.documentElement.dir === 'rtl');
  if (shownAfter.side !== shownBefore.side && rowsStartAtEdge && !document.querySelector('.browser-shell[data-sbmode]')) document.documentElement.dataset.edgeContent = 'still'; else delete document.documentElement.dataset.edgeContent;
  // Whether the top bar arrives or leaves: the page's top corner beside the sidebar rides the card's moving top edge (sidebar-overlay.css edge-corner-lift-*).
  // Only while the sidebar stays: when it comes or goes with the bar, the layout is measured again after the layout change (the bar's height lands a frame later), so the
  // offsets the corner rides are not yet known when the pieces are captured.
  // 'diag' (the bar and the sidebar together, or the bar without a sidebar): the corner piece is left off for the slide.
  if (shownAfter.top !== shownBefore.top) document.documentElement.dataset.edgeTop = shownBefore.side && shownAfter.side ? (shownAfter.top ? 'in' : 'out') : 'diag'; else delete document.documentElement.dataset.edgeTop;
  holdVeil = shownBefore.top && !shownAfter.top && floatFrame;
  if (shownBefore.side && !shownAfter.side) dropRimEdge();
  const ms = startEdgeTransition(reveal ? 'reveal' : 'hide', update, headerPx, shownBefore.top === shownAfter.top && shownBefore.side !== shownAfter.side);
  if (landing && edgeTransition) { const landed = () => setTopLanding(false); void edgeTransition.finished.then(landed, landed); }   // the slide has landed: the lights may come (App.tsx)
  if (!edgeTransition) { delete document.documentElement.dataset.edgeToolbar; delete document.documentElement.dataset.edgeTop; delete document.documentElement.dataset.edgeRim; holdVeil = false; } if (!edgeTransition) { delete document.documentElement.dataset.edgeSide; delete document.documentElement.dataset.edgeContent; }
  if (edgeTransition) {
    edgeBusy = true;
    const settled = () => { edgeBusy = false; delete document.documentElement.dataset.edgeToolbar; delete document.documentElement.dataset.edgeTop; delete document.documentElement.dataset.edgeRim; delete document.documentElement.dataset.edgeSide; delete document.documentElement.dataset.edgeContent; if (holdVeil) { holdVeil = false; refreshEdgeFloat(); } const requested = pendingEdge; pendingEdge = null; if (requested) applyEdge(requested); };
    const settledOnce = guardedBusy('transition', settled);   // D143: the normal end or, after 1.5 s, the watchdog's; once
    void edgeTransition.ready.then(() => stepNote('vt-ready'), () => {});
    const clock = watchSlideClock(edgeTransition, stepNote);   // a frame that comes late after ready: the slide starts again from 0 (slideClock.ts)
    void edgeTransition.finished.then(() => { if (clock.gaps.length) stepNote('frame-gaps', clock.gaps.slice(0, 8).join(',')); if (document.documentElement.dataset.edgeTrace === 'on') { try { console.warn('[edge-frames]', JSON.stringify(clock.frames)); } catch { /* console */ } } }, () => {});
    void edgeTransition.finished.then(settledOnce, settledOnce);
    void edgeTransition.finished.then(stepFlush, stepFlush);
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
  // Says which float a Seamless sidebar reveal uses (the regression guard's c3 counts view-transition layers: the glass float has no page-picture layer).
  document.documentElement.dataset.seamlessGlass = glassSwitch() ? 'on' : 'off';
  const off = bridge()?.subscribeBrowser?.(raw => {
    const event = raw as unknown as { type: string; top?: boolean; side?: boolean; pinned?: { top?: boolean; side?: boolean } };
    if (event.type === 'chrome-edge-prime') { const prime = (raw as unknown as { prime?: { top?: boolean; side?: boolean } }).prime; primeEdge({ top: !!prime?.top, side: !!prime?.side }); return; }
    if (event.type === 'chrome-lowered') { releaseOverlay(); pageFloatLowered(); return; }
    // D137: a widening switch beside a right sidebar: the page stands at its final size under the floated interface (ui/pageFloat.ts)
    if (event.type === 'page-float') { applyPageFloat((raw as unknown as { rect?: PageRect | null }).rect ?? null, rect => send({ float: true, rect }), () => send({ float: false }), () => !floating); return; }
    if (event.type === 'page-blank') { const page = raw as unknown as { tabId?: unknown; blank?: unknown }; if (typeof page.tabId === 'string') notePageBlank(page.tabId, page.blank === true); return; }
    if (event.type !== 'chrome-edge') return;
    applyEdge({ top: !!event.top, side: !!event.side, pinned: { top: !!event.pinned?.top, side: !!event.pinned?.side } });
  });
  const names = ['pointerdown', 'pointerup', 'wheel'] as const;
  for (const name of names) window.addEventListener(name, forwardInput, { capture: true, passive: false });
  return () => { off?.(); for (const name of names) window.removeEventListener(name, forwardInput, { capture: true }); setFloat(false); edge = rest; emit(); };
}

/** Main refuses an edge command that does not pass its validation ("Invalid browser command") and the interface used to drop that answer: round 3's early raise was refused for want of a tab id and nobody knew. A refusal is now said in the console (main forwards it under ACIRA_EDGE_TRACE). */
function edgeCommandFailed(patch: Record<string, unknown>, error: unknown): void { try { console.warn('[edge-command-failed]', Object.keys(patch).join(','), String((error as { message?: string })?.message ?? error)); } catch { /* console */ } }
const send = (patch: Record<string, unknown>) => { const native = bridge(); if (activeTab && native) void Promise.resolve(native.browserCommand({ type: 'edge', tabId: activeTab, ...patch } as never)).catch(error => edgeCommandFailed(patch, error)); };
const sent = { holds: '', keys: '' };
/** What keeps a showing edge open, and what asks for one (only when they change). */
export function sendEdgeFlags(holds: { top: boolean; side: boolean }, keys: { top: boolean; side: boolean }): void {
  const h = `${holds.top}|${holds.side}`, k = `${keys.top}|${keys.side}`;
  if (h !== sent.holds) { sent.holds = h; send({ holds }); }
  if (k !== sent.keys) { sent.keys = k; send({ keys }); }
}
/** Beta 14: one of the interface's own drags (a tab, a Favorite, a link) is on, so the hidden sidebar may show at the edge for it (main: edge-reveal.cjs `carrying`), in every mode but Never. */
let carrying = false;
export function sendEdgeCarry(on: boolean): void { if (on === carrying) return; carrying = on; send({ carry: on }); }
/** Listens for the interface's own drags: carries from `dragstart` (after the drag's own handler has chosen what it carries) until `dragend` or `drop`. Returns what removes it. */
export function watchEdgeCarry(): () => void {
  const start = (event: DragEvent) => { const types = event.dataTransfer?.types; if (event.isTrusted && types && (types.includes('application/x-acira-app') || types.includes('text/uri-list') || types.includes('Files'))) sendEdgeCarry(true); };
  const end = () => sendEdgeCarry(false);
  document.addEventListener('dragstart', start);
  for (const name of ['dragend', 'drop'] as const) window.addEventListener(name, end, true);
  return () => { document.removeEventListener('dragstart', start); for (const name of ['dragend', 'drop'] as const) window.removeEventListener(name, end, true); sendEdgeCarry(false); };
}
export function pinEdge(zone: 'top' | 'side', on: boolean): void { send({ pin: { zone, on } }); }
/** Esc, or opening the sidebar for good: hide the edge now (and unpin it). */
export function dismissEdge(zone: 'top' | 'side'): void {
  const shown = currentEdge();   // the warm-up is no edge: nothing to dismiss (D135)
  if (zone === 'side' ? !shown.side && !shown.pinned.side : !shown.top && !shown.pinned.top) return;
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
