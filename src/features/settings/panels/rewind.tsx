import { useEffect, useState } from 'react';
import { rewind, rewindAvailable, type RewindState } from '../../rewind/client';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel, SettingsPanelProps } from '../panels';

import { t } from '../../../i18n';
const days = [{ value: 1, label: t("rewind.1Day") }, { value: 3, label: t("rewind.3Days") }, { value: 7, label: t("rewind.7Days") }] as const;

/** Rewind on/off, retention and delete-now. Changes apply instantly (bible §5.6). */
function RewindSettings({ state, dispatch }: SettingsPanelProps) {
  const [data, setData] = useState<RewindState | null>(null), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const isPrivate = Boolean(state.browserProfiles.find(p => p.id === state.activeBrowserProfileId)?.private);
  useEffect(() => { if (rewindAvailable() && !isPrivate) void rewind({ type: 'rewind.list' }).then(setData, failure => setError(String(failure?.message ?? failure))); }, [isPrivate, state.activeBrowserProfileId]);
  if (!rewindAvailable() || isPrivate) return null;
  const apply = (patch: { enabled?: boolean; days?: number }) => { setError(''); void rewind({ type: 'rewind.settings', ...patch }).then(setData, failure => setError(String(failure?.message ?? failure))); };
  // What a delete would remove: the closed tabs, and the windows that were saved (one per window of a run, however many states it has).
  const tabs = data?.closedTabs ?? 0, windows = new Set((data?.checkpoints ?? []).map(item => `${item.sessionId}|${item.windowId}`)).size, count = tabs + windows;
  return <SettingGroup title={t("browsermenu.rewind")}>
    <SettingRow id="rewind-enabled" title={t("browsermenu.rewind")} detail={t("rewind.settingsDetail")}>
      <Switch checked={data?.enabled ?? true} disabled={!data} label={t("browsermenu.rewind")} onChange={enabled => apply({ enabled })}/>
    </SettingRow>
    <SettingRow id="rewind-retention" title={t("rewind.keepFor")} detail={t("rewind.keepForDetail")}>
      <Select value={data?.days ?? 7} disabled={!data} label={t("rewind.keepFor")} options={days} onChange={value => apply({ days: value })}/>
    </SettingRow>
    <SettingRow id="rewind-clear" title={t("rewind.deleteHistory")} detail={count ? t('rewind.savedCounts', { tabs: t('plural.tabs', { count: tabs }), windows: t('rewind.countWindows', { count: windows }) }) : t('rewind.nothingSaved')}>
      {confirm ? <span className="rewind-confirm"><button type="button" className="btn" onClick={() => setConfirm(false)}>{t("ext.dlgCancel")}</button> <button type="button" className="btn danger" onClick={() => { setConfirm(false); void rewind({ type: 'rewind.clear' }).then(next => { setData(next); dispatch({ type: 'toast', text: t("rewind.historyDeleted") }); }); }}>{t('rewind.deleteCount', { count })}</button></span>
        : <button type="button" className="btn" disabled={!count} onClick={() => setConfirm(true)}>{t("pwp.deleteEllipsis")}</button>}
    </SettingRow>
    {error && <SettingNote>{error}</SettingNote>}
  </SettingGroup>;
}
const panel: SettingsPanel = { section: 'Tabs', order: 55, Component: RewindSettings };
export default panel;
