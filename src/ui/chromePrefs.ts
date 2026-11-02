/** "Hide until needed" (UF-008) was a renderer-only localStorage flag. R3-68 retired it: Seamless is that, for both edges, and a
 * setting every window and every restart agrees on. This is what is left of it: read the old flag once, clear it, and let the
 * caller turn it into the Seamless default (runtime/windowView.ts `migrateAutoHide`). */
const KEY = 'acira-autohide-toolbar';

/** True when the old flag was on. Reading it removes it, so the migration happens once however many windows start. */
export function consumeLegacyAutoHide(): boolean {
  try {
    const was = localStorage.getItem(KEY) === '1';
    if (localStorage.getItem(KEY) !== null) localStorage.removeItem(KEY);
    return was;
  } catch { return false; }
}

/** The first-run tip for Seamless is shown once per profile. */
const TIP = 'acira-seamless-tip';
export function seamlessTipSeen(profileId: string): boolean {
  try { return localStorage.getItem(`${TIP}:${profileId}`) === '1'; } catch { return true; }
}
export function rememberSeamlessTip(profileId: string): void {
  try { localStorage.setItem(`${TIP}:${profileId}`, '1'); } catch { /* the tip may show again; harmless */ }
}
