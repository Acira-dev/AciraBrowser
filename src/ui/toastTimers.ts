/** Each toast's auto-dismiss clock (bible §4 Transient surfaces). Every toast runs its own timer; holding the stack (the
 * pointer or keyboard focus inside it, like macOS Notification Center) or hiding the window pauses every timer, and
 * releasing resumes each one with the time it had left, never less than a short grace, so a toast never vanishes the
 * instant the pointer leaves it. Pure (the clock is injectable) so the pause/resume rules are tested without a page. */
export const TOAST_RESUME_GRACE = 1500;

export interface ToastClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  /** True while the window is hidden (document.hidden). */
  hidden(): boolean;
}

const pageClock: ToastClock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  hidden: () => typeof document !== 'undefined' && document.hidden,
};

export interface ToastTimers {
  /** Starts (or restarts) a toast's clock with `ms` to run; it waits while the stack is held or the window hidden. */
  arm(key: number, ms: number): void;
  /** Forgets a toast's clock (dismissed, dropped, or a toast that stays until dismissed). */
  clear(key: number): void;
  /** Pointer or focus entered (true) or left (false) the stack. */
  hold(held: boolean): void;
  /** Re-reads the window's visibility (call on visibilitychange). */
  visibility(): void;
  held(): boolean;
  /** Time a toast has left, counting a running clock; undefined when it has none. */
  left(key: number): number | undefined;
  running(key: number): boolean;
  dispose(): void;
}

export function createToastTimers(expire: (key: number) => void, clock: ToastClock = pageClock, grace = TOAST_RESUME_GRACE): ToastTimers {
  const timers = new Map<number, { timer?: unknown; left: number; started: number }>();
  let holding = false;
  const paused = () => holding || clock.hidden();
  const run = (key: number) => {
    const entry = timers.get(key); if (!entry || entry.timer !== undefined || paused()) return;
    entry.started = clock.now();
    entry.timer = clock.setTimeout(() => { if (timers.get(key) !== entry) return; timers.delete(key); expire(key); }, entry.left);
  };
  const pause = (key: number) => {
    const entry = timers.get(key); if (!entry || entry.timer === undefined) return;
    clock.clearTimeout(entry.timer); entry.timer = undefined;
    entry.left = Math.max(grace, entry.left - (clock.now() - entry.started));
  };
  const clear = (key: number) => { const entry = timers.get(key); if (entry?.timer !== undefined) clock.clearTimeout(entry.timer); timers.delete(key); };
  return {
    arm(key, ms) { clear(key); timers.set(key, { left: ms, started: 0 }); run(key); },
    clear,
    hold(held) { holding = held; for (const key of [...timers.keys()]) held ? pause(key) : run(key); },
    visibility() { for (const key of [...timers.keys()]) paused() ? pause(key) : run(key); },
    held: () => holding,
    left(key) { const entry = timers.get(key); if (!entry) return undefined; return entry.timer === undefined ? entry.left : Math.max(0, entry.left - (clock.now() - entry.started)); },
    running: key => timers.get(key)?.timer !== undefined,
    dispose() { for (const key of [...timers.keys()]) clear(key); },
  };
}
