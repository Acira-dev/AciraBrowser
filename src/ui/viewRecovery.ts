/**
 * What the interface does when it cannot draw itself (the error boundary in src/main.tsx).
 *
 * A render that throws is tried again in place first: the tree is mounted afresh with nothing on screen in between (no reload, no blank
 * view), which settles an error that came from a state change (another profile's Favorites, a hook count that differed). Only when that
 * fails twice within ten seconds does the view reload itself, twice a minute at most so a view that cannot start does not loop; after that
 * the error screen stays, with Reload view, and main is told so it takes the page views off the interface (see `interface-error`).
 * Before 13.3 there was no first step: every failure was a reload (a blank view for ~200 ms), and the third one within a minute left the
 * error screen up with the last page still drawn over it, so nothing on it could be clicked.
 */
export type RecoveryStep = 'retry' | 'reload' | 'stay';
export interface RecoveryLog { retries: number[]; reloads: number[] }

export const RETRY_WINDOW_MS = 10_000;
export const MAX_RETRIES = 2;
export const RELOAD_WINDOW_MS = 60_000;
export const MAX_RELOADS = 2;

/** The next step for a failure at `now`, and the log with it counted. Pure: the caller keeps the log (retries in memory, reloads in session storage). */
export function planRecovery(log: RecoveryLog, now: number): { step: RecoveryStep; log: RecoveryLog } {
  const retries = log.retries.filter(time => now - time < RETRY_WINDOW_MS);
  const reloads = log.reloads.filter(time => now - time < RELOAD_WINDOW_MS);
  if (retries.length < MAX_RETRIES) return { step: 'retry', log: { retries: [...retries, now], reloads } };
  if (reloads.length < MAX_RELOADS) return { step: 'reload', log: { retries, reloads: [...reloads, now] } };
  return { step: 'stay', log: { retries, reloads } };
}

/** The reload times kept in session storage (they must outlive the reload they count); anything unreadable counts as none. */
export function readReloads(raw: string | null): number[] {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((time): time is number => typeof time === 'number' && Number.isFinite(time)) : [];
  } catch { return []; }
}
