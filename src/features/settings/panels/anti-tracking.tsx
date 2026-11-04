import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../../../runtime/client';
import type { AntiTrackingChoice, AntiTrackingStatus, SafeBrowsingStatus } from '../../../runtime/nativeNetwork';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { isMac } from '../../../ui/platform';

import { t, translateText } from '../../../i18n';
/** Anti-tracking beyond lists and phishing warnings (stream J). Backed by services `antitracking.*` and `safebrowsing.*`; every note comes from the running browser. */

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : t('connection.error.generic'));

function AntiTracking({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AntiTrackingStatus>();
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    runtime.service({ type: 'antitracking.status' }).then((result) => alive && setStatus(result.antiTracking)).catch((reason) => alive && setProblem(message(reason)));
    return () => { alive = false; };
  }, []);
  const change = useCallback(async (patch: Partial<AntiTrackingChoice>) => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'antitracking.set', patch })).antiTracking); } catch (reason) { setProblem(message(reason)); }
  }, []);
  const settings = status?.settings;
  return (
    <SettingGroup title={t("antiTracking.antiTracking")}>
      <SettingRow id="anti-cname" title={t("privacy.blockHiddenTrackers")} detail={status ? translateText(status.notes.cname) : t('antiTracking.cnameDetail')}>
        <Switch label={t("antiTracking.blockTrackersHiddenBehindA")} checked={settings?.cnameUncloaking ?? true} disabled={disabled || !settings} onChange={(next) => void change({ cnameUncloaking: next })} />
      </SettingRow>
      <SettingRow id="anti-redirects" title={t("privacy.skipTrackingRedirects")} detail={status ? translateText(status.notes.bounce) : t('privacy.redirects.on')}>
        <Switch label={t("privacy.skipTrackingRedirects")} checked={settings?.skipTrackingRedirects ?? true} disabled={disabled || !settings} onChange={(next) => void change({ skipTrackingRedirects: next })} />
      </SettingRow>
      <SettingRow id="anti-params" title={t("privacy.removeTrackingParameters")} detail={t('privacy.params.on')}>
        <Switch label={t("antiTracking.removeTrackingParametersFromLinks")} checked={settings?.stripTrackingParams ?? true} disabled={disabled || !settings} onChange={(next) => void change({ stripTrackingParams: next })} />
      </SettingRow>
      <SettingRow id="anti-amp" title={t("privacy.openOriginalPagesInsteadOf")} detail={t('antiTracking.ampDetail')}>
        <Switch label={t("privacy.openOriginalPagesInsteadOf")} checked={settings?.deAmp ?? true} disabled={disabled || !settings} onChange={(next) => void change({ deAmp: next })} />
      </SettingRow>
      <SettingRow id="anti-fingerprint" title={t("privacy.fingerprintProtection")} detail={status ? translateText(status.notes.fingerprint) : t('antiTracking.fingerprintDetail')}>
        <Select label={t("privacy.fingerprintProtection")} value={settings?.fingerprint ?? 'standard'} disabled={disabled || !settings} onChange={(next) => void change({ fingerprint: next })} options={[{ value: 'off', label: t('antiTracking.fingerprintOff') }, { value: 'standard', label: t("antiTracking.standard") }, { value: 'strict', label: t("antiTracking.strictCanBreakSites") }]} />
      </SettingRow>
      {settings?.fingerprint === 'strict' && <SettingNote>{t("antiTracking.strictAlsoReportsGenericGraphics")}</SettingNote>}
      {problem && <SettingNote>{problem}</SettingNote>}
    </SettingGroup>
  );
}

const WORDS: Record<string, string> = {
  off: t('protection.phishing.off'),
  loading: t('antiTracking.listsLoading'),
  downloading: t('antiTracking.listsDownloading'),
  updating: t('antiTracking.listsUpdating'),
  stale: t('antiTracking.listsStale'),
};

/** The one switch for phishing and malware warnings (R4-07): its own row at the top of Privacy & security, with the same name and
 * explanation as setup's Privacy step, reading and writing the same `phishingLists` choice through `antitracking.set`. */
export function PhishingProtection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AntiTrackingStatus>();
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    runtime.service({ type: 'antitracking.status' }).then((result) => alive && setStatus(result.antiTracking)).catch((reason) => alive && setProblem(message(reason)));
    return () => { alive = false; };
  }, []);
  const lists = status?.stats.threats;
  const total = lists?.lists.reduce((sum, item) => sum + item.entries, 0) ?? 0;
  const detail = !status ? t('antiTracking.readingState')
    : !status.settings.phishingLists ? WORDS.off
    : lists?.state === 'error' ? t('antiTracking.listsFailed', { error: lists.lastError ?? t('protection.phishing.unknownError') })
    : lists && ['active', 'partial', 'updating', 'stale'].includes(lists.state) && total ? `${lists.state === 'stale' ? WORDS.stale + ' ' : ''}${t('antiTracking.listsActive', { count: total })}${lists.warned ? ' ' + t('antiTracking.listsWarned', { count: lists.warned }) : ''}`
    : WORDS[lists?.state ?? 'downloading'] ?? WORDS.downloading;
  const change = async (next: boolean) => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'antitracking.set', patch: { phishingLists: next } })).antiTracking); } catch (reason) { setProblem(message(reason)); }
  };
  return (
    <SettingGroup>
      <SettingRow id="phishing-lists" title={t("privacy.phishingProtection")} detail={detail} info={t("setup.phishing.info")}>
        <Switch label={t("privacy.phishingProtection")} checked={status?.settings.phishingLists ?? true} disabled={disabled || !status} onChange={(next) => void change(next)} />
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
    </SettingGroup>
  );
}

