/**
 * Site tint engine (DEV PROTOTYPE, see siteTint.ts). Owns the morph and the DOM variables; React never re-renders for it.
 *
 * Why not the theme tokens: a token change is deliberately instant (themeSwitch.settleThemeTransitions finishes every colour
 * transition, ~70 controls), so a tab switch routed through themeTokens would CUT, not glide. The engine instead writes a small
 * set of --st-* variables on <html> from one rAF tween (pure colour math, no readable() searches, no React), and
 * styles/site-tint.css re-points the frame's own variables at them with !important (beats the inline tokens).
 *
 * Safe by construction: lightness stays in the finish's band (siteTint.ts), so glide frames are valid colours and the ink
 * never flips (match mode excepted). Reduced motion: no glide. Private and Tor windows, and an inactive flag: no tint at all.
 */
import { mix } from './colorMath';
import { fitMuted, glideColor, siteTintColors, siteTintEnabled, siteTintStates, siteTintVariables, tripleOf, type SiteTintBase, type SiteTintColors, type SiteTintRequest } from './siteTint';

const GLIDE_MS = 380;
let glideMs = GLIDE_MS; // dev rigs slow it down to photograph the glide
const ease = (t: number) => 1 - (1 - t) ** 3;
type Painted = { frame: string; end: string; edge: string; halo: string; strength: number; ink?: string; muted?: string };

let painted: Painted | null = null;
let target: { request: SiteTintRequest | null; colors: SiteTintColors | null } = { request: null, colors: null };
let raf = 0;
const perTab = new Map<string, SiteTintRequest>();
let activeTab = '', blocked = false;
let themeObserver: MutationObserver | undefined;

const root = () => document.documentElement;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
const mixHex = (frame: string) => mix('#ffffff', frame, .8);
const hexOf = (triple: string) => '#' + triple.trim().split(/\s+/).map(n => Number(n).toString(16).padStart(2, '0')).join('');

/** The finish's own frame, read from the INLINE tokens (the stylesheet's !important override hides them from computed style). */
export function readBase(): SiteTintBase | null {
  const node = app(); if (!node) return null;
  const get = (name: string) => node.style.getPropertyValue(name).trim();
  const rgb = get('--sidebar-rgb'); if (!/^\d+ \d+ \d+$/.test(rgb)) return null;
  const hex = (value: string) => /^#[\da-f]{6}$/i.test(value) ? value : undefined;
  return { dark: get('--sidebar-tone') === 'dark', frame: hexOf(rgb), ink: get('--sidebar-ink') || '#16181c', muted: get('--sidebar-muted') || '#60636c', accent: hex(get('--chrome-accent')), marker: hex(get('--sidebar-selection-marker')) };
}

function write(p: Painted, request: SiteTintRequest | null, base: SiteTintBase, final = false) {
  const el = root(), dark = request?.mode === 'match' && p.ink ? p.ink === '#ffffff' : base.dark;
  const ink = p.ink ?? base.ink, s = siteTintStates(p.frame, ink, dark);
  // The secondary ink is re-fitted to every painted frame (a glide frame is just another frame): AA holds on each one, with no gap.
  const muted = request?.mode === 'match' && p.muted ? p.muted : fitMuted(base.muted, ink, [p.frame, s.hover, s.pressed, s.selected]).color;
  const colors: SiteTintColors = { frame: p.frame, surface: dark ? p.frame : mixHex(p.frame), end: p.end, edge: p.edge, halo: p.halo, ...s, tone: dark ? 'dark' : 'light', note: 'ok', chroma: 0, ink: p.ink, muted };
  // A glide frame writes only what changes with the colour (no layout reads: a getBoundingClientRect here forced a layout every
  // frame and cost ~2x the frame time on a busy page). The shape's own colours are written only for the shapes that draw them.
  const shape = request?.shape ?? 'flat', vars = siteTintVariables(colors, request ?? { color: p.frame, strength: p.strength });
  const shapeOnly = ['--st-end-rgb', '--st-edge-rgb', '--st-halo-rgb'];
  // Dev probe: the glide writes only the colour the veil paints with (hover/pressed/selected/divider/sheet land when it settles).
  const lean = !final && (window as unknown as { __stLean?: boolean }).__stLean === true, leanKeep = ['--st-frame-rgb', '--st-frame', '--st-surface-rgb', '--st-muted'];
  for (const [name, value] of Object.entries(vars)) if ((!lean || leanKeep.includes(name)) && (shape !== 'flat' || final || !shapeOnly.includes(name))) { if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value); }
  if (!lean) { el.style.setProperty('--st-tabsel', dark ? s.selected : '#ffffff'); el.style.setProperty('--st-fade', String(p.strength)); }
  if (final) {
    const page = document.querySelector<HTMLElement>('.page-area');
    if (page) el.style.setProperty('--st-page-top', Math.max(0, Math.round(page.getBoundingClientRect().top)) + 'px');
  }
  const node = app();
  if (node && request?.mode === 'match') node.dataset.chrome = dark ? 'dark' : 'light';
}
function clearVars() {
  const el = root();
  for (const name of Array.from(el.style)) if (name.startsWith('--st-')) el.style.removeProperty(name);
  for (const attr of ['data-site-tint', 'data-site-tint-shape', 'data-site-tint-scope', 'data-site-tint-mode']) el.removeAttribute(attr);
}

