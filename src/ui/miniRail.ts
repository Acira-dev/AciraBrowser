import { RAIL_HIDDEN, layoutCentre } from './miniGeometry';
import { useSyncExternalStore } from 'react';
import { edgeActiveTab, miniFloat, miniRelease, miniStill } from './chromeEdge';
import { motionSpeed } from './sharedMotion';
import { bentRamp, lightShare, selectedFade, stayFadeEnd, stayFloor, stayRise, type Disc, type Glider } from './miniDockGlide';
import { MOVING_ATTR } from './miniDockMove';
import { MINI_DOCK_DONE, holdDockDone } from './miniDockDirection';
import { REFIT_EVENT } from './sidebarMorph';
import { runtime } from '../runtime/client';
import { MINI_RAIL_WIDTH, miniRailOn } from '../runtime/miniSidebar';
import { DWELL, GRACE, LEEWAY, LOCKOUT, MIN_VISIBLE, PREPARE_AHEAD, REST_MS, REST_PX, RETURN_MS, X_GUARD, closeDue, dwellFor, onRail as pointerOnRail, restStart, stillDue, type MiniSpeed } from './miniIntent';
import type { Settings, WindowUi } from '../runtime/types';

/* B14 Mini sidebar (AJ; ported from the approved sample, the reference sample, round 6: same structure, names and numbers). When the sidebar is closed it stays as a 56px
 * rail beside the page; resting the pointer on the rail opens the whole sidebar over the page (the hover peek's float, chromeEdge.ts),
 * leaving it closes it again. This is the intent half: pointer samples in, 'rail' | 'open' | 'closing' out. The rail is part of the
 * interface (not over the page), so the interface sees the pointer itself; main only floats the interface when asked. */

/** Rail width in interface px: twice the tab favicon's centre (the sidebar is shifted 6px right in Mini, so the centre is 28). */
export const MINI_RAIL = MINI_RAIL_WIDTH;
/** In Mini the whole sidebar sits 6px further from the window edge than the docked one, so its favicons are centred in the rail. */
export const MINI_SHIFT = 0; // round 4: open is the normal sidebar (no 6px shift); only the rail is translated 6px
/** Open and close lengths (the interface's --motion-pace: 1 Premium, .5 Fast); Off fades only. */
export const miniDuration = (): number => { const speed = motionSpeed(); return speed === 'off' ? 120 : speed === 'fast' ? 140 : 280; };

export type MiniPhase = 'rail' | 'open' | 'closing';
let phase: MiniPhase = 'rail';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/* the server snapshot is the same phase (a component that reads it can be drawn to markup, as tests do) */
export const useMiniPhase = (): MiniPhase => useSyncExternalStore(subscribe, () => phase, () => phase);
/** The rail is the sidebar's closed state in this window (the Favorites column and the rail-only parts are drawn only then: nothing extra at rest otherwise). */
export const useMiniRail = (): boolean => useSyncExternalStore(subscribe, () => enabled);
const setPhase = (next: MiniPhase) => { if (next === phase) return; phase = next; if (next !== 'rail') hideTip(true); else { glassPicture(false); dropStill(); } emit(); trace(next); };
/** Round 5 (settle/start check): raising the interface over the live page (main re-stacks the views) leaves the page area undrawn for one
 * or two frames; the open's first frames showed a blank page there. For the first 260ms of an open, the page's recent still stands in the
 * page area above the app's background (only visible once the interface is raised, i.e. exactly over those frames), then fades in 120ms.
 * It never stands in for the page for longer: the live page keeps running underneath and is what shows after. */
