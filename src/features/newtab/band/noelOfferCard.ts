import { useEffect, useState } from 'react';
import { t, useT } from '../../../i18n';
import { OFFER_KEY, offerDue, readAnswer, writeAnswer } from '../../../season/noelOffer';
import type { BandCard, BandContext } from './types';

type Snow = 'sidebar' | 'window' | 'off';
/**
 * Noël's offer as the band's third source (band/types.ts): after the usage notice and the billboard, so it never pushes either away. Christmas red, the Noël snowflake, the snowfall
 * choice on the card itself (In the sidebar chosen), "Turn it on" and "Not now". Only "Turn it on" changes anything; "Not now" and the X answer it for this season (season/noelOffer.ts).
 */
export function useNoelOfferCard({ dispatch, noelOn }: BandContext): BandCard | null {
  useT();
  const [answered, setAnswered] = useState(readAnswer);
  const [snow, setSnow] = useState<Snow>('sidebar');
  useEffect(() => { const sync = () => setAnswered(readAnswer()); window.addEventListener(OFFER_KEY, sync); window.addEventListener('storage', sync); return () => { window.removeEventListener(OFFER_KEY, sync); window.removeEventListener('storage', sync); }; }, []);
  const now = new Date();
  if (!offerDue(now, noelOn === true, answered)) return null;
  const answer = () => { writeAnswer(new Date()); setAnswered(readAnswer()); };
  return {
    id: 'noel-offer', kind: 'noel', style: 'noel', eyebrow: t('noeloffer.eyebrow'), title: t('noeloffer.title'), body: t('noeloffer.body'), closeLabel: t('app.close'), onClose: answer,
    choice: { label: t('noelsettings.snow'), value: snow, onChange: value => setSnow(value as Snow), options: [{ id: 'sidebar', label: t('noelsettings.snowSidebar') }, { id: 'window', label: t('noelsettings.snowWindow') }, { id: 'off', label: t('noelsettings.snowOff') }] },
    actions: [
      { id: 'on', label: t('noeloffer.turnOn'), tone: 'primary', onClick: () => { answer(); dispatch({ type: 'settings.update', patch: { noelOn: true, noelSnow: snow } }); } },
      { id: 'later', label: t('noeloffer.notNow'), onClick: answer },
    ],
  };
}