function reducedMotion() { return root().dataset.reducedMotion === 'true' || app()?.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches; }

/** Paint the request (null = Acira's own colours). Glides from whatever is painted now; a new call mid-glide retargets. */
export function setSiteTint(request: SiteTintRequest | null, options: { instant?: boolean } = {}) {
  if (!siteTintEnabled()) return;
  const base = readBase(); if (!base) return;
  const effective = blocked ? null : request;
  const colors = effective && effective.strength > 0 ? siteTintColors(effective, base) : null;
  target = { request: effective, colors };
  const el = root();
  if (effective && colors) {
    el.setAttribute('data-site-tint', ''); el.setAttribute('data-site-tint-shape', effective.shape ?? 'flat');
    el.setAttribute('data-site-tint-scope', effective.scope ?? 'frame'); el.setAttribute('data-site-tint-mode', effective.mode ?? 'tint');
  }
  const goal: Painted = colors
    ? { frame: colors.frame, end: colors.end, edge: colors.edge, halo: colors.halo, strength: effective!.strength, ink: colors.ink, muted: colors.muted }
    : { frame: base.frame, end: base.frame, edge: base.frame, halo: base.frame, strength: 0 };
  const from: Painted = painted ?? { frame: base.frame, end: base.frame, edge: base.frame, halo: base.frame, strength: 0 };
  cancelAnimationFrame(raf);
  const settle = () => { painted = goal; if (!colors) { clearVars(); painted = null; } else write(goal, effective, base, true); };
  if (options.instant || reducedMotion() || (!painted && !colors)) { settle(); return; }
  const start = performance.now();
  let lastWrite = -1e9;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / glideMs), e = ease(t);
    if (t >= 1) { settle(); return; }
    // Dev probe: how often the veil is repainted during a glide (ms between colour writes; default 33 = 30 steps a second).
    const every = (window as unknown as { __stEvery?: number }).__stEvery ?? 33;
    if (now - lastWrite < every) { raf = requestAnimationFrame(step); return; }
    lastWrite = now;
    const frame: Painted = {
      frame: glideColor(from.frame, goal.frame, e), end: glideColor(from.end, goal.end, e), edge: glideColor(from.edge, goal.edge, e), halo: glideColor(from.halo, goal.halo, e),
      strength: from.strength + (goal.strength - from.strength) * e,
      // Ink (match mode only) flips at the half: a cut, which is exactly why that mode is not recommended.
      ...(goal.ink || from.ink ? { ink: e < .5 ? (from.ink ?? base.ink) : (goal.ink ?? base.ink), muted: e < .5 ? (from.muted ?? base.muted) : (goal.muted ?? base.muted) } : {}),
    };
    painted = frame; write(frame, effective ?? target.request, base);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

/** A theme or finish change repaints the inline tokens: re-derive from the new base at once (the theme change itself is instant). */
function watchTheme() {
  const node = app(); if (!node || themeObserver) return;
  let last = node.style.getPropertyValue('--sidebar-rgb') + node.style.getPropertyValue('--sidebar-ink');
  themeObserver = new MutationObserver(() => {
    const now = node.style.getPropertyValue('--sidebar-rgb') + node.style.getPropertyValue('--sidebar-ink');
    if (now !== last) { last = now; painted = null; if (target.request) setSiteTint(target.request, { instant: true }); }
  });
  themeObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
}

/** Private and Tor windows keep Acira's own colours (recommendation); the App says so on every render. */
let followed = '';
export function siteTintFollow(tabId: string, privateWindow: boolean) {
  if (!siteTintEnabled()) return;
  watchTheme();
  const key = tabId + '|' + privateWindow;
  if (key === followed) return; // App calls this on every render; only a tab or privacy change retargets
  followed = key; blocked = privateWindow; activeTab = tabId;
  setSiteTint(perTab.get(tabId) ?? null);
}

declare global { interface Window { __aciraSiteTint?: unknown } }
if (typeof window !== 'undefined' && siteTintEnabled()) {
  window.__aciraSiteTint = {
    set: (request: SiteTintRequest | null, options?: { instant?: boolean }) => setSiteTint(request, options),
    clear: () => setSiteTint(null, { instant: true }),
    slow: (ms: number) => { glideMs = ms > 0 ? ms : GLIDE_MS; },
    setTab: (tabId: string, request: SiteTintRequest | null, options?: { instant?: boolean }) => { if (request) perTab.set(tabId, request); else perTab.delete(tabId); if (tabId === activeTab) setSiteTint(request, options); },
    recompute: () => { followed = ''; painted = null; setSiteTint(perTab.get(activeTab) ?? null, { instant: true }); },
    status: () => ({ painted, target: target.colors, activeTab, blocked, tabs: [...perTab.keys()] }),
    tripleOf,
  };
}
