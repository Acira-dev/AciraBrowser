import { useState, type CSSProperties } from 'react';
import { TorMark, torMarkState } from './TorMark';
import { TorKept } from './TorKept';
import { connectWithBridge, newTorIdentity, nextTorBridge, retryTor, TOR_PROTECTS, TOR_PROMISE, torBridgeName, torError, torLabel, torPhase, useTorStatus, type TorStatus } from './torClient';
import './tor.css';

import { t } from '../../i18n';
const GlyphIdentity = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M12.5 1.8v3h-3"/></svg>;
const GlyphBridge = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M1.5 11.5h13"/><path d="M3 11.5V9a5 5 0 0 1 10 0v2.5"/><path d="M6 11.5V9.8M10 11.5V9.8"/></svg>;
const GlyphSettings = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>;

/** Tor looks blocked (tor-engine.cjs: no handshake with any relay yet, long after start), or gave up the way a blocked network
 *  makes it give up. Offline is told apart: a bridge can't help there. */
function blockedView(status: TorStatus | null) {
  if (!status) return null;
  const failed = status.state === 'error' && ['unreachable', 'timeout'].includes(status.error?.code || '');
  if (!status.blocked && !failed) return null;
  if (status.blocked?.offline) return { title: t('tor.blocked.offlineTitle'), detail: t('tor.blocked.offlineDetail'), next: null };
  const next = nextTorBridge(status), using = status.bridges?.type;
  if (!using) return { title: t('tor.blocked.title'), detail: t('tor.blocked.detail'), next };
  return { title: t('tor.blocked.bridgeTitle', { kind: torBridgeName(using) }), detail: next ? t('tor.blocked.bridgeDetail') : t('tor.blocked.lastDetail'), next };
}
const GlyphOut = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3"/><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/></svg>;
const blank = <span/>;

/** New tab in Tor: one panel on the shared panel system. Status first (real bootstrap progress), then what Tor does and does not
 * do here, then the actions. Nothing is hidden: the limits are rows like the rest. */
