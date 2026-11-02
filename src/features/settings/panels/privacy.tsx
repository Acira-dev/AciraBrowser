import { isWindows } from '../../../ui/platform';
import './privacy.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../../../runtime/client';
import type { BrowsingDataCategory, BrowsingDataRange, BrowsingDataStatus, HttpsOnlyStatus, ProtectionRow, ProxyChoice, ProxyStatus } from '../../../runtime/nativeNetwork';
import type { NativeNetworkStatus } from '../../../runtime/nativeNetwork';
import { useConnection } from '../../connection/useConnection';
import { useT, t as tr } from '../../../i18n';
import { USAGE_COPY, useMetrics } from '../../metrics/useMetrics';
import {UsageOffNotice} from '../../metrics/UsageOffNotice';
import {UsageSent} from '../../metrics/UsageSent';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import { SecuredSettings } from '../../workspaces/SecuredSettings';
import type { SettingsPanel, SettingsPanelProps } from '../panels';

/** Privacy panels backed by the native protection services. Every row shows what the running browser really does. */

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : tr("connection.error.generic"));
const STATE_LABEL: Record<ProtectionRow['state'], string> = { on: tr("usage.on"), off: tr("usage.off"), optional: tr("usage.off"), system: tr("privacy.state.system"), unavailable: tr("privacy.state.unavailable"), preparing: tr("setup.gettingReady") };

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    let alive = true;
    load().then((next) => alive && (setValue(next), setError(''))).catch((reason) => alive && setError(message(reason)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { value, setValue, error, reload };
}

function Overview() {
  const { value, error } = useAsync(async () => (await runtime.service({ type: 'protection.status' })).protection, []);
  const active = value?.rows.filter((row) => row.state === 'on').length ?? 0;
  return (
    <SettingGroup>
      <SettingRow id="protection-overview" title={value ? (active ? tr("privacy.protectionIsOn") : tr("privacy.protectionIsOff")) : tr("privacy.protection")} detail={error || (value ? tr("privacy.protectionsActive", { count: active }) : tr("privacy.readingProtection"))} />
    </SettingGroup>
  );
}

function Cookies({ disabled }: { disabled: boolean }) {
  const { value, setValue, error } = useAsync(async () => (await runtime.service({ type: 'network.status' })).network, []);
  const [problem, setProblem] = useState('');
  const mode = value?.saved.cookies ?? 'block';
  const change = async (next: 'block' | 'allow') => {
    if (!value) return;
    setProblem('');
    try {
      const result = await runtime.service({ type: 'network.set', choice: { gpc: value.saved.gpc, dns: value.saved.dns, cookies: next } });
      if (result.network) setValue(result.network as NativeNetworkStatus);
    } catch (reason) { setProblem(message(reason)); }
  };
  const running = value?.engine?.thirdPartyCookies;
  return (
    <SettingGroup title={tr("privacy.cookies")}>
      <SettingRow id="third-party-cookies" title={tr("protection.cookies.title")} detail={tr("privacy.cookiesDetail")}>
        <Select label={tr("protection.cookies.title")} value={mode} disabled={disabled || !value} onChange={(next) => void change(next)} options={[{ value: 'block', label: tr("permission.block") }, { value: 'allow', label: tr("permission.allow") }]} />
      </SettingRow>
      {(error || problem) && <SettingNote>{error || problem}</SettingNote>}
      {value && running && running !== mode && <SettingNote>{tr(running === 'block' ? "privacy.restartCookiesBlocked" : "privacy.restartCookiesAllowed")}</SettingNote>}
    </SettingGroup>
  );
}

function ListUpdates({ disabled }: { disabled: boolean }) {
  const { value, setValue, error } = useAsync(async () => (await runtime.service({ type: 'filters.lists-status' })).filterLists, []);
  const [problem, setProblem] = useState('');
  const toggle = async (enabled: boolean) => {
    setProblem('');
    try { setValue((await runtime.service({ type: 'filters.lists-auto', enabled })).filterLists); } catch (reason) { setProblem(message(reason)); }
  };
  return (
    <SettingGroup title={tr("privacy.protectionLists")} fold>
      <SettingRow id="filter-lists-auto" title={tr("privacy.updateListsAutomatically")} detail={tr("privacy.listsDetail")}>
        <Switch label={tr("privacy.updateProtectionListsAutomatically")} checked={value?.automatic ?? true} disabled={disabled || !value} onChange={(next) => void toggle(next)} />
      </SettingRow>
      {(error || problem) && <SettingNote>{error || problem}</SettingNote>}
    </SettingGroup>
  );
}

function Https({ disabled }: { disabled: boolean }) {
  const { value, setValue, error } = useAsync(async () => (await runtime.service({ type: 'https.status' })).https as HttpsOnlyStatus | undefined, []);
  const [problem, setProblem] = useState('');
  const toggle = async (enabled: boolean) => {
    setProblem('');
    try { setValue({ profile: (await runtime.service({ type: 'https.set', enabled })).https as HttpsOnlyStatus['profile'] }); } catch (reason) { setProblem(message(reason)); }
  };
  return (
    <SettingGroup title={tr("privacy.secureConnections")}>
      <SettingRow id="https-only" title={tr("privacy.alwaysUseHttps")} detail={tr("privacy.httpsDetail")}>
        <Switch label={tr("privacy.alwaysUseHttps")} checked={Boolean(value?.profile?.enabled)} disabled={disabled || !value?.profile} onChange={(next) => void toggle(next)} />
      </SettingRow>
      {(error || problem) && <SettingNote>{error || problem}</SettingNote>}
    </SettingGroup>
  );
}

/** The proxy / VPN-app choice. Its home is Settings › Connection (panels/proxy.tsx renders it: R3-74); the code stays with the other native network panels. */
export function ProxySettings({ disabled: profileLocked }: { disabled: boolean }) {
  const c = useConnection();
  const root=useRef<HTMLDivElement>(null),retrying=useRef(false);
  useEffect(()=>{if(c.ready&&retrying.current){retrying.current=false;if(document.activeElement===document.body)root.current?.querySelector<HTMLElement>('button:not([disabled]),select:not([disabled])')?.focus({preventScroll:true});}},[c.ready]);
  const proxy = c.mode === 'proxy';
  // An extension that holds the profile's proxy (chrome.proxy.settings) wins over the person's choice until it lets go; the choice below stays saved.
  const held = c.controlledBy;
  const disabled = profileLocked || Boolean(held);
  const heldMode = held ? { direct: tr("connection.controlled.mode.direct"), system: tr("connection.controlled.mode.system"), auto_detect: tr("connection.controlled.mode.auto_detect"), pac_script: tr("connection.controlled.mode.pac_script"), fixed_servers: tr("connection.controlled.mode.fixed_servers") }[held.mode] : '';
  return (
    <div ref={root} style={{display:'contents'}}><SettingGroup title={tr("connection.proxyGroup")}>
      {!c.ready&&c.loading&&!c.problem&&<SettingNote><span role="status">{tr("local.loadingConnection")}</span></SettingNote>}
      {!c.ready&&c.problem&&<SettingNote><span role="alert">{c.problem}</span> <button type="button" className="st-button" disabled={disabled} aria-disabled={c.loading} aria-busy={c.loading} onClick={()=>{if(!c.loading){retrying.current=true;c.reload();}}}>{c.loading?tr("cleanup.checking"):tr("ne.tryAgain")}</button></SettingNote>}
      {held && (
        <SettingRow id="proxy-controlled" title={tr("connection.controlled.title", { name: held.name })} detail={tr("connection.controlled.detail", { name: held.name, mode: heldMode })} stacked>
          <button type="button" className="st-button primary" disabled={profileLocked || c.busy} onClick={() => void c.takeBack()}>{tr("connection.controlled.takeBack")}</button>
        </SettingRow>
      )}
      <SettingNote>{tr("privacy.aVpnOrProxyHides")}</SettingNote>
      {c.detected.length > 0 && <SettingNote>{tr("privacy.vpnDetected", { count: c.detected.length, names: c.detected.map((item) => item.name).join(' / ') })}</SettingNote>}
      <SettingRow id="proxy" title={tr("privacy.howThisProfileConnects")} detail={tr(proxy ? "privacy.proxyOnDetail" : "privacy.proxyVpnDetail")}>
        <Select label={tr("privacy.connection")} value={c.mode} disabled={disabled || !c.ready} onChange={c.setMode} options={[{ value: 'vpn', label: tr("privacy.useMyVpnApp") }, { value: 'proxy', label: tr("privacy.setUpAProxy") }]} />
      </SettingRow>
      {proxy && (
        <>
          <SettingRow title={tr("privacy.proxyType")} detail={tr("privacy.proxyTypeDetail")}>
            <Select label={tr("privacy.proxyType")} value={c.scheme} disabled={disabled} onChange={c.setScheme} options={[{ value: 'http', label: tr("privacy.httpOrHttps") }, { value: 'socks5', label: 'SOCKS5' }]} />
          </SettingRow>
          <SettingRow title={tr("acirasidebar.address")} detail={tr("privacy.addressDetail")}>
            <input className="st-input" aria-label={tr("privacy.proxyHost")} placeholder="proxy.example.com" value={c.host} disabled={disabled} onChange={(event) => c.setHost(event.target.value)} />
            <input className="st-input" style={{ width: 84, marginLeft: 8 }} aria-label={tr("privacy.proxyPort")} inputMode="numeric" placeholder="8080" value={c.port} disabled={disabled} onChange={(event) => c.setPort(event.target.value)} />
          </SettingRow>
          <SettingRow title={tr("privacy.test")} detail={tr("privacy.testDetail")}>
            <button type="button" className="st-button" disabled={disabled || c.busy || !c.valid} onClick={() => void c.runTest()}>{tr("privacy.testProxy")}</button>
          </SettingRow>
          {c.test && <SettingNote>{c.test.ok ? tr("privacy.works") : tr("privacy.problem")}{c.test.message}</SettingNote>}
        </>
      )}
      <SettingRow title={tr("privacy.apply2")} detail={c.status?.applied === false ? tr("privacy.applyDetail") : undefined}>
        <button type="button" className="st-button primary" disabled={disabled || c.busy || !c.ready || !c.valid} onClick={() => void c.apply()}>{tr("privacy.apply")}</button>
      </SettingRow>
      {((c.ready&&c.problem) || c.done) && <SettingNote>{c.problem || c.done}</SettingNote>}
      {c.providers.length > 0 && (
        <SettingRow title={tr("privacy.getAVpnApp")} detail={tr("privacy.vpnProvidersDetail")} stacked>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            {c.providers.map((provider) => <button key={provider.id} type="button" className="st-button" style={{ justifyContent: 'space-between', textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '6px 10px' }} onClick={() => c.openProvider(provider.url)}><span><strong>{provider.name}</strong> · {provider.note}</span></button>)}
          </div>
        </SettingRow>
      )}
      <SettingNote>{tr(isWindows()?"privacy.forAnonymityRatherThanA":"local.proxyVisibility")}</SettingNote>
    </SettingGroup></div>
  );
}

const CATEGORIES: { id: BrowsingDataCategory; title: string; detail: string }[] = [
  { id: 'history', title: tr("privacy.browsingHistory"), detail: tr("privacy.pagesYouVisitedAndThe") },
  { id: 'downloads', title: tr("privacy.downloadRecords"), detail: tr("privacy.theListOfDownloadsDownloaded") },
  { id: 'cookies', title: tr("privacy.cookies"), detail: tr("privacy.signsYouOutOfWebsites") },
  { id: 'storage', title: tr("privacy.siteStorage"), detail: tr("privacy.localStorageIndexeddbAndService") },
  { id: 'cache', title: tr("privacy.cachedFiles"), detail: tr("privacy.imagesAndFilesSavedTo") },
];
const RANGES: { value: BrowsingDataRange; label: string }[] = [
  { value: 'hour', label: tr("privacy.lastHour") }, { value: 'day', label: tr("privacy.last24Hours") }, { value: 'week', label: tr("privacy.last7Days") }, { value: 'month', label: tr("privacy.last4Weeks") }, { value: 'all', label: tr("privacy.allTime") },
];

function ClearData({ disabled }: { disabled: boolean }) {
  const { value } = useAsync(async () => (await runtime.service({ type: 'data.status' })).dataClear as BrowsingDataStatus | undefined, []);
  const [picked, setPicked] = useState<Set<BrowsingDataCategory>>(new Set(['history']));
  const [range, setRange] = useState<BrowsingDataRange>('all');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const chosen = [...picked];
  const allTimeOnly = chosen.some((id) => value && !value.capabilities[id].includes('hour'));
  const effective: BrowsingDataRange = allTimeOnly ? 'all' : range;
  const flip = (id: BrowsingDataCategory, on: boolean) => { setConfirming(false); setResult(''); setPicked((old) => { const next = new Set(old); if (on) next.add(id); else next.delete(id); return next; }); };
  const clear = async () => {
    setBusy(true); setResult('');
    try {
      const done = (await runtime.service({ type: 'data.clear', categories: chosen, range: effective })).dataCleared;
      const names = { history: tr("privacy.cleared.history"), downloads: tr("privacy.cleared.downloads"), cookies: tr("privacy.cleared.cookies"), storage: tr("privacy.cleared.storage"), cache: tr("privacy.cleared.cache") };
      setResult(done ? tr(done.reloadRequired ? "privacy.clearedResultReload" : "privacy.clearedResult", { categories: done.results.map((item) => names[item.category]).join(tr("privacy.cleared.separator")) }) : tr("forgetsitepanel.nothingWasCleared"));
    } catch (reason) { setResult(message(reason)); } finally { setBusy(false); setConfirming(false); }
  };
  return (
    <SettingGroup title={tr("privacy.clearBrowsingData")} fold>
      <SettingRow id="clear-browsing-data" title={tr("privacy.whatToClear")} detail={tr("privacy.clearNote")} />
      {CATEGORIES.map((category) => (
        <SettingRow key={category.id} title={category.title} detail={category.detail}>
          <Switch label={category.title} checked={picked.has(category.id)} disabled={disabled || !value} onChange={(on) => flip(category.id, on)} />
        </SettingRow>
      ))}
      <SettingRow id="clear-browsing-data-range" title={tr("privacy.timeRange")} detail={tr(allTimeOnly ? "privacy.timeRangeAllOnly" : "privacy.timeRangeShort")}>
        <Select label={tr("privacy.timeRange")} value={effective} disabled={disabled || !value || allTimeOnly} onChange={(next) => { setRange(next); setConfirming(false); }} options={RANGES} />
      </SettingRow>
      <SettingRow title={confirming ? tr("privacy.clearTheseNowThisCannot") : tr("privacy.clear")}>
        {confirming && <button type="button" className="st-button" disabled={busy} onClick={() => setConfirming(false)}>{tr("dialog.cancel")}</button>}
        <button type="button" className="st-button primary" style={{ marginLeft: confirming ? 8 : 0 }} disabled={disabled || busy || !chosen.length} onClick={() => (confirming ? void clear() : setConfirming(true))}>{confirming ? tr("privacy.clearData2") : tr("privacy.clearData")}</button>
      </SettingRow>
      {result && <SettingNote>{result}</SettingNote>}
    </SettingGroup>
  );
}

function Usage({ disabled }: { disabled: boolean }) {
  const t = useT();
  const m = useMetrics();
  const [shown, setShown] = useState(false);
  return (
    <SettingGroup title={t('usage.title')} fold>
      <SettingRow id="usage-metrics" title={USAGE_COPY.fact(m.enabled)} detail={USAGE_COPY.ask} info={t('help.usage')}>
        <Switch label={t('usage.switchLabel')} checked={m.enabled} disabled={disabled || !m.ready || m.busy} onChange={(next) => void m.set(next)} />
      </SettingRow>
      {m.status && !m.status.configured && <SettingNote>{t('usage.notConfigured')}</SettingNote>}
      {m.offNotice && <UsageOffNotice onClose={m.dismissOffNotice}/>}
      {m.enabled && <SettingRow id="usage-ratings" title={t('usage.askRatings')} detail={t('usage.askRatingsDetail')}>
        <Switch label={t('usage.askRatings')} checked={m.askRatings} disabled={disabled || !m.ready || m.busy} onChange={(next) => void m.setAskRatings(next)} />
      </SettingRow>}
      <SettingRow id="usage-metrics-payload" title={t('usage.seeSent')} detail={m.status ? (m.enabled ? USAGE_COPY.detail : t('usage.offDetail')) : undefined} stacked>
        <button type="button" className="st-button" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? t('usage.hide') : t('usage.show')}</button>
        {shown && m.status && <UsageSent status={m.status}/>}
        {shown && <pre className="st-payload" aria-label={t('usage.payloadLabel')}>{m.payloadText}</pre>}
        {shown && m.status && !m.status.configured && <SettingNote>{t('usage.notConfigured')}</SettingNote>}
      </SettingRow>
      {m.problem && <SettingNote>{m.problem}</SettingNote>}
    </SettingGroup>
  );
}

function PrivacyExtras({ state, dispatch }: SettingsPanelProps) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  const disabled = Boolean(profile?.private);
  return (
    <>
      <Overview />
      <Cookies disabled={disabled} />
      <Https disabled={disabled} />
      <SecuredSettings state={state} dispatch={dispatch} disabled={disabled} />
      <ListUpdates disabled={disabled} />
      <Usage disabled={disabled} />
      <ClearData disabled={disabled} />
    </>
  );
}

const panel: SettingsPanel = { section: 'Privacy', order: 20, Component: PrivacyExtras };
export default panel;
