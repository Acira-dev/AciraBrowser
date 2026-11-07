import { defineSettings, type SettingsEntry } from '../model';

import { t } from '../../../i18n';
const appearance = defineSettings('Appearance', [
  { id: 'sidebar-only-tabs', title: t("yours.tabs"), group: 'Layout', signpost: true, description: t("core.tabsInTheToolbarOr"), aliases: ['tab layout', 'layout', 'view', 'sidebar', 'side bar', 'sidebar view', 'toolbar view', 'sidebar only', 'toolbar only', 'sidebar-only tabs', 'vertical tabs', 'horizontal tabs', 'vertical', 'horizontal', 'tabs on the side', 'tabs on top', 'tabs along the top', 'tabs in the sidebar', 'tabs in the toolbar', 'tabs in a sidebar', 'side tabs', 'top tabs', 'left tabs', 'tab strip', 'tab bar', 'tab position', 'move tabs', 'arc style', 'rail'] },
  { id: 'appearance-mode', title: t("app.appearance"), group: 'Theme', description: t("core.lightDarkOrFollowYour"), aliases: ['theme', 'dark mode', 'light mode', 'night mode', 'color scheme', 'system theme', 'auto dark'] },
  { id: 'match-system-theme', title: t("systemtheme.title"), group: 'Theme', description: t("systemtheme.detail"), aliases: ['system theme', 'match system', 'follow system', 'desktop theme', 'gtk', 'qt', 'kde', 'gnome', 'accent', 'accent color', 'dark mode', 'light mode', 'auto dark'], when: 'system-theme' },
  { id: 'glass-finish', title: t("appearancecontrols.finish"), group: 'Theme', description: t("core.colorsTheWindowFrameTabs"), aliases: ['material', 'color', 'colour', 'tint', 'burgundy', 'silver', 'porcelain', 'glass', 'palette', 'accent'] },
  { id: 'bookmarks-bar', title: t("browsersettings.bookmarksBar"), group: 'Toolbar', description: t("core.showOnNewTabsAlways"), aliases: ['favorites bar', 'bookmark toolbar', 'show bookmarks', 'show bookmarks bar'] },
  { id: 'interface-size', title: t("browsersettings.interfaceSize"), group: 'Interface', description: t("core.sizeOfTabsToolbarSidebar"), aliases: ['ui scale', 'scaling', 'dpi', 'text size', 'font size', 'bigger', 'smaller', 'density', 'zoom interface'] },


  { id: 'animation-speed', title: t("browsersettings.animationSpeed"), group: 'Interface', description: t("core.howFastMenusAndPanelsMove"), aliases: ['animation', 'animations', 'motion', 'speed', 'premium', 'fast', 'slow', 'transitions', 'off'] },
  { id: 'window-view', title: t("windowview.title"), group: 'Layout', signpost: true, description: t("windowview.seamlessDetail"), aliases: ['toolbar', 'hide toolbar', 'autohide', 'auto hide', 'hide until needed', 'compact toolbar', 'compact', 'focus', 'focus mode', 'seamless', 'distraction free', 'minimal', 'one row', 'full screen page', 'zen', 'immersive', 'ctrl shift f', 'ctrl shift l', 'top bar', 'window view', 'view', 'layout', 'full', 'full view', 'compact view', 'focus view', 'seamless view', 'hide the toolbar'] },
  { id: 'seamless-edge-top', title: t("windowview.edgeTop"), group: 'Layout', description: t("windowview.seamlessDetail"), aliases: ['seamless', 'top edge', 'reveal toolbar', 'hover toolbar'] },
  { id: 'toolbar-showHome', title: t("core.showHomeButton"), group: 'Toolbar', description: t("core.homeButtonInTheToolbar"), aliases: ['home page', 'homepage'] },
  { id: 'toolbar-showTabOverview', title: t("core.showTabViewer"), group: 'Toolbar', description: t("core.tabViewerButtonInThe"), aliases: ['tab overview', 'tab switcher', 'all tabs'] },
  { id: 'toolbar-reset', title: t("browsersettings.resetToolbarControls"), group: 'Toolbar', description: t("core.restoreDefaultToolbarButtons"), aliases: ['customize toolbar', 'default toolbar', 'restore toolbar'], when: 'toolbar-changed' },

  { id: 'page-zoom', title: t("app.pageZoom"), group: 'Page zoom', description: t("core.makeOneWebsiteLargerOr"), aliases: ['zoom', 'magnify', 'text size', 'bigger', 'smaller', 'percentage', 'ctrl plus', 'ctrl minus'], when: 'website-open' },
  { id: 'page-zoom-site', title: t("browsersettings.websiteToZoom"), group: 'Page zoom', description: t("core.chooseWhichOpenWebsiteTo"), aliases: ['zoom site', 'zoom target'], when: 'website-open' },

  { id: 'glass-opacity', title: t("appearancecontrols.windowOpacity"), group: 'Colors', description: t("core.higherIsMoreSolid100"), aliases: ['opacity', 'transparency', 'translucent', 'see-through', 'blur', 'frosted', 'solid'], when: 'custom-glass-colors' },
  { id: 'surface-color', title: t("core.pages"), group: 'Colors', description: t("core.colorForAciraPagesAnd"), aliases: ['color', 'colour', 'background color', 'panel color'], when: 'custom-glass-colors' },
  { id: 'sidebar-color', title: t("core.sidebarAndFrameColor"), group: 'Colors', description: t("core.colorForTheSidebarAnd"), aliases: ['colour', 'sidebar tint', 'rail color'], when: 'custom-glass-colors' },
  { id: 'toolbar-color', title: t("core.toolbarColor"), group: 'Colors', description: t("core.colorForTheToolbarApart"), aliases: ['colour', 'toolbar tint', 'address bar color'], when: 'custom-glass-colors' },
  { id: 'tab-color', title: t("core.tabColor"), group: 'Colors', description: t("core.colorForTheTabStrip"), aliases: ['colour', 'tab tint', 'tab strip'], when: 'custom-glass-colors' },
  { id: 'reset-appearance', title: t("browsersettings.resetAppearance"), group: 'Reset', description: t("core.restoreTheDefaultFinishScale"), aliases: ['default appearance', 'restore defaults', 'reset theme'], when: 'appearance-changed' },
]);

