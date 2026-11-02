import { useEffect, useState } from 'react';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { TorMark, torMarkState } from './TorMark';
import { Disclosure, SwitchRow } from '../../components/PanelParts';
import { TorGlyph } from './TorChip';
import { useTorOnionPreference } from './TorOnion';
import { TorLevelControl, torLevelName, useTorLevel } from './TorLevel';
import { bookmarkInTorVault, refreshTorVault, useTorVault } from './torVaultClient';
import { shortcutFor, useShortcutKeys } from '../../ui/shortcutKeys';
import { newTorIdentity, retryTor, TOR_PROTECTS, TOR_PROMISE, torDownloadsActive, torError, torPhase, useTorStatus } from './torClient';
import './tor.css';

import { t } from '../../i18n';
const GlyphIdentity = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M12.5 1.8v3h-3"/></svg>;
const GlyphShield = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M8 1.8 3 3.6v4.1c0 3 2 5.2 5 6.5 3-1.3 5-3.5 5-6.5V3.6z"/><path d="m5.9 8 1.5 1.5L10.3 6.6"/></svg>;
const GlyphBookmark = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4.5 2.5h7v11L8 10.5l-3.5 3z"/></svg>;
const GlyphOut = () => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3"/><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/></svg>;

/** What the Tor chip opens: live status, what Tor does here, New Tor identity, and a link to the Tor page. No tab opens unless "Learn more" is chosen.
 * New Tor identity asks first, in this panel: one short paragraph of what will happen, then Cancel or New identity. The menu row and Ctrl+Shift+U open the panel
 * already asking (`intent="identity"`). One connection serves every Tor tab and window, so a new identity renews all of them. */
export function TorPopover({ state, dispatch, close, intent }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; close: () => void; intent?: 'identity' }) {
  useShortcutKeys();
  const status = useTorStatus(), phase = status?.state || 'starting', progress = status?.progress || 0;
  const [asking, setAsking] = useState(intent === 'identity'), [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  // Opened to ask while Tor is still connecting (Ctrl+Shift+U right after a Tor tab opens): show the status, and don't turn into a question the moment it connects.
  useEffect(() => { if (status && status.state !== 'ready') setAsking(false); }, [status]);
  const level = useTorLevel(), onion = useTorOnionPreference(), vault = useTorVault(), [saved, setSaved] = useState<string>(''), active = state.tabs.find(tab => tab.id === state.activeTabId), canBookmark: boolean = Boolean(vault?.enabled) && /^https?:\/\//i.test(active?.url || '');
  useEffect(() => { void refreshTorVault(); }, []); // the panel lives in the overlay page: read the switch fresh each time it opens
  const inTorWindow = Boolean(state.browserProfiles.find(profile => profile.id === state.activeBrowserProfileId)?.tor);
  const title = phase === 'ready' ? t('tor.label.connected') : phase === 'error' ? t('tor.pop.stopped') : t('tor.pop.connectingPct', { progress });
  const sub = phase === 'error' ? torError(status?.error ?? null).title : phase === 'ready' ? t('tor.pop.thisTab') : torPhase(status);
  const run = (work: () => Promise<unknown>, done: () => void) => { setBusy(true); setProblem(''); void work().then(done, (error: unknown) => setProblem(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('tor.vaultFailed'))).finally(() => setBusy(false)); }; // a failed identity stays on its question, with the reason, so Try again is one click
  if (asking && phase === 'ready') return <div className="tor-popover tor-popover-ask" role="alertdialog" aria-labelledby="tor-ask-title" aria-describedby="tor-ask-body" aria-busy={busy || undefined}>
    <div className="acira-menu-row acira-menu-row-identity">
      <GlyphIdentity/>
      <span className="acira-menu-title" id="tor-ask-title">{t('tor.identity.title')}</span><span/>
    </div>
    <p className="tor-pop-note" id="tor-ask-body">{t('tor.identity.body')}{torDownloadsActive(state) && <> {t('tor.identity.downloads')}</>}</p>
    {problem && <p className="tor-pop-note tor-pop-problem" role="alert">{problem}</p>}
    <div className="tor-pop-actions">
      <button type="button" className="acira-button acira-button-secondary" disabled={busy} onClick={() => setAsking(false)}>{t('ext.dlgCancel')}</button>
      <button type="button" className="acira-button acira-button-primary" autoFocus disabled={busy} onClick={() => run(() => newTorIdentity(), close)}>{busy ? t('tor.identity.working') : t('tor.identity.confirm')}</button>
    </div>
  </div>;
  return <div className="tor-popover" role="group" aria-label={t("app.torStatus")}>
    <div className="acira-menu-row acira-menu-row-identity" aria-live="polite">
      <span className="acira-menu-icon tor-pop-onion"><TorMark state={torMarkState(phase)} progress={progress} size={16} reducedMotion={state.settings.reducedMotion}/></span>
      <span className="acira-menu-title">{title}<span className="acira-menu-sub">{sub}</span></span><span/>
    </div>
    <p className="tor-pop-note">{phase === 'error' ? torError(status?.error ?? null).detail : `${TOR_PROMISE} ${TOR_PROTECTS}`}</p>
    {problem && <p className="tor-pop-note tor-pop-problem" role="alert">{problem}</p>}
    <hr className="acira-menu-sep"/>
    {phase === 'error'
      ? <button type="button" className="acira-menu-row" disabled={busy} onClick={() => run(retryTor, () => undefined)}><GlyphIdentity/><span className="acira-menu-title">{t("ne.tryAgain")}</span><span/></button>
      : <button type="button" className="acira-menu-row" disabled={busy || phase !== 'ready'} onClick={() => setAsking(true)}><GlyphIdentity/><span className="acira-menu-title">{t("tornewtab.newTorIdentity")}</span><span className="acira-menu-meta">{shortcutFor('tor-identity', 'Ctrl Shift U')}</span></button>}
    <Disclosure className="tor-level-row" title={t('tor.level.title')} icon={<GlyphShield/>} value={torLevelName(level.info?.level ?? 'standard')}><TorLevelControl variant="panel" model={level}/></Disclosure>
    <SwitchRow id="tor-onion-prefer" label={t('tor.onion.prefer')} checked={Boolean(onion.prefer)} disabled={onion.prefer === null} onChange={() => void onion.choose(!onion.prefer)} icon={<TorGlyph className="acira-menu-icon"/>}/>
    {onion.problem && <p className="tor-pop-note tor-pop-problem" role="alert">{onion.problem}</p>}
    <button type="button" className="acira-menu-row" disabled={busy || !canBookmark} title={vault?.enabled ? undefined : t("torpopover.turnOnKeepTorBookmarks")} onClick={() => run(() => bookmarkInTorVault().then(result => setSaved(result === 'already' ? t('tor.pop.alreadySaved') : t('cleanup.saved'))), () => undefined)}><GlyphBookmark/><span className="acira-menu-title">{t("app.bookmarkThisPage")}</span><span className="acira-menu-meta">{saved || (vault && !vault.enabled ? t('usage.off') : '')}</span></button>
    <button type="button" className="acira-menu-row" onClick={() => { dispatch(inTorWindow ? { type: 'tab.new' } : { type: 'tab.new', privacy: 'tor' }); close(); }}><GlyphOut/><span className="acira-menu-title">{t("protectedmedianotice.learnMore")}</span><span/></button>
  </div>;
}
