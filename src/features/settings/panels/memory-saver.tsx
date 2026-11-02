import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { SettingGroup, SettingRow, Select, Switch } from '../controls';
import { SiteListEditor } from '../SiteListEditor';
import '../native-core.css';

import { t } from '../../../i18n';
const MINUTES = [5, 15, 30, 60, 120, 240] as const;
const label = (minutes: number) => (minutes < 60 ? t('memorySaver.minutes', { count: minutes }) : t('memorySaver.hours', { count: minutes / 60 }));
const DEFAULTS = { enabled: true, idleMinutes: 15, neverSleep: [] as string[] };

/** Tabs that have been in the background a while are frozen, then put to sleep; sleeping tabs keep their place and reload when opened. */
function MemorySaver({ state, dispatch }: SettingsPanelProps) {
  const saved = { ...DEFAULTS, ...state.settings.memorySaver };
  const save = (patch: Partial<typeof DEFAULTS>) => dispatch({ type: 'settings.update', patch: { memorySaver: { ...saved, ...patch } } });
  const options = MINUTES.includes(saved.idleMinutes as (typeof MINUTES)[number]) ? MINUTES : [...MINUTES, saved.idleMinutes].sort((a, b) => a - b);
  return (
    <SettingGroup title={t("memorySaver.memorySaver")} id="memory-saver">
      <SettingRow id="memory-saver-enabled" title={t("nativeCore.putUnusedTabsToSleep")} detail={t("memorySaver.enabledDetail")}>
        <Switch label={t("nativeCore.putUnusedTabsToSleep")} checked={saved.enabled} onChange={(enabled) => save({ enabled })} />
      </SettingRow>
      <SettingRow id="memory-saver-after" title={t("nativeCore.sleepAfter")} detail={t("nativeCore.howLongATabCan")}>
        <Select label={t("nativeCore.sleepAfter")} value={saved.idleMinutes} disabled={!saved.enabled} options={options.map((value) => ({ value, label: label(value) }))} onChange={(idleMinutes) => save({ idleMinutes: Number(idleMinutes) })} />
      </SettingRow>
      <SettingRow id="memory-saver-sites" title={t("nativeCore.neverPutTheseSitesTo")} detail={t("sitelist.detail")} info={t("memorySaver.callsChatAndMusicSites")} stacked>
        <SiteListEditor sites={saved.neverSleep} label={t("nativeCore.neverPutTheseSitesTo")} disabled={!saved.enabled} onChange={(neverSleep) => save({ neverSleep })} />
      </SettingRow>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Tabs', order: 60, Component: MemorySaver };
export default panel;
