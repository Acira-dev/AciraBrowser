/** A trackpad pinch over one of Acira's own pages magnifies it the way Chromium magnifies a website: the page is drawn larger about the fingers
 * and can be panned, but it is not laid out again and its page zoom (the 25%-500% steps) is untouched. A page zoom step, actual size or a
 * new address clears it. The preload tells this module about a pinch (a ctrl+wheel with small deltas and no Control key down). */
import { runtime } from '../runtime/client';
import type { BrowserSnapshot } from '../runtime/types';
import { magnifyBy, NO_MAGNIFY, panMagnify, type Magnify } from './pageMagnifyMath';

interface Held extends Magnify { url: string; zoom: number }
const held = new Map<string, Held>();
let latest: BrowserSnapshot | undefined, panning = false;

const panes = () => [...document.querySelectorAll<HTMLElement>('.page-content > .page-pane')];
const tabOf = (pane: HTMLElement) => pane.dataset.pane ?? latest?.activeTabId;

/** Draws every held magnification on its pane; a pane without one is left as it is. The clip keeps the larger page inside its card. */
function apply() {
  for (const pane of panes()) {
    const id = tabOf(pane), magnified = id !== undefined ? held.get(id) : undefined;
    if (magnified) { pane.style.transformOrigin = '0 0'; pane.style.transform = `translate(${magnified.x}px, ${magnified.y}px) scale(${magnified.scale})`; }
    else if (pane.style.transform) { pane.style.transform = ''; pane.style.transformOrigin = ''; }
  }
  for (const content of document.querySelectorAll<HTMLElement>('.page-content')) content.toggleAttribute('data-magnified', [...content.children].some(child => child instanceof HTMLElement && child.classList.contains('page-pane') && child.style.transform !== ''));
  if (held.size && !panning) { panning = true; window.addEventListener('wheel', pan, { passive: false }); }
  else if (!held.size && panning) { panning = false; window.removeEventListener('wheel', pan); }
}

/** The pane's own box, before its magnification: the pane is scaled from its top-left corner, so its position is the drawn one less the offset. */
function boxOf(pane: HTMLElement, magnified: Magnify) {
  const drawn = pane.getBoundingClientRect();
  return { left: drawn.left - magnified.x, top: drawn.top - magnified.y, width: drawn.width / magnified.scale, height: drawn.height / magnified.scale };
}

const paneAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('.page-content > .page-pane') ?? null;

function pinch(event: Event) {
  let input: { deltaY: number; x: number; y: number };
  try { input = JSON.parse(String((event as CustomEvent).detail)); } catch { return; }
  if (![input.deltaY, input.x, input.y].every(Number.isFinite)) return;
  const pane = paneAt(input.x, input.y), id = pane ? tabOf(pane) : undefined, tab = latest?.tabs.find(item => item.id === id);
  if (!pane || !id || !tab) return;
  watch();
  const before = held.get(id) ?? { ...NO_MAGNIFY, url: tab.url, zoom: tab.zoom }, box = boxOf(pane, before);
  const next = magnifyBy(before, input.deltaY, { x: input.x - box.left, y: input.y - box.top }, box);
  if (next.scale > 1) held.set(id, { ...next, url: tab.url, zoom: tab.zoom }); else held.delete(id);
  apply();
}

/** The nearest scrollable ancestor that can still move the way the wheel went (the page's own scroller, as the wheel would have reached it). */
function scrollOf(from: Element | null, dx: number, dy: number): HTMLElement | null {
  for (let node = from; node && node !== document.documentElement; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const style = getComputedStyle(node), canY = dy !== 0 && /auto|scroll/.test(style.overflowY) && (dy < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    const canX = dx !== 0 && /auto|scroll/.test(style.overflowX) && (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    if (canX || canY) return node;
  }
  return null;
}

function pan(event: WheelEvent) {
  if (event.ctrlKey || event.defaultPrevented || !event.isTrusted) return;
  const pane = paneAt(event.clientX, event.clientY), id = pane ? tabOf(pane) : undefined, current = id ? held.get(id) : undefined;
  if (!pane || !id || !current) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1, box = boxOf(pane, current);
  const moved = panMagnify(current, event.deltaX * scale, event.deltaY * scale, box);
  event.preventDefault();
  held.set(id, { ...current, ...moved.magnify }); apply();
  if (moved.restX || moved.restY) scrollOf(event.target instanceof Element ? event.target : null, moved.restX, moved.restY)?.scrollBy({ left: moved.restX, top: moved.restY });
}

/** Something that makes a magnification stale (the page zoom or the address changed, the tab went) clears it. */
function settle(snapshot: BrowserSnapshot) {
  latest = snapshot;
  let changed = false;
  for (const [id, magnified] of held) {
    const tab = snapshot.tabs.find(item => item.id === id);
    if (!tab || tab.url !== magnified.url || tab.zoom !== magnified.zoom) { held.delete(id); changed = true; }
  }
  if (changed) apply();
}

/** A pane comes and goes with its tab (and a split with its panes): the magnification a tab holds is drawn again when its pane returns. */
const watcher = new MutationObserver(() => apply()), watched = new WeakSet<Element>();
function watch() { for (const element of document.querySelectorAll('.page-content')) if (!watched.has(element)) { watched.add(element); watcher.observe(element, { childList: true }); } }

/** Called once by the interface. */
export function installPageMagnify(): () => void {
  if (!window.acira) return () => undefined;
  window.addEventListener('acira:pinch', pinch);
  const stops = [
    runtime.subscribe(settle),
    // Actual size (or any page zoom) clears a pinch even when the zoom stays 100%: main says so for a page the interface draws.
    runtime.subscribeBrowser(event => { const raw = event as { type: string; tabId?: string }; if (raw.type === 'page-zoom-set' && raw.tabId && held.delete(raw.tabId)) apply(); }),
  ];
  void runtime.getSnapshot().then(snapshot => { latest ??= snapshot; });
  return () => { window.removeEventListener('acira:pinch', pinch); window.removeEventListener('wheel', pan); for (const stop of stops) stop(); watcher.disconnect(); };
}
