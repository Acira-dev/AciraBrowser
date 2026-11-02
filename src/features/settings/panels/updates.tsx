import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../../../runtime/client';
import type { UpdateStatus } from '../../../runtime/nativeNetwork';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel } from '../panels';
import { version as aciraVersion } from '../../../../package.json';
import { releaseVersion } from '../../../ui/releaseVersion';

import { t } from '../../../i18n';
const chromium = /Chrome\/(\d+)/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent)?.[1];

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Something went wrong.');

function describe(status?: UpdateStatus) {
  if (!status) return 'Reading update status…';
  switch (status.status) {
    case 'unsupported': return status.reason ?? 'Updates are not available here.';
    case 'checking': return 'Checking for updates…';
    case 'available': return `Version ${status.available} is available.`;
    case 'downloading': return `Downloading version ${status.available ?? ''}${status.progress ? ` · ${status.progress}%` : '…'}`;
    case 'ready': return `Version ${status.available} is ready. Restart to install it.`;
    case 'current': return 'Acira is up to date.';
    case 'error': return `Could not check for updates. ${status.error ?? ''}`;
    default: return 'Not checked yet.';
  }
}

function Updates() {
  const [status, setStatus] = useState<UpdateStatus>();
  const [problem, setProblem] = useState('');
  const refresh = useCallback(async () => { try { setStatus((await runtime.service({ type: 'update.status' })).update); } catch (reason) { setProblem(message(reason)); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!status || !['checking', 'downloading'].includes(status.status)) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [status, refresh]);
  const act = async (type: 'update.check' | 'update.download' | 'update.install') => {
    setProblem('');
    try { setStatus((await runtime.service({ type })).update); } catch (reason) { setProblem(message(reason)); }
  };
  const auto = async (enabled: boolean) => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'update.auto', enabled })).update); } catch (reason) { setProblem(message(reason)); }
  };
  const channel = async (value: 'stable' | 'beta') => {
    setProblem('');
    try { setStatus((await runtime.service({ type: 'update.channel', channel: value })).update); } catch (reason) { setProblem(message(reason)); }
  };
  const busy = status?.status === 'checking' || status?.status === 'downloading';
  return (
    <SettingGroup title={t("updates.updates")}>
      <SettingRow id="app-updates" title={t("updates.aciraAciraversionChromium", { aciraVersion: releaseVersion(aciraVersion), chromium: chromium ? ` (Chromium ${chromium})` : '' })} detail={describe(status)}>
        {status?.status === 'ready'
          ? <button type="button" className="st-button primary" onClick={() => void act('update.install')}>{t("updates.restartToUpdate")}</button>
          : status?.status === 'available'
            ? <button type="button" className="st-button primary" onClick={() => void act('update.download')}>{t("updates.download")}</button>
            : <button type="button" className="st-button" disabled={!status?.supported || busy} onClick={() => void act('update.check')}>{busy ? 'Checking…' : t("updates.checkForUpdates")}</button>}
      </SettingRow>
      <SettingRow id="app-updates-auto" title={t("updates.downloadUpdatesAutomatically")} detail="Checks at launch and every 8 hours. Installs when you restart.">
        <Switch label={t("updates.downloadUpdatesAutomatically")} checked={status?.autoDownload ?? true} disabled={!status?.supported} onChange={(next) => void auto(next)} />
      </SettingRow>
      <SettingRow id="app-updates-channel" title={t("updates.updateChannel")} detail={status?.channel === 'beta' ? 'Beta also gets pre-releases, earlier and less tested.' : 'Stable gets full releases only.'}>
        <Select label={t("updates.updateChannel")} value={status?.channel ?? 'stable'} disabled={!status?.supported} options={[{ value: 'stable', label: t("updates.stable") }, { value: 'beta', label: t("updates.beta") }]} onChange={(next) => void channel(next)} />
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
      <SettingNote>{t("updates.updatesComeFromGithubReleases")}</SettingNote>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 50, Component: Updates };
export default panel;
