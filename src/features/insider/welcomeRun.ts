/** D146: what the interface of this run knows about the one-time welcome, in one place that has no React and no Electron (tests/welcome-hold.test.ts).
 *
 *  Beta 14.0 and 14.1 lost the welcome for a member whose seal was still unseen (a code entered in 13.11, or any Insider whose pass arrived before the first 14.x start): the welcome marked itself seen the moment it OPENED, the host then
 *  saw "no welcome owed, a reveal owed" and asked the popup system to open the reveal, and the popup system answered an open of the kind that was already showing by CLOSING it (the toolbar buttons toggle). The welcome was on screen for
 *  about two seconds and never came back. So: (1) the welcome counts as seen only when the person ends it (desktop/insider/insider-service.cjs welcomeDone, sent from the welcome's own exit); (2) a run that claimed the welcome
 *  never also claims the reveal (its Gift step is the reveal); (3) an AUTOMATIC open never toggles a popup of the same kind closed. */
let claimed = false;

/** D126 (open since 14.0): the REVEAL (the seal and card on their own, a run with no welcome owed) was tried once and, when another popup replaced it before its Gift step, never came back in that run. This run's memory of its reveal:
 *  `revealOpen` it was opened here; `revealEnd` how it ended unseen, 'replaced' (a different popup took its place: ask again when the way is free) or 'closed' (the person closed it: not asked again in this run; the next start owes it once more). */
let revealOpen = false, revealEnd: 'replaced' | 'closed' | null = null, kindNow: string | null = null, notesWaited = 0;
/** How many of the host's attempts (about 4 s apart) the reveal waits for the release notes' popup: in a layout whose toolbar is hidden the notes' popup may not open at all, and the reveal must not wait for ever. */
export const NOTES_WAIT_ATTEMPTS = 3;
/** The popup kind showing now (App.tsx reports it on every render). Also notes how a reveal that was showing ended. */
export const noteOpenKind = (kind: string | null): void => {
  if (revealOpen && revealEnd === null && kindNow === 'welcome' && kind !== 'welcome') revealEnd = kind === null ? 'closed' : 'replaced';
  kindNow = kind;
};
export const openKindNow = (): string | null => kindNow;

/** This run's window took the welcome (main's claim answered yes). */
export const noteWelcomeClaimed = (): void => { claimed = true; };
/** True once this run's window took the welcome: nothing else of the welcome (the reveal) is claimed in this run. */
export const welcomeClaimedThisRun = (): boolean => claimed;
/** Tests only. */
export const resetWelcomeRun = (): void => { claimed = false; revealOpen = false; revealEnd = null; kindNow = null; notesWaited = 0; };

/** What the popup system does with a request to open `kind` when `openKind` is showing. `automatic`: the app asked (the welcome host), not the person. A person's second press of the same control closes it (a toggle);
 *  an automatic request for what is already showing changes nothing, and never closes it. */
export const automaticOpenAction = (openKind: string | null, kind: string, automatic: boolean): 'open' | 'keep' => (automatic && openKind === kind ? 'keep' : 'open');

export interface WelcomeHostDeps {
  /** True while the profile owes the welcome (the view's `insider.welcome.owed`); false: only the reveal can be owed. */
  owed: boolean;
  call: (request: { type: 'insider.welcome-claim' | 'insider.reveal-claim' }) => Promise<{ claimed?: boolean }>;
  /** The ordinary "What's new" popup is the welcome's second step: the welcome takes its notes. */
  claimNotes: () => Promise<unknown>;
  open: (flow: 'welcome' | 'reveal', automatic: boolean) => Promise<unknown>;
  /** The host's effect was cleaned up while main was answering. */
  stopped: () => boolean;
  /** Called the moment a WELCOME claim is won: the host stops asking. (A reveal is asked again until it is seen.) */
  claimedNow: () => void;
  /** D126: the popup kind showing now (default: none). */
  popupKind?: () => string | null;
  /** D126: whether the release notes' own popup ("What's new") is still to be shown (default: no). */
  notesPending?: () => Promise<boolean>;
  /** D126: gives this window's reveal claim back to main (default: nothing). */
  release?: () => Promise<unknown>;
}

/** One attempt of the welcome host (src/features/insider/WelcomeHost.tsx): asks main for the welcome (or, when none is owed, for the reveal) and opens the popup. Returns which one opened, or null.
 *  Never claims the reveal in a run that claimed the welcome (its Gift step shows the seal and card; a second open of the kind would close the first, D146). */
export async function welcomeHostAttempt(d: WelcomeHostDeps): Promise<'welcome' | 'reveal' | null> {
  if (d.owed) {
    const answer = await d.call({ type: 'insider.welcome-claim' });
    if (d.stopped() || !answer.claimed) return null;
    noteWelcomeClaimed(); d.claimedNow();
    await d.claimNotes().catch(() => false);
    await d.open('welcome', true);
    return 'welcome';
  }
  if (claimed) return null;
  const kind = d.popupKind ?? (() => kindNow);
  if (revealOpen) {
    if (revealEnd === 'closed') return null;                                   // the person closed it: not again in this run
    if (revealEnd === null) return null;                                       // still showing (or opening)
    revealOpen = false; revealEnd = null;                                      // another popup took its place: its claim goes back and it is asked again when the way is free
    try { await d.release?.(); } catch { /* the same window may claim again */ }
  }
  if (kind() !== null) return null;                                            // another popup is showing: the way is not free
  // The release notes come first: on the first launch after an update their popup opens at 1.2 s and the reveal waits for it to be closed (D126, 2).
  if (d.notesPending && notesWaited < NOTES_WAIT_ATTEMPTS && await d.notesPending().catch(() => false)) { notesWaited++; return null; }
  const answer = await d.call({ type: 'insider.reveal-claim' });
  if (d.stopped() || !answer.claimed) return null;
  revealOpen = true; revealEnd = null;
  await d.open('reveal', true);
  return 'reveal';
}
