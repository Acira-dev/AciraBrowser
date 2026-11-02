import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream G · sidebar controls, rendered by `panels/sidebar.tsx` in the Tabs section. */
export default defineSettings('Tabs', [
  { id: 'ctrl-tab', title: t("sidebar.ctrlTabSwitchesTo"), group: 'Switching tabs', description: t("sidebar.nextTabLikeChromeThe"), aliases: ['ctrl tab', 'ctrl shift tab', 'next tab', 'previous tab', 'mru', 'recent tabs', 'recently used', 'tab switcher', 'tab viewer', 'alt tab', 'cycle tabs', 'last tab', 'switch tabs'] },
  { id: 'sidebar-visible', title: t("sidebar.showSidebar"), group: 'Sidebar', description: t("sidebar.showOrHideTheSidebar"), aliases: ['hide sidebar', 'collapse sidebar', 'side panel', 'rail', 'ctrl shift e'] },
  { id: 'sidebar-shortcut', title: t("sidebar.ctrlSTogglesTheSidebar"), group: 'Sidebar', description: t("sidebar.withVerticalTabsCtrlS"), aliases: ['ctrl s', 'save page', 'sidebar shortcut', 'keyboard', 'helium'] },
  { id: 'sidebar-apps', title: t("acirasidebar.favorites"), group: 'Sidebar', description: t("sidebar.sitesKeptAtTheTop"), aliases: ['favourites', 'sidebar apps', 'pinned sites', 'app icons', 'shortcuts', 'pinned apps', 'dia', 'essentials'] },
  { id: 'sidebar-new-tabs-top', title: t("sidebar.newTabsAtTheTop"), group: 'Sidebar', description: t("sidebar.openNewTabsAboveYour"), aliases: ['tab order', 'new tab position', 'top of list', 'reverse tabs'] },
  { id: 'sidebar-width', title: t("sidebar.sidebarWidth"), group: 'Sidebar', description: t("sidebar.resetTheSidebarToIts"), aliases: ['resize sidebar', 'wider', 'narrower', 'sidebar size'] },
  { id: 'sidebar-reset', title: t("sidebar.resetSidebarLayout"), group: 'Sidebar', description: t("sidebar.restoreSidebarVisibilityAppsWidth"), aliases: ['restore sidebar', 'default layout', 'reset tabs'] },
  { id: 'sidebar-section-tabs', title: t("sidebar.sidebarSections"), group: 'Sidebar sections', description: t("sidebar.showHideAndReorderTabs"), aliases: ['reorder sidebar', 'sidebar order', 'hide history in sidebar', 'sections'] },
  { id: 'sidebar-customize', title: t("sidebar.customizeInTheSidebar"), group: 'Sidebar sections', description: t("sidebar.editTheSectionsInThe"), aliases: ['customize sidebar'] },
]);
