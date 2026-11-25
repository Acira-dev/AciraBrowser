// 13.11 (laptop, 13.10 round 5 Run 9): the FIRST view transition of a launch freezes inside its slide for ~150-200 ms (side, scaling with the layers' area; ~60 ms on the top bar) after vt-ready, whatever the window's
// state (never activated or focused); every later reveal of the launch is smooth. Every main-side step of that reveal answers within 0-3 ms, so it is a first-time cost of the transition itself (the compositor / GPU
// side: texture allocation for the snapshot layers, first use of the blend, clip and blur passes). This plays ONE transition once after launch, at idle, that has the same kinds of layers in the same sizes, so
// the cost is paid when nobody is looking:
//   'root'   one transition that changes nothing (the whole window's snapshot pair),
//   'layers' the root pair plus three named layers the size of the sidebar, the page card and the toolbar band, sliding in with the reveal's own curve,
//   'blur'   'layers' with the sidebar layer's backdrop blur (the glass),
//   'off'    nothing. Chosen with ACIRA_EDGE_WARM (main sets data-edge-warm); the default is 'real' (Beta 14 freeze, laptop Run 12: the first-reveal gap halved, 48-60 vs 76-99 ms, no snap-back): the interface's own reveal once at 1 % (chromeEdge.ts playWarmReveal), then 'layers'; without that hook it is 'layers'.
// Invisible: the layers stand at 1 % opacity inside the window, under the native page (it plays only while a website is showing, which covers them); no focus change, no event, nothing sent to main. It starts only
// when the window is idle (no edge shown, no prime, no transition, no popup, nothing typed into), waits for a website if the window starts on an internal page (every 2 s, for two minutes), and is let go of at once
// (`abortEdgeWarm`) when an edge, a prime or another view transition starts.
import { reducedMotion } from './sharedMotion';

