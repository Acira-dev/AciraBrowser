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
 */
import { siteTintEnabled, type SiteTintBase } from './siteTint';
import { SITE_GLOW_STRENGTH, siteGlowColors, type SiteGlowRequest } from './siteGlow';
import type { SiteColorLevel } from '../runtime/types';
import { sidebarMorphRunning } from './sidebarMorph';

const FADE_MS = 420;
/** Layers: THREE (frame layers, and the sidebar's, one set per index). A colour that arrives while a fade is running (a quick second tab, Ctrl+Tab through several) must not be painted into the layer that is still fading out: with two layers
 *  that layer's colour was swapped while visible and its opacity snapped to 0, and the tint of the frame dropped by a fifth of its strength in one frame (the toolbar band lost 11-16 levels). The new colour goes on the layer, other than the
 *  front one, that shows the least; every other layer fades on to nothing from where it is. */
const LAYERS = 3;
/** The layer that gets the next colour: not the front one, and of the others the one that shows the least (the first on a tie). */
export function pickGlowLayer(shown: number[], front: number): number {
  let toward = -1, least = Infinity;
  for (let i = 0; i < shown.length; i++) { if (i === front) continue; if (shown[i] < least) { least = shown[i]; toward = i; } }
  return toward;
}
let layers: HTMLElement[] = [], front = 0, lastKey = '', lastBase = '', lastColour = '', painted = false;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
/** The left wash is painted by the sidebar itself (13.5): two layers inside the open sidebar (`.st-glow-rail`, see AciraSidebar) that follow the frame layers' colours,
 *  opacity and fades exactly. A layer behind the frame at a fixed place is not part of what the layout view transition shows under the sidebar column: the sidebar slid in
 *  without its glow and the glow landed on it in one frame at the end. Inside the sidebar the glow travels, and fades, with it. Mounted layers take the current state at once. */
const rails: Set<HTMLElement>[] = Array.from({ length: LAYERS }, () => new Set<HTMLElement>());
const railRef = (index: number) => (el: HTMLElement | null) => {
  if (!el) return undefined;
  rails[index].add(el); el.style.cssText = layers[index]?.style.cssText ?? ''; lightOne(el, !!layers[index]?.hasAttribute('data-lit'));
  return () => { rails[index].delete(el); };
};
/** React refs of the three layers a sidebar renders. */
export const railGlowRef0 = railRef(0), railGlowRef1 = railRef(1), railGlowRef2 = railRef(2);
const stackOf = (index: number): HTMLElement[] => [layers[index], ...rails[index]].filter(Boolean) as HTMLElement[];
/** A glow layer (a frame layer and its rails) wears `data-lit` while it shows a glow or is still fading: only then does the stylesheet keep it on the compositor
 *  (`will-change`, styles/site-glow.css). An idle layer at opacity 0 used to stay a full-window composited layer for good after the first site colour, with a compositor
 *  surface of its own in dark (12.6 MB at 2x) and an overlap layer above it. Opacity 0 draws nothing: the picture and the fades are the same. */
const lightOne = (el: HTMLElement, lit: boolean) => { if (lit) el.setAttribute('data-lit', ''); else el.removeAttribute('data-lit'); };
const light = (index: number, lit: boolean) => { for (const el of stackOf(index)) lightOne(el, lit); };
/** After a layer has faded out (or at once without a fade), put it away, unless a colour has been put on it again since. */
const putAwayWhenFaded = (index: number, wait: number) => {
  const put = () => { const layer = layers[index]; if (layer && (parseFloat(layer.style.opacity) || 0) === 0) light(index, false); };
  if (wait > 0) setTimeout(put, wait); else put();
};
const hexOf = (triple: string) => '#' + triple.trim().split(/\s+/).map(n => Number(n).toString(16).padStart(2, '0')).join('');

