import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { Select, SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import { setRailPrefs, useRailPrefs, type SidebarFolders } from '../../../ui/railPrefs';
import { setSidebarAppsHidden, setSidebarAppsLimit, setSidebarAppsPlace, useSidebarApps } from '../../../ui/sidebarApps';
import { STACK_LIMIT_CHOICES, stackLimitOf, type StackLimitChoice } from '../../../ui/favoritesStackLimit';
import { clampSidebarWidth } from '../../../ui/sidebarLayout';
import { sidebarSideOf } from '../../../ui/sidebarSide';
import { sidebarPatch, workspaceIsOpen } from '../../../runtime/browserChrome';
import { sidebarHeldOpenIn } from '../../../runtime/windowView';
import { favoriteTabsInList } from '../../../runtime/favoriteTabsRule';
import { shelfOn, sidebarOn } from '../../../runtime/shelf';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useFlip } from '../../../ui/sharedMotion';
import { moveSection, openSidebarCustomize, saveSections, sectionLayout, sectionLocked, sectionShown, SECTION_NAMES, toggleSection, type SectionId } from '../../../ui/sidebarSections';
import { ArrowUp } from '../../../components/AppIcons';
import { readCtrlTabMode, readCtrlTabShow, setCtrlTabMode, setCtrlTabShow, subscribeCtrlTabMode, type CtrlTabMode, type CtrlTabShow } from '../../../ui/tabMru';
import { SidebarPeekRow, SidebarRevealRow, SidebarSideRow } from '../SidebarRows';
import { SidebarClosedRow } from '../SidebarClosedRow';
import { SidebarSizeRow } from '../SidebarSizeRow';
import { SIDEBAR_RESET, sidebarLayoutChanged } from '../changed';
import { sidebarClosedOf } from '../../../runtime/miniSidebar';

import { t, translateText, type MessageId } from '../../../i18n';
const ctrlTabDetail: Record<CtrlTabMode, MessageId> = {
  next: 'sidebar.ctrlTabNextDetail',
  recent: 'sidebar.ctrlTabRecentDetail',
  viewer: 'sidebar.ctrlTabViewerDetail',
};
/** Beta 14: what shows while Ctrl is held after Ctrl+Tab. */
const ctrlTabShowDetail: Record<CtrlTabShow, MessageId> = {
  pictures: 'sidebar.ctrlTabShowPicturesDetail',
  names: 'sidebar.ctrlTabShowNamesDetail',
  nothing: 'sidebar.ctrlTabShowNothingDetail',
};
/** A sidebar section's name in the interface language (sidebarSections.ts keeps the English names). */
const sectionName = (id: SectionId) => translateText(SECTION_NAMES[id]);

/** Settings › Tabs › Sidebar: every sidebar choice in one place, right under the Tabs layout card (BrowserSettings puts it there):
 * show it, its size (Narrow, Standard or Wide), the side it stands on, the left edge, Favorites, new tabs, a reset, and below it the sections (show, hide, reorder).
 * The Window view stays in Appearance › Layout, which points here for the tabs layout, the side and the edge rows: each lives in one place. Where the address bar lives is the Tabs card above (the third layout). */
