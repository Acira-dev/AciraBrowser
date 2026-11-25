import { defineSettings, type SettingsEntry } from '../model';

import { t } from '../../../i18n';
import { isMac } from '../../../ui/platform';
import { paletteModifierKey } from '../../../ui/paletteTarget';
const appearance = defineSettings('Appearance', [
  { id: 'appearance-mode', title: t("settings.lightOrDark"), group: 'Theme', description: t("core.lightDarkOrFollowYour"), aliases: ['theme', 'dark mode', 'light mode', 'night mode', 'color scheme', 'system theme', 'auto dark'] },
  { id: 'match-system-theme', title: t("systemtheme.title"), group: 'Theme', description: t("systemtheme.detail"), aliases: ['system theme', 'match system', 'follow system', 'desktop theme', 'gtk', 'qt', 'kde', 'gnome', 'accent', 'accent color', 'dark mode', 'light mode', 'auto dark'], when: 'system-theme' },
  { id: 'glass-finish', title: t("appearancecontrols.finish"), group: 'Theme', description: t("core.colorsTheWindowFrameTabs"), signpost: true, aliases: ['change colors', 'change colours', 'change color', 'window color', 'colors', 'colours', 'color theme', 'colour theme', 'theme color', 'theme colour', 'material', 'color', 'colour', 'tint', 'burgundy', 'silver', 'porcelain', 'glass', 'palette', 'accent'] },
  { id: 'site-color', title: t("browsersettings.siteColor"), group: 'Light and glow', description: t("browsersettings.siteColorDetail"), aliases: ['site colour', 'website color', 'website colour', 'glow', 'page color', 'brand color', 'tint'] },
  { id: 'active-border', title: t("browsersettings.activeBorder"), group: 'Light and glow', description: t("browsersettings.activeBorderDetail"), aliases: ['border', 'borders', 'outline', 'selected tab', 'selection', 'selected border', 'focus ring', 'focus outline', 'highlight', 'ring', 'glow', 'divider fade', 'lit edge', 'hairline', 'inner light', 'plain'] },
  { id: 'ambient-mode', title: t("browsersettings.ambientMode"), group: 'Light and glow', description: t("browsersettings.ambientModeDetail"), aliases: ['ambient', 'ambient light', 'ambient glow', 'edge colors', 'edge colours', 'page colors', 'page colours', 'spill', 'youtube ambient', 'glass', 'frame colors'] },
  { id: 'noel-on', title: t("noelsettings.title"), group: 'Seasonal', description: t("noelsettings.detail"), aliases: ['noel', 'noël', 'christmas', 'xmas', 'holiday', 'festive', 'winter', 'season', 'seasonal', 'snow', 'santa', 'santa hat', 'christmas tree', 'frost', 'tree'] },
  { id: 'noel-snow', title: t("noelsettings.snow"), group: 'Seasonal', description: t("noelsettings.snowDetail"), aliases: ['snow', 'snowfall', 'snowflakes', 'falling snow', 'flakes', 'christmas', 'xmas', 'noel', 'noël', 'winter', 'no snow', 'sidebar snow', 'whole window'] },
  { id: 'noel-keep', title: t("noelsettings.keep"), group: 'Seasonal', description: t("noelsettings.keepDetail"), aliases: ['keep snowing', 'constant snow', 'always snow', 'snow all the time', 'snow stops', 'snow rest', 'snow pause', 'temporary snow', 'snowfall', 'noel', 'noël', 'christmas', 'xmas'] },
  { id: 'noel-hat', title: t("noelsettings.hat"), group: 'Seasonal', description: t("noelsettings.hatDetail"), aliases: ['hat', 'santa hat', 'santa', 'christmas hat', 'xmas hat', 'profile picture', 'profile photo', 'avatar', 'noel', 'noël', 'christmas', 'xmas'] },
  { id: 'website-appearance', title: t("browsersettings.websiteAppearance"), group: 'Theme', description: t("browsersettings.websiteAppearanceDetail"), aliases: ['dark mode', 'light mode', 'always dark', 'dark pages', 'night mode', 'force dark', 'auto dark', 'dark websites', 'dark theme', 'invert', 'exclude site'] },
  { id: 'bookmarks-bar', title: t("browsersettings.bookmarksBar"), group: 'Toolbar', description: t("core.showOnNewTabsAlways"), aliases: ['favorites bar', 'bookmark toolbar', 'show bookmarks', 'show bookmarks bar'], section: 'Layout' },
  { id: 'screenshot-button', title: t("browsersettings.screenshotButton"), group: 'Toolbar', description: t("core.screenshotButtonHint"), aliases: ['screenshot', 'screen shot', 'camera', 'capture', 'take a picture of the page'], section: 'Layout' },
  { id: 'interface-size', title: t("browsersettings.interfaceSize"), group: 'Size and motion', description: t("core.sizeOfTabsToolbarSidebar"), aliases: ['ui scale', 'scaling', 'dpi', 'text size', 'font size', 'bigger', 'smaller', 'density', 'zoom interface'] },


  { id: 'animation-speed', title: t("browsersettings.animationSpeed"), group: 'Size and motion', description: t("core.howFastMenusAndPanelsMove"), aliases: ['animation', 'animations', 'motion', 'speed', 'premium', 'fast', 'slow', 'transitions', 'off'] },
  { id: 'seasonal-app-icon', title: t("appicon.title"), group: 'Seasonal', description: t("appicon.detail"), aliases: ['icon', 'app icon', 'dock icon', 'taskbar icon', 'seasonal', 'christmas', 'logo', 'start menu'] },
  { id: 'window-view', title: t("windowview.title"), group: 'Window view', signpost: true, description: t("windowview.seamlessDetail"), aliases: ['toolbar', 'hide toolbar', 'autohide', 'auto hide', 'hide until needed', 'compact toolbar', 'compact', 'focus', 'focus mode', 'seamless', 'distraction free', 'minimal', 'one row', 'full screen page', 'zen', 'immersive', 'ctrl shift f', 'ctrl shift l', 'top bar', 'window view', 'view', 'layout', 'full', 'full view', 'compact view', 'focus view', 'seamless view', 'hide the toolbar'], section: 'Layout' },
  { id: 'hide-toolbar', title: t("windowview.hideToolbar"), group: 'Window view', description: t("windowview.hideToolbarDetail"), signpost: true, aliases: ['address bar', 'url bar', 'search bar', 'hide address bar', 'hide the address bar', 'hide url bar', 'hide the url bar', 'hide search bar', 'hide toolbar', 'hide the toolbar', 'hide top bar', 'auto hide toolbar', 'autohide toolbar', 'toolbar hides', 'top bar', 'top edge', 'reveal toolbar', 'hover toolbar', 'seamless toolbar', 'toolbar only'], section: 'Layout' },
  { id: 'seamless-edge-top', title: t("windowview.edgeTop"), group: 'Window view', description: t("windowview.edgeTopDetail"), aliases: ['seamless', 'top edge', 'reveal toolbar', 'hover toolbar'], section: 'Layout' },
  { id: 'toolbar-showHome', title: t("core.showHomeButton"), group: 'Toolbar', description: t("core.homeButtonInTheToolbar"), aliases: ['home page', 'homepage'], section: 'Layout' },
  { id: 'toolbar-showTabOverview', title: t("core.showTabViewer"), group: 'Toolbar', description: t("core.tabViewerButtonInThe"), aliases: ['tab overview', 'tab switcher', 'all tabs'], section: 'Layout' },
  { id: 'toolbar-reset', title: t("browsersettings.resetToolbarControls"), group: 'Toolbar', description: t("core.restoreDefaultToolbarButtons"), aliases: ['customize toolbar', 'default toolbar', 'restore toolbar'], section: 'Layout' },

  { id: 'page-zoom', title: t("app.pageZoom"), group: 'Size and motion', description: t("core.makeOneWebsiteLargerOr"), aliases: ['zoom', 'magnify', 'text size', 'bigger', 'smaller', 'percentage', 'ctrl plus', 'ctrl minus'], when: 'website-open' },
  { id: 'toolbar-showZoomIcon', title: t("core.showZoomIcon"), group: 'Toolbar', description: t("core.zoomIconInTheAddress"), aliases: ['magnifier', 'percent'], section: 'Layout' },
  { id: 'toolbar-showBookmarkStar', title: t("core.showBookmarkStar"), group: 'Toolbar', description: t("core.bookmarkStarInTheAddress"), aliases: ['star', 'bookmark button', 'favorite'], section: 'Layout' },
  { id: 'page-zoom-site', title: t("browsersettings.websiteToZoom"), group: 'Size and motion', description: t("core.chooseWhichOpenWebsiteTo"), aliases: ['zoom site', 'zoom target'], when: 'website-open' },

  { id: 'glass-opacity', title: t("appearancecontrols.windowOpacity"), group: 'Transparency', description: t("settings.opacityDetail"), signpost: true, aliases: ['transparent', 'transparent sidebar', 'transparent window', 'see through', 'glass', 'glass effect', 'opacity', 'transparency', 'translucent', 'see-through', 'blur', 'frosted', 'solid'], when: 'custom-glass-colors' },
  { id: 'surface-color', title: t("core.pages"), group: 'Your own colors', description: t("core.colorForAciraPagesAnd"), aliases: ['change colors', 'change colours', 'own colors', 'own colours', 'color', 'colour', 'background color', 'panel color'], when: 'custom-glass-colors' },
  { id: 'sidebar-color', title: t("core.sidebarAndFrameColor"), group: 'Your own colors', description: t("core.colorForTheSidebarAnd"), aliases: ['change colors', 'change colours', 'own colors', 'own colours', 'colour', 'sidebar tint', 'rail color'], when: 'custom-glass-colors' },
  { id: 'toolbar-color', title: t("core.toolbarColor"), group: 'Your own colors', description: t("core.colorForTheToolbarApart"), aliases: ['change colors', 'change colours', 'own colors', 'own colours', 'colour', 'toolbar tint', 'address bar color'], when: 'custom-glass-colors' },
  { id: 'tab-color', title: t("core.tabColor"), group: 'Your own colors', description: t("core.colorForTheTabStrip"), aliases: ['change colors', 'change colours', 'own colors', 'own colours', 'colour', 'tab tint', 'tab strip'], when: 'custom-glass-colors' },
  { id: 'reset-appearance', title: t("browsersettings.resetAppearance"), group: 'Reset', description: t("core.restoreTheDefaultFinishScale"), aliases: ['default appearance', 'restore defaults', 'reset theme'] },
]);