function PhishingLists({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AntiTrackingStatus>();
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    runtime.service({ type: 'antitracking.status' }).then((result) => alive && setStatus(result.antiTracking)).catch((reason) => alive && setProblem(message(reason)));
    return () => { alive = false; };
  }, []);
  const changePage = async (next: boolean) => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'antitracking.set', patch: { pageWarnings: next } })).antiTracking); } catch (reason) { setProblem(message(reason)); }
  };
  return (
    <SettingGroup title={t("antiTracking.phishingAndMalware")}>
      <SettingRow id="page-warnings" title={t("privacy.warnAboutScamPages")} detail={isMac() ? t('antiTracking.pageWarningsDetailMac') : t('antiTracking.pageWarningsDetail')}>
        <Switch label={t("privacy.warnAboutScamPages")} checked={status?.settings.pageWarnings ?? true} disabled={disabled || !status} onChange={(next) => void changePage(next)} />
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
      <SettingNote>{t("antiTracking.usesThreePublicListsDownloaded")}</SettingNote>
    </SettingGroup>
  );
}

/** "Passkeys and security keys" (28 Oct): off for everyone until they turn it on. Reads and writes the `passkeys` choice through `antitracking.set`; the passkey guard
 * in every web frame asks the main process at each call, so turning it off applies to open pages at once. Pages loaded while it was off carry a Permissions-Policy
 * header denying passkeys (the engine's own backstop), so turning it on reaches them after a reload: the note says so. */
function Passkeys({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AntiTrackingStatus>();
  const [problem, setProblem] = useState('');
  const [justOn, setJustOn] = useState(false);
  useEffect(() => {
    let alive = true;
    runtime.service({ type: 'antitracking.status' }).then((result) => alive && setStatus(result.antiTracking)).catch((reason) => alive && setProblem(message(reason)));
    return () => { alive = false; };
  }, []);
  const change = async (next: boolean) => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'antitracking.set', patch: { passkeys: next } })).antiTracking); setJustOn(next); } catch (reason) { setProblem(message(reason)); }
  };
  return (
    <SettingGroup>
      <SettingRow id="passkeys" title={t("privacy.passkeysAndSecurityKeys")} detail={t("privacy.passkeysDetail")}>
        <Switch label={t("privacy.passkeysAndSecurityKeys")} checked={status?.settings.passkeys ?? false} disabled={disabled || !status} onChange={(next) => void change(next)} />
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
      {justOn && !problem && <SettingNote>{t("privacy.passkeysReload")}</SettingNote>}
    </SettingGroup>
  );
}

function SafeBrowsing({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<SafeBrowsingStatus>();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let alive = true;
    runtime.service({ type: 'safebrowsing.status' }).then((result) => alive && setStatus(result.safeBrowsing)).catch((reason) => alive && setProblem(message(reason)));
    return () => { alive = false; };
  }, []);
  const run = async (request: { type: 'safebrowsing.set-key'; key: string } | { type: 'safebrowsing.clear-key' }) => {
    setBusy(true); setProblem('');
    try { setStatus((await runtime.service(request)).safeBrowsing); setKey(''); } catch (reason) { setProblem(message(reason)); } finally { setBusy(false); }
  };
  const detail = !status ? t('antiTracking.readingState')
    : status.state === 'off-no-key' ? t('antiTracking.safeBrowsingNoKey')
    : status.state === 'ready' ? t('antiTracking.safeBrowsingReady')
    : status.state === 'error' ? t('antiTracking.safeBrowsingError', { error: status.lastError ?? t('antiTracking.safeBrowsingListsFailed') })
    : t('protection.phishing.listDownloading');
  return (
    <SettingGroup title={t("antiTracking.googleSafeBrowsingOptional")} fold>
      <SettingRow id="safe-browsing-key" title={t("privacy.safeBrowsingWithYourOwn")} detail={detail} stacked>
        {status?.hasKey ? (
          <button type="button" className="st-button" disabled={disabled || busy} onClick={() => void run({ type: 'safebrowsing.clear-key' })}>{t("antiTracking.removeKey")}</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, width: '100%', minWidth: 0 }}>
            <input className="st-input" style={{ flex: 1, minWidth: 0 }} type="password" autoComplete="off" spellCheck={false} aria-label={t("antiTracking.googleSafeBrowsingApiKey")} placeholder={t("antiTracking.pasteYourGoogleSafeBrowsing")} value={key} disabled={disabled || busy} onChange={(event) => setKey(event.target.value)} />
            <button type="button" className="st-button primary" disabled={disabled || busy || !key.trim()} onClick={() => void run({ type: 'safebrowsing.set-key', key })}>{t("antiTracking.turnOn")}</button>
          </div>
        )}
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
      <SettingNote>{t("antiTracking.anExtraForPeopleWho")}</SettingNote>
    </SettingGroup>
  );
}

function Panel({ state }: SettingsPanelProps) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  const disabled = Boolean(profile?.private);
  return (
    <>
      <AntiTracking disabled={disabled} />
      <PhishingLists disabled={disabled} />
      {/* No passkey choice on a Mac: the guard answers there with no setting (passkey-guard-preload.cjs), so the switch did nothing. */}
      {!isMac() && <Passkeys disabled={disabled} />}
      <SafeBrowsing disabled={disabled} />
    </>
  );
}

const panel: SettingsPanel = { section: 'Privacy', order: 21, Component: Panel };
export default panel;
