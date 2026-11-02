import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import { setRailPrefs, useRailPrefs } from '../../../ui/railPrefs';
import { setSidebarAppsHidden, useSidebarApps } from '../../../ui/sidebarApps';
import { clampSidebarWidth, SIDEBAR_WIDTH } from '../../../ui/sidebarLayout';
import { sidebarPatch, workspaceIsOpen } from '../../../runtime/browserChrome';
import { useRef, useSyncExternalStore } from 'react';
import { useFlip } from '../../../ui/sharedMotion';
import { moveSection, openSidebarCustomize, saveSections, sectionLayout, sectionShown, SECTION_NAMES, toggleSection, type SectionId } from '../../../ui/sidebarSections';
import { ArrowUp } from '../../../components/AppIcons';
import { readCtrlTabMode, setCtrlTabMode, subscribeCtrlTabMode, type CtrlTabMode } from '../../../ui/tabMru';

import { t, translateText, type MessageId } from '../../../i18n';
const ctrlTabDetail: Record<CtrlTabMode, MessageId> = {
  next: 'sidebar.ctrlTabNextDetail',
  recent: 'sidebar.ctrlTabRecentDetail',
  viewer: 'sidebar.ctrlTabViewerDetail',
};
/** A sidebar section's name in the interface language (sidebarSections.ts keeps the English names). */
const sectionName = (id: SectionId) => translateText(SECTION_NAMES[id]);

