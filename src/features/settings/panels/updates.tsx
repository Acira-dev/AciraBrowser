import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../../../runtime/client';
import type { UpdateStatus } from '../../../runtime/nativeNetwork';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel } from '../panels';
import { version as aciraVersion } from '../../../../package.json';
import { releaseVersion } from '../../../ui/releaseVersion';

import { t } from '../../../i18n';
import { describe, rowAction } from '../updateRow';
const chromium = /Chrome\/(\d+)/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent)?.[1];

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : t('connection.error.generic'));

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
  const refocus = useRef(false), rowButton = () => document.querySelector<HTMLButtonElement>('[data-setting="app-updates"] .st-control button');
  const act = async (type: 'update.check' | 'update.download' | 'update.pause' | 'update.resume' | 'update.install') => {
    setProblem('');
    // The row's button goes off while a download runs; a keyboard user gets it back, focused, when it ends.
    refocus.current = document.activeElement === rowButton();
    // A Mac's check is answered only when it is over (one to three seconds): say it is checking from the press, not afterwards.
    if (type === 'update.check') setStatus((current) => current && { ...current, status: 'checking', error: null });
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
  const busy = status?.status === 'checking' || status?.status === 'downloading', button = rowAction(status);
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === document.body) rowButton()?.focus();
  }, [busy]);
  return (
    <SettingGroup title={t("updates.updates")}>
      <SettingRow id="app-updates" title={t("updates.aciraAciraversionChromium", { aciraVersion: releaseVersion(aciraVersion), chromium: chromium ? ` (Chromium ${chromium})` : '' })} detail={describe(status)}>
        {button.action === 'update.install'
          ? <button type="button" className="st-button primary" onClick={() => void act('update.install')}>{t("updates.restartToUpdate")}</button>
          : button.action === 'update.resume'
            ? <button type="button" className="st-button primary" onClick={() => void act('update.resume')}>{t('updates.resume')}</button>
          : button.action === 'update.pause'
            ? <button type="button" className="st-button" onClick={() => void act('update.pause')}>{t('updates.pause')}</button>
          : button.action === 'update.download'
            ? <button type="button" className="st-button primary" disabled={button.disabled} onClick={() => void act('update.download')}>{t("updates.download")}</button>
            : <button type="button" className="st-button" disabled={button.disabled} onClick={() => void act('update.check')}>{t("updates.checkForUpdates")}</button>}
      </SettingRow>
      <SettingRow id="app-updates-auto" title={t("updates.downloadUpdatesAutomatically")} detail={t("updates.autoDetail")}>
        <Switch label={t("updates.downloadUpdatesAutomatically")} checked={status?.autoDownload ?? true} disabled={!status?.supported} onChange={(next) => void auto(next)} />
      </SettingRow>
      <SettingRow id="app-updates-channel" title={t("updates.updateChannel")} detail={status?.channel === 'beta' ? t('updates.betaDetail') : t('updates.stableDetail')}>
        <Select label={t("updates.updateChannel")} value={status?.channel ?? 'stable'} disabled={!status?.supported} options={[{ value: 'stable', label: t("updates.stable") }, { value: 'beta', label: t("updates.beta") }]} onChange={(next) => void channel(next)} />
      </SettingRow>
      {problem && <SettingNote>{problem}</SettingNote>}
      {status?.status === 'error' && status.error && <SettingNote>{t('import.technicalDetails')}: {status.error}</SettingNote>}
      <SettingNote>{t("updates.updatesComeFromGithubReleases")}</SettingNote>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 50, Component: Updates };
export default panel;
