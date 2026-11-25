import { useEffect, useState } from 'react';
import { insiderCall, useFeedbackView } from '../../runtime/feedback';
import type { BrowserSnapshot } from '../../runtime/types';
import { Welcome } from './Welcome';
import { Viewer } from './Viewer';
import type { WelcomePath } from './welcomeContent';
import { memberCardData } from '../memberCard/useMemberCardData';
import { certificateTier } from '../feedback/sealNumbers';

/** Beta 14: the pop-up kind `welcome`. It is drawn in the overlay page (a page of its own), so what it is for travels through main like the Insider pop-up's screens do
 * (`insider.flow-set` / `insider.flow-take`, insider-service.cjs): 'welcome' is the one-time Beta 14 welcome, 'reveal' is the same screen starting on the Gift step for an Insider whose
 * pass arrived after the welcome. The mark and the card are the profile's own (its rank, or the Early Member mark): the member card's data, with the Insider's number and month from the signed certificate. */
export function WelcomePopup({ close, state }: { close: () => void; state: BrowserSnapshot }) {
  const view = useFeedbackView('welcome'), insider = view.insider;
  const [mode, setMode] = useState<'welcome' | 'reveal' | 'seal' | 'card' | null>(null);
  useEffect(() => { let alive = true; void insiderCall({ type: 'insider.flow-take' }).then((answer) => { if (alive) setMode(answer.flow === 'reveal' ? 'reveal' : answer.flow === 'seal' || answer.flow === 'card' ? answer.flow : 'welcome'); }).catch(() => { if (alive) setMode('welcome'); }); return () => { alive = false; }; }, []);
  // D146: the profile's flag is set when the PERSON ends the welcome (its own exit, `onEnd`), never when it opens: Beta 14.0 / 14.1 set it at once, so a welcome that something closed a second later was lost for good. The reveal is owed separately and marked when the Insider mark is shown.
  if (!mode) return null;   // the frame is invisible: nothing to hold open while main answers
  // what the profile's own card says (rank, name, month, number: the member card's data adapter, src/features/memberCard/useMemberCardData.ts); the words follow the rank: an Insider's or a Founding Contributor's own, otherwise Early Member's
  const profile = state.browserProfiles.find((p) => p.id === state.activeBrowserProfileId), card = memberCardData(view, profile?.name);
  // the seal's and the card's close-up (opened from the profile viewer): the Welcome's glass and its own way in and out, with just the one thing on it (Viewer.tsx)
  if (mode === 'seal' || mode === 'card') {
    const kind = view.rank ?? (view.mark ? 'early' : null);
    return <ViewerWhenKnown what={mode} close={close} speed={state.settings.animationSpeed} reduced={!!state.settings.reducedMotion} seal={kind ? { kind, number: kind === 'insider' || kind === 'founding' ? (insider.member?.number ?? null) : null } : null} card={card} />;
  }
  const rank = card?.rank ?? (insider.insider ? (certificateTier(insider.member?.number) ?? 'founding') : 'early');   // a certificate holder wears the Founding Contributor seal (reported 16 Nov 21:40); No. 101 and up is an Insider (public 14.4)
  const path: WelcomePath = rank === 'insider' || rank === 'founding' ? 'insider' : 'early';
  return <Welcome close={close} speed={state.settings.animationSpeed} reduced={!!state.settings.reducedMotion} path={path} activationPending={insider.activation === 'trying'}
    member={insider.member ? { number: insider.member.number } : null} card={card} mode={mode} onEnd={mode === 'welcome' ? () => void insiderCall({ type: 'insider.welcome-done' }) : undefined} onInsiderShown={() => void insiderCall({ type: 'insider.reveal-seen' })} />;
}

/** The close-up needs the profile's rank (or mark) and card; the page's view is there when the profile viewer opened it, and if it is not (a view still loading) the close-up waits a moment for it, then closes: it never shows
 * a seal or card that is not the profile's own, and never anything for a profile with no rank (a private window). */
function ViewerWhenKnown(props: React.ComponentProps<typeof Viewer>) {
  const known = props.what === 'seal' ? props.seal !== null : props.card !== null;
  useEffect(() => { if (known) return; const id = window.setTimeout(props.close, 2000); return () => window.clearTimeout(id); }, [known]); // eslint-disable-line react-hooks/exhaustive-deps
  return known ? <Viewer {...props} /> : null;
}