export function SidebarGroups({ state, dispatch }: SettingsPanelProps) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId) || state.tabs[0];
  const profile = state.browserProfiles.find((item) => item.id === tab.browserProfileId);
  const privateMode = !!profile?.private;
  const apps = useSidebarApps(tab.browserProfileId, privateMode);
  const rail = useRailPrefs(tab.browserProfileId, privateMode);
  const width = clampSidebarWidth(state.settings.sidebarWidth);
  const open = workspaceIsOpen(state.windowUi, tab);
  const noSidebar = !sidebarOn(state.settings), heldOpen = !noSidebar && sidebarHeldOpenIn(state.settings, state.windowUi);
  const side = sidebarSideOf(state.settings);
  const shelf = shelfOn(state.settings);
  const changed = sidebarLayoutChanged({ rail: state.settings.sidebarRail === true, width, side, reveal: state.settings.sidebarReveal, closed: sidebarClosedOf(state.settings), appsHidden: apps.hidden, appsPlace: apps.place === 'bottom' ? 'bottom' : 'top', appsLimit: stackLimitOf(apps.limit), favoriteTabsInList: state.settings.favoriteTabsInList, tabsInSidebar: Boolean(state.settings.verticalTabs) || rail.tabs, newTabsTop: rail.newTabsTop, folders: rail.folders, open });
  const reset = () => {
    const to = SIDEBAR_RESET;
    dispatch({ type: 'settings.update', patch: { sidebarWidth: to.settings.sidebarWidth, sidebarRail: false, sidebarSide: to.settings.sidebarSide, sidebarReveal: to.settings.sidebarReveal, sidebarClosed: to.settings.sidebarClosed, favoriteTabsInList: to.settings.favoriteTabsInList } });
    if (!open) dispatch({ type: 'ui.update', patch: sidebarPatch(to.shown) });
    setSidebarAppsHidden(tab.browserProfileId, privateMode, to.appsHidden);
    setSidebarAppsPlace(tab.browserProfileId, privateMode, to.appsPlace);
    setSidebarAppsLimit(tab.browserProfileId, privateMode, to.appsLimit as StackLimitChoice);
    setRailPrefs(to.rail, tab.browserProfileId, privateMode);
    dispatch({ type: 'settings.update', patch: { verticalTabs: to.settings.verticalTabs } });
  };
  // Beta 14: the Shelf (Top + sidebar) has no tab list: its sections are Favorites and the library ones, with a hidden list of their own, and the tab rows below are not offered.
  // The pinned extensions' row and the side panel sites' icons are blocks of Customize sidebar (top edge, list or off); the list here is the sections.
  const layout = sectionLayout(rail, shelf), inList: SectionId[] = layout.order.filter((id) => id !== 'extensions' && id !== 'sidepanel'), listed: SectionId[] = ['favorites', ...inList];
  const save = (next: typeof layout) => saveSections(next, tab.browserProfileId, privateMode, shelf);
  // Rows swap places on the morph spring (R3-55).
  const sections = useRef<HTMLDivElement>(null);
  useFlip(sections, layout.order.join(','));
  return (<>
    <SettingGroup title={t("acirasidebar.sidebar")} id="sidebar">
      <SidebarClosedRow state={state} dispatch={dispatch} />
      {/* Beta 14.4: always listed; where the sidebar cannot close (Sidebar + address in Full) or there is none (Along the top), it is off and says why. */}
      <SettingRow id="sidebar-visible" title={t("sidebar.showSidebar")} detail={noSidebar ? t('settings.reasonNoSidebar') : heldOpen ? t('settings.reasonSidebarHeldOpen') : t("sidebar.showSidebarDetail")}>
        <Switch label={t("sidebar.showSidebar")} checked={open} disabled={noSidebar || heldOpen} onChange={(next) => dispatch({ type: 'ui.update', patch: sidebarPatch(next) })} />
      </SettingRow>
      <SidebarSizeRow state={state} dispatch={dispatch} />
      <SidebarSideRow state={state} dispatch={dispatch} always />
      <SidebarPeekRow state={state} dispatch={dispatch} />
      <SidebarRevealRow state={state} dispatch={dispatch} />
      <SettingRow id="sidebar-shortcut" title={t("sidebar.ctrlSTogglesTheSidebar")} detail={t("sidebar.ctrlSDetail")}>
        <Switch label={t("sidebar.ctrlSTogglesTheSidebar")} checked={state.settings.sidebarShortcut !== false} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarShortcut: next } })} />
      </SettingRow>
      <SettingRow id="sidebar-new-tabs-top" title={t("sidebar.newTabsAtTheTop")} detail={shelf ? t('settings.reasonShelf') : t("sidebar.newTabsTopDetail")}>
        <Switch disabled={shelf} label={t("sidebar.newTabsAtTheTop")} checked={rail.newTabsTop !== false} onChange={(next) => setRailPrefs({ newTabsTop: next, newTabsTopChosen: true }, tab.browserProfileId, privateMode)} />
      </SettingRow>
      <SettingRow id="sidebar-folders" title={t("sidebar.tabGroups")} detail={shelf ? t('settings.reasonShelf') : t("sidebar.tabGroupsDetail")}>
        <Select<SidebarFolders> disabled={shelf} label={t("sidebar.tabGroups")} value={rail.folders ?? 'mixed'} onChange={(next) => setRailPrefs({ folders: next }, tab.browserProfileId, privateMode)}
          options={[{ value: 'mixed', label: t("sidebar.groupsWithTabs") }, { value: 'above', label: t("sidebar.groupsAbove") }, { value: 'below', label: t("sidebar.groupsBelow") }]} />
      </SettingRow>
      <SettingRow id="sidebar-reset" title={t("sidebar.resetSidebarLayout")} detail={t("sidebar.resetLayoutDetail")}>
        <button type="button" className="st-button" disabled={!changed} onClick={reset}>{t("browsersettings.reset")}</button>
      </SettingRow>
    </SettingGroup>
    <SettingGroup title={t("acirasidebar.favorites")} id="favorites">
      <SettingRow id="sidebar-apps" title={t("acirasidebar.favorites")} detail={apps.apps.length ? t('sidebar.favoritesCountDetail', { count: apps.apps.length }) : t('sidebar.favoritesDetail')}>
        <Select<'top' | 'bottom'> label={t("sidebar.favoritesPosition")} value={apps.place === 'bottom' ? 'bottom' : 'top'} disabled={apps.hidden} onChange={(place) => setSidebarAppsPlace(tab.browserProfileId, privateMode, place)} options={[{ value: 'top', label: t("sidebar.favoritesTop") }, { value: 'bottom', label: t("sidebar.favoritesBottom") }]} />
        <Switch label={t("sidebar.showFavoritesInTheSidebar")} checked={!apps.hidden} onChange={(next) => setSidebarAppsHidden(tab.browserProfileId, privateMode, !next)} />
      </SettingRow>
      {/* Beta 14, L1: how many places the Favorites grid has before the rest gather in the stack tile */}
      <SettingRow id="sidebar-apps-limit" title={t("sidebar.favoritesBeforeStack")} detail={apps.hidden ? t('settings.reasonFavoritesOff') : t("sidebar.favoritesBeforeStackDetail")}>
        <Select<StackLimitChoice> label={t("sidebar.favoritesBeforeStack")} value={stackLimitOf(apps.limit)} disabled={apps.hidden} onChange={(limit) => setSidebarAppsLimit(tab.browserProfileId, privateMode, limit)}
          options={[...STACK_LIMIT_CHOICES.map((value) => ({ value, label: String(value) })), { value: 'all' as const, label: t("sidebar.favoritesShowAll") }]} />
      </SettingRow>
      <SettingRow id="sidebar-apps-tabs" title={t("sidebar.favoriteTabsInList")} detail={shelf ? t('settings.reasonShelf') : apps.hidden ? t('settings.reasonFavoritesOff') : t("sidebar.favoriteTabsInListDetail")}>
        <Switch label={t("sidebar.favoriteTabsInList")} checked={favoriteTabsInList(state.settings)} disabled={shelf || apps.hidden} onChange={(next) => dispatch({ type: 'settings.update', patch: { favoriteTabsInList: next } })} />
      </SettingRow>
      {privateMode && <SettingNote>{t("sidebar.favoritesAddedInAPrivate")}</SettingNote>}
    </SettingGroup>
    <SettingGroup title={t("sidebar.sidebarSections")} id="sidebar-sections" bodyRef={sections} fold foldDetail={t("sidebar.showHideAndReorderTabs")}>
      {listed.map((id) => {
        const at = inList.indexOf(id), movable = at >= 0;
        return <SettingRow key={id} id={'sidebar-section-' + id} title={sectionName(id)}>
          {movable && <>
            <button type="button" className="st-button st-icon-button" aria-label={t("sidebar.moveIdUp", { id: sectionName(id) })} disabled={at === 0} onClick={() => save(moveSection(layout, id, layout.order.indexOf(inList[at - 1])))}><ArrowUp size={14} /></button>
            <button type="button" className="st-button st-icon-button flip" aria-label={t("sidebar.moveIdDown", { id: sectionName(id) })} disabled={at === inList.length - 1} onClick={() => save(moveSection(layout, id, layout.order.indexOf(inList[at + 1])))}><ArrowUp size={14} /></button>
          </>}
          <Switch label={t("sidebar.showId", { id: sectionName(id) })} checked={sectionShown(layout, id)} disabled={sectionLocked(id)} onChange={() => save(toggleSection(layout, id))} />
        </SettingRow>;
      })}
      <SettingRow id="sidebar-customize" title={t("sidebar.customizeInTheSidebar")} detail={t("sidebar.customizeDetail")}>
        <button type="button" className="st-button" onClick={() => { if (!open) dispatch({ type: 'ui.update', patch: sidebarPatch(true) }); openSidebarCustomize(); }}>{t("browsersettings.customize")}</button>
      </SettingRow>
    </SettingGroup>
  </>);
}