const profiles = defineSettings('Profiles', [
  { id: 'profile-list', title: t("app.profiles"), description: t("core.separateSignInsBookmarksHistory"), aliases: ['accounts', 'switch profile', 'users', 'google account', 'sign in', 'person'] },
  { id: 'profile-create', title: t("browsersettings.addAProfile"), group: 'New profile', description: t("core.createANewSeparateProfile"), aliases: ['new profile', 'create profile', 'add user', 'work profile'] },
]);

const tabs = defineSettings('Tabs', [
  { id: 'compact-tab-titles', title: t("browsersettings.showTitlesInCompactTabs"), description: t("core.showPageTitlesInNarrow"), aliases: ['tab names', 'tab labels', 'tab text'] },
  { id: 'tab-viewer-density', title: t("browsersettings.allOpenTabsView"), description: t("core.comfortableRowsWithTheTitle"), aliases: ['tab viewer', 'your tabs', 'alt t', 'tab list', 'comfortable', 'compact'] },
  { id: 'ask-before-closing', title: t("closeGuard.askTitle"), description: t("closeGuard.askDetail"), aliases: ['confirm close', 'confirm quit', 'warn before closing', 'close all tabs', 'quit', 'exit', 'close browser', 'dont ask again', 'unsaved changes', 'leave site'] },
  { id: 'on-startup', title: t("onstartup.title"), description: t("onstartup.detail"), aliases: ['startup', 'start up', 'launch', 'open on start', 'restore tabs', 'restore windows', 'restore session', 'previous session', 'last session', 'continue where you left off', 'new tab on start', 'start fresh', 'reopen tabs'] },
  { id: 'link-preview', title: t("linkpreview.title"), description: t("linkpreview.detail"), aliases: ['peek', 'glance', 'preview link', 'link preview', 'search result preview', 'preview button', 'alt click', 'shift click', 'press and hold', 'floating preview'] },
  { id: 'open-tabs-in-front', title: t("tabsinfront.title"), description: t("tabsinfront.detail"), aliases: ['new tab in front', 'switch to new tab', 'background tab', 'foreground tab', 'tabs to the front', 'ctrl click', 'cmd click', 'middle click', 'open link in new tab'] },
  { id: 'tab-hover-card', title: t("tabhovercard.title"), description: t("tabhovercard.summary"), aliases: ['hover card', 'tab preview', 'tab thumbnail', 'page preview', 'thumbnail', 'tab tooltip', 'tab picture'] },
]);

