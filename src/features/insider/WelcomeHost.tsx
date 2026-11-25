import {useEffect} from 'react';
import {insiderCall,useFeedbackView} from '../../runtime/feedback';
import {claimWhatsNew} from '../updates/useUpdateReady';
import {openWelcome} from './insiderFlow';
import {runtime} from '../../runtime/client';
import {openKindNow,welcomeClaimedThisRun,welcomeHostAttempt} from './welcomeRun';

/** Beta 14: the one-time Beta 14 welcome. Main says whether this profile owes it (insider-service.cjs: the first 14.x run after 13.x or older, never for a profile made on 14.x, never again once seen); this asks main to
 * give THIS window the claim (only one window ever shows it), takes the release notes so the ordinary "What's new" pop-up does not come on top, and opens the welcome pop-up (Beta 14, src/features/welcome: the reference design's approved screen). It waits a moment after the window is up so it arrives calmly, and asks again until the window is visible.
 * The same for the REVEAL (the seal and card on their own): an Insider whose pass arrived when no welcome is owed (the Insider build's first-run activation had no answer during the welcome, or a new profile) sees it once.
 * D126: the reveal comes only when no other popup is showing and the release notes' own popup is not still to come (What's new first, the reveal when it is closed); if a different popup replaces it before the seal was shown it is asked again once the way is free; if the person closes it, it is not asked again in this run. */
export function WelcomeHost({ hold = false }: { hold?: boolean } = {}) {
  const isWindow = !new URLSearchParams(location.search).get('view');
  // `hold`: the first-run setup (or a sign-in) is on screen: a FRESH install owes the welcome too (public 14.4), and it must not open over the setup dialog; it waits until the setup is done, then comes as it always does
  const view = useFeedbackView(isWindow ? 'welcome' : null), owed = isWindow && !hold && view.insider.welcome.owed, reveal = isWindow && !hold && !owed && view.insider.reveal && !welcomeClaimedThisRun();
  useEffect(() => {
    if (!owed && !reveal) return;
    let stopped = false, busy = false;
    const attempt = async () => {
      if (stopped || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        await welcomeHostAttempt({ owed, call: (request) => insiderCall(request) as Promise<{ claimed?: boolean }>, claimNotes: () => claimWhatsNew(), open: openWelcome, stopped: () => stopped, claimedNow: () => { stopped = true; }, popupKind: openKindNow, notesPending: () => runtime.service({ type: 'update.status' }).then((answer) => Boolean(answer.update?.whatsNew?.notes) && answer.update?.welcome === true), release: () => insiderCall({ type: 'insider.reveal-release' }) });
      } catch { /* asked again */ } finally { busy = false; }
    };
    const first = window.setTimeout(() => void attempt(), 1600), again = window.setInterval(() => void attempt(), 4000);
    document.addEventListener('visibilitychange', attempt);
    return () => { stopped = true; window.clearTimeout(first); window.clearInterval(again); document.removeEventListener('visibilitychange', attempt); };
  }, [owed, reveal]);
  return null;
}