/** Tabs › Switching tabs: Ctrl+Tab, and the touchpad swipe the page passes in (Windows and Linux). */
export function SwitchingTabs({ children }: { children?: ReactNode }) {
  const ctrlTab = useSyncExternalStore(subscribeCtrlTabMode, readCtrlTabMode);
  const ctrlTabShow = useSyncExternalStore(subscribeCtrlTabMode, readCtrlTabShow);
  return (
    <SettingGroup title={t("sidebar.switchingTabs")} id="tab-switching">
      <SettingRow id="ctrl-tab" title={t("sidebar.ctrlTabSwitchesTo")} detail={t(ctrlTabDetail[ctrlTab])}>
        <Select<CtrlTabMode> label={t("sidebar.ctrlTabSwitchesTo")} value={ctrlTab} onChange={setCtrlTabMode} options={[{ value: 'next', label: t("sidebar.nextTab") }, { value: 'recent', label: t("sidebar.recentlyUsedTab") }, { value: 'viewer', label: t("core.showTabViewer") }]} />
      </SettingRow>
      <SettingRow id="ctrl-tab-show" title={t("sidebar.ctrlTabShow")} detail={ctrlTab === 'viewer' ? t('settings.reasonCtrlTabViewer') : t(ctrlTabShowDetail[ctrlTabShow])}>
        <Select<CtrlTabShow> label={t("sidebar.ctrlTabShow")} value={ctrlTabShow} disabled={ctrlTab === 'viewer'} onChange={setCtrlTabShow} options={[{ value: 'pictures', label: t("sidebar.ctrlTabShowPictures") }, { value: 'names', label: t("sidebar.ctrlTabShowNames") }, { value: 'nothing', label: t("sidebar.ctrlTabShowNothing") }]} />
      </SettingRow>
      {children}
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Tabs', order: 50, placed: true, Component: () => <SwitchingTabs /> };
export default panel;
