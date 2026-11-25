/**
 * The edge light's slow breathing (Beta 14, F5): the sidebar's light drifts and swells a few pixels in place over many seconds (styles/site-glow.css, `.st-glow-rail::after`).
 * It is the one thing in the browser that moves while nothing else does, so it runs ONLY when everything says it should, and costs nothing otherwise:
 *   - the window is the active one (`data-window-active`: main tells every view on focus and blur);
 *   - motion is not Off (Settings > Appearance > Animation speed, or the system's reduced motion);
 *   - the battery is not low (not charging and at or under 20%, the level the systems' own battery savers switch on at: `navigator.getBattery`);
 *   - the page is visible, and a site glow is showing at all;
 *   - (Beta 14.1) the person touched the browser in the last REST_AFTER_MS (desktop/input-rest.cjs: main says `input-idle`), unless media plays in the
 *     visible tab with the sidebar's Now Playing light on (`data-np-light`, NowPlaying.tsx) or a sidebar / layout motion runs: then it never rests.
 * The answer is one attribute on the root, `<html data-edge-breathe="on|rest|still|off">`:
 *   on     the light breathes;
 *   rest   (the active window: no input for the quiet time, or a low battery) the light PAUSES WHERE IT IS: the same animation, paused, keeping its layer, so resting
 *          and waking change no pixel and it goes on from the same place;
 *   still  (a window that has not been the active one for SETTLE_MS, or a hidden page as long) the light HOLDS WHERE IT IS with no animation at all: where the breath was (its time and its
 *          values) is read the moment it stops and the light is drawn with those values; a paused animation would keep a layer alive in every background window
 *          (+11 MB of tiles, +35 MB of GPU memory measured), this costs nothing. When it may breathe again the animation starts that far into its breath, so it goes
 *          on from the same place. A light that never breathed holds the breath's first frame, where it would start. (14.0 removed the animation when the window
 *          lost focus: a one-frame step to its plain look, and back to the start of its breath on return, D122.)
 *   off    no animation at all (motion Off, or no glow): the plain look, as before.
 * A window that has just stopped being the active one RESTS for SETTLE_MS first (paused, on its layer: `data-window-settled` is not on the root yet), so a look at
 * another window and back changes nothing at all: drawn on its own layer or with the sidebar's, the dark light's screen blend rounds differently (about 2 levels, real
 * window), so the layer goes only once the window has stayed away (the rail's own cut waits for the same mark, site-glow.css). */
export interface BreathInputs { windowActive: boolean; reducedMotion: boolean; batterySaver: boolean; visible: boolean; glowing: boolean;
  /** No input for the quiet time (main's `input-idle`). */ idle?: boolean;
  /** Media plays in the visible tab with the sidebar's Now Playing light on. */ nowPlaying?: boolean;
  /** A sidebar or layout motion is running (a mode switch, the Sidebar morph, the Mini rail docking, a page rising or dropping). */ moving?: boolean;
  /** The window has not been the active one (or the page has been hidden) for SETTLE_MS (`data-window-settled`). */ settled?: boolean }
export type BreathState = 'on' | 'rest' | 'still' | 'off';
/** The battery level at or under which, when not charging, the light stops breathing. */
export const LOW_BATTERY = .2;
/** How long a window that is no longer the active one keeps the light on its layer (paused) before it is held with none and the rail's layer goes too. */
export const SETTLE_MS = 30 * 1000;
export const batterySaverOn = (battery: { charging: boolean; level: number } | null | undefined): boolean => !!battery && !battery.charging && battery.level <= LOW_BATTERY;
/** What the light does for these inputs. Motion Off and no glow: the plain look. A window that is not the active one (or a hidden page): held where it is, no layer.
 *  The active window rests it in place for a low battery, or for no input in the quiet time unless media plays with the light on or something moves. */
export function breathState(i: BreathInputs): BreathState {
  if (!i.glowing || i.reducedMotion) return 'off';
  if (!i.windowActive || !i.visible) return i.settled ? 'still' : 'rest';
  if (i.batterySaver) return 'rest';
  if (i.idle && !i.nowPlaying && !i.moving) return 'rest';
  return 'on';
}
/** Where the breath is, kept on the root while it is held: `--ab-breath-at` (how far into its breath, the CSS animation's delay when it starts again), and the
 *  light's values at that moment (`--ab-still-op`, `--ab-still-tf`). Read from the light that shows (the lit rail with the highest opacity): its swell animation's
 *  time plus the delay it started with. Called before the root says `still`, in the same task, so the animation goes and the held values come in one style. */