const profiles = defineSettings('Profiles', [
  { id: 'profile-list', title: t("app.profiles"), description: t("core.separateSignInsBookmarksHistory"), aliases: ['accounts', 'switch profile', 'users', 'google account', 'sign in', 'person'] },
  { id: 'profile-create', title: t("browsersettings.addAProfile"), group: 'New profile', description: t("core.createANewSeparateProfile"), aliases: ['new profile', 'create profile', 'add user', 'work profile'] },
]);

const tabs = defineSettings('Tabs', [
  { id: 'compact-tab-titles', title: t("browsersettings.showTitlesInCompactTabs"), description: t("core.showPageTitlesInNarrow"), aliases: ['tab names', 'tab labels', 'tab text'], section: 'Layout', group: 'Tab layout' },
  { id: 'tab-viewer-density', title: t("browsersettings.allOpenTabsView"), description: t("core.comfortableRowsWithTheTitle"), aliases: ['tab viewer', 'your tabs', 'alt t', 'tab list', 'comfortable', 'compact'], group: 'Previews' },
  { id: 'ask-before-closing', title: t("closeGuard.askTitle"), description: t("closeGuard.askDetail"), aliases: ['confirm close', 'confirm quit', 'warn before closing', 'close all tabs', 'quit', 'exit', 'close browser', 'dont ask again', 'unsaved changes', 'leave site'], group: 'Opening and closing' },
  { id: 'on-startup', title: t("onstartup.title"), description: t("onstartup.detail"), aliases: ['homepage', 'home page', 'start page', 'startup page', 'open on start', 'restore tabs on start', 'startup', 'start up', 'launch', 'open on start', 'restore tabs', 'restore windows', 'restore session', 'previous session', 'last session', 'continue where you left off', 'new tab on start', 'start fresh', 'reopen tabs'], group: 'When Acira starts' },
  { id: 'command-search-new-tab', title: t("commandsearchnewtab.title"), description: t("commandsearchnewtab.detail", { key: paletteModifierKey(isMac()) }), aliases: ['command palette', 'palette', 'command bar', 'search results', 'open results in new tab', 'ctrl shift k', 'alt enter', 'option enter', 'ctrl t', 'new tab search'], group: 'Opening and closing' },
  { id: 'touchpad-swipe', title: t("touchpadswipe.title"), description: t("touchpadswipe.detail"), aliases: ['swipe', 'two finger swipe', 'two-finger swipe', 'touchpad', 'trackpad', 'gesture', 'back and forward', 'swipe back', 'swipe forward', 'swipe between pages', 'workspace swipe'], group: 'Switching tabs', when: 'touchpad-swipe' },
  { id: 'fullscreen-fills-window', title: t("fullscreenfill.title"), description: t("fullscreenfill.detail"), aliases: ['fullscreen', 'full screen', 'video fullscreen', 'windowed fullscreen', 'inline fullscreen', 'fill the window', 'youtube fullscreen', 'twitch fullscreen', 'theater'], group: 'Videos' },
  { id: 'link-preview', title: t("linkpreview.title"), description: t("linkpreview.detail"), aliases: ['peek', 'glance', 'preview link', 'link preview', 'search result preview', 'preview button', 'alt click', 'shift click', 'press and hold', 'floating preview'], group: 'Previews' },
  { id: 'close-tab-landing', title: t("closelanding.title"), description: t("closelanding.detail"), aliases: ['after closing a tab', 'close tab', 'closing tabs', 'empty page', 'blank page', 'previous tab', 'next tab', 'which tab after close', 'arc', 'wake tabs', 'jump to another tab'], group: 'Opening and closing' },
  { id: 'open-tabs-in-front', title: t("tabsinfront.title"), description: t("tabsinfront.detail"), aliases: ['new tab in front', 'switch to new tab', 'background tab', 'foreground tab', 'tabs to the front', 'ctrl click', 'cmd click', 'middle click', 'open link in new tab'], group: 'Opening and closing' },
  { id: 'load-ahead', title: t("loadahead.title"), description: t("loadahead.detail"), aliases: ['preload', 'preload tabs', 'preload pages', 'load tabs at start', 'load tabs ahead', 'instant tabs', 'warm up tabs', 'fast tabs', 'restored tabs', 'pinned tabs at start', 'startup tabs'], group: 'When Acira starts' },
  { id: 'auto-picture-in-picture', title: t("autopip.title"), description: t("autopip.detail"), aliases: ['automatic picture in picture', 'auto pip', 'pip', 'picture in picture', 'pop out video', 'floating video', 'mini player', 'video window', 'leave tab', 'arc', 'switch tabs', 'tab switch', 'change tabs', 'when i switch tabs', 'pop out on tab switch'], group: 'Videos' },
  { id: 'tab-hover-card', title: t("tabhovercard.title"), description: t("tabhovercard.summary"), aliases: ['hover card', 'tab preview', 'tab thumbnail', 'page preview', 'thumbnail', 'tab tooltip', 'tab picture'], group: 'Previews' },
]);

