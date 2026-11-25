// Beta 14.5 (EDICT, Windows: "the download popup flickers when you hover it while it is moving"): hovering the toast stack spreads it (`expanded`), the spread moves the cards and the stack's host, and the pointer, which has
// not moved, is then no longer over the stack for a moment: a pointer-leave 2 ms after the enter, the stack collapses, the pointer is over it again 270 ms later, it spreads again. The two answers cross the overlay
// view, main and the interface (toast-hold / toast-release) so the loop is a flicker of the whole stack.
// A leave that comes while the stack is still settling (it was entered, spread, or got or lost a card a moment ago) is held for a short grace: if the pointer is back over the stack by then nothing happened at all.
// A leave after the stack has been still for a while collapses it at once, as before.

/** A leave within this long after the stack was entered, spread or changed its cards is taken to be the stack moving under the pointer. */
export const toastSettleMs = 500;
/** How long such a leave waits for the pointer to be back before the stack lets go. */
export const toastLeaveGraceMs = 350;

export interface HoldGateClock { now(): number; setTimeout(run: () => void, ms: number): unknown; clearTimeout(timer: unknown): void; }
const pageClock: HoldGateClock = { now: () => performance.now(), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };

export interface HoldGate {
  /** The pointer or focus came onto the stack. */
  enter(): void;
  /** It left. Taken at once when the stack has been still, after the grace when the stack was still moving. */
  leave(): void;
  /** The stack spread, collapsed or changed its cards: it is moving. */
  moved(): void;
  /** The stack is gone: a leave still waiting is taken now. */
  dispose(): void;
  held(): boolean;
}

export function createHoldGate(apply: (held: boolean) => void, { clock = pageClock, settleMs = toastSettleMs, graceMs = toastLeaveGraceMs }: { clock?: HoldGateClock; settleMs?: number; graceMs?: number } = {}): HoldGate {
  let held = false, lastMove = -Infinity, waiting: unknown;
  const cancel = () => { if (waiting !== undefined) { clock.clearTimeout(waiting); waiting = undefined; } };
  const release = () => { cancel(); if (held) { held = false; apply(false); } };
  return {
    enter() { cancel(); lastMove = clock.now(); if (!held) { held = true; apply(true); } },
    leave() {
      if (!held || waiting !== undefined) return;
      if (clock.now() - lastMove < settleMs) waiting = clock.setTimeout(() => { waiting = undefined; release(); }, graceMs); else release();
    },
    moved() { lastMove = clock.now(); },
    dispose() { release(); },
    held: () => held,
  };
}