/** Sidebar apps, width and a one-step reset. Sidebar-only tabs stays in C's Tabs group. */
function SidebarSettings({ state, dispatch }: SettingsPanelProps) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId) || state.tabs[0];
  const profile = state.browserProfiles.find((item) => item.id === tab.browserProfileId);
  const privateMode = !!profile?.private;
  const apps = useSidebarApps(tab.browserProfileId, privateMode);
  const rail = useRailPrefs(tab.browserProfileId, privateMode);
  const width = clampSidebarWidth(state.settings.sidebarWidth);
  const open = workspaceIsOpen(state.windowUi, tab);
  const changed = width !== SIDEBAR_WIDTH.initial || apps.hidden || rail.tabs || rail.newTabsTop === false || !open;
  const reset = () => {
    dispatch({ type: 'settings.update', patch: { sidebarWidth: SIDEBAR_WIDTH.initial } });
    if (!open) dispatch({ type: 'ui.update', patch: sidebarPatch(true) });
    setSidebarAppsHidden(tab.browserProfileId, privateMode, false);
    setRailPrefs({ tabs: false, newTabsTop: true, newTabsTopChosen: false }, tab.browserProfileId, privateMode);
    dispatch({ type: 'settings.update', patch: { verticalTabs: false } });
  };
  const ctrlTab = useSyncExternalStore(subscribeCtrlTabMode, readCtrlTabMode);
  const layout = sectionLayout(rail), listed: SectionId[] = ['favorites', 'pinned', ...layout.order];
  const save = (next: typeof layout) => saveSections(next, tab.browserProfileId, privateMode);
  // Rows swap places on the morph spring (R3-55).
  const sections = useRef<HTMLDivElement>(null);
  useFlip(sections, layout.order.join(','));
  return (<>
    <SettingGroup title={t("sidebar.switchingTabs")} id="tab-switching">
      <SettingRow id="ctrl-tab" title={t("sidebar.ctrlTabSwitchesTo")} detail={t(ctrlTabDetail[ctrlTab])}>
        <Select<CtrlTabMode> label={t("sidebar.ctrlTabSwitchesTo")} value={ctrlTab} onChange={setCtrlTabMode} options={[{ value: 'next', label: t("sidebar.nextTab") }, { value: 'recent', label: t("sidebar.recentlyUsedTab") }, { value: 'viewer', label: t("core.showTabViewer") }]} />
      </SettingRow>
    </SettingGroup>
    <SettingGroup title={t("acirasidebar.sidebar")} id="sidebar">
      <SettingRow id="sidebar-visible" title={t("sidebar.showSidebar")} detail={t("sidebar.showSidebarDetail")}>
        <Switch label={t("sidebar.showSidebar")} checked={open} onChange={(next) => dispatch({ type: 'ui.update', patch: sidebarPatch(next) })} />
      </SettingRow>
      <SettingRow id="sidebar-shortcut" title={t("sidebar.ctrlSTogglesTheSidebar")} detail={t("sidebar.ctrlSDetail")}>
        <Switch label={t("sidebar.ctrlSTogglesTheSidebar")} checked={state.settings.sidebarShortcut !== false} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarShortcut: next } })} />
      </SettingRow>
      <SettingRow id="sidebar-apps" title={t("acirasidebar.favorites")} detail={apps.apps.length ? t('sidebar.favoritesCountDetail', { count: apps.apps.length }) : t('sidebar.favoritesDetail')}>
        <Switch label={t("sidebar.showFavoritesInTheSidebar")} checked={!apps.hidden} onChange={(next) => setSidebarAppsHidden(tab.browserProfileId, privateMode, !next)} />
      </SettingRow>
      <SettingRow id="sidebar-new-tabs-top" title={t("sidebar.newTabsAtTheTop")} detail={t("sidebar.newTabsTopDetail")}>
        <Switch label={t("sidebar.newTabsAtTheTop")} checked={rail.newTabsTop !== false} onChange={(next) => setRailPrefs({ newTabsTop: next, newTabsTopChosen: true }, tab.browserProfileId, privateMode)} />
      </SettingRow>
      <SettingRow id="sidebar-width" title={t("sidebar.width")} detail={t('sidebar.widthDetail', { width, min: SIDEBAR_WIDTH.min, max: SIDEBAR_WIDTH.max })}>
        <button type="button" className="st-button" disabled={width === SIDEBAR_WIDTH.initial} onClick={() => dispatch({ type: 'settings.update', patch: { sidebarWidth: SIDEBAR_WIDTH.initial } })}>{t("sidebar.resetWidth")}</button>
      </SettingRow>
      <SettingRow id="sidebar-reset" title={t("sidebar.resetSidebarLayout")} detail={t("sidebar.resetLayoutDetail")}>
        <button type="button" className="st-button" disabled={!changed} onClick={reset}>{t("browsersettings.reset")}</button>
      </SettingRow>
      {privateMode && <SettingNote>{t("sidebar.favoritesAddedInAPrivate")}</SettingNote>}
    </SettingGroup>
    <SettingGroup title={t("sidebar.sidebarSections")} id="sidebar-sections" bodyRef={sections} fold>
      {listed.map((id) => {
        const at = layout.order.indexOf(id), movable = at >= 0;
        return <SettingRow key={id} id={'sidebar-section-' + id} title={sectionName(id)}>
          {movable && <>
            <button type="button" className="st-button st-icon-button" aria-label={t("sidebar.moveIdUp", { id: sectionName(id) })} disabled={at === 0} onClick={() => save(moveSection(layout, id, at - 1))}><ArrowUp size={14} /></button>
            <button type="button" className="st-button st-icon-button flip" aria-label={t("sidebar.moveIdDown", { id: sectionName(id) })} disabled={at === layout.order.length - 1} onClick={() => save(moveSection(layout, id, at + 1))}><ArrowUp size={14} /></button>
          </>}
          <Switch label={t("sidebar.showId", { id: sectionName(id) })} checked={sectionShown(layout, id)} onChange={() => save(toggleSection(layout, id))} />
        </SettingRow>;
      })}
      <SettingRow id="sidebar-customize" title={t("sidebar.customizeInTheSidebar")} detail={t("sidebar.customizeDetail")}>
        <button type="button" className="st-button" onClick={() => { if (!open) dispatch({ type: 'ui.update', patch: sidebarPatch(true) }); openSidebarCustomize(); }}>{t("browsersettings.customize")}</button>
      </SettingRow>
    </SettingGroup>
  </>);
}

const panel: SettingsPanel = { section: 'Tabs', order: 50, Component: SidebarSettings };
export default panel;
