import { useCallback, useEffect, useState } from 'react';
import type { BrowserAction, TabSession } from '../../runtime/types';
import { TorGlyph } from './TorChip';
import { torProblem, torRequest } from './torClient';
import './tor.css';

import { t } from '../../i18n';

/** "Onion available" (Tor Browser's Onion-Location pill): a Tor tab on an https site whose response named its .onion address gets this chip in the address bar.
 * Choosing it opens the onion version in the same tab; the address comes from main, which only passes a v3 .onion address from a secure page. */
export function TorOnionChip({ tab, dispatch }: { tab: TabSession; dispatch: (action: BrowserAction) => void }) {
  if (!tab.onionLocation) return null;
  return <button type="button" className="tor-onion-chip" aria-label={t('tor.onion.open')} title={t('tor.onion.tooltip')} onClick={() => dispatch({ type: 'tab.navigate', tabId: tab.id, url: tab.onionLocation! })}>
    <TorGlyph size={14}/><span className="tor-onion-chip-label">{t('tor.onion.available')}</span>
  </button>;
}

/** "Prefer .onion versions" (Tor Browser's privacy.prioritizeonions.enabled): one Tor preference, read fresh and saved at once. Used by the Tor panel and Settings. */
export function useTorOnionPreference() {
  const [prefer, setPrefer] = useState<boolean | null>(null), [problem, setProblem] = useState('');
  useEffect(() => { let live = true; void torRequest<{ torOnion: { prefer: boolean } }>({ type: 'tor.onion-prefer' }).then(reply => { if (live) setPrefer(reply.torOnion.prefer); }, () => undefined); return () => { live = false; }; }, []);
  const choose = useCallback((next: boolean) => {
    setProblem('');
    return torRequest<{ torOnion: { prefer: boolean } }>({ type: 'tor.onion-prefer-set', prefer: next }).then(reply => setPrefer(reply.torOnion.prefer), error => setProblem(torProblem(error)));
  }, []);
  return { prefer, problem, choose };
}