const search = defineSettings('Search', [
  { id: 'search-engine', title: t("browsersettings.addressBarSearchEngine"), description: t("core.googleDuckduckgoOrBing"), aliases: ['default search', 'google', 'duckduckgo', 'bing', 'omnibox search', 'search provider'], when: 'stock-search' },
  { id: 'address-suggestions', title: t("browsersettings.localAddressSuggestions"), description: t("core.suggestTabsBookmarksAndHistory"), aliases: ['autocomplete', 'suggestions', 'omnibox', 'address bar', 'history suggestions', 'autofill'] },
  { id: 'engine-suggestions', title: t("searchsuggest.title"), group: 'Suggestions while typing', description: t("searchsuggest.entryDetail"), aliases: ['search suggestions', 'autosuggest', 'autocomplete', 'suggest', 'while typing', 'as you type', 'kagi', 'duckduckgo', 'google suggestions', 'omnibox', 'address bar'] },
  { id: 'image-search', title: t("imagesearch.title"), group: 'Search for an image', description: t("imagesearch.entryDetail"), aliases: ['search image', 'reverse image search', 'google lens', 'lens', 'tineye', 'yandex', 'bing visual', 'image search service', 'search by image'] },
  { id: 'image-search-custom', title: t("imagesearch.customAddress"), group: 'Search for an image', description: t("imagesearch.customAddressHelp"), aliases: ['custom image search', 'post parameters', 'vivaldi image search'] },
  { id: 'engine-suggestions-from', title: t("searchsuggest.from"), group: 'Suggestions while typing', description: t("searchsuggest.fromDetail"), aliases: ['suggestion service', 'suggest url', 'suggestion address', 'custom suggestions', 'opensearch', 'kagi'] },
]);

