// D193 (Beta 14.5): a sheet on the native material layer is hidden until main has acknowledged its material and then its content (`overlayReady(id, 'material')`, then `'content'`).
// Main answers false for a generation it does not hold (the host was re-made by a resize or a rescale, the popup moved on) and the sheet used to give up on the first false, for good:
// the popup stayed hidden (the Windows release check saw the workspace form hidden for 30 s). The wait is bounded the way the sheet's wait for its measured size is (`sizeWaitMs`):
// a false answer is asked again a few times, and when the bound passes the answer is `late`, the sheet shows its content on its dense plate (the 'opaque' provider) and tells main it did.

/** How long a sheet waits for main's two acknowledgements before it shows its content on the dense plate. A healthy answer takes a few milliseconds. */
export const nativeAckWaitMs = 250;
/** How long it waits between two asks after a false answer (main may only now be placing this generation). */
export const nativeAckRetryMs = 30;

export type NativeAck = 'acked' | 'late' | 'cancelled';
export interface NativeAckClock { now(): number; sleep(ms: number): Promise<void>; }
const pageClock: NativeAckClock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

/**
 * Asks for the 'material' acknowledgement and then the 'content' one. `ask` answers true (accepted), false (refused) or undefined (no such call in this runtime: nothing to wait for).
 * Returns 'acked' when both were accepted, 'late' when the bound passed first (an ask that is still running when it passes is not waited for), 'cancelled' when `cancelled()` says so.
 */
export async function awaitNativeAck(
  ask: (stage: 'material' | 'content') => Promise<boolean | undefined>,
  { cancelled = () => false, waitMs = nativeAckWaitMs, retryMs = nativeAckRetryMs, clock = pageClock }: { cancelled?: () => boolean; waitMs?: number; retryMs?: number; clock?: NativeAckClock } = {},
): Promise<NativeAck> {
  const until = clock.now() + waitMs;
  let over = false;   // the race is decided: a loop that is still running stops asking
  const bound = new Promise<'late'>(resolve => { void clock.sleep(Math.max(0, until - clock.now())).then(() => resolve('late')); });
  const run = async (): Promise<NativeAck> => {
    for (const stage of ['material', 'content'] as const) {
      for (;;) {
        if (over || cancelled()) return 'cancelled';
        const answer = await ask(stage).catch(() => false);
        if (over || cancelled()) return 'cancelled';
        if (answer !== false) break;
        if (clock.now() >= until) return 'late';
        await clock.sleep(retryMs);
      }
    }
    return 'acked';
  };
  const result = await Promise.race([run(), bound]);
  over = true;
  return result;
}
