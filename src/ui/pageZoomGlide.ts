/** Plus, minus and Reset on one of Acira's own pages (Settings, History, the new tab ...) glide the way a pinch plays, then the real zoom lands.
 * A website does the same with Chromium's own page scale (desktop/page-zoom-glide.cjs); here the page is drawn by the interface, so the page
 * pane is scaled from its top-left corner with a compositor transform (the page card clips it, as it clips a pinch):
 *
 *   zoom in  (100% -> 110%)  the old layout is held and grows to the step; then the new layout lands in the same frame the scale ends
 *   zoom out (110% -> 100%)  the new layout lands first, enlarged to the old size, and shrinks to fit
 *
 * The page's level (`tab.zoom`), the chip, the bubble and the saved level change on the press as before; only the layout the pane is drawn
 * at (`shownZoom`) lags a zoom in. A glide starts only for a step main says is one (a `page-zoom-set` event with `glide`, sent just before the
 * new level: plus, minus, Reset); a level that changes any other way (a navigation, another window's change) lands at once, as before.
 * No glide with motion off, in a split view (a scaled pane would cover its neighbour), in a hidden window, or for a jump of more than 1.6x. */
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { runtime } from '../runtime/client';
import type { BrowserSnapshot } from '../runtime/types';
import { kick, springForFrequent } from './motionTokens';
import { planGlide } from './pageZoomGlideMath';
import { motionSpeed } from './sharedMotion';
import { springEasing } from './springs';

interface Hold { layout: number; url: string; anim: Animation | null; timer: number }
const holds = new Map<string, Hold>(), lastZoom = new Map<string, number>(), listeners = new Set<() => void>();
let latest: BrowserSnapshot | undefined, version = 0;

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const notify = () => { version++; flushSync(() => listeners.forEach(fn => fn())); };
/** Re-renders the interface when a held layout changes (App reads `shownZoom` for each pane). */
export const usePageZoomHolds = () => useSyncExternalStore(subscribe, () => version, () => 0);
/** The zoom (a fraction) a page is laid out at: the one it has, or the old one a glide holds until its zoom in has grown into place. */
export const shownZoom = (id: string, zoom: number): number => holds.get(id)?.layout ?? zoom;

const panes = () => [...document.querySelectorAll<HTMLElement>('.page-content > .page-pane')];
/** The pane of a tab, only when it is the one pane on screen (a split view's panes are not glided). */
const paneOf = (id: string) => { const all = panes(); return all.length === 1 && latest?.activeTabId === id ? all[0] : null; };
const scaleOf = (pane: HTMLElement) => { const value = getComputedStyle(pane).transform; try { return value && value !== 'none' ? Math.max(1, new DOMMatrixReadOnly(value).a) : 1; } catch { return 1; } };

/** The glide is over (or never was): the pane is laid out at the zoom the page has, with no scale. The layout lands before the scale is taken off,
 * in the same task, so no frame shows the page at the wrong size. */
function release(id: string) {
  const hold = holds.get(id); if (!hold) return;
  clearTimeout(hold.timer); holds.delete(id);
  notify();
  hold.anim?.cancel();
}

function glide(id: string, target: number) {
  const hold = holds.get(id), pane = paneOf(id), speed = motionSpeed();
  if (!hold) return;
  if (!pane || speed === 'off' || document.visibilityState !== 'visible') return release(id);
  const plan = planGlide({ layout: hold.layout, scale: hold.anim ? scaleOf(pane) : 1 }, target);
  if (plan.kind !== 'glide') return release(id);
  const moved = plan.layout !== hold.layout;
  hold.layout = plan.layout;
  if (moved) notify(); // a landing: the new layout is on screen before the enlarged copy of it starts
  const spec = springForFrequent('page.zoom', speed);
  if (!spec) return release(id);
  const { duration, easing } = springEasing(spec, 1, hold.anim ? 0 : kick[speed] * Math.PI * 2 / spec.duration);
  const frame = (scale: number): Keyframe => ({ transform: `scale(${scale})`, transformOrigin: '0 0' });
  const next = pane.animate([frame(plan.scale), frame(plan.goal)], { duration, easing, fill: 'both' });
  hold.anim?.cancel(); hold.anim = next;
  next.onfinish = () => { if (holds.get(id)?.anim === next) release(id); };
  clearTimeout(hold.timer); hold.timer = window.setTimeout(() => { if (holds.get(id)?.anim === next) release(id); }, duration + 500);
}

/** Main says a step came: hold the layout the pane has, so a zoom in does not land before it has grown. */
function onEvent(raw: { type: string; tabId?: string; glide?: boolean }) {
  if (raw.type !== 'page-zoom-set' || !raw.tabId) return;
  const id = raw.tabId, tab = latest?.tabs.find(item => item.id === id);
  if (!tab || tab.contentKind === 'web') return;
  if (!raw.glide || motionSpeed() === 'off' || !paneOf(id) || document.visibilityState !== 'visible') return release(id);
  let hold = holds.get(id);
  if (!hold) { hold = { layout: tab.zoom / 100, url: tab.url, anim: null, timer: 0 }; holds.set(id, hold); }
  // No new level followed (Reset at 100%, plus at 500%): nothing to glide.
  if (!hold.anim) { clearTimeout(hold.timer); const mine = hold; hold.timer = window.setTimeout(() => { if (holds.get(id) === mine && !mine.anim) release(id); }, 250); }
}

function settle(snapshot: BrowserSnapshot) {
  latest = snapshot;
  const ids = new Set<string>();
  for (const tab of snapshot.tabs) {
    ids.add(tab.id);
    if (tab.contentKind === 'web') { lastZoom.delete(tab.id); continue; }
    const before = lastZoom.get(tab.id); lastZoom.set(tab.id, tab.zoom);
    const hold = holds.get(tab.id); if (!hold) continue;
    if (hold.url !== tab.url || snapshot.activeTabId !== tab.id) release(tab.id);
    else if (before !== undefined && before !== tab.zoom) glide(tab.id, tab.zoom / 100);
  }
  for (const id of [...holds.keys()]) if (!ids.has(id)) release(id);
  for (const id of [...lastZoom.keys()]) if (!ids.has(id)) lastZoom.delete(id);
}

/** Called once by the interface. */
export function installPageZoomGlide(): () => void {
  if (!window.acira) return () => undefined;
  const stops = [runtime.subscribe(settle), runtime.subscribeBrowser(event => onEvent(event as { type: string; tabId?: string; glide?: boolean }))];
  void runtime.getSnapshot().then(snapshot => { latest ??= snapshot; for (const tab of snapshot.tabs) if (tab.contentKind !== 'web' && !lastZoom.has(tab.id)) lastZoom.set(tab.id, tab.zoom); });
  // (The interface is going away: no re-render to ask for, so the holds are just dropped.)
  return () => { for (const stop of stops) stop(); for (const hold of holds.values()) { clearTimeout(hold.timer); hold.anim?.cancel(); } holds.clear(); };
}
