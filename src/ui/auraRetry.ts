/**
 * Beta 14.4 (battery): when the interface stops asking main to play an owed aura (features/feedback/AuraTrigger.tsx).
 * Measured 24 Nov (14.3 at rest, one tab, a window that is not focused): the interface asked `feedback.aura-play` every 4 s for as long as the window stayed
 * unfocused (16 requests a minute, each with a frame loop while main answered), and main said no every time ('blurred'). Only the window becoming active can
 * change that answer, and main tells the interface when it does (`data-window-active`, desktop/main.cjs emitActive on focus and blur), so after such a no the
 * interface waits for that instead of asking again on a timer. Every other no ('popup', 'pointer', 'sharing', ...) is still asked again every 4 s, as before.
 */
/** The reasons only the window becoming active can end (desktop/feedback/aura-conditions.cjs: 'blurred', 'minimized'). */
export const AURA_WINDOW_REASONS: readonly string[] = ['blurred', 'minimized'];

/** Whether to stop the timed retries after main's answer: it said no for a window reason AND the interface sees the window inactive now
 * (`data-window-active` is 'false'; when it already reads active, the answer raced a focus and the timer goes on). */
export function auraWaitsForWindow(reasons: readonly string[] | undefined, windowActive: string | null): boolean {
  if (!Array.isArray(reasons) || !reasons.some(reason => AURA_WINDOW_REASONS.includes(reason))) return false;
  return windowActive === 'false';
}