const search = defineSettings('Search', [
  { id: 'search-engine', title: t("browsersettings.addressBarSearchEngine"), description: t("core.googleDuckduckgoOrBing"), aliases: ['default search', 'google', 'duckduckgo', 'bing', 'omnibox search', 'search provider'], when: 'stock-search' },
  { id: 'address-suggestions', title: t("browsersettings.localAddressSuggestions"), description: t("core.suggestTabsBookmarksAndHistory"), aliases: ['autocomplete', 'suggestions', 'omnibox', 'address bar', 'history suggestions', 'autofill'] },
]);

const privacy = defineSettings('Privacy', [
  { id: 'incognito', title: t("browsersettings.privateWindow"), group: 'Private browsing', description: t("core.openAWindowThatIs"), aliases: ['privacy', 'incognito', 'private browsing', 'inprivate'] },
  { id: 'block-ads-trackers', title: t("core.blockAdsAndTrackers"), group: 'Protection', description: t("core.builtInProtectionForThis"), aliases: ['adblock', 'ad block', 'tracker blocking', 'ublock', 'ghostery', 'content blocker', 'privacy', 'tracking protection'] },
  { id: 'cleanup-enabled', title: t("core.clearBrowsingDataOnExit"), group: 'Clear on exit', description: t("core.removeSelectedDataWhenAcira"), aliases: ['clear on exit', 'clear on close', 'delete on exit', 'auto clear', 'quit', 'close browser', 'forget'], when: 'regular-profile' },
  { id: 'cleanup-categories', title: t("core.dataToClear"), group: 'Clear on exit', description: t("core.cookiesSiteStorageHistoryAnd"), aliases: ['cookies', 'cache', 'site data', 'storage', 'history', 'permissions', 'clear history', 'clear cookies'], when: 'regular-profile' },
  { id: 'cleanup-keep-sites', title: t("core.sitesToKeep"), group: 'Clear on exit', description: t("core.sitesWhoseDataSurvivesCleanup"), aliases: ['exceptions', 'allow list', 'keep cookies', 'stay signed in', 'whitelist'], when: 'regular-profile' },
  { id: 'cleanup-help', title: t("core.howCleanupAndKeepSites"), group: 'Clear on exit', description: t("core.whatIsClearedAndWhat"), aliases: ['cleanup help', 'explain'], expand: 'cleanup-help', when: 'regular-profile' },
  { id: 'filters-ai', title: t("browsermenu.aiFreeMode"), group: 'Content filters', description: t("core.hideAiAnswersAndAi"), aliases: ['hide ai answers in search', 'what it hides', 'ai overviews', 'ai mode', 'gemini', 'ai answers', 'ai summaries', 'ai content', 'no ai', 'copilot', 'search assist', 'duck.ai', 'ask brave', 'ai search'] },
  { id: 'filters-cookie-answer', title: t("core.answerCookieBanners"), group: 'Content filters', description: t("core.answerCookieBannersDesc"), aliases: ['reject cookies', 'reject all', 'necessary only', 'consent popup', 'cookie popup', 'gdpr', 'cookie consent', 'autoconsent'] },
  { id: 'filters-promotions', title: t("core.hideCookieBanners"), group: 'Content filters', description: t("core.hideCookieAndConsentBanners"), aliases: ['consent popup', 'consent banner', 'gdpr', 'annoyances', 'promos', 'brave search'] },
  { id: 'filters-sources', title: t("core.hideSelectedSources"), group: 'Content filters', description: t("core.hideResultsFromWebsitesYou"), aliases: ['block sites', 'block domain', 'hide results', 'source filter'] },
  { id: 'filters-reset', title: t("core.resetProfileFilters"), group: 'Content filters', description: t("core.clearAllContentFilterChoices"), aliases: ['default filters'] },
  { id: 'filter-lists-update', title: t("core.updateListsNow"), group: 'Protection lists', description: t("core.downloadTheLatestEasylistAnd"), aliases: ['refresh lists', 'easylist', 'ublock origin', 'filter lists', 'update filters'], when: 'regular-profile' },
  { id: 'filter-lists-rollback', title: t("core.usePreviousLists"), group: 'Protection lists', description: t("core.goBackToThePrevious"), aliases: ['rollback', 'undo update', 'restore lists'], when: 'regular-profile' },
  { id: 'filter-lists-sources', title: t("core.listSources"), group: 'Protection lists', description: t("core.whereProtectionListsComeFrom"), aliases: ['easylist', 'sources', 'where lists'], expand: 'filter-lists-sources', when: 'regular-profile' },
  { id: 'gpc', title: t("core.sendGlobalPrivacyControl"), group: 'Network privacy', description: t("core.tellWebsitesNotToSell"), aliases: ['do not track', 'dnt', 'gpc', 'opt out', 'privacy signal'] },
]);