const privacy = defineSettings('Privacy', [
  { id: 'incognito', title: t("browsersettings.privateWindow"), description: t("core.openAWindowThatIs"), aliases: ['privacy', 'incognito', 'private browsing', 'inprivate'], group: 'Private windows and secured workspaces' },
  { id: 'block-ads-trackers', title: t("core.blockAdsAndTrackers"), description: t("core.builtInProtectionForThis"), aliases: ['adblock', 'ad block', 'tracker blocking', 'ublock', 'ghostery', 'content blocker', 'privacy', 'tracking protection'], group: 'Ads and trackers', section: 'Protection' },
  { id: 'cleanup-enabled', title: t("core.clearBrowsingDataOnExit"), group: 'Clear on exit', description: t("core.removeSelectedDataWhenAcira"), aliases: ['clear on exit', 'clear on close', 'delete on exit', 'auto clear', 'quit', 'close browser', 'forget'], when: 'regular-profile' },
  { id: 'cleanup-categories', title: t("core.dataToClear"), group: 'Clear on exit', description: t("core.cookiesSiteStorageHistoryAnd"), aliases: ['cookies', 'cache', 'site data', 'storage', 'history', 'permissions', 'clear history', 'clear cookies'], when: 'regular-profile' },
  { id: 'cleanup-keep-sites', title: t("core.sitesToKeep"), group: 'Clear on exit', description: t("core.sitesWhoseDataSurvivesCleanup"), aliases: ['exceptions', 'allow list', 'keep cookies', 'stay signed in', 'whitelist'], when: 'regular-profile' },
  { id: 'cleanup-help', title: t("core.howCleanupAndKeepSites"), group: 'Clear on exit', description: t("core.whatIsClearedAndWhat"), aliases: ['cleanup help', 'explain'], expand: 'cleanup-help', when: 'regular-profile' },
  { id: 'filters-ai', title: t("browsermenu.aiFreeMode"), description: t("core.hideAiAnswersAndAi"), aliases: ['hide ai answers in search', 'what it hides', 'ai overviews', 'ai mode', 'gemini', 'ai answers', 'ai summaries', 'ai content', 'no ai', 'copilot', 'search assist', 'duck.ai', 'ask brave', 'ai search'], group: 'Search results and AI', section: 'Protection' },
  { id: 'filters-cookie-answer', title: t("core.answerCookieBanners"), description: t("core.answerCookieBannersDesc"), aliases: ['reject cookies', 'reject all', 'necessary only', 'consent popup', 'cookie popup', 'gdpr', 'cookie consent', 'autoconsent'], group: 'Cookies and banners' },
  { id: 'filters-promotions', title: t("core.hideCookieBanners"), description: t("core.hideCookieAndConsentBanners"), aliases: ['consent popup', 'consent banner', 'gdpr', 'annoyances', 'promos', 'brave search'], group: 'Cookies and banners' },
  { id: 'filters-sources', title: t("core.hideSelectedSources"), description: t("core.hideResultsFromWebsitesYou"), aliases: ['block sites', 'block domain', 'hide results', 'source filter'], group: 'Search results and AI', section: 'Protection' },
  { id: 'filters-reset', title: t("core.resetProfileFilters"), description: t("core.clearAllContentFilterChoices"), aliases: ['default filters'], group: 'Search results and AI', section: 'Protection' },
  { id: 'filter-lists-update', title: t("core.updateListsNow"), description: t("core.downloadTheLatestEasylistAnd"), aliases: ['refresh lists', 'easylist', 'ublock origin', 'filter lists', 'update filters'], when: 'regular-profile', group: 'Protection lists', section: 'Protection' },
  { id: 'filter-lists-rollback', title: t("core.usePreviousLists"), description: t("core.goBackToThePrevious"), aliases: ['rollback', 'undo update', 'restore lists'], when: 'regular-profile', group: 'Protection lists', section: 'Protection' },
  { id: 'filter-lists-sources', title: t("core.listSources"), description: t("core.whereProtectionListsComeFrom"), aliases: ['easylist', 'sources', 'where lists'], expand: 'filter-lists-sources', when: 'regular-profile', group: 'Protection lists', section: 'Protection' },
  { id: 'gpc', title: t("core.sendGlobalPrivacyControl"), description: t("core.tellWebsitesNotToSell"), aliases: ['do not track', 'dnt', 'gpc', 'opt out', 'privacy signal'], group: 'Anti-tracking', section: 'Protection' },
]);