function readBase(): SiteTintBase | null {
  const node = app(); if (!node) return null;
  const get = (name: string) => node.style.getPropertyValue(name).trim(), rgb = get('--sidebar-rgb');
  if (!/^\d+ \d+ \d+$/.test(rgb)) return null;
  const hex = (v: string) => /^#[\da-f]{6}$/i.test(v) ? v : undefined;
  return { dark: get('--sidebar-tone') === 'dark', frame: hexOf(rgb), ink: get('--sidebar-ink') || '#16181c', muted: get('--sidebar-muted') || '#60636c', accent: hex(get('--chrome-accent')), marker: hex(get('--sidebar-selection-marker')) };
}
function ensureLayers() {
  const node = app(); if (!node) return false;
  if (layers.length === LAYERS && layers.every(l => l.isConnected)) return true;
  layers = Array.from({ length: LAYERS }, () => { const el = document.createElement('div'); el.className = 'st-glow'; el.setAttribute('aria-hidden', 'true'); node.prepend(el); return el; });
  return true;
}
const reducedMotion = () => app()?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SiteGlowInput { color?: string; level: SiteColorLevel; /** private/Tor window or tab, secured tab: Acira's own colours. */ blocked: boolean }
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
  if (switching()) { waiting = { input, options }; whenSteady(); return; }
  waiting = null;
  const root = document.documentElement;
  if (root.getAttribute('data-site-color') !== input.level) root.setAttribute('data-site-color', input.level);
  const wants = !input.blocked && input.level !== 'off' && !!input.color && /^#[\da-f]{6}$/i.test(input.color);
  const color = wants ? input.color!.toLowerCase() : '';
  const key = color + '|' + input.level;
  if (!color && !painted) { lastKey = key; lastColour = ''; return; } // never had a glow: nothing to take away
  if (!ensureLayers()) return;
  const base = readBase(); if (!base) return;
  const baseKey = base.frame + base.dark;
  if (key === lastKey && baseKey === lastBase) return;
  const sameColour = key === lastKey; // only the finish changed: re-derive at once
  lastKey = key; lastBase = baseKey; lastColour = color; if (color) painted = true;
  const instant = options.instant || sameColour || reducedMotion();
  const inIndex = pickGlowLayer(layers.map(layer => instant ? 0 : (parseFloat(getComputedStyle(layer).opacity) || 0)), front), incoming = layers[inIndex], outIndexes = layers.map((_, i) => i).filter(i => i !== inIndex);
  const request: SiteGlowRequest | null = color ? { color, strength: SITE_GLOW_STRENGTH[input.level === 'rich' ? 'rich' : 'soft'] } : null;
  const colors = request ? siteGlowColors(request, base) : null;
  const transition = instant ? 'none' : `opacity ${FADE_MS}ms cubic-bezier(.2,0,0,1)`;
  if (colors && colors.opacity > 0) {
    root.setAttribute('data-site-glow', ''); root.setAttribute('data-site-glow-tone', base.dark ? 'dark' : 'light');
    light(inIndex, true);
    for (const el of stackOf(inIndex)) {
      el.style.setProperty('--g1', colors.g1); el.style.setProperty('--g2', colors.g2); el.style.setProperty('--g3', colors.g3);
      el.style.transition = 'none'; el.style.opacity = '0';
    }
    void incoming.offsetWidth;
    for (const index of layers.keys()) for (const el of stackOf(index)) el.style.transition = transition;
    for (const el of stackOf(inIndex)) el.style.opacity = String(colors.opacity);
    for (const index of outIndexes) for (const el of stackOf(index)) el.style.opacity = '0';   // a transition retargets from where the layer is: a fade that is running goes on, no step
    for (const index of outIndexes) putAwayWhenFaded(index, instant ? 0 : FADE_MS + 40);
    front = inIndex;
  } else {
    for (const index of layers.keys()) for (const el of stackOf(index)) { el.style.transition = transition; el.style.opacity = '0'; }
    for (const index of layers.keys()) putAwayWhenFaded(index, instant ? 0 : FADE_MS + 40);
    if (instant) root.removeAttribute('data-site-glow'); else setTimeout(() => { if (!lastColour) root.removeAttribute('data-site-glow'); }, FADE_MS + 40);
  }
}

// Dev rig hook (flag only): paint a colour on a tab without a page behind it.
declare global { interface Window { __aciraSiteGlow?: unknown } }
if (typeof window !== 'undefined' && siteTintEnabled()) {
  window.__aciraSiteGlow = { sync: (input: SiteGlowInput, options?: { instant?: boolean }) => syncSiteGlow(input, options), status: () => ({ lastKey, front, layers: layers.length }) };
}