// R3-74: secure DNS is part of how Acira reaches the internet (Connection). Global Privacy Control stays in Privacy.
const connectionDns = defineSettings('Connection', [
  { id: 'secure-dns', title: t("core.secureDns"), group: 'Secure DNS', description: t("core.systemOffOrStrictHttps"), aliases: ['privacy', 'network', 'dns', 'doh', 'dns over https', 'cloudflare', 'resolver', 'encrypted dns', 'dns servers', 'dns endpoints', 'custom dns'] },
  { id: 'network-save', title: t("core.saveNetworkPreferences"), group: 'Secure DNS', description: t("core.appliesAfterRestartingAcira"), aliases: ['privacy', 'restart', 'apply dns'] },
]);

const accessibility = defineSettings('Accessibility', [
  { id: 'reduce-motion', title: t("browsersettings.reduceMotion"), description: t("core.simplifyTransitionsAndUseA"), aliases: ['animation', 'animations', 'motion', 'transitions', 'vestibular', 'static'] },
  { id: 'reduce-transparency', title: t("browsersettings.reduceTransparency"), description: t("core.useReadableOpaqueSurfaces"), aliases: ['opacity', 'transparency', 'solid', 'opaque', 'contrast', 'blur', 'glass', 'readable'] },
]);

const importExport = defineSettings('Import & export', [
  { id: 'import-browser', title: t("core.importFromAnotherBrowser"), description: t("core.bookmarksHistoryAndMoreFrom"), aliases: ['import', 'migrate', 'chrome', 'edge', 'firefox', 'brave', 'switch browser', 'move from chrome', 'transfer', 'undo import', 'previous imports'], when: 'regular-profile' },
  { id: 'import-signin', title: t("signin.title"), description: t("signin.settingDesc"), aliases: ['sign in', 'sign back in', 'log in', 'login', 'accounts', 'sessions', 'cookies', 'logged out', 'signed out'], when: 'regular-profile' },
  { id: 'import-passwords', title: t("handoff.title"), description: t("handoff.settingDesc"), aliases: ['passwords', 'csv', 'export passwords', 'chrome passwords', 'edge passwords', 'firefox passwords', 'bring passwords'], when: 'regular-profile' },
  { id: 'import-bookmarks-html', title: t("core.importBookmarksHtml"), group: 'Files', description: t("core.importABookmarksFileExported"), aliases: ['import bookmarks', 'html file', 'netscape'], when: 'regular-profile' },
  { id: 'export-bookmarks-html', title: t("core.exportBookmarksHtml"), group: 'Files', description: t("core.htmlWorksWithOtherBrowsers"), aliases: ['export bookmarks', 'backup bookmarks', 'save bookmarks'], when: 'regular-profile' },
  { id: 'export-profile-json', title: t("core.exportProfileJson"), group: 'Files', description: t("core.bookmarksSupportedSettingsAndOptional"), aliases: ['export', 'backup', 'profile backup', 'download data', 'save profile'], when: 'regular-profile' },
  { id: 'export-include-history', title: t("core.includeHistoryInJsonExport"), group: 'Files', description: t("core.addThisProfileSHistory"), aliases: ['history export', 'backup history'], when: 'regular-profile' },
]);

const about = defineSettings('About', [
  { id: 'about-version', title: t("core.aboutAcira"), description: t("core.versionLicenseAndBrowserSetup"), aliases: ['version', 'update', 'license', 'agpl', 'build', 'what is new'] },
  { id: 'default-browser', title: t("defaultbrowserrow.defaultBrowser"), description: t("core.openWebLinksAndFiles"), aliases: ['make default', 'set default', 'default app', 'links', 'open links', 'chrome', 'edge'], when: 'desktop' },
  { id: 'browser-setup', title: t("browsersettings.runSetupAgain"), description: t("core.goThroughTheFirstRun"), aliases: ['onboarding', 'welcome', 'set up', 'default browser', 'first run', 'tutorial'] },
]);