// R3-74: secure DNS is part of how Acira reaches the internet (Connection). Global Privacy Control stays in Privacy.
const connectionDns = defineSettings('Connection', [
  { id: 'secure-dns', title: t("core.secureDns"), group: 'Secure DNS', description: t("core.systemOffOrStrictHttps"), aliases: ['privacy', 'network', 'dns', 'doh', 'dns over https', 'cloudflare', 'resolver', 'encrypted dns', 'dns servers', 'dns endpoints', 'custom dns'] },
  { id: 'network-save', title: t("core.saveNetworkPreferences"), group: 'Secure DNS', description: t("core.appliesAfterRestartingAcira"), aliases: ['privacy', 'restart', 'apply dns'] },
]);

const accessibility = defineSettings('Accessibility', [
  { id: 'reduce-motion', title: t("browsersettings.reduceMotion"), description: t("core.simplifyTransitionsAndUseA"), aliases: ['animation', 'animations', 'motion', 'transitions', 'vestibular', 'static'], group: 'Motion and transparency' },
  { id: 'reduce-transparency', title: t("browsersettings.reduceTransparency"), description: t("core.useReadableOpaqueSurfaces"), aliases: ['opacity', 'transparency', 'solid', 'opaque', 'contrast', 'blur', 'glass', 'readable'], section: 'Appearance', group: 'Transparency' },
]);

