import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import { TorCircuitGlyph } from './TorChip';
import { TorCircuitView } from './TorCircuit';
import { runTorCircuit, torCircuitShortcut } from './torClient';
import './tor.css';

import { t } from '../../i18n';

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

/** The Tor part of a Tor tab's site panel (Page information): Tor Browser keeps the circuit and "New Tor circuit for this site" beside the
 * site's identity, so they are here, under the identity row, on the shared panel rows (panels.css). */
export function TorSitePanel({ tab, dispatch, close }: { state: BrowserSnapshot; tab: TabSession; dispatch: (action: BrowserAction) => void; close: () => void }) {
  return <section className="tor-site" aria-label={t('tor.circuit.title')}>
    <div className="acira-menu-label tor-site-label">{t('tor.circuit.title')}</div>
    <TorCircuitView tabId={tab.id} host={hostOf(tab.url)}/>
    <button type="button" className="acira-menu-row tor-site-new" onClick={() => { void runTorCircuit(dispatch, tab.id); close(); }}>
      <TorCircuitGlyph className="acira-menu-icon"/><span className="acira-menu-title">{t('tor.circuit.new')}</span><span className="acira-menu-meta">{torCircuitShortcut()}</span>
    </button>
    <hr className="acira-menu-sep"/>
  </section>;
}
