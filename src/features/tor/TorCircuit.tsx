import { useEffect, useRef, useState } from 'react';
import { readTorCircuit, type TorCircuit, type TorHop } from './torClient';
import './tor.css';

import { t } from '../../i18n';

/** A country's name in the page's language from its two-letter code (tor's geoip table); '' when tor does not know the relay's country. */
export function countryName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return '';
  try { const name = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(code.toUpperCase()); return name && name.toUpperCase() !== code.toUpperCase() ? name : ''; } catch { return ''; }
}
const roleName = (role: TorHop['role']) => role === 'guard' ? t('tor.circuit.guard') : role === 'middle' ? t('tor.circuit.middle') : role === 'rendezvous' ? t('tor.circuit.rendezvous') : t('tor.circuit.exit');

/** The relays of the circuit this tab's site rides (Tor Browser's circuit display): this browser, guard, middle, exit, the site. Each relay shows its
 * country, nickname and address, read from tor's control port when the panel opens. A site that has not made its first stream yet shows a note and is
 * asked again for a few seconds. */
export function TorCircuitView({ tabId, host }: { tabId: string; host: string }) {
  const [circuit, setCircuit] = useState<TorCircuit | null>(null), [failed, setFailed] = useState(false), tries = useRef(0);
  useEffect(() => {
    let live = true, timer = 0;
    const load = (attempt: number) => readTorCircuit(tabId).then(
      next => { if (!live) return; tries.current = attempt; setCircuit(next); setFailed(false); if (next.pending && attempt < 6) timer = window.setTimeout(() => load(attempt + 1), 1500); },
      () => { if (live) setFailed(true); });
    void load(0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [tabId]);
  // While the circuit is being read (or the site has none yet and is asked again) the slot keeps the room the list will need, so the panel does not jump.
  if (failed && !circuit) return <p className="tor-circuit-note">{t('tor.circuit.unavailable')}</p>;
  if (!circuit) return <div className="tor-circuit-slot"><p className="tor-circuit-note" role="status">{t('tor.circuit.loading')}</p></div>;
  if (!circuit.hops.length) return circuit.pending && tries.current < 6 ? <div className="tor-circuit-slot"><p className="tor-circuit-note" role="status">{t('tor.circuit.loading')}</p></div> : <p className="tor-circuit-note" role="status">{t('tor.circuit.none')}</p>;
  return <>
    <ol className="tor-circuit" aria-label={t('tor.circuit.title')}>
      <li className="tor-hop tor-hop-end"><span className="tor-hop-dot" aria-hidden="true"/><span className="tor-hop-end-name">{t('tor.circuit.you')}</span></li>
      {circuit.hops.map((hop, index) => <li className="tor-hop" key={index} data-role={hop.role}>
        <span className="tor-hop-dot" aria-hidden="true"/>
        <span className="tor-hop-body">
          <span className="tor-hop-place">{countryName(hop.country) || t('tor.circuit.unknownCountry')}</span>
          <span className="tor-hop-detail">{[hop.nickname, hop.address].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="tor-hop-role">{roleName(hop.role)}</span>
      </li>)}
      <li className="tor-hop tor-hop-end"><span className="tor-hop-dot" aria-hidden="true"/><span className="tor-hop-end-name">{host}</span></li>
    </ol>
    {circuit.onion && <p className="tor-circuit-note">{t('tor.circuit.onion')}</p>}
  </>;
}