const importExport = defineSettings('Import & export', [
  { id: 'import-browser', title: t("core.importFromAnotherBrowser"), description: t("core.bookmarksHistoryAndMoreFrom"), aliases: ['import', 'migrate', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'opera gx', 'vivaldi', 'safari', 'zen', 'arc', 'speed dial', 'switch browser', 'move from chrome', 'transfer', 'undo import', 'previous imports'], when: 'regular-profile' },
  { id: 'import-signin', title: t("signin.title"), description: t("signin.settingDesc"), aliases: ['sign in', 'sign back in', 'log in', 'login', 'accounts', 'sessions', 'cookies', 'logged out', 'signed out'], when: 'regular-profile' },
  { id: 'import-passwords', title: t("handoff.title"), description: t("handoff.settingDesc"), aliases: ['passwords', 'csv', 'export passwords', 'chrome passwords', 'edge passwords', 'firefox passwords', 'bring passwords'], when: 'regular-profile' },
  // beta.14 (spec 4.1): the Another computer group first, then the Files group's three rows. The retired ids (import-bookmarks-html, export-profile-json, export-include-history) are gone as rows;
  // their words live on as aliases of the rows that replaced them, so anyone who remembers the old names still lands on the right control.
  { id: 'transfer-send', title: t('transfer.settings.send'), group: t('transfer.settings.group'), description: t('transfer.settings.sendDesc'), aliases: ['move to another computer', 'another computer', 'other computer', 'second computer', 'new computer', 'new pc', 'new mac', 'send profile', 'send', 'move', 'move profile', 'transfer', 'transfer profile', 'share profile', 'pair', 'code'], when: 'regular-profile' },
  { id: 'transfer-receive', title: t('transfer.settings.receive'), group: t('transfer.settings.group'), description: t('transfer.settings.receiveDesc'), aliases: ['move to another computer', 'another computer', 'other computer', 'second computer', 'new computer', 'new pc', 'new mac', 'receive profile', 'receive', 'get profile', 'bring my profile', 'move', 'transfer', 'type code', 'enter code', 'code'], when: 'regular-profile' },
  { id: 'profile-file-save', title: t('transfer.file.save.title'), group: 'Files', description: t('transfer.file.saveDesc'), aliases: ['export', 'backup', 'profile backup', 'download data', 'save profile', 'export profile', 'export profile json', 'export profile data', 'profile json', 'history export', 'backup history', 'include history', 'include history in json export', 'aciraprofile', 'profile file', 'password protected', 'lock file'], when: 'regular-profile' },
  { id: 'profile-file-open', title: t('transfer.file.open.title'), group: 'Files', signpost: true, description: t('transfer.file.openDesc'), aliases: ['import bookmarks', 'import bookmarks file', 'import bookmarks html', 'import profile', 'import profile json', 'open profile', 'html file', 'netscape', 'restore backup', 'aciraprofile', 'profile file', 'older acira export'], when: 'regular-profile' },
  { id: 'export-bookmarks-html', title: t("core.exportBookmarksHtml"), group: 'Files', description: t("core.htmlWorksWithOtherBrowsers"), aliases: ['export bookmarks', 'backup bookmarks', 'save bookmarks'], when: 'regular-profile' },
]);

