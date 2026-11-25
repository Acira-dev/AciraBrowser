/* B14 Mini sidebar (AJ): the dock / undock / rail change is a MOVEMENT. During it the docked sidebar keeps the rail's transitions off (the rows must not fade their text in while the page glides:
 * miniRail.css `[data-mini-moving]`); once it has landed the docked sidebar is exactly the normal one, transitions included, so a rule of the rail never reaches a settled docked sidebar.
 * This file only sets and clears the attribute; it holds no state at rest and runs nothing between movements. Pure (the environment is passed in) so it is tested against fakes. */

/** Set on the sidebar element while it moves. */
export const MOVING_ATTR = 'data-mini-moving';
/** The root attributes that say a layout glide / sidebar morph / held page cut-out is still on (sharedMotion.ts, sidebarMorph.ts, chromeEdge.ts). */
export const MOVING_ROOT_ATTRS = ['data-mode-switch', 'data-sm-morph', 'data-sidebar-overlay'] as const;
/** Quiet animation frames in a row (no glide, no morph, no held cut-out) that end a movement. */
export const MOVE_QUIET_FRAMES = 2;
/** The longest a movement may keep the attribute on, whatever else is going on (ms): the net under a missed end. */
export const MOVE_MAX_MS = 1500;

export interface MoveElement { setAttribute(name: string, value: string): void; removeAttribute(name: string): void; hasAttribute(name: string): boolean }
export interface MoveEnv {
  root: { hasAttribute(name: string): boolean };
  frame(fn: () => void): void;
  after(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** Returns `move(el)`: call it when the sidebar docks, undocks or changes its rail. A newer movement takes over from an older one (rapid toggles end on the last one's landing). */
export function createMiniDockMove(env: MoveEnv): (el: MoveElement | null) => void {
  let seq = 0;
  let net: unknown = null;
  return (el) => {
    if (!el) return;
    const mine = ++seq;
    if (net !== null) env.cancel(net);
    el.setAttribute(MOVING_ATTR, '');
    let quiet = 0;
    const end = () => { if (mine !== seq) return; seq++; if (net !== null) { env.cancel(net); net = null; } el.removeAttribute(MOVING_ATTR); };
    const busy = () => MOVING_ROOT_ATTRS.some(name => env.root.hasAttribute(name));
    const tick = () => {
      if (mine !== seq) return;
      quiet = busy() ? 0 : quiet + 1;
      if (quiet >= MOVE_QUIET_FRAMES) end(); else env.frame(tick);
    };
    net = env.after(end, MOVE_MAX_MS);
    env.frame(tick);
  };
}

/** The browser's: animation frames and timers of the interface window. */
export const miniDockMove = createMiniDockMove({
  get root() { return document.documentElement; },
  frame: fn => { requestAnimationFrame(() => fn()); },
  after: (fn, ms) => window.setTimeout(fn, ms),
  cancel: handle => window.clearTimeout(handle as number),
});