// R3-74: the picture of the new tab is an appearance choice (Chrome, Firefox and Arc keep the background with the look). Same ids and storage; the New tab section keeps the layout and the shortcuts.
const newTabBackground = defineSettings('Appearance', [
  { id: 'newtab-art', title: t("core.showArtwork"), group: 'New tab background', description: t("core.paintingBehindTheNewTab"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'cover', 'background', 'wallpaper', 'painting', 'image', 'hide cover', 'restore cover', 'show cover'] },
  { id: 'newtab-collection', title: t("core.collection"), group: 'New tab background', description: t("core.builtInPaintingsOrOpen"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'photos', 'nature', 'space', 'wikimedia', 'art institute', 'photography', 'source'] },
  { id: 'newtab-artwork', title: t("core.artwork"), group: 'New tab background', description: t("core.chooseThePaintingForThe"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'painting', 'cover', 'background', 'wallpaper', 'museum', 'picture'] },
  { id: 'newtab-art-details', title: t("core.aboutThisPainting"), group: 'New tab background', description: t("core.artistDateAndMuseumRecord"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'artist', 'provenance', 'credit', 'rights', 'public domain', 'museum record'], expand: 'newtab-art-details' },
  { id: 'newtab-personal-image', title: t("ntp.personal"), group: 'New tab background', description: t("core.useYourOwnImageAs"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'custom background', 'upload', 'own image', 'photo', 'import image', 'choose image'], when: 'desktop' },
  { id: 'newtab-caption', title: t("core.showTheCaption"), group: 'New tab background', description: t("core.titleArtistAndYearUnder"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'artwork caption', 'credit', 'painting title'] },
  { id: 'newtab-daily', title: t("core.changeArtwork"), group: 'New tab background', description: t("core.everyNewTabEveryHour"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'rotate', 'daily art', 'rotation', 'random', 'every day', 'hourly', 'every hour', 'shuffle', 'every tab', 'interval'] },
]);

const newTab = defineSettings('New tab', [
  { id: 'newtab-name', title: t("core.showProfileName"), group: 'New tab', description: t("core.showTheProfileNameOn"), aliases: ['workspace name', 'greeting', 'label'] },
  { id: 'newtab-mark', title: t("core.showAciraMark"), group: 'New tab', description: t("core.staticAciraSymbolOnThe"), aliases: ['logo', 'brand', 'icon', 'dot matrix'] },
  { id: 'newtab-search', title: t("core.showSearch"), group: 'New tab', description: t("core.centeredSearchFieldOnThe"), aliases: ['search box', 'search field'] },
  { id: 'newtab-shortcuts', title: t("core.showShortcuts"), group: 'New tab', description: t("core.siteShortcutsOnTheNew"), aliases: ['speed dial', 'top sites', 'most visited', 'tiles', 'favorites'] },
  { id: 'newtab-saved', title: t("core.showBookmarks"), group: 'New tab', description: t("core.bookmarksOnTheNewTab"), aliases: ['saved pages', 'favorites'] },
  { id: 'newtab-recent', title: t("core.showRecentPages"), group: 'New tab', description: t("core.recentHistoryOnTheNew"), aliases: ['history', 'recently visited', 'recents'] },
  { id: 'newtab-frequent', title: t("core.includeFrequentlyVisitedPages"), group: 'New tab', description: t("core.useThisProfileSHistory"), aliases: ['most visited', 'top sites', 'history shortcuts'], when: 'regular-profile' },
  { id: 'newtab-reset', title: t("core.resetNewTabLayout"), group: 'New tab', description: t("core.restoreTheDefaultNewTab"), aliases: ['restore defaults', 'default new tab'], when: 'newtab-changed' },
  { id: 'newtab-shortcut-editor', title: t("core.shortcuts"), group: 'New tab', description: t("core.addEditReorderAndRemove"), aliases: ['add shortcut', 'edit shortcut', 'remove shortcut', 'site shortcuts', 'speed dial', 'sidebar shortcuts', 'pinned sites'] },
]);

const entries: SettingsEntry[] = [...appearance, ...newTabBackground, ...newTab, ...profiles, ...tabs, ...search, ...privacy, ...connectionDns, ...accessibility, ...importExport, ...about];
export default entries;