function raiseCover(): void {
  const area = document.querySelector('.page-area')?.getBoundingClientRect(), app = document.querySelector<HTMLElement>('.app');
  const still = freshStill();
  if (!still || !area || !app) return;
  const img = Object.assign(new Image(), { src: still, alt: '' });
  img.className = 'sb-mini-cover'; img.setAttribute('aria-hidden', 'true');
  Object.assign(img.style, { position: 'fixed', left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px`, zIndex: '5', pointerEvents: 'none', borderRadius: getComputedStyle(document.querySelector('.page-area')!).borderRadius, transition: 'opacity 120ms linear', objectFit: 'fill' });
  app.append(img);
  window.setTimeout(() => { img.style.opacity = '0'; window.setTimeout(() => img.remove(), 140); }, 260);
}
/** Round 5: the float's glass draws the page's picture itself (miniRail.css .sb-mini-glass), so it is one surface from the window's edge. */
function glassPicture(on: boolean): void {
  const shade = document.querySelector<HTMLElement>('.app > .sb-mini-shade');
  if (!shade) return;
  const src = on ? freshStill() : '', glass = shade.querySelector<HTMLElement>('.sb-mini-glass');
  if (src && glass) { const img = glass.querySelector('img') ?? glass.appendChild(Object.assign(new Image(), { alt: '', decoding: 'sync', className: 'sb-mini-glass-img' })); if (img.src !== src) img.src = src; shade.dataset.pic = ''; }
  else { delete shade.dataset.pic; glass?.replaceChildren(); }
}

/** QA: every phase change with its time (window.__miniTrace). */
const traceLog: { t: number; phase: string }[] = [];
function trace(what: string) { traceLog.push({ t: performance.now(), phase: what }); if (traceLog.length > 400) traceLog.shift(); }
(globalThis as unknown as { __miniTrace?: unknown }).__miniTrace = traceLog;

let root: HTMLElement | null = null, width = 240, enabled = false, side: 'left' | 'right' = 'left';
/** D170: counts every change of the rail's intent; an open's deferred switch-off acts only if nothing has changed since it began (dockOpen). */
let railGen = 0, openPending = 0;
/** How far from the sidebar's window edge a point is (the sidebar on the right is the same thing mirrored). */
const edgeX = (x: number): number => (side === 'right' ? window.innerWidth - x : x);
let samples: { x: number; y: number; t: number }[] = [];
let restSince = 0, inside = false, prepared: Promise<boolean> | null = null, ticker = 0;
/** Zero cost at rest: the 16 ms tick runs only while the pointer is on the rail (a rest is a wait, no event ends it) or the sidebar is open or closing. */
const arm = (): void => { if (!ticker) ticker = window.setInterval(step, 16); };
const disarm = (): void => { if (ticker) { window.clearInterval(ticker); ticker = 0; } };
/** Something outside the sidebar that keeps it open (a menu or pop-up from it, a confirmation), set by App. */
let popupHold = false;
export function setMiniPopupHold(on: boolean): void { popupHold = on; }
let openedAt = 0, openedPoint: { x: number; y: number } | null = null, leaveAt = 0, insideSince = 0, lockUntil = 0, closeTimer = 0;
let buttons = 0, holdDrag = false;
/** A wheel over the rail (the Favorites column, the tab list) is scrolling, not a request for the sidebar: no open until the pointer moves on. */
let wheelAt: { x: number; y: number } | null = null;
export function noteMiniWheel(): void { const last = samples.at(-1); wheelAt = last ? { x: last.x, y: last.y } : { x: -1, y: -1 }; restSince = 0; if (prepared && phase === 'rail') { prepared = null; miniRelease(); } }

const speed = () => motionSpeed();
const now = () => performance.now();
/** The rail (closed) or the open sidebar plus LEEWAY (open), in window px. */
const railRight = () => MINI_RAIL;
const openRight = () => width + MINI_SHIFT + LEEWAY;

/** Something in the sidebar that keeps it open whatever the pointer does: a rename or address field with focus, a drag that started in it,
 * keyboard focus inside it (F6 / Tab). (Menus and pop-ups from the sidebar live in the overlay view: not done yet.) */
function held(): boolean {
  if (holdDrag || popupHold) return true;
  const active = document.activeElement as HTMLElement | null;
  if (root && active && root.contains(active) && (active.matches('input,textarea,[contenteditable=true]') || active.matches(':focus-visible'))) return true;
  return !!document.querySelector('.acira-sidebar [data-renaming], .acira-sidebar .sb-tab input');
}

/** The hover float (rest on the rail, a click on its empty space) is HIDDEN (reported 17 Nov 01:35: "when I'm hovering it, it's not that good at all, especially the colours and the icons, the glow is faster than the sidebar; hide it, fix it
 * later"). With this off the rail stays a rail under the pointer: it never opens by hover, rest or click, the sidebar opens only by its button, the shortcut or the menu (the dock's slide, miniRail.css `data-mini-dock`), and the pointer
 * over a rail item shows that tab's preview card (railTip). Everything the float needs stays in place behind this one switch. */
export const MINI_HOVER_FLOAT = false;
function open(): void {
  if (!MINI_HOVER_FLOAT) return;
  if (phase === 'open') return;
  window.clearTimeout(closeTimer);
  const reopening = phase === 'closing';
  closingFor = '';
  openedAt = now(); openedPoint = samples.at(-1) ?? null; leaveAt = 0;
  const go = () => { if (!enabled) return; if (!reopening) raiseCover(); miniFloat(true); glassPicture(true); setPhase('open'); };
  if (reopening) { go(); return; }
  // Round 5: the open never waits for, and never shows, a picture of the page: the live page stays under the float (native float).
  prepared = null;
  go();
}
/** Why the sidebar is closing: only a pointer that left it (`left`) may be turned round by a return; Esc, a click on the page, the undock and a hold ending say "closed" and stay closed until the pointer moves on. */
let closingFor = '';
function close(reason: string): void {
  if (phase !== 'open') return;
  trace('close:' + reason);
  leaveAt = 0; restSince = 0; closingFor = reason;
  if (reason !== 'left') { const last = samples.at(-1); wheelAt = last ? { x: last.x, y: last.y } : { x: -1, y: -1 }; }
  setPhase('closing');
  window.clearTimeout(closeTimer);
  // The float ends only once the sidebar is back in the rail, so the page is never uncovered by a placeholder mid-motion.
  closeTimer = window.setTimeout(() => { if (phase !== 'closing') return; setPhase('rail'); miniFloat(false, closingFor === 'undock'); lockUntil = now() + LOCKOUT; }, miniDuration() + 34);
}

function step(): void {
  if (!enabled) return;
  const t = now(), last = samples.at(-1);
  if (!last) return;
  if (phase === 'closing' && closingFor !== 'left') return;
  if (phase === 'rail' || phase === 'closing') {
    const lx = edgeX(last.x), onRail = pointerOnRail({ inside, fromEdge: lx, y: last.y, closing: phase === 'closing', width: openRight() - LEEWAY, buttons, now: t, lockUntil, rail: railRight() });
    if (wheelAt && Math.hypot(last.x - wheelAt.x, last.y - wheelAt.y) >= REST_PX) wheelAt = null;
    if (!onRail || (wheelAt && phase === 'rail')) { if (restSince && phase === 'rail') { restSince = 0; if (prepared) { prepared = null; miniRelease(); } } if (phase === 'rail') disarm(); return; }
    // Rest: where the pointer has been in the last REST_MS. The rest began at the last sample that was REST_PX or more away.
    const since = restStart(samples);
    restSince = since;
    const rested = t - since;
    const under = document.elementFromPoint(last.x, last.y), overFavorites = !!under?.closest?.('.sb-mini-favs');
    // Round 5 (reported: switching must be instant and never bring the float): a rest on an icon (a tab, a folder, a Favorite, a button) is
    // usually the moment before a click, so it waits DWELL_ITEM; a rest on the rail's empty space opens as before. The page is pictured
    // only just before the open (never for a rest that ends in a click), so a switch never pays for a snapshot.
    const overItem = !!under?.closest?.(TIP_ITEMS + ',button');
    const dwell = dwellFor({ closing: phase === 'closing', overItem, overFavorites, speed: speed() });
    if (qaHold && phase === 'rail') return;
    if (stillDue(rested, dwell) && !prepared && phase === 'rail' && !(globalThis as unknown as { __msNoStill?: boolean }).__msNoStill) { const tab = edgeActiveTab(); prepared = miniStill().then(url => { if (url && tab && tab === edgeActiveTab()) { lastStill = url; stillAt = now(); stillTab = tab; glassPicture(phase !== 'rail'); } else dropStill(); return !!url; }); }
    if (rested >= dwell) open();
    return;
  }
  // open
  const on = pointerOnRail({ inside, fromEdge: edgeX(last.x), y: last.y, closing: false, width: 0, buttons: 0, now: t, lockUntil: 0, rail: openRight() });
  if (held()) { leaveAt = 0; return; }
  if (on) {
    if (!insideSince) insideSince = t;
    if (leaveAt && t - insideSince >= RETURN_MS) leaveAt = 0;
    return;
  }
  insideSince = 0;
  if (!leaveAt) leaveAt = t;
  if (closeDue({ now: t, leaveAt, openedAt, speed: speed() })) close('left');
}

/* Round 5: names in the rail. The rail is 56px and the page (a native view) covers the interface beside it, so the house tooltip
 * squeezed into the rail and wrapped letter by letter. A rail item's name is now drawn by the tab card's view, which is above the page:
 * the house tooltip's chip (one line, sized to its text, at most 260px, ellipsis), beside the rail, centred on the item. Its timing is the
 * card's (450ms first, at once between neighbours). It shows only while the rail stays a rail (after a wheel or a click, which hold the
 * open off) and leaves the moment the sidebar starts to open. */
const TIP_ITEMS = '.sb-mini-fav,.sb-tab[data-tab-id],.sb-group-header,.sb-new-tab,.sb-zone-toggle,.sb-foot-profile,.sb-bookmark,.sb-folder,.np-wrap[data-media-tab]';
/** The page's still (for the glass and the first frames' cover): only ever a FRESH picture of the tab that is showing: it is dropped on a tab change, a page that cannot be pictured, a failed capture and when the sidebar is back in the rail. */
let lastStill = '', stillAt = 0, stillTab = '';
const freshStill = (): string => (lastStill && stillTab === edgeActiveTab() && now() - stillAt < 1500 ? lastStill : '');
const dropStill = (): void => { lastStill = ''; stillTab = ''; };
let tipEl: HTMLElement | null = null, tipTab: string | null = null, tipWheelTimer = 0, qaHold = false;
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
function tipLabel(item: HTMLElement): string {
  // The rail's media tile (final round, item 3): what plays, as the open card says it: the track, then the artist.
  if (item.matches('.np-wrap[data-media-tab]')) { const title = text(item.querySelector('.np-text:not(.np-out) .np-title')), artist = text(item.querySelector('.np-text:not(.np-out) .np-artist-name')); return artist && artist !== title ? `${title} · ${artist}` : title; }
  if (item.matches('.sb-mini-fav')) return item.getAttribute('aria-label') || item.dataset.tipTitle || item.title || '';
  const own = item.querySelector('.sb-tab-title,.sb-group-name,.sb-zone-label,.sb-foot-profile>span:not(.profile-avatar),.sb-new-tab>span:not(.sb-tab-icon)');
  return text(own) || item.getAttribute('aria-label') || item.dataset.tipTitle || item.title || '';
}
function hideTip(now = false): void {
  if (!tipEl && !now) return;
  const tab = tipTab; tipEl = null; tipTab = null;
  if (tab) void runtime.browserCommand({ type: 'tab-card', tabId: tab, action: now ? 'dismiss' : 'leave' }).catch(() => {});
}
function railTip(x: number, y: number, target: EventTarget | null): void {
  if (!enabled || !root || phase !== 'rail' || edgeX(x) >= MINI_RAIL || buttons) { hideTip(); return; }
  const item = (target as Element | null)?.closest?.(TIP_ITEMS) as HTMLElement | null;
  if (!item || !root.contains(item)) { hideTip(); return; }
  if (item === tipEl) return;
  const title = tipLabel(item), tab = item.dataset.tabId || item.dataset.mediaTab || document.querySelector<HTMLElement>('.acira-sidebar .sb-tab[aria-current=true]')?.dataset.tabId || document.querySelector<HTMLElement>('.acira-sidebar .sb-tab[data-tab-id]')?.dataset.tabId;
  if (!title || !tab) { hideTip(); return; }
  const box = (item.matches('.sb-mini-fav') ? item : item).getBoundingClientRect(), mid = box.top + box.height / 2;
  tipEl = item; tipTab = tab;
  // A site's icon shows that tab's PREVIEW card (reported 17 Nov 01:35: "the only thing that will help is to actually see the preview of the site"): the tab card the docked sidebar's rows show (main decides its kind: a page's
  // picture, or just its name for Acira's own pages), beside the rail from the sidebar's edge, centred on the icon's row. Folders, the New tab row and the footer keep their one-line name.
  if (item.matches('.sb-tab[data-tab-id]') || (item.matches('.sb-mini-fav') && item.dataset.tabId)) {
    void runtime.browserCommand({ type: 'tab-card', tabId: tab, action: 'hover', anchor: { x: side === 'right' ? Math.round(window.innerWidth - MINI_RAIL) : 0, y: Math.round(box.top), width: MINI_RAIL, height: Math.round(box.height) }, side: side === 'right' ? 'left' : 'right', floor: 0 }).catch(() => {});
    return;
  }
  // The card goes 6px right of the anchor and 4px above its top: an anchor the rail's width, 24px tall, centred on the item.
  void runtime.browserCommand({ type: 'tab-card', tabId: tab, action: 'hover', anchor: { x: side === 'right' ? Math.round(window.innerWidth - MINI_RAIL) : 0, y: Math.round(mid - 12 + 4), width: MINI_RAIL, height: 24 }, side: side === 'right' ? 'left' : 'right', floor: 0, label: { title: title.slice(0, 300), host: '', tip: true } }).catch(() => {});
}
/* Round 5 (reported: closing a folder in the rail sent its icons sliding right and out of the rail). The list's fold leaves a fading copy of
 * each row that goes (.sb-flip-ghost, outside the folder), at the row's own x: in the rail a folder's tabs stand 21px left of that (on the
 * axis), so the copies appeared 21px right and shrank around the full row's centre. In the rail the copies of folder tabs take the same
 * 21px and shrink around the icon's axis: they fade and shrink in place, the reverse of the open. */
/** Called by the list's fold (useFlip) for each copy it leaves behind: no observer runs at rest. */
export function railGhost(ghost: HTMLElement): void {
  const aside = ghost.closest<HTMLElement>('.acira-sidebar.is-mini:not([data-mini=open])');
  if (!aside || phase === 'open') return;
  const left = aside.getBoundingClientRect().left;
  // Round 6: the copy goes back by its own indent (a top folder's tab 21px, a nested folder's tab about 42px), measured against a top-level
  // row's left edge (the New tab row), so every leaving copy shrinks on the axis whatever its depth.
  const anchor = aside.querySelector<HTMLElement>('.sb-new-tab:not(.sb-flip-ghost)'), base = anchor ? anchor.getBoundingClientRect().left - left : 8;
  const dx = ghost.getBoundingClientRect().left - left - base;
  if (dx > 2) ghost.style.translate = `${-dx}px 0`;
  ghost.style.transformOrigin = '14px 50%';
}
const onMove = (event: PointerEvent | MouseEvent) => {
  if (!enabled) return;
  if (!MINI_HOVER_FLOAT) { buttons = event.buttons; railTip(event.clientX, event.clientY, event.target); return; }   // no intent, no ticks: only the preview card follows the pointer
  const t = now();
  inside = true; buttons = event.buttons;
  if (buttons === 0) holdDrag = false;
  samples.push({ x: event.clientX, y: event.clientY, t });
  while (samples.length > 2 && t - samples[0].t > 400) samples.shift();
  if (phase !== 'rail' || edgeX(event.clientX) < railRight()) arm();
  step();
  railTip(event.clientX, event.clientY, event.target);
};
const onLeave = (event: MouseEvent) => { if (event.relatedTarget) return; hideTip(); if (!MINI_HOVER_FLOAT) return; inside = false; samples.push({ x: 1e6, y: 0, t: now() }); step(); };
const onDown = (event: PointerEvent) => {
  if (!enabled || !root) return;
  hideTip(true);
  root.removeAttribute('data-mini-kb');
  if (!MINI_HOVER_FLOAT) return;
  const target = event.target as HTMLElement | null, inSidebar = !!target?.closest('.acira-sidebar');
  if (phase === 'open' && !inSidebar && !target?.closest('.browser-popup,[role=dialog]')) { close('page-click'); return; }
  if (inSidebar && event.button === 0) holdDrag = true;
  // A click on empty rail space opens it at once; a click on a tab, a plate or a button does that item's job.
  if (phase === 'rail' && inSidebar && event.button === 0 && edgeX(event.clientX) < railRight() && !target?.closest('button,a,input,[role=button],.sb-tab')) open();
  // ... and the rest after that click is not a request for the sidebar either: no open until the pointer moves on.
  else if (phase === 'rail' && inSidebar && edgeX(event.clientX) < railRight()) noteMiniWheel();
};
const onWheel = (event: WheelEvent) => {
  if (!(enabled && phase === 'rail' && (event.target as HTMLElement | null)?.closest?.('.acira-sidebar'))) return;
  noteMiniWheel();
  // The column moves under a still pointer: the name follows the Favorite that lands there once it settles.
  hideTip(true); window.clearTimeout(tipWheelTimer);
  tipWheelTimer = window.setTimeout(() => { const last = samples.at(-1); if (last) railTip(last.x, last.y, document.elementFromPoint(last.x, last.y)); }, 280);
};
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && phase === 'open') { const active = document.activeElement as HTMLElement | null; if (!(root && active && root.contains(active) && active.matches('input,textarea,[contenteditable=true]'))) close('esc'); }
  // Round 5: typing (Ctrl+Tab, Ctrl+1..9) while the pointer rests on the rail is not a request for the sidebar: no open, no snapshot.
  else if (phase === 'rail' && enabled) { noteMiniWheel(); hideTip(true); }
  if (/^(Tab|Arrow|F6|Home|End)/.test(event.key)) root?.setAttribute('data-mini-kb', '');
};
/** A tab's × that has just appeared under a resting pointer ignores clicks for X_GUARD ms and until the pointer moves (Brave's lost tab). */
const onClick = (event: MouseEvent) => {
  if (phase !== 'open' || !(event.target as HTMLElement | null)?.closest('.sb-tab-close')) return;
  const moved = openedPoint && Math.hypot(event.clientX - openedPoint.x, event.clientY - openedPoint.y) >= 2;
  if (now() - openedAt < X_GUARD && !moved) { event.preventDefault(); event.stopPropagation(); trace('x-guard'); }
};

/* The dock switch on the left (miniRail.css, the block at the end of the file). Full <-> Mini inside a layout switch is ONE live sidebar for the whole switch: the float's own open <-> close geometry and fades
 * (the rules that say `data-mini=open` and `data-mini=closing`), on the page's spring. The aside is given the float's phase attribute straight on the element (React's phase stays `rail`, so nothing that reads it moves: the toolbar's
 * padding, the float's shade), plus `data-mini-dock-st` (`out` | `in`) which scopes the dock's own rules. The phase goes to its second value at the transition's `ready`, and everything is given back when the transition has
 * finished (the root's `data-mini-dock` goes). The picture's edge is a pseudo-element animation (CSS) which starts at `ready`; the live transitions start one frame after it, so they are moved on by that frame (their `currentTime`):
 * every layer of the sidebar is at the same place of the same curve. */
const DOCK_ST = 'data-mini-dock-st';
let dockSeq = 0;
type ActiveTransition = { ready: Promise<unknown> };
/** The switch's own transition, where the engine names it (`document.activeViewTransition`). */
const activeTransition = (): ActiveTransition | null => (document as Document & { activeViewTransition?: ActiveTransition | null }).activeViewTransition ?? null;
const pictureAnimation = (started: boolean): Animation | undefined => document.getAnimations().find(item => !!(item.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') && (!started || item.startTime !== null));
/** One of the view transition's own animations (they all start at its `ready`), or null when none appears within ~40 frames or the switch is gone. */
function transitionAnimation(): Promise<Animation | null> {
  // At the transition's `ready` its animations exist and none has started: what is made in that same task starts in the frame they start in. (Real frames at Wide and Narrow, 19 Nov: found by a frame loop only once one of them HAD started,
  // the favorites and the washes stood still for two recorded frames, 33 ms, while the frame's pictures were already moving, and then jumped onto the clock.) The frame loop is what an engine without the name falls back to.
  const active = activeTransition();
  if (active) return active.ready.then(() => pictureAnimation(false) ?? null, () => null);
  return new Promise(resolve => {
    let frames = 0;
    const look = () => {
      const own = pictureAnimation(true);
      if (own) { resolve(own); return; }
      if (++frames > 40 || !document.documentElement.hasAttribute('data-mode-switch')) { resolve(null); return; }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
/** The two places of the sidebar's edge in the switch (the frame's pictures use them: miniRail.css `--mini-dock-w`, `--mini-dock-r`). */
function setEdge(w: number, lead = 0): void {
  const style = document.documentElement.style;
  if (w) {
    style.setProperty('--mini-dock-w', `${w}px`); style.setProperty('--mini-dock-r', `${MINI_RAIL}px`); style.setProperty('--mini-dock-travel', `${w - MINI_RAIL}px`); style.setProperty('--mini-lead', `${lead}ms`);
    bentRamp(barLightShare()).forEach((value, i) => style.setProperty(`--mini-e${i + 1}`, String(value)));
  } else { for (const name of ['--mini-dock-w', '--mini-dock-r', '--mini-dock-travel', '--mini-lead', '--mini-e1', '--mini-e2', '--mini-e3']) style.removeProperty(name); }
}
/** The bar light's share of the frame beside the sidebar as it stands now (miniDockGlide `lightShare`): read from the light's own layer, the one that shows most, as ui/ambient.ts wrote it (its gradient and its opacity, both inline:
 * nothing is computed for this), and the band's height it put on the root. 0 with no light, or one that cannot be read. */
function barLightShare(): number {
  try {
    let image = '', shown = 0;
    for (const layer of document.querySelectorAll<HTMLElement>('.browser-shell > .st-amb-top > .amb-l')) { const o = parseFloat(layer.style.opacity) || 0; if (o > shown) { shown = o; image = layer.style.backgroundImage; } }
    if (!image) return 0;
    return lightShare(image, shown, parseFloat(document.documentElement.style.getPropertyValue('--amb-foot')) || 0, document.documentElement.dataset.sidebarSide === 'right');
  } catch { return 0; }
}
/** The sidebar's edge may stand ahead of the native page's on an expand, never behind it: the page covers whatever of the picture is under it, but a gap would show the frame (real window, 18 Nov: the page 10 to 16 px ahead of the edge on an expand for ~150 ms; main's page waits OPEN_LEAD_FRAMES = 2.5 display frames before it
 * moves, and the picture of a pseudo-element animation reaches the screen about two frames after the animation's start). The picture and every live transition of an expand start this many ms ahead (a negative animation delay and the same in the carry). */
const EXPAND_LEAD_MS = 24;
/** Puts `item` on the transition's own clock: at once when that clock's start is known, else the moment it is (made in the same task as the transition's animations it starts in their frame; this makes the two starts the same number). */
function onClock(item: Animation, own: Animation | null): void {
  if (!own) return;
  const start = clockStart(own);
  if (start !== null) { item.startTime = start; return; }
  void own.ready.then(() => { const at = clockStart(own); if (at !== null && item.playState !== 'idle' && item.startTime !== at) item.startTime = at; }, () => {});
}
/** The clock's start, read once a task. D172 (item 3): reading a CSS animation's `startTime` makes the engine bring every style up to date first, and a dock switch puts about 50 animations on the clock one after another, each
 * right after a write (the app's trace, 40 tabs: 46 to 49 forced style passes, 8 to 9 ms, in the task before the first moving frame). Within a task the start cannot change (it is decided at a frame); it is forgotten when the task's
 * script is done, so a later task (a pause, a resumed clock) reads it afresh. */
const clockStarts = new WeakMap<Animation, number | null>();
function clockStart(own: Animation): number | null {
  if (clockStarts.has(own)) return clockStarts.get(own) ?? null;
  const read = own.startTime === null ? null : Number(own.startTime);
  clockStarts.set(own, read);
  queueMicrotask(() => clockStarts.delete(own));
  return read;
}
/** The favorites ride the PAGE's clock, not the frame's pictures' (real frames at Wide, 19 Nov, three clocks read off each frame: the page's edge, a toolbar button's picture, a gliding icon). Closing, main's page does not wait (page-motion.cjs: a wait
 * there opens a strip) and stands 24 ms ahead of the pictures in the first frames, about 10 ms later on: a favorite from the last column was under the page's edge for five frames. Their glide and fades start this many ms ahead of the pictures on a
 * collapse. Opening, main's page waits and stands with the pictures (0 to 8 ms behind them): the favorites take no lead there (with the sidebar's edge's lead they ran 24 to 32 ms ahead of the page and came out from under it cut). A time, not a
 * length: the same at every width. */
const COLLAPSE_CONTENT_LEAD_MS = 20;
/** The clock everything that rides the sidebar's edge runs on in a dock switch, as ms ahead of the frame's pictures. On the LEFT the sidebar's picture stands still and a window uncovers it, so its edge may run ahead of the page's (the page
 * covers what is under it): EXPAND_LEAD_MS on an expand, none on a collapse (the page is ahead there and covers it). On the RIGHT the picture is a drawer: the rail is the sidebar's page-side 56 px, so the whole picture travels with the edge,
 * and whatever of it is ahead of the page's edge is covered WITH its contents (real frames, 19 Nov, take b6r: the first favorite, the New tab row's plus and the tabs' icons cut in half for three frames of an expand; on a collapse the page
 * runs ahead and cut the first column). There the drawer, the favorites inside it and the lights that ride its edge are on ONE clock, the page's own: the pictures' on an expand (the page waits for them), COLLAPSE_CONTENT_LEAD_MS ahead on
 * a collapse (the page does not wait). The stylesheet reads it as `--mini-lead` (setEdge). */
function dockLead(direction: 'out' | 'in'): number {
  const right = document.documentElement.dataset.sidebarSide === 'right';
  return right ? (direction === 'in' ? 0 : COLLAPSE_CONTENT_LEAD_MS) : (direction === 'in' ? EXPAND_LEAD_MS : 0);
}
const SPRING_EASE = 'linear(0,.03361,.112,.21091,.31536,.41656,.50969,.59255,.66451,.72589,.77752,.82045,.85584,.88478,.9083,.9273,.94258,.95483,.9646,.97237,.97853,.9834,.98725,.99027,.99265,.99452,.99598,.99712,.99801,.99871,.99925,.99967,1)';
/** The sidebar's lights (the wash layers, the Ambient light) are the ones the eye reads against the page's edge, so each is a Web Animation started at the transition's own start time (`startTime` of its pseudo animation) instead of a CSS transition carried
 * to it: a transition that was pending took its start from the next frame and lagged the edge by up to ~100 ms in the real window (the wash arrived at x 228 at +500 ms of an expand; the probe in a hidden window did not show it). miniRail.css gives these
 * elements no transition of their own in a dock switch. Returns what to cancel at the end. */
function glideLights(el: HTMLElement, direction: 'out' | 'in', w: number, own: Animation | null, lead: number): Animation[] {
  const right = document.documentElement.dataset.sidebarSide === 'right', rail = w - MINI_RAIL, dur = 480 * (motionSpeed() === 'fast' ? .5 : 1);
  const px = (n: number) => `${n}px 0`;
  const washRail = right ? -6 : -(rail + 6), restPlace = 0, ambRail = right ? rail : -rail;
  const targets: [Element, string, string][] = [];
  for (const wash of el.querySelectorAll('.st-glow-rail')) targets.push([wash, px(direction === 'out' ? restPlace : washRail), px(direction === 'out' ? washRail : restPlace)]);
  const inside = el.querySelector(':scope > .st-amb-side'), outside = document.querySelector('.app > .st-amb-side.sb-mini-amb');
  // the sidebar on the left: the head's light is a picture that slides on the keyframes the bar's light slides on (miniRail.css, ONE FIELD); the live layers stand still
  if (right && inside && direction === 'in') targets.push([inside, px(ambRail), px(restPlace)]);
  if (right && outside && direction === 'out') targets.push([outside, px(restPlace), px(ambRail)]);
  const made: Animation[] = [];
  for (const [target, from, to] of targets) {
    const item = target.animate([{ translate: from }, { translate: to }], { duration: dur, easing: SPRING_EASE, delay: -lead, fill: 'both' });
    onClock(item, own);
    made.push(item);
  }
  return made;
}
/** A favorite's plate at one end of a dock switch: its box (window px), corner, fill and shadow. */
type Plate = { x: number; y: number; w: number; h: number; r: number; fill: string; shadow: string };
/** The travelling plates of the switch that is running; they go when it ends (dockSwitch's end). */
const dockPlates: HTMLElement[] = [];
const dropPlates = (): void => { for (const plate of dockPlates.splice(0)) plate.remove(); for (const line of document.querySelectorAll('.acira-sidebar > .sb-mini-line:is([data-dock-fav],[data-dock-row])')) { line.removeAttribute('data-dock-fav'); line.removeAttribute('data-dock-row'); } };
/** The rail marker's tile colour as it rests (miniRail.css `--mark-tile`, a custom property, so no transition stands between it and its value): its painted colour reads as clear while the marker is hidden or its colour is
 * still easing in, and its ::before has no values at all while the marker is not drawn (an expand's ready): read from the marker itself (the open Favorite's plate faded out on its way and the tile popped in at the landing: one
 * Favorite, and every expand). */
let markSeen = '', markRow: HTMLElement | null = null;
const markTile = (line: HTMLElement | null, mark: CSSStyleDeclaration | null): string => (line && getComputedStyle(line).getPropertyValue('--mark-tile').trim()) || mark?.getPropertyValue('--mark-tile').trim() || markSeen || mark?.backgroundColor || '';
const PLATE_STEPS = 8;
/** The keyframes of a plate's travel at `progress` 0..1 (the switch's curve is the effect's easing, so a keyframe's offset IS the progress): the box moves and scales from one end to the other (a transform: the compositor
 * runs it) and its corner, kept in the box's own units, stays the corner it should be at that progress on both axes; the colour goes straight from one end's to the other's; the shadow goes out by the middle and the other
 * end's comes in after it (two shadow lists interpolate only when they match). */
function plateFrames(from: Plate, to: Plate): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= PLATE_STEPS; i++) {
    const p = i / PLATE_STEPS, sx = 1 + (to.w / from.w - 1) * p, sy = 1 + (to.h / from.h - 1) * p, r = from.r + (to.r - from.r) * p;
    const frame: Keyframe = { offset: p, transform: `translate(${(to.x - from.x) * p}px, ${(to.y - from.y) * p}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` };
    if (i === 0) Object.assign(frame, { backgroundColor: from.fill, boxShadow: from.shadow });
    if (i === PLATE_STEPS / 2) frame.boxShadow = 'none';
    if (i === PLATE_STEPS) Object.assign(frame, { backgroundColor: to.fill, boxShadow: to.shadow });
    frames.push(frame);
  }
  return frames;
}
/** The column's fade over a favorite's icon at its place in the rail (miniRail.css .sb-mini-favs[data-more~=below]: the column's last 22 px when there are more Favorites below), as a mask image in the icon's own box that
 * the switch slides in with the motion (mask-position 0 -200px at the docked end, the fade 200 px below the icon; 0 -400px at the rail's end, in place), or null when the icon is clear of it. (A column scrolled down, with a
 * fade above as well, keeps the old way for its first icon: it travels whole and takes the column's look at the landing.) */
function columnFade(icon: DOMRect, column: DOMRect, below: boolean): string | null {
  if (!below || icon.bottom <= column.bottom - 22) return null;
  const at = (y: number) => `${Math.round((y - icon.top + 400) * 10) / 10}px`;
  return `linear-gradient(#000 ${at(column.bottom - 22)}, transparent ${at(column.bottom)})`;
}
/** Favorites in a dock switch: each one is ONE thing that travels (reported 18 Nov, real frames at 150 %: "W" stood twice, the rail's column fading in beside the grid's row fading out). The grid's own icons glide between their
 * place in the grid and their twin's place in the rail's column (a transform on the sidebar's clock and curve, the size going to the column's 16 px), each tile's own plate fades in the first 30 % of a collapse (the last 30 % of an expand), and a
 * favorite the column has no room for fades whole in that same part. The column itself is hidden for the whole switch (miniRail.css) and is what shows from the frame after the last, where grid and column stand at the same place. */
/** What stands for a Favorite's icon in the grid and in the rail's column: its site icon, or its letter when it has none (D189). */
const FAV_ICON = '.site-identity-icon, .sb-app-initial';
function glideFavorites(el: HTMLElement, direction: 'out' | 'in', own: Animation | null, lead: number, w = width): Animation[] {
  const grid = el.querySelector<HTMLElement>('.sb-apps'), column = el.querySelector<HTMLElement>('.sb-mini-favs');
  if (!grid || !column) return [];
  const dur = 480 * (motionSpeed() === 'fast' ? .5 : 1), room = column.getBoundingClientRect(), twins = [...column.querySelectorAll<HTMLElement>('.sb-mini-fav')], used = new Set<HTMLElement>();
  const made: Animation[] = [], out = direction === 'out';
  const run = (target: Element, frames: Keyframe[], easing: string): void => {
    const item = target.animate(out ? frames : [...frames].reverse().map(frame => ({ ...frame, offset: typeof frame.offset === 'number' ? 1 - frame.offset : undefined })), { duration: dur, easing, delay: -lead, fill: 'both' });
    onClock(item, own);
    made.push(item);
  };
  // Everything is READ first and the animations are started after: a read after an animation has started forces a new style calculation, and this ran one per favorite (the app's trace, 19 Nov: 27 style calculations in
  // the frame the switch's animations start, 21.7 ms on the main thread).
  const gliders: Glider[] = [], stay: { tile: HTMLElement; box: DOMRect; icon: Disc | null; shown: number }[] = [], moves: { icon: HTMLElement; tile: HTMLElement; dx: number; dy: number; size: number; from: Plate; to: Plate; fade: string | null; current: boolean }[] = [];
  // D152: the rail's own look of a favorite's place (its plate) and of the open Favorite (the marker's tile stands there, miniRail.css .sb-mini-line::before), and where the column's fade lies (data-more)
  // (placed first: a marker the dock has not placed yet is hidden and has no site colour, so its tile read as clear, and the open Favorite's plate faded out on its way and the tile popped in at the landing: Narrow, 8 Favorites)
  const line = el.querySelector<HTMLElement>(':scope > .sb-mini-line');
  if (out && line && (line.hasAttribute('data-hidden') || !line.hasAttribute('data-on-fav')) && grid.querySelector('.sb-app[aria-current=page]')) placeLineNow(el);
  const mark = line ? getComputedStyle(line, '::before') : null;
  // 14.3 Tab size: the marker's tile is the sidebar's row tall (28 / 32 / 38) on the Favorite's place, which stays 40 x 32
  const rowH = parseFloat(getComputedStyle(el).getPropertyValue('--sb-row')) || 0;
  let carried = false;
  // (from the column's own size, not its data-more mark: the switch's first commit drew the column anew and the mark was empty then, so an expand's last Favorite left without its fade)
  const fadeBelow = /(^| )below( |$)/.test(column.getAttribute('data-more') || '') || column.scrollHeight - column.scrollTop - column.clientHeight > 1;
  for (const tile of grid.querySelectorAll<HTMLElement>(':scope > *')) {
    const label = tile.matches('.sb-app[data-app-id]') ? tile.getAttribute('aria-label') : null;
    const twin = label === null ? undefined : twins.find(item => !used.has(item) && item.getAttribute('aria-label') === label);
    // D189 (24 Nov): a Favorite with no site icon is drawn as its letter (AciraSidebar AppIcon `.sb-app-initial`, in the grid and in the rail's column alike): that letter IS its icon here. Taken as the icon only, a
    // letter Favorite never travelled: it faded at its cell by 30 % of a collapse and the rail's column showed it only at the end, in one frame (back, the column went at once and the grid came back at the end).
    const icon = tile.querySelector<HTMLElement>(FAV_ICON), goal = twin?.querySelector<HTMLElement>(FAV_ICON);
    const from = icon?.getBoundingClientRect(), to = goal?.getBoundingClientRect();
    if (!twin || !icon || !from || !to || !from.width || !to.width || to.top < room.top - 1 || to.bottom > room.bottom + 1) {
      // (its own opacity as it rests: the Add tile shows only under the pointer, and faded in to 1 on an expand it went back to 0 in the landing frame: D152, the right at Wide)
      stay.push({ tile, box: tile.getBoundingClientRect(), icon: from && from.width ? { x: from.left + from.width / 2, y: from.top + from.height / 2, r: from.width / 2 } : null, shown: Math.max(0, Math.min(1, parseFloat(getComputedStyle(tile).opacity) || 0)) });
      continue;
    }
    used.add(twin);
    const dx = to.left + to.width / 2 - from.left - from.width / 2, dy = to.top + to.height / 2 - from.top - from.height / 2, size = to.width / from.width;
    gliders.push({ from: { x: from.left + from.width / 2, y: from.top + from.height / 2, r: from.width / 2 }, to: { x: to.left + to.width / 2, y: to.top + to.height / 2, r: to.width / 2 } });
    const look = getComputedStyle(tile), box = tile.getBoundingClientRect(), place = twin.getBoundingClientRect(), current = tile.getAttribute('aria-current') === 'page' || twin.getAttribute('aria-current') === 'page';
    if (current) carried = true;
    const own = current && mark && line?.isConnected ? mark : getComputedStyle(twin);
    const fromPlate: Plate = { x: box.left, y: box.top, w: box.width, h: box.height, r: parseFloat(look.borderTopLeftRadius) || 0, fill: look.backgroundColor, shadow: look.boxShadow };
    const tileH = current && rowH ? rowH : place.height;
    const toPlate: Plate = { x: place.left, y: place.top + (place.height - tileH) / 2, w: place.width, h: tileH, r: parseFloat(own.borderTopLeftRadius) || 0, fill: current && (markTile(line, mark)) ? markTile(line, mark) : own.backgroundColor, shadow: own.boxShadow };
    moves.push({ icon, tile, dx, dy, size, from: fromPlate, to: toPlate, fade: columnFade(to, room, fadeBelow), current });
  }
  const aside = el.getBoundingClientRect(), right = document.documentElement.dataset.sidebarSide === 'right', travel = Math.max(1, w - MINI_RAIL);
  // D152 (reported 23 Nov: "the one which is highlighted in the favorites also glitches", and on an expand "how the background of the icons show"): each favorite's PLATE travels with its icon, one piece from its tile's
  // place, size, corner and colour to its place in the rail (the open Favorite's to the marker's tile there, the others' to the rail's bare place, so theirs fades with the motion), on the icon's clock and curve. It used to
  // fade where the tile stood over the first 30 % of a collapse (and come back there over the last 30 % of an expand) while the icon travelled on alone, and the rail's highlight then appeared at the landing in one frame.
  // The tile's own background is held clear for the switch: the travelling plate is it. The plates are drawn under the icons (first in the grid, the icons carry transforms), and go in the task the switch ends in.
  // the marker's tile is the open Favorite's plate at the rail's end: off while the travelling plate stands for it (from this task, the one its plate starts in), back in the task the switch ends in
  if (carried && line) line.setAttribute('data-dock-fav', '');
  const holder = getComputedStyle(grid).position === 'static' && grid.offsetParent instanceof HTMLElement ? grid.offsetParent : grid, outer = holder.getBoundingClientRect();
  const base = { left: outer.left + holder.clientLeft, top: outer.top + holder.clientTop };
  // the plates go into the grid in ONE insertion (each one alone was a layout of the grid in the task the switch's first frame waits for)
  const plates = document.createDocumentFragment(), made2: [HTMLElement, Plate, Plate, boolean][] = [];
  for (const { tile, from, to, current } of moves) {
    const ghost = document.createElement('div');
    ghost.className = 'sb-dock-plate'; ghost.setAttribute('aria-hidden', 'true'); ghost.dataset.plateFor = tile.getAttribute('aria-label') || '';
    ghost.style.cssText = `left:${from.x - base.left}px;top:${from.y - base.top}px;width:${from.w}px;height:${from.h}px`;
    plates.append(ghost); dockPlates.push(ghost); made2.push([ghost, from, to, current]);
  }
  grid.prepend(plates);
  for (const [ghost, from, to] of made2) run(ghost, plateFrames(from, to), SPRING_EASE);
  // D189 (reported 24 Nov, his recording, the Christmas theme on: "for favorite tabs the ones are glitchy"): a Favorite's tile can wear a layer of its own over its colour, the theme's frost (season/NoelFx `.noel-fx`,
  // the tile's child). The tile's colour and shadow were held clear and carried by the plate, the frost was neither: it stayed at the cell as an empty frosted box (cut by the rail's narrowing edge, still drawn behind
  // the first icons until the switch ended), the plate under the travelling icon showed nothing, and on an expand the frost stood at the cell from the first frame beside the plate under the icon: two boxes. Now the
  // tile's own frost is held off at the cell for the switch and a copy rides in the plate, scaled with it, going out as the plate takes the rail's bare place (the rail draws no frost), on the plate's clock and curve.
  made2.forEach(([ghost], i) => {
    const frost = moves[i].tile.querySelector<HTMLElement>(':scope > .noel-fx');     // (made2 follows moves, one plate a move)
    if (!frost) return;
    const copy = frost.cloneNode(false) as HTMLElement;
    ghost.append(copy);
    run(copy, [{ opacity: 1 }, { opacity: 0 }], SPRING_EASE);
    run(frost, [{ opacity: 0 }, { opacity: 0 }], 'linear');
  });
  // D162: the open Favorite's highlight is not seen while the sidebar transforms (miniDockGlide.ts selectedFade): its plate fades out as its icon leaves and back as it lands, and the tile's own ring (active-border.css, the
  // tile's ::before, which the held background does not cover) on the same fade: it stood at the cell for the whole collapse. The same frames both ways (in time, not the collapse run backwards).
  const fade = selectedFade(dur), timing: KeyframeAnimationOptions = { duration: dur, easing: 'linear', delay: -lead, fill: 'both' };
  const lift = (item: Animation): void => { onClock(item, own); made.push(item); };
  for (const [ghost, , , current] of made2) if (current) lift(ghost.animate(fade, timing));
  // the tile's ring stands at the CELL: it only leaves on a collapse and only comes on an expand (with the plate's frames it stood at the cell from an expand's first frame, before its icon was there)
  const ring = fade.map((frame, i) => ((out ? i >= 2 : i < 2) ? { ...frame, opacity: 0 } : frame));
  for (const { tile, current } of moves) if (current) lift(tile.animate(ring, { ...timing, pseudoElement: '::before' }));
  for (const { icon, tile, dx, dy, size, fade } of moves) {
    run(icon, [{ transform: 'translate(0px, 0px) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${size})` }], SPRING_EASE);
    run(tile, [{ backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' }, { backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' }], 'linear');
    // the last Favorite the column shows lies in the column's fade (more below): its icon takes that fade on with the motion, so it lands looking as the column shows it (it went from whole to faded in one frame)
    if (fade) run(icon, [{ WebkitMaskImage: fade, maskImage: fade, WebkitMaskPosition: '0px -200px', maskPosition: '0px -200px', WebkitMaskSize: '100% 1000px', maskSize: '100% 1000px', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' } as Keyframe, { WebkitMaskImage: fade, maskImage: fade, WebkitMaskPosition: '0px -400px', maskPosition: '0px -400px', WebkitMaskSize: '100% 1000px', maskSize: '100% 1000px', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' } as Keyframe], SPRING_EASE);
  }
  // A favorite the column has no room for fades where it stands, and is GONE before anything reaches it (reported 19 Nov, Narrow and Wide: at Wide the fourth column's icons glide across two cells whose own icons were still fading; at Narrow the
  // sidebar's edge cut a tile that was still there). Its fade ends at the earliest of: 20 % of the time (what Standard always had; there one favorite, the one under the rail's fourth slot, now goes 6 ms sooner, the rest as before), the moment a gliding icon first touches its icon, the moment the
  // travelling edge reaches the tile (the page's edge: the favorites are on its clock, COLLAPSE_CONTENT_LEAD_MS). Both moments are read from the layout as it is (any width, any number of columns), then turned into time on the spring
  // (miniDockGlide.ts `stayFadeEnd`, where the whole glide is written down as rules of the grid).
  const paths = moves.map(({ from, to }) => ({ from, to }));     // every travelling plate's way (the open's kept-out favorites wait for them to pass: D172)
  for (const { tile, box, icon, shown } of stay) {
    if (!shown) continue;
    if (out) {
      const edge = right ? (box.left - aside.left) / travel : (aside.right - box.right) / travel;     // the part of the travel after which the sidebar's edge is at the tile
      // (never under STAY_MIN_MS: at Fast the 20 % was three frames, a blink: D152)
      run(tile, [{ opacity: shown }, { opacity: 0, offset: stayFadeEnd(icon, gliders, edge, stayFloor(dur)) }, { opacity: 0 }], 'linear');
      continue;
    }
    // D172 (reported 24 Nov): an expand brought it back over the last 20 % of the TIME, when the move had already landed (the spring is at 99.7 % of the travel then): "they should come in with the move". Now it rises on
    // the move's own spring, from where the opening edge begins to uncover its tile (and every gliding icon and travelling plate has passed it) to where the move lands (miniDockGlide.ts `stayRise`). Still one opacity animation a tile.
    const inner = right ? (aside.right - MINI_RAIL - box.right) / travel : (box.left - aside.left - MINI_RAIL) / travel;     // the part of the travel after which the opening edge is at the tile's inner side
    const [from, to] = stayRise(icon, gliders, inner, stayFloor(dur), { x: box.left, y: box.top, w: box.width, h: box.height }, paths);
    const rise = tile.animate([{ opacity: 0 }, { opacity: 0, offset: from }, { opacity: shown, offset: to }, { opacity: shown }], { duration: dur, easing: SPRING_EASE, delay: -lead, fill: 'both' });
    onClock(rise, own);
    made.push(rise);
  }
  return made;
}
/** The phase's second value at `ready`. The live transitions it starts are put on the transition's own clock: at once by the time that has passed since `ready`, and again one frame later, when their start has been decided
 * (a transition that is still pending takes its start from the NEXT frame, so the first estimate is a frame short: probe, 18 Nov, the wash 20 ms behind the picture's edge), by the pseudo-element animation's own `currentTime`. */
/* ----- The list under the Favorites in a collapse (19 Nov, the app's own frame log). The rail's Favorites band is taller than the open grid, so the list stands `--mini-band-dy` lower in the rail than in the open sidebar. That
 * was a LAYOUT animation (the Favorites region's margin, on the dock's 480 ms spring): the whole list laid out and painted again on every frame under the washes, and the main thread ran 4 to 8 frames of 25 ms in every collapse on the left
 * (the base has none; with the margin's animation off: 1; with the washes hidden: 1; with the wash still, unblended, unmasked or not breathing: 3 to 6). Now the layout stands STILL for the whole collapse: miniRail.css holds the
 * margin at its open value while the sidebar carries `data-mini-list-glide`, and what stands under the region travels down by a transform on the dock's clock and curve, the same travel it had. When the switch ends the margin takes its
 * rail value and the transforms go, in one task: the same pixels. Nothing is read per frame: the travel is the one number the sidebar already carries. The marker rides with its row the same way (it was read from the layout every
 * frame before). Only with the Favorites ABOVE the list (the default): placed at the bottom the margin moves other things, and that arrangement keeps the layout animation. */
const LIST_GLIDE = 'data-mini-list-glide';
/** What moves down with the list when the Favorites region grows: its in-flow siblings up to the list's wrapper, what stands in the wrapper above the scroller, and the scroller's own content (the scroller's box stands still, so its
 * bottom edge cuts the rows as it always did). Empty when the Favorites are not above the list. */
function listMovers(el: HTMLElement): HTMLElement[] {
  // the region stands in the sidebar's caption (AciraSidebar SidebarTop: aside > .sb-caption > .sb-apps-region); what moves when it grows is what follows the caption
  const caption = el.querySelector<HTMLElement>(':scope > .sb-caption'), region = caption?.querySelector<HTMLElement>(':scope > .sb-apps-region'), wrap = el.querySelector<HTMLElement>(':scope > .sb-sections-wrap'), scroller = wrap?.querySelector<HTMLElement>(':scope > .sb-scroll');
  if (!caption || !region || !wrap || !scroller || region.hasAttribute('data-bottom') || region.nextElementSibling || !(caption.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING)) return [];
  const out: HTMLElement[] = [];
  for (let node = caption.nextElementSibling; node && node !== wrap; node = node.nextElementSibling) if (node instanceof HTMLElement) out.push(node);
  for (let node = wrap.firstElementChild; node && node !== scroller; node = node.nextElementSibling) if (node instanceof HTMLElement) out.push(node);
  for (const node of scroller.children) if (node instanceof HTMLElement) out.push(node);
  return out;
}
/** Starts the list's travel of a collapse on the switch's clock. Returns what to cancel at the end. */
function glideList(el: HTMLElement, own: Animation | null, lead: number): Animation[] {
  if (!el.hasAttribute(LIST_GLIDE)) return [];
  const dy = parseFloat(el.style.getPropertyValue('--mini-band-dy')) || 0;
  if (!dy) return [];
  const dur = 480 * (motionSpeed() === 'fast' ? .5 : 1), made: Animation[] = [];
  const line = el.querySelector<HTMLElement>(':scope > .sb-mini-line');
  // (the marker of an open FAVORITE stands beside its icon in the column, which does not move with the list: carried down with it, it stood a slot under the Favorites, an empty tile, for the whole collapse and then jumped up: D152)
  for (const target of [...listMovers(el), ...(line && !line.hasAttribute('data-on-fav') && !line.hasAttribute('data-dock-fav') ? [line] : [])]) {
    // `transform`, not `translate`: the marker's own place is its `translate` (its row's), and the two compose; and a plain replace, so the compositor runs it (an animation that adds to the value under it runs on the main thread:
    // the first build of this, composite 'add', still had 4 frames of 25 ms at Standard)
    const item = target.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${dy}px)` }], { duration: dur, easing: SPRING_EASE, delay: -lead, fill: 'both' });
    onClock(item, own); made.push(item);
  }
  return made;
}
/** D152: the open TAB's highlight in a dock switch. Its row's own card (the ::after, miniRail.css "Tiles") already changes shape between the whole row and the rail's tile on the switch's curve (40 wide on the axis; inside an open
 * folder 26 x row-4, the marker's folder tile), but its colour went to clear in the rail's form while the marker's tile (the open tab's highlight in the rail, the same shape at the same place) faded in on a clock of its own: for 3 to 9
 * frames of every collapse and expand the open tab's highlight was under 3 % (dark). Now the card carries the colour from the row's highlight to the marker tile's on the switch's clock and curve, the marker's tile is off while it
 * does (`data-dock-row`, from this task) and takes over where it lands, in the task the switch ends in. A split's pane keeps the old way (its plate is the split's). Everything is read here, before any of the switch's animations
 * starts; the returned start makes the animation and returns what to cancel at the end. */
/** D162: the open tab's card keeps its ring and shadow until this part of the way (its fill crosses the sidebar's own colour near the half in light). */
export const ROW_EDGE_HOLD = .7;
function prepareRowPlate(el: HTMLElement, direction: 'out' | 'in', lead: number): (own: Animation | null) => Animation[] {
  const row = el.querySelector<HTMLElement>('.sb-tab[aria-current=true]'), line = el.querySelector<HTMLElement>(':scope > .sb-mini-line');
  const onRow = line ? line.hasAttribute('data-on-row') && !line.hasAttribute('data-hidden') && !line.hasAttribute('data-in-split') : !!row && markRow === row;
  if (!row || !onRow) return () => [];
  const look = getComputedStyle(row), mark = line ? getComputedStyle(line, '::before') : null;
  const lit = look.getPropertyValue('--sb-current').trim(), litShadow = look.getPropertyValue('--sb-current-shadow').trim() || 'none', tile = markTile(line, mark), tileShadow = mark?.boxShadow || 'none';
  if (!lit || !tile) return () => [];
  // (reported 23 Nov: "the background of the icon selected did kinda disappear". In light the row's white card goes to the rail's grey tile, so its fill passes the sidebar's own grey on the way (zero contrast), and the card's
  // ring and shadow went at the half, the same moment: hidden stills, every light cell, the open tab's highlight at 10 to 18 % of even the rail's tile for two frames, then back. The card keeps its ring and shadow until 70 % of
  // the way, past the crossing, and they go over the rest.)
  const dur = 480 * (motionSpeed() === 'fast' ? .5 : 1), frames: Keyframe[] = [{ backgroundColor: lit, boxShadow: litShadow }, { boxShadow: litShadow, offset: ROW_EDGE_HOLD }, { backgroundColor: tile, boxShadow: tileShadow }];
  return own => {
    const item = row.animate(direction === 'out' ? frames : [...frames].reverse().map(frame => ({ ...frame, offset: typeof frame.offset === 'number' ? 1 - frame.offset : undefined })), { duration: dur, easing: SPRING_EASE, delay: -lead, fill: 'both', pseudoElement: '::after' });
    onClock(item, own);
    line?.setAttribute('data-dock-row', '');
    return [item];
  };
}
/** D172 (item 1): the sidebar's texts in a dock switch (titles, group names, section labels and lines, the New tab label, the foot, the folders' chevrons and rails). Their CSS fades were written for the float
 * (40 ms after the clip starts, over --mini-text-in), but in a dock switch the style changes at the commit and the motion starts 60-90 ms later, at ready: at the first moving frame of an expand they stood whole
 * (held stills, D172 step 1; the per-frame probe read 0 to 62 % in one frame), with 40 tabs some 60 transitions on the main thread every frame. Now their transitions are off for the switch (miniRail.css
 * `data-mini-dock-st`) and the ones in sight (one row over each edge of the list) fade on the switch's own clock: in from 0 on its spring over the whole expand, out over the first 40 % of a collapse; to and
 * from their own open opacity (a control shown only on hover stays out). Opacity only: the compositor's. The rest take their end at once, out of sight. */
const DOCK_TEXTS = '.sb-tab-title,.sb-group-name,.sb-zone-label,.sb-new-label,.sb-group-chev,.sb-header-add,.sb-zone-actions,.sb-zone-chev,.sb-foot-name,.sb-foot-icons,.sb-sep,.sb-group-rail';
/** A collapse reads its texts in the commit, but React then draws the rows in their rail form and replaces those nodes: the opacities are kept by a key (the element's class, its row's tab or group id, its text) and
 * matched to the elements standing at ready (an animation made on the replaced node ran on nothing: the held stills showed the titles gone in the collapse's first frame). */
let collapseTexts = new Map<string, number>();
/** The texts fading by the current dock switch (their data-dock-fade mark is removed at its end, in the task that cancels the fades). */
let dockFaded: HTMLElement[] = [];
const unmarkFaded = (): void => { for (const item of dockFaded) item.removeAttribute('data-dock-fade'); dockFaded = []; };
const textKey = (item: HTMLElement): string => `${item.className}|${item.closest('[data-tab-id]')?.getAttribute('data-tab-id') ?? item.closest('[data-group-id]')?.getAttribute('data-group-id') ?? ''}|${(item.textContent ?? '').trim().slice(0, 40)}`;
/** The texts standing now whose key the commit saw, with the opacity it read. */
function keptTexts(el: HTMLElement, kept: Map<string, number>): [HTMLElement, number][] {
  const out: [HTMLElement, number][] = [];
  if (!kept.size) return out;
  for (const item of el.querySelectorAll<HTMLElement>(DOCK_TEXTS)) { const shown = kept.get(textKey(item)); if (shown !== undefined) out.push([item, shown]); }
  return out;
}
/** The texts in sight and their open opacity (one batched read; the sidebar must be in its open form with the text transitions off). */
function openTexts(el: HTMLElement): [HTMLElement, number][] {
  const list = el.querySelector<HTMLElement>('.sb-scroll'), view = list?.getBoundingClientRect(), row = 40, out: [HTMLElement, number][] = [];
  for (const item of el.querySelectorAll<HTMLElement>(DOCK_TEXTS)) {
    if (view && list?.contains(item)) { const b = item.getBoundingClientRect(); if (b.bottom < view.top - row || b.top > view.bottom + row) continue; }
    const shown = parseFloat(getComputedStyle(item).opacity) || 0;
    if (shown > .01) out.push([item, shown]);
  }
  return out;
}
/** A collapse's labels are gone at this share of the switch: 96 ms of 480, on a gentle in-out and no lead, as the line DREW them (its held frames, 40 tabs: whole at 17 ms, faint at 50, gone by 83; the edge reaches a long
 * label at about 80). (The dock rule's 144 ms expo-out, put on the switch's clock with the content's lead, took 62 % off in the first frame: a cut, the probe's inventory.) */
export const DOCK_TEXT_OUT = .2;
function fadeTexts(texts: [HTMLElement, number][], direction: 'out' | 'in', own: Animation | null, lead: number): Animation[] {
  const dur = 480 * (motionSpeed() === 'fast' ? .5 : 1), made: Animation[] = [];
  for (const [item, shown] of texts) {
    if (!item.isConnected) continue;
    // (marked: the rail's opacity:0!important for texts outside the open form steps back for it, miniRail.css; the mark goes at the switch's end)
    item.setAttribute('data-dock-fade', ''); dockFaded.push(item);
    // out: as the line drew its labels (DOCK_TEXT_OUT), now on the switch's clock
    const frames: Keyframe[] = direction === 'in' ? [{ opacity: 0 }, { opacity: shown }] : [{ opacity: shown, easing: 'cubic-bezier(.3,0,.7,1)' }, { opacity: 0, offset: DOCK_TEXT_OUT }, { opacity: 0 }];
    const a = item.animate(frames, { duration: dur, easing: direction === 'in' ? SPRING_EASE : 'linear', delay: -lead, fill: 'both' });
    onClock(a, own); made.push(a);
  }
  return made;
}
function dockGo(el: HTMLElement, to: string, own: Animation | null, lead = 0, lights: Animation[] = [], w = width): Animation[] {
  settle(el);      // whatever was still easing toward the first form ends there: the second form starts from it
  el.setAttribute('data-mini-dock-go', '');
  el.setAttribute('data-mini', to);
  markDock(el);
  void el.getBoundingClientRect();
  const direction: 'out' | 'in' = to === 'closing' ? 'out' : 'in';
  const rowPlate = prepareRowPlate(el, direction, lead);
  // (today's build: the expand's texts are drawn as the line draws them, by their own CSS fade; their fade on the clock (from 0 on the spring) added per-frame work at the full profile: left 312, 12 takes, late 21 -> 27; it comes back with tomorrow's update)
  const texts = direction === 'in' ? [] : keptTexts(el, collapseTexts); collapseTexts = new Map();
  lights.push(...glideLights(el, direction, w, own, lead));
  lights.push(...glideFavorites(el, direction, own, direction === 'out' ? COLLAPSE_CONTENT_LEAD_MS : 0, w));
  lights.push(...rowPlate(own));
  lights.push(...fadeTexts(texts, direction, own, 0));
  if (direction === 'out') lights.push(...glideList(el, own, lead));
  const mine = el.getAnimations({ subtree: true }).filter((item): item is CSSTransition => item instanceof CSSTransition && Number(item.currentTime) < 4);
  const now = (): number => (own ? (Number(own.currentTime) || 0) + lead : 0);
  if (own && now() > 0.5) for (const item of mine) item.currentTime = now();
  if (own) requestAnimationFrame(() => { const at = now(); if (at > 0.5) for (const item of mine) if (item.playState !== 'finished') item.currentTime = at; });
  return lights;
}
/** Toolbar controls in a dock switch (D44, the team, 18 Nov, real frames at 150 %: Home drawn on the field's own button, the profile button on the overflow chevron). When the sidebar narrows the toolbar has room for more controls and adds
 * them a frame AFTER the switch has begun (it measures its new width first), so they are in no picture of the transition: they showed at once, inside the toolbar's own gliding picture, over neighbours still travelling to their new places
 * (hidden dump of the groups at 150 %: no group for Home, tab overview, profile, focus). The controls that are on screen when the switch begins are left as they are; one that turns up later is held invisible until 70 % of the switch's time (the spring
 * is at 97 % of its travel then, every neighbour in its place) and fades in over the rest (holdLateControls, below). */
const DOCK_CONTROLS = '.browser-shell>.acira-persistent-toolbar :is(.navigation-controls>*,.toolbar-tab-overview,.toolbar-actions>*)';
/** The controls on screen when the switch begins are left alone. One that is not (hidden then, or added while the switch runs: the toolbar is watched) is given an animation of its own, invisible until 70 % of the switch's time and a plain
 * fade over the rest, put on the switch's clock once that is known (`clock`). No stylesheet rule selects these controls: they have no class in common, and a rule ending in `*` is tried on every element of the window on every style
 * recalculation (scripts/costly-selectors.mjs). */
function holdLateControls(): { release: () => void; clock: (own: Animation | null) => void } {
  const bar = document.querySelector<HTMLElement>('.browser-shell>.acira-persistent-toolbar'), dur = 480 * (motionSpeed() === 'fast' ? .5 : 1);
  const seen = new Set<Element>([...document.querySelectorAll<HTMLElement>(DOCK_CONTROLS)].filter(item => item.getBoundingClientRect().width > 0));
  const made: Animation[] = []; let own: Animation | null = null;
  const hold = () => {
    for (const item of document.querySelectorAll<HTMLElement>(DOCK_CONTROLS)) {
      if (seen.has(item)) continue;
      seen.add(item);
      const fade = item.animate([{ opacity: 0 }, { opacity: 0, offset: .7 }, { opacity: 1 }], { duration: dur, easing: 'linear', fill: 'both' });
      onClock(fade, own); made.push(fade);
    }
  };
  hold();
  const watch = bar && typeof MutationObserver !== 'undefined' ? new MutationObserver(hold) : null;
  if (watch && bar) watch.observe(bar, { childList: true, subtree: true });
  return { release: () => { watch?.disconnect(); for (const item of made) item.cancel(); }, clock: next => { own = next; for (const item of made) onClock(item, own); } };
}
/** Ends every CSS transition that is running on the sidebar and inside it: each value stands at its target. It is what `transition: none` on every descendant did while a dock waited for its second form (the commit's first style was the
 * rail's, and each value the dock then moved to its first form started a transition: probe, 48 on the first frame, the picture opening AS the rail), without a rule that ends in `*`. */
function settle(el: HTMLElement): void {
  void el.offsetWidth;
  for (const item of el.getAnimations({ subtree: true })) if (item instanceof CSSTransition) item.cancel();
}
/** The sidebar's phase in a dock switch, mirrored on the root (`data-mini-dock-el`: open | closing | rail) for the rules that style what is OUTSIDE the sidebar by it (miniRail.css): no `:has()` on the app. `null` takes it away. */
function markDock(el: HTMLElement | null): void {
  const root = document.documentElement;
  if (el) root.setAttribute('data-mini-dock-el', el.getAttribute('data-mini') || 'rail'); else root.removeAttribute('data-mini-dock-el');
}
/** For a frame or two after a switch has ended the sidebar still says it is moving (miniDockMove.ts), and the rail's active marker is hidden while it does and then fades back in. The marker of a collapse is already there by then
 * (miniRail.css), so it is held (`data-mini-dock-landed`) until that mark has gone: real frames, the open tab's tile and line blinked off for two frames right after every collapse. */
function holdLanded(el: HTMLElement): void {
  if (!el.hasAttribute(MOVING_ATTR) || typeof MutationObserver === 'undefined') return;
  el.setAttribute('data-mini-dock-landed', '');
  const off = () => { watch.disconnect(); window.clearTimeout(net); el.removeAttribute('data-mini-dock-landed'); };
  const watch = new MutationObserver(() => { if (!el.hasAttribute(MOVING_ATTR)) off(); });
  watch.observe(el, { attributes: true, attributeFilter: [MOVING_ATTR] });
  const net = window.setTimeout(off, 400);
}
/** D175: the Favorites panel, folded in the rail and kept out while an opening switch runs (miniRail.css), comes back over the landed sidebar by a fade of its own (a CSS transition would be cancelled by
 * `settle` in the same task; this is a web animation, which it leaves). Only when it is open (the sidebar says so: data-fav-panel). */
function panelBack(el: HTMLElement): void {
  if (el.getAttribute('data-fav-panel') !== 'open') return;
  const dur = 200 * (motionSpeed() === 'fast' ? .5 : 1);
  for (const part of el.querySelectorAll<HTMLElement>('.sb-apps-panel,.sb-apps-panel-shade')) part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease-out', fill: 'backwards' });
}
/** Runs a dock switch on `el`: `begin` puts it in its first form (in the commit), `go` is its second (at `ready`), `finish` gives everything back. */
function dockSwitch(el: HTMLElement, w: number, direction: 'out' | 'in', begin: () => void, to: string, finish: () => void): void {
  const lead = dockLead(direction);
  const mine = ++dockSeq, root = document.documentElement;
  // D172 (item 3): in the commit the switch only WRITES; what it reads is read once the commit's script is done (a microtask: before the new state is photographed, after every style pass the commit forces anyway), so it
  // costs no style pass of its own. In the commit each read brought every style up to date after a write (the app's trace, 40 tabs: the width, the settle, the texts, the toolbar's controls, 5 to 9 ms each, six passes
  // before the new state could be photographed). A collapse settles there (the transitions its first form started, made by the commit's own passes, are ended the same) and reads its texts in that first form, the open
  // one; an expand reads before `begin`'s microtask changes its form (queued first), and that microtask settles it.
  let controls: ReturnType<typeof holdLateControls> | null = null, still = false, line: (() => void) | null = null;
  collapseTexts = new Map();
  setEdge(w, lead); el.setAttribute(DOCK_ST, direction); el.removeAttribute(MINI_DOCK_DONE);
  queueMicrotask(() => {
    if (done || dockSeq !== mine || !el.isConnected) return;
    if (direction === 'out') { settle(el); collapseTexts = new Map(openTexts(el).map(([item, shown]) => [textKey(item), shown] as [string, number])); }
    controls = holdLateControls();
    // Whether the list travels by a transform is known at `ready` (the band's height is put on the sidebar by a layout effect of this very commit): until then the marker is followed, which costs nothing while the layout stands still.
    if (direction === 'out') line = followLine(el);
  });
  begin(); markDock(el);
  el.removeAttribute(LIST_GLIDE);
  let done = false, net = 0; const lights: Animation[] = [];
  const watch = new MutationObserver(() => { if (!root.hasAttribute('data-mini-dock')) end(); });
  const end = () => { if (done) return; done = true; watch.disconnect(); window.clearTimeout(net); setEdge(0); markDock(null); controls?.release(); line?.(); for (const item of lights) item.cancel(); unmarkFaded(); dropPlates(); if (el.isConnected) {
      if (direction === 'in') panelBack(el);     // D175 (a web animation: settle, below, cancels only CSS transitions)
      if (direction === 'out') { holdLanded(el); holdDockDone(el, root); }     // D194: ended by the net before the page's mark went: the rail's entrance stays held off (miniDockDirection.ts)
      el.removeAttribute(DOCK_ST); el.removeAttribute('data-mini-dock-go'); el.removeAttribute(LIST_GLIDE); finish();
      // The hand-over to the settled sidebar starts no fade: the open tab's row is drawn by the rail's own plate while the dock runs and by the row's background once it has landed, and that background came in from nothing over
      // 100 ms (real frames, every expand: the open tab's row 20 levels under rest for three frames right after the switch; hidden probe: background-color from transparent, started in the frame the dock ended).
      settle(el);
      if (line || still) placeLineStill(el);   // the rail's layout has landed: the marker stands beside its row as it is laid out now
    }
  };
  watch.observe(root, { attributes: true, attributeFilter: ['data-mini-dock'] });
  net = window.setTimeout(end, 1500);
  // D172 (2a): when the list does not travel at all (the band adds nothing: --mini-band-dy 0, e.g. four rows of Favorites or more) the rows, and so the marker, stand still for the whole collapse: the marker is
  // placed once at ready and no longer followed (followed, it read every row's box on every frame: the app's trace, 40 tabs, about 4 ms a frame, forcing the frame's style pass inside our script).
  // (When the list travels, the mark is on before the second form is: the region's margin never starts to move.)
  void transitionAnimation().then(own => {
    if (done || dockSeq !== mine || !el.isConnected) return;
    controls?.clock(own);
    still = direction === 'out' && listMovers(el).length > 0 && (parseFloat(el.style.getPropertyValue('--mini-band-dy')) || 0) > 0;
    if (still) { line?.(); line = null; placeLineNow(el); el.setAttribute(LIST_GLIDE, ''); } else if (line && !(parseFloat(el.style.getPropertyValue('--mini-band-dy')) > 0)) { line(); line = null; placeLineNow(el); }
    dockGo(el, to, own, lead, lights, w);
  });
}
/** Asks the toolbar to fit its controls to its width now (ui/toolbarOverflow.ts listens for this; the Sidebar mode morph asks the same way when it has settled). */
function fitToolbarNow(): void {
  try { window.dispatchEvent(new Event(REFIT_EVENT)); } catch { /* no window */ }
}
/** Full -> Mini on the left: the docked sidebar (the float's open form) closes into the rail. */
function dockClose(el: HTMLElement | null): void {
  if (!el || motionSpeed() === 'off') return;
  dockSwitch(el, liveWidth(el), 'out', () => el.setAttribute('data-mini', 'open'), 'closing', () => el.setAttribute('data-mini', phase));
}
/** The width the sidebar is laid out at now: `--mini-w` on the aside (the saved size, Narrow 168 / Standard 240 / Wide 312 or any dragged one; after a drag below Narrow has closed it, the width the drag left, F4). Every length of a dock switch
 * (the travel, the lights' glide, the wash's place) is this width less the rail, never a number for one size. */
function liveWidth(el: HTMLElement): number {
  // D172 (item 3): the sidebar's own inline value first (AciraSidebar.tsx sets it in Mini mode; no stylesheet sets it): asking for the computed style brought every style up to date in the switch's commit (the app's trace, 40 tabs: 6 ms)
  const read = parseFloat(el.style.getPropertyValue('--mini-w') || getComputedStyle(el).getPropertyValue('--mini-w'));
  return Number.isFinite(read) && read > MINI_RAIL ? read : width;
}
/** Mini -> Full on the left: the rail (its DOM, the Favorites column, stays mounted until it has landed) opens into the docked sidebar. In the commit the sidebar is given the float's rail form (`is-mini-docked` off, `data-mini=rail`);
 * at `ready` its phase is `open`; when the transition has finished its docked class and attributes are given back and the rail is switched off. Returns false (nothing done) when this is not that case. */
function dockOpen(el: HTMLElement | null, w: number): boolean {
  const root = document.documentElement;
  if (!el || phase !== 'rail' || motionSpeed() === 'off' || root.dataset.modeSwitch !== 'layout' || !el.classList.contains('is-mini-docked')) return false;
  // the docked class goes in a microtask: client.ts reads the dock's state right after the update (noteMiniDock) and says `in` only for an aside that is docked then; before this, the class was removed here, the direction was '' and none of this switch's rules (all keyed on data-mini-dock) ran
  // The toolbar fits itself in that same microtask (19 Nov, the interface 600 px wide: 150 % in the smallest window). Opening the sidebar leaves the toolbar too narrow for some of its controls, and it used to take them out a frame
  // AFTER the switch had begun (ui/toolbarOverflow.ts fits in the next frame): by then they had been photographed as part of the new state, and Chromium ends a view transition the moment an element it photographed stops being
  // drawn. The switch was over 32 ms after it started: the finished sidebar at once, the page gliding alone, no favorite travelling (real takes b6z, b7z). Asked here, the fit lands before the new state is photographed: the controls
  // that leave are in the old picture only and go with the leaving controls' own 150 ms fade. In the microtask, not in the commit: the toolbar's listener is put back by an effect that runs after this one.
  dockSwitch(el, w, 'in', () => { queueMicrotask(() => { if (!el.isConnected) return; el.classList.remove('is-mini-docked'); el.setAttribute('data-mini', 'rail'); markDock(el); settle(el); fitToolbarNow(); }); }, 'open', () => { el.classList.add('is-mini-docked'); el.setAttribute('data-mini', 'open'); });
  const keep = el, mine = ++railGen; openPending = mine;
  // the rail is switched off once the sidebar has landed (the Favorites column was needed until then). Both ways of noticing it (the switch's end, and a safety net of 1.6 s) belong to THIS open: D170 (a member on Windows,
  // 23 Nov): Full -> Mini again within 1.6 s of an open, and the open's safety net switched the NEW rail off after it had landed: the Favorites column (drawn only while the rail is on) was taken off the page and the rail
  // stayed without it until the next Full -> Mini. Any later change of the rail (railGen) makes them do nothing.
  const off = new MutationObserver(() => { if (railGen !== mine) { off.disconnect(); return; } if (!document.documentElement.hasAttribute('data-mini-dock')) { off.disconnect(); openPending = 0; enabled = false; emit(); railOff(true); } });
  off.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mini-dock'] });
  window.setTimeout(() => { if (railGen !== mine) return; if (keep && enabled && !el.hasAttribute(DOCK_ST) && !document.documentElement.hasAttribute('data-mini-dock')) { off.disconnect(); openPending = 0; enabled = false; emit(); railOff(true); } }, 1600);
  return true;
}
/** Turn the rail's intent on (Mini, sidebar closed) or off. `el` is the sidebar, `w` its width setting. */
export function miniEnable(on: boolean, el: HTMLElement | null, w: number, fromDock = false, toDock = false, sidebarSide: 'left' | 'right' = 'left'): void {
  root = el; width = w; side = sidebarSide;
  // D170: back to Mini before an open has landed: the rail is still on (the open keeps it until it lands), so nothing below runs; the open's switch-off is called off here
  if (on && openPending) { openPending = 0; railGen++; }
  if (on === enabled) return;
  // Mini -> Full inside a layout switch, on the left: the rail's own DOM (the Favorites column) stays mounted and the sidebar opens from the rail as one live element (dockOpen below); the rail is switched off once it has landed.
  if (!on && toDock && dockOpen(el, w)) return;
  railGen++;     // D170: an open still landing (dockOpen) no longer switches this rail off
  enabled = on; emit();
  if (on) {
    // Ctrl+Shift+E from the docked sidebar: it stands open where it is and closes into the rail like a float leaving (the page grows under it).
    // While a layout switch's view transition plays (the toggle, the shortcut), the docked sidebar slides away over the rail (miniRail.css, `data-mini-dock`) in step with the page, as the normal sidebar does: the rail is
    // there from the first frame and the interface stays UNDER the page, so nothing floats, no open sidebar closes into the rail afterwards and no placeholder shows over the page (the team's 23:38 recording: the page
    // dimmed for 5 frames, the rail's icons only came after the slide). The pointer must move on before the float opens again, as after any close.
    if (fromDock && document.documentElement.dataset.modeSwitch === 'layout') { lockUntil = now() + LOCKOUT; dockClose(el); }
    else if (fromDock) { miniFloat(true); setPhase('open'); openedAt = now() - MIN_VISIBLE; requestAnimationFrame(() => requestAnimationFrame(() => close('undock'))); }
    window.addEventListener('pointermove', onMove, true);
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('click', onClick, true);
  } else railOff(toDock);
}
/** The rail's intent off: its listeners, its ticks, its float (to the docked sidebar: the page glides under the float, see below). */
function railOff(toDock: boolean): void {
    hideTip(true);
    window.removeEventListener('pointermove', onMove, true);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('click', onClick, true);
    disarm(); window.clearTimeout(closeTimer);
    // To the docked sidebar (Keep open): the float stays up, with the page's picture, while the layout switch glides the page area to its new
    // place under the sidebar; the website comes back where its picture then stands.
    // To the docked sidebar (Keep open): the interface stays raised over the page through the layout switch's page glide, and is lowered on the glide's last frame
    // (App's setEdgeFloatable lowers it with `afterGlide`, main waits for the glide: the page never slides over the floating sidebar, the sample's flaw 1). The timer is only the net under that.
    if (phase !== 'rail') { if (toDock) window.setTimeout(() => { if (!enabled) miniFloat(false, true); }, 1500); else miniFloat(false); }
    else if (prepared) miniRelease();
    prepared = null; samples = []; restSince = 0;
    setPhase('rail');
}
/** QA */
(globalThis as unknown as { __mini?: unknown }).__mini = { open, close: () => close('qa'), phase: () => phase, hold: (on: boolean) => { qaHold = on; } };
/** Beta 14.0 (reported 20 Nov): Customize sidebar asked for from the rail. The customizer is drawn in the sidebar, which the rail clips to 56 px, so the sidebar is opened first (the rail's own expand: sidebarPatch(true))
 * and the customizer comes in once the dock switch has landed: the list is never swapped for the customizer in the middle of the dock's glide. `then` runs at the latest after `cap` ms. */
export function afterMiniDock(then: () => void, cap = 1200): void {
  const start = performance.now(); let frames = 0;
  const tick = () => {
    frames += 1;
    const aside = document.querySelector<HTMLElement>('.acira-sidebar.is-mini');
    const landed = !!aside?.classList.contains('is-mini-docked') && !document.documentElement.hasAttribute('data-mini-dock') && !aside.hasAttribute(DOCK_ST) && !aside.hasAttribute(MOVING_ATTR);
    if ((frames > 1 && landed) || performance.now() - start > cap) { then(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** Mini in this window (setting Mini, a sidebar in this layout, not Seamless, not held open): App gives the page card its rounded corners beside the rail, as beside the docked sidebar (the team, round 3: the junction was square at the top and bottom). */
export const miniRailFor = (settings: Partial<Settings>, windowUi: Pick<WindowUi, 'view' | 'app'> | null | undefined): boolean => miniRailOn(settings, windowUi);

/* Round 5 (the team): in the rail the active tab is marked by one short vertical line in the site's colour, at the rail's left edge; there
 * is no tile behind the active icon any more. The line is one element: it slides to the newly active tab and its colour cross-fades
 * (miniRail.css .sb-mini-line). Its colour is the tab's own site colour (--site, the colour the tab glow already derives from the favicon,
 * set on the row when the favicon has one); a monochrome logo (GitHub, X, Wikipedia) gets a neutral grey. The CSS lifts or deepens it for
 * contrast and caps its chroma. Where the active tab cannot be seen (inside a closed folder, or scrolled out of the list), the line
 * stands beside its folder's icon; an active Favorite gets it beside its icon in the column. */
const lineScroll = new WeakSet<HTMLElement>();
const seen = (el: HTMLElement, clip: HTMLElement | null): boolean => {
  if (!el.offsetHeight) return false;
  if (!clip) return true;
  const a = el.getBoundingClientRect(), b = clip.getBoundingClientRect(), mid = a.top + a.height / 2;
  return mid > b.top + 4 && mid < b.bottom - 4;
};
let lineFrame = 0;
/** Placed on every render, and once more on the next frame: a new tab's row is drawn a frame after the selection moves to it. */
let lineFor = '';
export function placeMiniLine(aside: HTMLElement): void {
  // A new selection is placed on the next frame (one frame later), so a row still being inserted or moved by that same change (a new tab)
  // is read where it lands, not where an in-between render drew it: the line takes one path, never a detour.
  const active = aside.querySelector<HTMLElement>('.sb-tab[aria-current=true]')?.dataset.tabId ?? aside.querySelector<HTMLElement>('.sb-mini-fav[aria-current=page]')?.getAttribute('aria-label') ?? '';
  // Every change is placed 2 frames after the last render that asked (a list change and the selection that goes with it, a new tab, arrive
  // as separate renders: placed one by one, the line went toward the moved row and back). The first placement is at once.
  if (!lineFor) { lineFor = active || '-'; placeLineNow(aside); return; }
  window.clearTimeout(lineFrame);
  lineFrame = window.setTimeout(() => { lineFrame = 0; if (aside.isConnected) placeLineNow(aside); }, 34);
}
/** What the line stands beside: the open tab's row when it can be seen, else its folder's head, else the open Favorite's icon in the column; and that tab's site colour. */
function lineTarget(aside: HTMLElement, list: HTMLElement | null, favs: HTMLElement | null): { target: HTMLElement | null; site: string } {
  const row = aside.querySelector<HTMLElement>('.sb-tab[aria-current=true]');
  let target: HTMLElement | null = null, site = '';
  if (row) {
    site = row.style.getPropertyValue('--site').trim();
    if (seen(row, list)) target = row;
    else { const head = row.closest('.sb-group')?.querySelector<HTMLElement>('.sb-group-header'); if (head && seen(head, list)) target = head; }
  } else {
    const fav = aside.querySelector<HTMLElement>('.sb-mini-fav[aria-current=page]');
    if (fav && seen(fav, favs)) { target = fav; const tile = [...aside.querySelectorAll<HTMLElement>('.sb-apps .sb-app')].find(t => t.getAttribute('aria-label') === fav.getAttribute('aria-label')); site = tile ? getComputedStyle(tile).getPropertyValue('--sb-site').trim() : ''; }
  }
  return { target, site };
}
/** The rail's marker (the open tab's tile and line) through a collapse. It is placed when the sidebar renders (placeMiniLine), and in a dock switch that is BEFORE the rail's layout exists: the sidebar is still in its open form then, and
 * the list under the Favorites moves down by LAYOUT through the whole switch (the Favorites region's margin, miniRail.css). Nothing renders again, so the marker stood for good where the open tab's row had been in the open sidebar: one
 * slot too high, on the tab above (real takes of every build of the one-surface dock, 19 Nov: the tile and the line on "Settings page" with "Watch" open; the base marks "Watch"). It follows its row frame by frame while the dock runs
 * (the dock's rules take every transition off it, miniRail.css) and is placed once more, without a slide, when the layout has landed. Returns the stop. */
function followLine(el: HTMLElement): () => void {
  let frame = 0, last = NaN, on = true;
  const tick = (): void => {
    frame = 0;
    if (!on || !el.isConnected) return;
    const { target } = lineTarget(el, el.querySelector<HTMLElement>('.sb-scroll'), el.querySelector<HTMLElement>('.sb-mini-favs'));
    const y = target ? layoutCentre(target, el) : -1;
    if (y !== last) { last = y; placeLineNow(el); }
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => { on = false; if (frame) cancelAnimationFrame(frame); frame = 0; };
}
/** The line placed where the layout says now, with no slide to there (its own transition is for a change of tab). */
function placeLineStill(aside: HTMLElement): void {
  const line = aside.querySelector<HTMLElement>(':scope > .sb-mini-line');
  if (!line) return;
  const keep = line.style.transition;
  line.style.transition = 'none'; placeLineNow(aside); void line.offsetWidth; line.style.transition = keep;
}
function placeLineNow(aside: HTMLElement): void {
  const line = aside.querySelector<HTMLElement>(':scope > .sb-mini-line');
  if (!line) return;
  const list = aside.querySelector<HTMLElement>('.sb-scroll'), favs = aside.querySelector<HTMLElement>('.sb-mini-favs');
  if (list && !lineScroll.has(list)) { lineScroll.add(list); list.addEventListener('scroll', () => placeLineNow(aside), { passive: true }); }
  // Round 6: the rail's list fades at its top edge once it is scrolled (it was cut flat under the New tab row), as the Favorites column does.
  if (list) list.toggleAttribute('data-mini-scrolled', list.scrollTop > 0.5);
  if (favs && !lineScroll.has(favs)) { lineScroll.add(favs); favs.addEventListener('scroll', () => placeLineNow(aside), { passive: true }); }
  const { target, site } = lineTarget(aside, list, favs);
  if (!target) { line.dataset.hidden = ''; return; }
  // Layout positions, not painted ones: rows that are still gliding (the list's FLIP after a new tab or a close) must not send the line
  // to where they are drawn this frame (it jumped, then corrected).
  const y = layoutCentre(target, aside);
  const first = line.dataset.placed === undefined;
  if (first) line.style.transition = 'none';
  line.style.setProperty('--line-y', `${y}px`);
  if (site) line.style.setProperty('--line-site', site); else line.style.removeProperty('--line-site');
  line.toggleAttribute('data-mono', !site);
  line.toggleAttribute('data-on-fav', target.matches('.sb-mini-fav'));
  line.toggleAttribute('data-on-row', target.matches('.sb-tab'));
  // D152: the marker tile's colour and the row it stands on, for an expand: the rail's marker is no longer in the page when the switch's plates start
  markSeen = getComputedStyle(line).getPropertyValue('--mark-tile').trim();
  markRow = target.matches('.sb-tab') && !line.hasAttribute('data-in-split') ? target : null;
  line.toggleAttribute('data-in-folder', !!target.closest('.sb-group:not([data-collapsed])') && !target.matches('.sb-mini-fav'));
  // 14.0.1: a split's pane stands inside the split's plate (miniRail.css .sb-mini-line[data-in-split]).
  line.toggleAttribute('data-in-split', !!target.closest('.sb-split-group') && !target.matches('.sb-mini-fav'));
  delete line.dataset.hidden;
  if (first) { line.dataset.placed = ''; void line.offsetWidth; line.style.transition = ''; }
}

/* Round 5 (the team, dark screenshot): a dark monochrome favicon (GitHub's black cat) disappears on the dark rail and leaves what looks
 * like an empty slot. Round 6 (the light plates read as stickers): two kinds, read once per image from its pixels (opaque pixels: mean
 * luminance and colour, and how much of the square they cover):
 *  - 'glyph': a dark mark on a transparent ground (GitHub's cat, Vercel's disc): shown inverted, a light mark on the dark rail;
 *  - 'tile': a dark filled square that carries its own light mark (MDN, X, Notion): kept as it is, with a hairline light edge so its
 *    square does not dissolve into the rail.
 * An image that cannot be read keeps its look. */
const darkness = new Map<string, '' | 'glyph' | 'tile'>();
function judge(img: HTMLImageElement): '' | 'glyph' | 'tile' | undefined {
  const src = img.currentSrc || img.src;
  if (!src) return undefined;
  if (darkness.has(src)) return darkness.get(src);
  if (!img.complete || !img.naturalWidth) { img.addEventListener('load', () => { const a = img.closest<HTMLElement>('.acira-sidebar'); if (a) markDarkIcons(a); }, { once: true }); return undefined; }
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data;
    let n = 0, lum = 0, chroma = 0, darkPx = 0, lightPx = 0;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; if (a < .5) continue; const r = d[i], gg = d[i + 1], b = d[i + 2]; n++; const l = (.2126 * r + .7152 * gg + .0722 * b) / 255; lum += l; chroma += (Math.max(r, gg, b) - Math.min(r, gg, b)) / 255; if (l < .3) darkPx++; else if (l > .7) lightPx++; }
    let kind: '' | 'glyph' | 'tile' = '';
    if (n > 12 && lum / n < .28 && chroma / n < .18) kind = n / 256 > .9 && lightPx > 6 ? 'tile' : 'glyph';
    else if (n / 256 > .9 && darkPx / n > .55 && chroma / n < .18) kind = 'tile';
    if (darkness.size >= 256) darkness.delete(darkness.keys().next().value as string);
    darkness.set(src, kind); return kind;
  } catch { darkness.set(src, ''); return ''; }
}
export function markDarkIcons(aside: HTMLElement, _appearance?: unknown): void {
  for (const img of aside.querySelectorAll<HTMLImageElement>('.sb-mini-fav img, .sb-tab img.site-identity-icon, .sb-bookmark img.site-identity-icon')) {
    const kind = judge(img);
    if (kind === undefined) continue;
    if (kind) img.setAttribute('data-dark-icon', kind); else img.removeAttribute('data-dark-icon');
  }
}

/* Keyboard and screen readers: the rail is the real sidebar clipped, so everything past the clip is still in the tab order and the accessibility tree at opacity 0. While the sidebar is only a rail those controls are
 * taken out (tabindex -1 and aria-hidden, restored when it opens), so focus never lands on something nobody can see; the rail's own rows keep their soft focus fill (miniRail.css). The open and docked sidebar are untouched. */
export function setRailInert(aside: HTMLElement, on: boolean): void {
  if (on === (aside.dataset.railInert === '1')) return;
  if (on) aside.dataset.railInert = '1'; else delete aside.dataset.railInert;
  for (const el of aside.querySelectorAll<HTMLElement>(RAIL_HIDDEN)) {
    if (on) { if (el.dataset.railTab === undefined) { el.dataset.railTab = el.getAttribute('tabindex') ?? ''; } el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); }
    else if (el.dataset.railTab !== undefined) { const was = el.dataset.railTab; delete el.dataset.railTab; if (was === '') el.removeAttribute('tabindex'); else el.setAttribute('tabindex', was); el.removeAttribute('aria-hidden'); }
  }
}
