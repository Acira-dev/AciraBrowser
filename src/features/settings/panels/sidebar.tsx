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

import { t } from '../../../i18n';
const ctrlTabDetail: Record<CtrlTabMode, string> = {
  next: 'Ctrl+Tab goes to the next tab and Ctrl+Shift+Tab to the previous one, skipping collapsed groups. Alt+T shows all your tabs.',
  recent: 'A quick Ctrl+Tab returns to the tab you used last; hold Ctrl to see your recent tabs. Ctrl+PageUp and Ctrl+PageDown follow the tab order.',
  viewer: 'Ctrl+Tab shows all your tabs, like Alt+T. Ctrl+PageUp and Ctrl+PageDown follow the tab order.',
};

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
      <SettingRow id="ctrl-tab" title={t("sidebar.ctrlTabSwitchesTo")} detail={ctrlTabDetail[ctrlTab]}>
        <Select<CtrlTabMode> label={t("sidebar.ctrlTabSwitchesTo")} value={ctrlTab} onChange={setCtrlTabMode} options={[{ value: 'next', label: t("sidebar.nextTab") }, { value: 'recent', label: t("sidebar.recentlyUsedTab") }, { value: 'viewer', label: t("core.showTabViewer") }]} />
      </SettingRow>
    </SettingGroup>
    <SettingGroup title={t("acirasidebar.sidebar")} id="sidebar">
      <SettingRow id="sidebar-visible" title={t("sidebar.showSidebar")} detail="The toolbar button and Ctrl+Shift+E show or hide it from anywhere.">
        <Switch label={t("sidebar.showSidebar")} checked={open} onChange={(next) => dispatch({ type: 'ui.update', patch: sidebarPatch(next) })} />
      </SettingRow>
      <SettingRow id="sidebar-shortcut" title={t("sidebar.ctrlSTogglesTheSidebar")} detail="With vertical tabs, Ctrl+S shows or hides the sidebar. Off: Ctrl+S saves the page.">
        <Switch label={t("sidebar.ctrlSTogglesTheSidebar")} checked={state.settings.sidebarShortcut !== false} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarShortcut: next } })} />
      </SettingRow>
      <SettingRow id="sidebar-apps" title={t("acirasidebar.favorites")} detail={apps.apps.length ? `Sites kept at the top of the sidebar: ${apps.apps.length} in this profile. Right-click one to edit or remove it. Ctrl+Shift+D adds the current page.` : 'Sites kept at the top of the sidebar. Ctrl+Shift+D adds the current page; you can also drag a tab or a link there.'}>
        <Switch label={t("sidebar.showFavoritesInTheSidebar")} checked={!apps.hidden} onChange={(next) => setSidebarAppsHidden(tab.browserProfileId, privateMode, !next)} />
      </SettingRow>
      <SettingRow id="sidebar-new-tabs-top" title={t("sidebar.newTabsAtTheTop")} detail="With sidebar-only tabs, new tabs appear at the top of the list, right under New tab. Off: they are added at the bottom.">
        <Switch label={t("sidebar.newTabsAtTheTop")} checked={rail.newTabsTop !== false} onChange={(next) => setRailPrefs({ newTabsTop: next, newTabsTopChosen: true }, tab.browserProfileId, privateMode)} />
      </SettingRow>
      <SettingRow id="sidebar-width" title={t("sidebar.width")} detail={`${width}px. Drag the sidebar edge to resize, between ${SIDEBAR_WIDTH.min} and ${SIDEBAR_WIDTH.max}px.`}>
        <button type="button" className="st-button" disabled={width === SIDEBAR_WIDTH.initial} onClick={() => dispatch({ type: 'settings.update', patch: { sidebarWidth: SIDEBAR_WIDTH.initial } })}>{t("sidebar.resetWidth")}</button>
      </SettingRow>
      <SettingRow id="sidebar-reset" title={t("sidebar.resetSidebarLayout")} detail="Shows the sidebar and its apps, restores the default width and moves tabs back to the top strip. Pinned apps are kept.">
        <button type="button" className="st-button" disabled={!changed} onClick={reset}>{t("browsersettings.reset")}</button>
      </SettingRow>
      {privateMode && <SettingNote>{t("sidebar.favoritesAddedInAPrivate")}</SettingNote>}
    </SettingGroup>
    <SettingGroup title={t("sidebar.sidebarSections")} id="sidebar-sections" bodyRef={sections} fold>
      {listed.map((id) => {
        const at = layout.order.indexOf(id), movable = at >= 0;
        return <SettingRow key={id} id={'sidebar-section-' + id} title={SECTION_NAMES[id]}>
          {movable && <>
            <button type="button" className="st-button st-icon-button" aria-label={t("sidebar.moveIdUp", { id: SECTION_NAMES[id] })} disabled={at === 0} onClick={() => save(moveSection(layout, id, at - 1))}><ArrowUp size={14} /></button>
            <button type="button" className="st-button st-icon-button flip" aria-label={t("sidebar.moveIdDown", { id: SECTION_NAMES[id] })} disabled={at === layout.order.length - 1} onClick={() => save(moveSection(layout, id, at + 1))}><ArrowUp size={14} /></button>
          </>}
          <Switch label={t("sidebar.showId", { id: SECTION_NAMES[id] })} checked={sectionShown(layout, id)} onChange={() => save(toggleSection(layout, id))} />
        </SettingRow>;
      })}
      <SettingRow id="sidebar-customize" title={t("sidebar.customizeInTheSidebar")} detail="Drag sections into order right where they are.">
        <button type="button" className="st-button" onClick={() => { if (!open) dispatch({ type: 'ui.update', patch: sidebarPatch(true) }); openSidebarCustomize(); }}>{t("browsersettings.customize")}</button>
      </SettingRow>
    </SettingGroup>
  </>);
}

const panel: SettingsPanel = { section: 'Tabs', order: 50, Component: SidebarSettings };
export default panel;