export type WarmVariant = 'off' | 'root' | 'layers' | 'blur' | 'real';
const root = (): HTMLElement => document.documentElement;
export const warmVariant = (): WarmVariant => { const v = root().dataset.edgeWarm; return v === 'off' || v === 'root' || v === 'blur' || v === 'layers' ? v : 'real'; };
let state: 'idle' | 'scheduled' | 'running' | 'done' = 'idle', layers: HTMLElement[] = [], running: { skipTransition(): void } | null = null, guard = 0, realRun: RealRun | null = null;
export const edgeWarmState = (): string => state;
function finish(): void { window.clearTimeout(guard); for (const layer of layers) layer.remove(); layers = []; running = null; delete root().dataset.edgeWarming; state = 'done'; }
/** An edge, a prime, a key or a popup is here: the warm-up lets go at once (the real transition replaces a running one by itself). */
export function abortEdgeWarm(): void {
  if (state === 'scheduled') return;   // not playing yet: the attempt checks the edge itself (world.quiet()) and waits; an edge or a prime before the warm-up must not cancel it for the whole launch
  if (state !== 'running') return;
  if (realRun) { const run = realRun; realRun = null; window.clearTimeout(guard); state = 'done'; run.cancel(); return; }   // the real reveal puts the interface back itself
  try { running?.skipTransition(); } catch { /* already over */ }
  finish();
}
export type RealRun = { cancel: () => void; finished: Promise<void> };
export type WarmWorld = { quiet: () => boolean; real?: () => RealRun | null };   // real: plays the interface's own reveal transition invisibly (chromeEdge.ts playWarmReveal)
const editing = (): boolean => { const el = document.activeElement as HTMLElement | null; return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
function ready(world: WarmWorld): boolean {
  const r = root();
  return document.visibilityState === 'visible' && !reducedMotion() && !r.hasAttribute('data-mode-switch') && !r.hasAttribute('data-fr-switch') && !r.hasAttribute('data-edge-float') && !r.hasAttribute('data-sidebar-overlay')
    && !document.querySelector('.setup-dialog, .native-popup-stage > *') && !!document.querySelector('.app') && !editing() && world.quiet();
}
function layer(kind: 'sidebar' | 'page' | 'bar', box: { x: number; y: number; width: number; height: number }, blur: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'edge-warm-layer'; el.dataset.warm = kind; if (blur) el.dataset.blur = '';
  el.style.cssText = `left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${Math.max(1, Math.round(box.width))}px;height:${Math.max(1, Math.round(box.height))}px`;
  return el;
}
function play(variant: WarmVariant, world?: WarmWorld): void {
  if (variant === 'real') {   // the interface's own reveal, played once with the real sidebar at 1 %; then the synthetic layers (the toolbar band and the page card)
    const run = world?.real?.();
    if (!run) { play('layers', world); return; }
    state = 'running'; realRun = run;
    guard = window.setTimeout(() => { if (realRun === run) { realRun = null; run.cancel(); } }, 1500);
    void run.finished.then(() => { window.clearTimeout(guard); if (realRun === run) realRun = null; if (state === 'running') play('layers', world); else state = 'done'; });
    return;
  }
  const start = (document as Document & { startViewTransition?: (update: () => void) => { skipTransition(): void; finished: Promise<void>; ready?: Promise<void> } }).startViewTransition;
  if (!start) { state = 'done'; return; }
  const r = root();
  state = 'running';
  const area = (document.querySelector('.page-area') as HTMLElement | null)?.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const page = area && area.width > 40 ? { x: area.left, y: area.top, width: area.width, height: area.height } : { x: 6, y: 6, width: W - 12, height: H - 12 };
  const sidebarWidth = Math.min(320, Math.max(180, parseFloat(getComputedStyle(r).getPropertyValue('--sidebar-width')) || 240));
  r.dataset.edgeWarming = variant;
  try {
    const transition = start.call(document, () => {
      if (variant === 'root') return;
      layers = [layer('page', page, false), layer('sidebar', { x: 6, y: 6, width: sidebarWidth, height: H - 12 }, variant === 'blur'), layer('bar', { x: 6, y: 6, width: W - 12, height: 72 }, false)];
      const app = document.querySelector('.app');   // under .app, where every other named layer lives and the setup guard (R4-50) can see it
      if (!app) return;
      for (const l of layers) app.appendChild(l);
    });
    running = transition;
    // Skipping it (the guard below, or abortEdgeWarm when an edge, a prime or a toggle starts) rejects `ready` with an AbortError: consumed here, or the console reports "Uncaught (in promise) AbortError: Transition was skipped".
    void transition.ready?.then(() => {}, () => {});
    guard = window.setTimeout(() => { try { transition.skipTransition(); } catch { /* over */ } finish(); }, 900);
    void transition.finished.then(finish, finish);
  } catch { finish(); }
}
/** Once per window: at idle, a while after launch. Returns the cleanup for the effect that calls it. */
export function scheduleEdgeWarm(world: WarmWorld, firstDelay = 2500, retryDelay = 2000, tries = 60): () => void {
  if (state !== 'idle') return () => {};
  const variant = warmVariant();
  if (variant === 'off') { state = 'done'; return () => {}; }
  state = 'scheduled';
  let timer = 0, attempt = 0;
  const attemptNow = () => {
    if (state !== 'scheduled') return;
    if (ready(world)) { play(variant, world); return; }
    if (++attempt >= tries) { state = 'done'; return; }
    timer = window.setTimeout(idle, retryDelay);
  };
  const idle = () => { const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback; if (ric) ric(attemptNow, { timeout: 3000 }); else attemptNow(); };
  timer = window.setTimeout(idle, firstDelay);
  const letGo = () => abortEdgeWarm();
  document.addEventListener('acira-transition-start', letGo);
  return () => { window.clearTimeout(timer); document.removeEventListener('acira-transition-start', letGo); if (state === 'scheduled') state = 'idle'; abortEdgeWarm(); };
}
/** For tests: forget everything. */
export function resetEdgeWarm(): void { window.clearTimeout(guard); for (const l of layers) l.remove(); layers = []; running = null; state = 'idle'; delete root().dataset.edgeWarming; }