const about = defineSettings('About', [
  { id: 'about-version', title: t("core.aboutAcira"), description: t("core.versionLicenseAndBrowserSetup"), aliases: ['version', 'update', 'license', 'agpl', 'build', 'what is new'] },
  { id: 'default-browser', title: t("defaultbrowserrow.defaultBrowser"), description: t("core.openWebLinksAndFiles"), aliases: ['make default', 'set default', 'default app', 'links', 'open links', 'chrome', 'edge'], when: 'desktop' },
  { id: 'browser-setup', title: t("browsersettings.runSetupAgain"), description: t("core.goThroughTheFirstRun"), aliases: ['onboarding', 'welcome', 'set up', 'default browser', 'first run', 'tutorial'] },
]);

// R3-74: the picture of the new tab is an appearance choice (Chrome, Firefox and Arc keep the background with the look). Same ids and storage; the New tab section keeps the layout and the shortcuts.
// Beta 14.4: the New Tab's background lives on the New tab page, with the rest of the New Tab (it was on Appearance). The group keeps its name, so rows added to it land there too.
const newTabBackground = defineSettings('New tab', [
  { id: 'newtab-art', title: t("core.showArtwork"), group: 'New tab background', description: t("core.paintingBehindTheNewTab"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'cover', 'background', 'wallpaper', 'painting', 'image', 'hide cover', 'restore cover', 'show cover'] },
  { id: 'newtab-collection', title: t("core.collection"), group: 'New tab background', description: t("core.builtInPaintingsOrOpen"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'photos', 'nature', 'space', 'wikimedia', 'art institute', 'photography', 'source'] },
  { id: 'newtab-artwork', title: t("core.artwork"), group: 'New tab background', description: t("core.chooseThePaintingForThe"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'painting', 'cover', 'background', 'wallpaper', 'museum', 'picture'] },
  { id: 'newtab-art-details', title: t("core.aboutThisPainting"), group: 'New tab background', description: t("core.artistDateAndMuseumRecord"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'artist', 'provenance', 'credit', 'rights', 'public domain', 'museum record'], expand: 'newtab-art-details' },
  { id: 'newtab-personal-image', title: t("ntp.personal"), group: 'New tab background', description: t("core.useYourOwnImageAs"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'custom background', 'upload', 'own image', 'photo', 'import image', 'choose image'], when: 'desktop' },
  { id: 'newtab-personal-video', title: t("ntp.video"), group: 'New tab background', description: t("ntp.videoDetail"), aliases: ['new tab', 'new tab background', 'video', 'live wallpaper', 'moving background', 'animated background', 'own video', 'mp4', 'webm', 'mov'], when: 'desktop' },
  { id: 'newtab-video-battery', title: t("ntp.videoOnBattery"), group: 'New tab background', description: t("ntp.videoOnBatteryDetail"), aliases: ['new tab', 'video', 'live wallpaper', 'battery', 'power', 'low power', 'play on battery'], when: 'desktop' },
  { id: 'newtab-caption', title: t("core.showTheCaption"), group: 'New tab background', description: t("core.titleArtistAndYearUnder"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'artwork caption', 'credit', 'painting title'] },
  { id: 'newtab-daily', title: t("core.changeArtwork"), group: 'New tab background', description: t("core.everyNewTabEveryHour"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'rotate', 'daily art', 'rotation', 'random', 'every day', 'hourly', 'every hour', 'shuffle', 'every tab', 'interval'] },
  { id: 'newtab-rotation', title: t("ntp.rotation"), group: 'New tab background', description: t("ntp.rotationDetail"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'rotate', 'rotation', 'only my picks', 'all pictures', 'favorites', 'favourites', 'picked', 'shuffle', 'random', 'change artwork', 'change among'] },
  { id: 'newtab-picks', title: t("ntp.picks"), group: 'New tab background', description: t("ntp.picksDetail"), aliases: ['new tab', 'new tab background', 'background image', 'new tab image', 'my picks', 'picks', 'pick', 'tick', 'favorites', 'favourites', 'chosen pictures', 'selection', 'rotate', 'rotation', 'which paintings'] },
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
