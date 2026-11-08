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
 * whether this window or tab keeps Acira's own colours (private, Tor, secured). Outputs: the layers, plus two things other glows read:
 *   <html data-site-color="off|soft|rich">   the setting, always set
 *   <html style="--site-rgb: r g b">         the active site's colour; absent when there is none (or Off, or a private window)
 * Reduce motion: no fade. The washes are held to the finish's lightness band and gated at their peak (siteGlow.ts), so ink stays AA.
 */
import { siteTintEnabled, type SiteTintBase } from './siteTint';
import { SITE_GLOW_STRENGTH, siteGlowColors, type SiteGlowRequest } from './siteGlow';
import type { SiteColorLevel } from '../runtime/types';
import { sidebarMorphRunning } from './sidebarMorph';

const FADE_MS = 420;
let layers: HTMLElement[] = [], front = 0, lastKey = '', lastBase = '', lastColour = '', painted = false;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
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
  if (layers.length === 2 && layers.every(l => l.isConnected)) return true;
  layers = [0, 1].map(() => { const el = document.createElement('div'); el.className = 'st-glow'; el.setAttribute('aria-hidden', 'true'); node.prepend(el); return el; });
  return true;
}
const reducedMotion = () => app()?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const rgbTriple = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');

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
  if (color) root.style.setProperty('--site-rgb', rgbTriple(color)); else root.style.removeProperty('--site-rgb');
  const key = color + '|' + input.level;
  if (!color && !painted) { lastKey = key; lastColour = ''; return; } // never had a glow: nothing to take away
  if (!ensureLayers()) return;
  const base = readBase(); if (!base) return;
  const baseKey = base.frame + base.dark;
  if (key === lastKey && baseKey === lastBase) return;
  const sameColour = key === lastKey; // only the finish changed: re-derive at once
  lastKey = key; lastBase = baseKey; lastColour = color; if (color) painted = true;
  const incoming = layers[1 - front], outgoing = layers[front], instant = options.instant || sameColour || reducedMotion();
  const request: SiteGlowRequest | null = color ? { color, strength: SITE_GLOW_STRENGTH[input.level === 'rich' ? 'rich' : 'soft'] } : null;
  const colors = request ? siteGlowColors(request, base) : null;
  const transition = instant ? 'none' : `opacity ${FADE_MS}ms cubic-bezier(.2,0,0,1)`;
  if (colors && colors.opacity > 0) {
    root.setAttribute('data-site-glow', ''); root.setAttribute('data-site-glow-tone', base.dark ? 'dark' : 'light');
    incoming.style.setProperty('--g1', colors.g1); incoming.style.setProperty('--g2', colors.g2); incoming.style.setProperty('--g3', colors.g3);
    incoming.style.transition = 'none'; incoming.style.opacity = '0'; void incoming.offsetWidth;
    incoming.style.transition = transition; outgoing.style.transition = transition;
    incoming.style.opacity = String(colors.opacity); outgoing.style.opacity = '0'; front = 1 - front;
  } else {
    for (const l of layers) { l.style.transition = transition; l.style.opacity = '0'; }
    if (instant) root.removeAttribute('data-site-glow'); else setTimeout(() => { if (!lastColour) root.removeAttribute('data-site-glow'); }, FADE_MS + 40);
  }
}

// Dev rig hook (flag only): paint a colour on a tab without a page behind it.
declare global { interface Window { __aciraSiteGlow?: unknown } }
if (typeof window !== 'undefined' && siteTintEnabled()) {
  window.__aciraSiteGlow = { sync: (input: SiteGlowInput, options?: { instant?: boolean }) => syncSiteGlow(input, options), status: () => ({ lastKey, front, layers: layers.length }) };
}