export function holdWhereItIs(root: HTMLElement): boolean {
  if (typeof document.getAnimations !== 'function') return false;
  let best: { el: Element; opacity: number; at: number } | null = null;
  for (const run of document.getAnimations()) {
    if ((run as CSSAnimation).animationName !== 'ab-edge-swell') continue;
    const el = (run.effect as KeyframeEffect | null)?.target; if (!el) continue;
    const opacity = parseFloat(getComputedStyle(el).opacity) || 0, at = Number(run.currentTime);
    if (!Number.isFinite(at)) continue;
    if (!best || opacity > best.opacity) best = { el, opacity, at };
  }
  if (!best) return false;
  const started = parseFloat(root.style.getPropertyValue('--ab-breath-at')) || 0, light = getComputedStyle(best.el, '::after');
  root.style.setProperty('--ab-breath-at', `${started + best.at}ms`);
  root.style.setProperty('--ab-still-op', light.opacity); root.style.setProperty('--ab-still-tf', light.transform);
  return true;
}
export const breathing = (i: BreathInputs): boolean => breathState(i) === 'on';

/** The root attributes that mark a sidebar or layout motion while it runs (sharedMotion.ts, sidebarMorph.ts, miniRail.ts, chromeEdge.ts, workspaceMotion.ts). */
export const MOTION_FLAGS = ['data-mode-switch', 'data-sm-morph', 'data-mini-dock', 'data-mini-dock-el', 'data-rail-slide', 'data-page-rise', 'data-page-drop', 'data-block-slide'] as const;
const moving = (root: Element): boolean => MOTION_FLAGS.some(name => root.hasAttribute(name) && !(name === 'data-mode-switch' && root.getAttribute(name) === 'appearance'));

/** Main's `input-idle` on the root (`data-input-idle`), from the first script on. Pure for the test: `root` is anything with attributes. */
export function applyInputIdle(root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }, event: { type: string; idle?: boolean }): void {
  if (event.type !== 'input-idle') return;
  if (event.idle) root.setAttribute('data-input-idle', ''); else root.removeAttribute('data-input-idle');
}

/** Listens from the first script on (src/main.tsx), like windowActive.ts: main also says the current state when the interface loads. */
export function installInputIdle(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const subscribe = (window as unknown as { acira?: { subscribeBrowser?: (fn: (event: { type: string; idle?: boolean }) => void) => (() => void) | undefined } }).acira?.subscribeBrowser;
  return subscribe?.(event => applyInputIdle(document.documentElement, event)) ?? (() => {});
}

let installed = false;
export function installEdgeBreath(): void {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  let saver = false, watched: Element | null = null;
  const read = (): BreathInputs => {
    const app = document.querySelector('.app.style-acira:not(.native-layer)');
    return {
      windowActive: root.getAttribute('data-window-active') !== 'false', // not told yet (a dev page, a window that has not reported): active
      reducedMotion: app?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches,
      batterySaver: saver, visible: document.visibilityState !== 'hidden', glowing: root.hasAttribute('data-site-glow') && !root.hasAttribute('data-noel'),   // Noël: the light is one still icy light, it does not breathe

      idle: root.hasAttribute('data-input-idle'), nowPlaying: root.hasAttribute('data-np-light'), moving: moving(root), settled: root.hasAttribute('data-window-settled'),
    };
  };
  let settling: ReturnType<typeof setTimeout> | null = null;
  const settle = (away: boolean) => {
    if (!away) { if (settling) clearTimeout(settling); settling = null; if (root.hasAttribute('data-window-settled')) root.removeAttribute('data-window-settled'); return; }
    if (settling || root.hasAttribute('data-window-settled')) return;
    settling = setTimeout(() => { settling = null; root.setAttribute('data-window-settled', ''); }, SETTLE_MS);
  };
  const apply = () => {
    const inputs = read(); settle(!inputs.windowActive || !inputs.visible);
    const next = breathState({ ...inputs, settled: root.hasAttribute('data-window-settled') }), now = root.getAttribute('data-edge-breathe');
    if (now !== next) {
      if (next === 'still' && (now === 'on' || now === 'rest')) holdWhereItIs(root);   // where the breath is, before its animation goes
      root.setAttribute('data-edge-breathe', next);
    }
    const app = document.querySelector('.app.style-acira:not(.native-layer)');
    if (app && app !== watched) { watched = app; new MutationObserver(apply).observe(app, { attributes: true, attributeFilter: ['data-reduced-motion'] }); }
  };
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-window-active', 'data-window-settled', 'data-site-glow', 'data-input-idle', 'data-np-light', ...MOTION_FLAGS] });
  document.addEventListener('visibilitychange', apply);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
  try {
    void (navigator as unknown as { getBattery?: () => Promise<EventTarget & { charging: boolean; level: number }> }).getBattery?.().then(battery => {
      const update = () => { const next = batterySaverOn(battery); if (next !== saver) { saver = next; apply(); } };
      battery.addEventListener('chargingchange', update); battery.addEventListener('levelchange', update); update();
    }).catch(() => undefined);
  } catch { /* no battery information: the light breathes as long as the other conditions hold */ }
  apply();
}