export function TorNewTab({ onNavigate, reducedMotion, downloading = false, onBridgeSettings }: { onNavigate: (url: string) => void; reducedMotion: boolean; /** A Tor download is running: New Tor identity would stop it, so the question says so. */ downloading?: boolean; /** Opens Settings › Connection › Bridges. */ onBridgeSettings?: () => void }) {
  const status = useTorStatus(), state = status?.state || 'starting', mark = torMarkState(state), progress = status?.progress || 0;
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const connecting = mark === 'connecting', blocked = blockedView(status);
  const err = torError(status?.error ?? null), title = blocked ? blocked.title : state === 'error' ? err.title : state === 'ready' ? t('tor.label.connected') : t('tor.page.connecting');
  const detail = blocked ? blocked.detail + (status?.retryInMs ? ' ' + t('tor.page.retrySoon') : '') : state === 'error' ? err.detail + (status?.retryInMs ? ' ' + t('tor.page.retrySoon') : '')
    : state === 'ready' ? t('tor.page.ready')
    : status?.slowRestarts ? t('tor.page.slow')
    : t(status?.firstConnection ? 'tor.page.waitFirst' : 'tor.page.wait', { phase: torPhase(status) });
  const via = status?.bridges ? ' · ' + t('tor.bridge.via', { kind: torBridgeName(status.bridges.type) }) : '';
  const run = (work: () => Promise<unknown>) => { setBusy(true); setProblem(''); void work().catch((error: unknown) => setProblem(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('tor.vaultFailed'))).finally(() => { setBusy(false); setConfirming(false); }); };
  return <main className="tor-page" aria-labelledby="tor-title">
    <div className="tor-column">
      <span className="tor-page-glyph"><TorMark state={mark} progress={progress} size={40} reducedMotion={reducedMotion} label={torLabel(status)}/></span>
      <h1 id="tor-title" className="display-page">{t("tornewtab.browsingThroughTor")}</h1>
      <p className="lede tor-lede">{TOR_PROMISE} {TOR_PROTECTS}</p>
      <section className="acira-panel tor-panel" data-state={state} aria-label={t("connection.tor")}>
        <div className="acira-menu-row acira-menu-row-identity" aria-live="polite">
          <span className="acira-menu-icon tor-pop-onion"><TorMark state={mark} progress={progress} size={16} reducedMotion={reducedMotion}/></span>
          <span className="acira-menu-title">{title}<span className="acira-menu-sub">{(connecting ? `${progress}%` : state === 'ready' ? 'Tor ' + (status?.version || '') : t("tornewtab.stopped")) + via}</span></span>
          {blank}
        </div>
        {connecting && <div className="tor-progress" role="progressbar" aria-label={torLabel(status)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ '--tor-progress': progress / 100 } as CSSProperties}/></div>}
        <p className="tor-pop-note">{detail}</p>
        {problem && <p className="tor-pop-note tor-pop-problem" role="alert">{problem}</p>}
        {blocked && <div className="tor-blocked" data-tor-blocked>
          {blocked.next && <button type="button" className="acira-menu-row" disabled={busy} onClick={() => run(() => connectWithBridge(blocked.next!))}><GlyphBridge/><span className="acira-menu-title">{status?.bridges ? t('tor.blocked.tryAnother') : t('tor.blocked.connectBridge')}</span><span className="acira-menu-value">{torBridgeName(blocked.next)}</span></button>}
          <button type="button" className="acira-menu-row" disabled={busy} onClick={() => run(retryTor)}><GlyphIdentity/><span className="acira-menu-title">{t("ne.tryAgain")}</span>{blank}</button>
          {onBridgeSettings && <button type="button" className="acira-menu-row" onClick={onBridgeSettings}><GlyphSettings/><span className="acira-menu-title">{t('tor.blocked.settings')}</span>{blank}</button>}
        </div>}
        <hr className="acira-menu-sep"/>
        <div className="acira-menu-row acira-menu-row-fact">{blank}<span className="acira-menu-title">{t("tornewtab.yourIpAddress")}</span><span className="acira-menu-value">{t("tornewtab.hiddenFromSites")}</span></div>
        <div className="acira-menu-row acira-menu-row-fact">{blank}<span className="acira-menu-title">{t("tornewtab.historyCookiesSiteData")}</span><span className="acira-menu-value">{t("tornewtab.goneAtClose")}</span></div>
        <div className="acira-menu-row acira-menu-row-fact">{blank}<span className="acira-menu-title">{t("ext.title")}</span><span className="acira-menu-value">{t("ext.stateOff")}</span></div>
        <div className="acira-menu-row acira-menu-row-fact">{blank}<span className="acira-menu-title">{t("tornewtab.browserFingerprint")}</span><span className="acira-menu-value">{t("tornewtab.notHidden")}</span></div>
        <hr className="acira-menu-sep"/>
        {state === 'error' && blocked ? null : state === 'error'
          ? <button type="button" className="acira-menu-row" disabled={busy} onClick={() => run(retryTor)}><GlyphIdentity/><span className="acira-menu-title">{t("ne.tryAgain")}</span>{blank}</button>
          : <button type="button" className="acira-menu-row" disabled={busy || state !== 'ready'} data-armed={confirming || undefined} onClick={() => confirming ? run(() => newTorIdentity()) : setConfirming(true)}><GlyphIdentity/><span className="acira-menu-title">{busy && confirming ? t("tor.identity.working") : confirming ? t("tornewtab.confirmCloseTorTabsClear") : t("tornewtab.newTorIdentity")}</span>{blank}</button>}
        {confirming && downloading && <p className="tor-pop-note">{t('tor.identity.downloads')}</p>}
        {confirming && <button type="button" className="acira-menu-row" disabled={busy} onClick={() => setConfirming(false)}>{blank}<span className="acira-menu-title">{t("ext.dlgCancel")}</span>{blank}</button>}
        <TorKept onNavigate={onNavigate} reducedMotion={reducedMotion}/>
      </section>
    </div>
  </main>;
}
