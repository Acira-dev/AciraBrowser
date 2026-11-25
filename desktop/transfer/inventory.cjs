'use strict';
// What moves in a profile transfer, and what never does (spec PROFILE_TRANSFER.md section 9).
//
// Every `Settings` key, every interface-preference key, every policy key the app writes and every JSON store under `userData`
// is classified here as "moved" or "never moved", with a reason for the second kind. `tests/transfer-inventory.test.ts` reads the
// source and fails when something is in neither list, so a future setting cannot silently fall out of the transfer.
//
// The transfer's include rows (what the person ticks on the sending side) are the keys of ROWS.

/** The rows of the sending checklist. `passwords` and `openTabs` and `pictures` are off by default. */
const ROWS = Object.freeze(['look', 'spaces', 'bookmarks', 'history', 'settings', 'privacy', 'reading', 'extensions', 'openTabs', 'pictures', 'passwords']);
const DEFAULT_ROWS = Object.freeze(['look', 'spaces', 'bookmarks', 'history', 'settings', 'privacy', 'reading', 'extensions']);

// ---------------------------------------------------------------- 9.1 Settings (src/runtime/types.ts `Settings`)

/** Row "Look and layout": theme, colors, glass, site colour, scale. Run through the reducer's material normalization. */
const LOOK_SETTINGS = Object.freeze(['appearance', 'style', 'stylePreferences', 'accentColor', 'browserTint', 'colorPreset', 'glassOpacity', 'translucentOpacity', 'surfaceColor', 'sidebarColor', 'tabColor', 'toolbarColor', 'reducedTransparency', 'systemTheme', 'interfaceScale', 'siteColor', 'websiteAppearance', 'activeBorder', 'ambientMode', 'noelOn', 'noelSnow', 'noelHat', 'noelKeepSnowing', 'ownColours', 'frameGradient', 'frameGlow', 'frameMaterial']);
/** Row "Look and layout": window view, the sidebar (side, size, tabs layout), toolbar, menu. The Tabs layout is verticalTabs + addressInSidebar + the rail's `tabs` switch (9.1). */
const LAYOUT_SETTINGS = Object.freeze(['windowView', 'toolbarLayout', 'seamlessEdges', 'sidebarPeek', 'verticalTabs', 'addressInSidebar', 'hideToolbar', 'sidebarWidth', 'sidebarSide', 'favoriteTabsInList', 'panelWidth', 'compactTabTitles', 'showHome', 'showTabOverview', 'showZoomIcon', 'showBookmarkStar', 'shelf', 'sidebarRail', 'bookmarksBar', 'bookmarksOnNewTabOnly', 'tabViewerDensity', 'tabSize', 'tabHoverCard', 'sidebarShortcut', 'spaces', 'sidebarReveal', 'sidebarHandleAt', 'sidebarClosed', 'screenshotButton']);
/** Row "Look and layout": motion. */
const MOTION_SETTINGS = Object.freeze(['animationSpeed', 'reducedMotion']);
/** Row "Settings, search and shortcuts": behaviour. */
const BEHAVIOUR_SETTINGS = Object.freeze(['askBeforeClosing', 'linkPreview', 'openTabsInFront', 'commandSearchNewTab', 'addressSuggestions', 'memorySaver', 'securedLockMinutes', 'onStartup', 'loadAhead', 'autoPictureInPicture', 'sidePanelKeepMinutes', 'sidePanelCloseOnSwitch', 'fullscreenFillsWindow', 'touchpadSwipe', 'closeTabLanding']);
/** Row "Settings, search and shortcuts": search. */
const SEARCH_SETTINGS = Object.freeze(['searchEngine', 'searchProviders', 'engineSuggestions', 'engineSuggestionsFrom', 'engineSuggestionsService', 'engineSuggestionsAddress', 'imageSearch', 'imageSearchCustom', 'imageSearchCustomPost']);
/** Never applied silently: the Done screen offers "Switch to <language>". */
const LANGUAGE_SETTINGS = Object.freeze(['language']);

/** The settings that make up the "Look" apply (inside the reveal, 5.3). */
const LOOK_ROW_SETTINGS = Object.freeze([...LOOK_SETTINGS, ...LAYOUT_SETTINGS, ...MOTION_SETTINGS]);
/** The settings applied before the reveal (11.1 step 3). */
const EARLY_SETTINGS = Object.freeze([...BEHAVIOUR_SETTINGS, ...SEARCH_SETTINGS]);
/** Every setting that travels in `payload.settings` (language included; the apply never switches it by itself). */
const MOVED_SETTINGS = Object.freeze([...LOOK_ROW_SETTINGS, ...BEHAVIOUR_SETTINGS, ...SEARCH_SETTINGS, ...LANGUAGE_SETTINGS]);
/** In the `Settings` interface, but the running app keeps them in the `'*'` profile policy (only first-run setup reads `Settings.blocking`). */
const POLICY_SETTINGS = Object.freeze(['blocking']);
/** Not a choice to move, with the reason. */
const NEVER_SETTINGS = Object.freeze({
  onboardingComplete: 'setup state of this install',
  defaultProfileId: 'which local profile starts; ids differ per install',
  sidebarPeekDefault: 'one-time migration marker',
  homeButtonDefault: 'one-time migration marker',
  ambientOwnSwitch: 'one-time migration marker',
  systemAccent: 'runtime only: the Linux desktop accent, never saved',
  siteNotifications: 'a setting to try in 14.3 (As system notifications by default): a transfer never turns the panel on in another install',
  siteNotificationsSilent: 'belongs to the panel above, which a transfer never turns on',
  zoom: 'mirrors the active tab\'s zoom; writing it zooms the tab on screen (per-site zoom moves with the site settings)',
  workspace: 'an unused legacy label; the active Space is window state',
  screenshotLast: 'the kind of screenshot this computer took last (area, visible or full); a memory of use, not a row in Settings',
  pinnedCloseHinted: 'set once the "Pinned tabs stay" hint has been shown on this computer',
  reducedMotionChosen: 'a marker that the person (not this computer\'s software drawing) chose Reduce motion; each computer decides it for itself',
  imageSearchUploadOk: 'the person\'s OK to send a picture to an image search service ("Don\'t ask again"): asked again on each computer, whatever the file says'
});

/** One realistic value per moved key, so the guard can run each through `validateSettings` (many optional keys have no default). */
const SAMPLE_SETTINGS = Object.freeze({
  appearance: 'dark', style: 'acira',
  stylePreferences: { acira: { appearance: 'dark', accentColor: '#3b82f6', browserTint: '#101827', colorPreset: 'ocean' } },
  accentColor: '#3b82f6', browserTint: '#101827', colorPreset: 'ocean', glassOpacity: 64, translucentOpacity: 64,
  surfaceColor: '#101827', sidebarColor: '#0b1220', tabColor: '#16213a', toolbarColor: '#0f172a',
  reducedTransparency: false, systemTheme: false, interfaceScale: 100, siteColor: 'soft', websiteAppearance: 'dark', activeBorder: 'hairline', ambientMode: true, noelOn: true, noelSnow: 'window', noelHat: false, noelKeepSnowing: false,
  ownColours: ['#8b5cf6', '#14b8a6'], frameGradient: ['#14b8a6'], frameGlow: true, frameMaterial: 'glossy',
  windowView: 'full', toolbarLayout: 'expanded', seamlessEdges: { top: true, side: true }, sidebarPeek: { full: false, compact: true, focus: true },
  verticalTabs: true, addressInSidebar: false, hideToolbar: true, sidebarWidth: 240, sidebarSide: 'left', favoriteTabsInList: true, panelWidth: 360,
  compactTabTitles: true, showHome: true, showTabOverview: true, showZoomIcon: false, showBookmarkStar: false, shelf: false, sidebarRail: true, bookmarksBar: false, bookmarksOnNewTabOnly: true,
  tabViewerDensity: 'comfortable', tabSize: 'large', tabHoverCard: 'preview', sidebarShortcut: true, spaces: 'workspaces',
  animationSpeed: 'premium', reducedMotion: false,
  askBeforeClosing: true, linkPreview: true, openTabsInFront: false, commandSearchNewTab: false, addressSuggestions: true,
  memorySaver: { enabled: true, idleMinutes: 30, neverSleep: [] }, securedLockMinutes: 5, onStartup: 'continue',
  sidebarReveal: 'handle', sidebarHandleAt: 0.5, sidebarClosed: 'hidden', screenshotButton: 'top', loadAhead: 'pinned', autoPictureInPicture: true, sidePanelKeepMinutes: 15, sidePanelCloseOnSwitch: false, fullscreenFillsWindow: true, touchpadSwipe: true, closeTabLanding: 'empty',
  engineSuggestions: true, engineSuggestionsFrom: 'service', engineSuggestionsService: 'duckduckgo', engineSuggestionsAddress: 'https://suggest.example.com/complete?q=%s',
  imageSearch: 'tineye', imageSearchCustom: 'https://images.example.com/search?url=%s', imageSearchCustomPost: 'source=acira',
  searchEngine: 'google', searchProviders: null, language: 'en'
});

// ---------------------------------------------------------------- 9.2 Interface preferences (renderer localStorage)

/** The preferences the renderer collects and writes (src/ui/profileUiPrefs.ts). `payload` is where the value sits in `payload.ui`. */
const UI_PREFS = Object.freeze([
  { id: 'sidebarApps', key: 'acira-sidebar-apps', scope: 'profile', row: 'spaces', module: 'src/ui/sidebarApps.ts' },
  { id: 'railPrefs', key: 'acira-rail-prefs', scope: 'profile', row: 'look', module: 'src/ui/railPrefs.ts' },
  { id: 'toolbarItems', key: 'acira-toolbar-items', scope: 'profile', row: 'look', module: 'src/ui/toolbarPrefs.ts' },
  { id: 'menuLayout', key: 'acira-menu-layout', scope: 'profile', row: 'look', module: 'src/ui/menuPrefs.ts' },
  { id: 'newTab', key: 'acira-new-tab', scope: 'profile', row: 'look', module: 'src/ui/newTabPreferences.ts' },
  { id: 'readingList', key: 'acira-reading-list', scope: 'profile', row: 'reading', module: 'src/ui/readingList.ts' },
  { id: 'ctrlTabMode', key: 'acira-ctrl-tab-mode', scope: 'global', row: 'settings', module: 'src/ui/tabMru.ts' },
  { id: 'ctrlTabShow', key: 'acira-ctrl-tab-show', scope: 'global', row: 'settings', module: 'src/ui/tabMru.ts' },
  { id: 'downloadsHideCompleted', key: 'acira.downloads.hideCompleted', scope: 'global', row: 'settings', module: 'src/features/Downloads.tsx' },
  { id: 'rewindView', key: 'acira.rewind.view', scope: 'global', row: 'settings', module: 'src/features/rewind/RewindPage.tsx' }
]);
/**
 * localStorage keys that exist and are never moved (hints, recents, caches, read marks, one-shot hand-offs, developer flags), with the reason.
 * A key with a per-profile suffix (`acira-live-prs-seen:<profile>`) is listed without the colon; the guard compares names without a trailing ':'.
 */
const NEVER_UI_KEYS = Object.freeze({
  'acira-noel-offer': 'the season the Noël offer was answered in (14.3): this computer\'s own answer; another computer may ask once itself',
  'acira-edit-favorite': 'not stored: the window event the Favorites menu sends to open the editor (E10)',
  'acira-own-turn': 'whose turn it is in the round of the person\'s own New Tab pictures (14.1): a counter of this computer; the next computer starts its own round',
  'acira-autohide-toolbar': 'a legacy flag that Seamless replaced (R3-68): read once at start and cleared, so there is nothing to move',
  'acira-seamless-tip': 'hint shown once', 'acira-hide-toolbar-tip': 'hint shown once', 'acira.rewind.intro.v3': 'intro shown once', 'acira-protected-media-seen': 'hint shown once',
  'acira-palette-recent': 'recent commands', 'acira-tab-mru': 'recent tab order', 'acira-tab-switcher-order': 'legacy switcher state', 'acira-tab-switcher-open': 'switcher session state', 'acira-tab-switcher-released': 'switcher session state',
  'acira-workspace-target': 'where the next tab goes right now', 'acira-settings-target': 'one-shot scroll target',
  'acira-locale': 'cache of the interface language', 'acira-locale-reloads': 'reload guard', 'acira-icon-colors': 'cache of site icon colours', 'acira-first-frame': 'performance mark', 'acira-render-begin': 'performance mark', 'acira-ui-recovery': 'crash recovery guard',
  'acira-live-prs-seen': 'read marks of the Pull requests folder', 'acira-downloads-seen': 'read marks of the Downloads dot',
  'acira-favorite-edit': 'one-shot hand-off', 'acira-imported-favorites': 'one-shot hand-off (import receipts)', 'acira-sidebar-apps-undo': 'undo state', 'acira-sidebar-section-undo': 'undo state',
  'acira-sidebar-request': 'one-shot hand-off', 'acira-customize-sidebar': 'one-shot hand-off', 'acira-toast-dismissed': 'dismissed toasts',
  'acira-lab-dot-click': 'developer flag', 'acira.dev.siteTint': 'developer flag', 'acira-offline-game': 'game state', 'acira-offline-game-best': 'game high score',
  'acira-browser-v1': 'web-only fallback store', 'acira-study-cover': 'legacy key, folded into acira-new-tab when read', 'acira-imported-ui': 'the transfer\'s own undo record',
  'acira-sidebar-reveal-never-tip': 'hint shown once (the "never reveal" tip)', 'acira-setup-layout-picker': 'a developer flag for the setup layout picker (dev builds only)', 'acira-icon-plates-1': 'cache of computed icon plates', 'acira-suggestion-rows': 'a QA override of the address suggestions rows',
  'acira-overflow-rows': 'one-shot hand-off (how many rows the toolbar \u00bb menu holds, left for the popup just before it opens; a stale one is ignored after two minutes)',
});

// ---------------------------------------------------------------- 9.3 App-wide stores (userData)

/** Files under userData the transfer reads and writes through each module's setter (names as they appear in the source). */
const MOVED_STORES = Object.freeze({
  'privacy-plus.json': 'appPrefs.privacy',
  'native-network-preferences.json': 'appPrefs.network (applies after a restart)',
  'download-preferences.json': 'appPrefs.downloadsAskWhere (never the folder)',
  'shortcuts.json': 'shortcuts',
  'settings.json': 'passwords/settings.json (enabled), rewind/settings.json (enabled, days), tor/settings.json (level, downloadWarning, preferOnion), the filter cache settings.json (automatic)',
  'live-prs.json': 'livePrs (the folder name and filters, as an unticked line)',
  'favicons.json': 'favicons (through the favicon store: list and adopt)',
  'library.json': 'routines (through routines export and import)',
  'index.json': 'pictures (the personal artwork index, through workspace-artwork)',
  'web-apps.json': 'webApps (offered on Done)',
  'extensions.json': 'extensions (offered on Done)',
  '.vault.json': 'passwords (through the vault, with the gate; code path or a locked file only)'
});
/** Everything else found under desktop/**, with the reason it is not a preference to move. */
const NEVER_STORES = Object.freeze({
  'signin.json': 'accounts and sign-ins', 'metrics.json': 'install id', 'signedInUser.json': 'Firefox import source file',
  'window-state.json': 'window bounds of this screen', 'devtools-dock.json': 'the side and sizes of Developer tools, and its window place on this screen', 'pip-window.json': 'where the video pop-out window was left, on this screen', 'peek-hint.json': 'hint shown once', 'processes.json': 'running process list', 'browser-state.json': 'session state (the database holds profiles)', 'browser.sqlite': 'the profile database (moves through the payload, never as a file)', 'removed-partitions.json': 'cleanup bookkeeping', 'closed.json': 'closed-tabs log',
  'onboarding.json': 'setup state', 'preview-build.json': 'build marker',
  'update-info.json': 'update state', 'update-stub-log.json': 'update state', 'update.json': 'update state', 'update.part.json': 'update state', 'updater.json': 'update state', 'blockmaps.json': 'update state', 'download-recovery.json': 'paths on this disk', 'extension-download-ids.json': 'extension bookkeeping',
  'current.json': 'filter cache', 'previous.json': 'filter cache', 'resources.json': 'filter cache', 'resources-cache.json': 'filter cache', 'query-filter.json': 'filter cache', 'debounce.json': 'filter cache', 'safe-browsing.json': 'protection data', 'threat-lists.json': 'protection data', 'site-allowlist.json': 'protection data', 'meta.json': 'protection data bookkeeping',
  'extension-compat.json': 'extension internals', 'rules.json': 'extension rules (DNR)', 'manifest.json': 'not a store (extension and web app manifests)', 'messages.json': 'not a store (extension locale files)', 'native-manifest.json': 'Tor engine files',
  'bridges.json': 'Tor bridges are private by design',
  'video.json': '14.4 live wallpaper: the profile\'s own video (desktop/workspace-video.cjs) is up to 200 MB and stays on this computer; the receiving profile keeps its picture',
  'applied-places.json': 'the app icon: which shortcut or launcher picture of THIS computer was changed, and what it said before', 'setting.json': 'the app icon switch of this computer (the icon belongs to the app, not to a profile)', 'state.json': 'the app icon: the daily file, its tag and the picture applied on THIS computer',
  '.key.json': 'the contributor key file: it never moves as a file (the OS-protected copy cannot be read on another computer); the key moves as `payload.identity`, only by code or in a password-locked file, through the module that owns it (identity.cjs)', '.state.json': 'the contributor state file: never as a file; the rank and marks the person has earned and the welcome flag move as `payload.identity.recognition` and `.welcome` (identity.cjs)', 'billboard.json': 'billboard notices: the cache and read state of this installation', 'billboard-feed.json': 'billboard notices: the cache of this installation', 'billboard-state.json': 'billboard notices: read state of this installation', 'install.json': 'the install date of this installation', 'usage-mark.json': 'the usage count first-message mark of this installation (B9: one install is counted once)', '.insider.json': 'the Insider pass of this installation (tied to its contributor key) and the welcome state',
  'data.json': 'the v1 export file name', 'acira-export.json': 'export file name', 'acira-web-app.json': 'web app marker', 'StorableSidebar.json': 'Arc import source file', 'favicons.sqlite': 'Firefox import source file', 'places.sqlite': 'Firefox import source file'
});
/**
 * Beta 14, the guard one level down: what is INSIDE a record that moves only in part. A key added to one of these records has to be classified here, or the build fails
 * (tests/transfer-inventory.test.cjs, guards 8 and 9). `moved` = names carried; `never` = name -> the reason it stays on its computer.
 * `source` + `type` (or `literal`) say where the guard reads the record's own key list from.
 */
const UI_PREF_FIELDS = Object.freeze({
  sidebarApps: { source: 'src/ui/sidebarApps.ts', type: 'SidebarApps', moved: ['apps', 'hidden', 'seeded', 'place', 'limit'], never: {} },
  railPrefs: { source: 'src/ui/railPrefs.ts', type: 'RailPrefs', moved: ['tabs', 'newTabsTop', 'newTabsTopChosen', 'folders', 'folded', 'sections'], never: {} },
  newTab: {
    source: 'src/ui/newTabPreferences.ts', type: 'NewTabPreferences',
    moved: ['modules', 'artwork', 'artStyle', 'daily', 'perTab', 'hourly', 'collection', 'collectionSeed', 'collectionExcludeId', 'rotation', 'picks', 'ownImages', 'caption', 'frequent', 'shortcuts'],
    never: { version: 'the record\'s own schema marker: the receiving app writes its own', ownVideo: '14.4: the video file itself does not move (up to 200 MB); the receiving profile keeps its picture', videoOnBattery: '14.4: goes with the video, which stays on this computer' }
  }
});
/** Interface preferences that move whole: each goes through its own module's normalizer, so there is no field list to keep (a list, a scalar, or a payload section of its own). */
const UI_PREF_WHOLE = Object.freeze(['toolbarItems', 'menuLayout', 'readingList', 'ctrlTabMode', 'ctrlTabShow', 'downloadsHideCompleted', 'rewindView']);
/** Records in a userData store that move only some of their keys. `pattern` finds the record's literal (its first `{`) in `source`. */
const STORE_FIELDS = Object.freeze({
  'download-preferences.json': {
    source: 'desktop/download-preferences.cjs', pattern: /let value=\{/,
    moved: ['askWhere', 'offerFiles', 'offerFilesPrivate'],
    never: { folder: 'a path on this computer', lastSaveFolder: 'a path on this computer (the last folder a Save dialog used)', screenshotFolder: 'a path on this computer (the screenshots folder)' }
  },
  'privacy-plus.json': {
    source: 'desktop/browser-services/privacy-plus.cjs', pattern: /const DEFAULTS = Object\.freeze\(\{/,
    moved: ['cnameUncloaking', 'skipTrackingRedirects', 'stripTrackingParams', 'deAmp', 'fingerprint', 'phishingLists', 'pageWarnings', 'passkeys'], never: {}
  },
  'native-network-preferences.json': {
    source: 'desktop/native-network-preferences.cjs', pattern: /const defaults=\(\)=>\(\{/,
    moved: ['gpc', 'dns', 'cookies'], never: {}
  }
});
/**
 * What the plan (point 4) names, with where each one moves. `setting:<key>`, `ui:<pref>.<field>`, `store:<file>.<key>`, `payload:<dotted place in the payload>` (its last name must
 * be read by payload.cjs) and `identity:<part>`. The guard checks every place is real, so a named item cannot quietly stop travelling.
 */
const BETA14_ITEMS = Object.freeze([
  ['layout and the Shelf', ['setting:shelf', 'setting:windowView', 'setting:toolbarLayout', 'setting:sidebarRail', 'ui:railPrefs.sections']],
  ['active border', ['setting:activeBorder']],
  ['ambient mode', ['setting:ambientMode']],
  ['Favorites tiles and stack', ['ui:sidebarApps.limit', 'ui:sidebarApps.place', 'ui:sidebarApps.hidden', 'setting:favoriteTabsInList', 'payload:favorites']],
  ['nested groups and their order', ['payload:tabGroups', 'ui:railPrefs.folders', 'ui:railPrefs.folded']],
  ['pinned side panel sites', ['payload:profile.sidePanelSites', 'setting:sidePanelKeepMinutes', 'setting:sidePanelCloseOnSwitch']],
  ['Zap rules', ['payload:sites.zap']],
  ['the hidden sidebar\'s handle place', ['setting:sidebarReveal', 'setting:sidebarHandleAt']],
  ['load-ahead', ['setting:loadAhead']],
  ['search suggestions', ['setting:engineSuggestions', 'setting:engineSuggestionsFrom', 'setting:engineSuggestionsService', 'setting:engineSuggestionsAddress']],
  ['image search', ['setting:imageSearch', 'setting:imageSearchCustom', 'setting:imageSearchCustomPost']],
  ['picture-in-picture', ['setting:autoPictureInPicture']],
  ['Easy Files on and off', ['store:download-preferences.json.offerFiles', 'store:download-preferences.json.offerFilesPrivate']],
  ['the new tab picture set', ['ui:newTab.artwork', 'ui:newTab.rotation', 'ui:newTab.picks', 'ui:newTab.collection', 'ui:newTab.ownImages', 'payload:pictures']],
  ['shortcuts', ['payload:shortcuts']],
  ['the "welcome seen" flag (recognition.welcomeSeen)', ['identity:recognition']],
  ['recognition state', ['identity:recognition']],
  ['the ID key pair', ['identity:key']],
  ['the Insider certificate', ['identity:cert']]
]);
/** Parts of the identity bundle (`payload.identity`, identity.cjs): the key (the 32-byte seed) with its public half, the Insider certificate, and the recognition state (which holds the welcome-seen flag). The guard compares this list with what identity.cjs cleans. */
const IDENTITY_PARTS = Object.freeze(['key', 'publicKey', 'cert', 'recognition']);
/** Never moved, named by the brief: the analytics ID and its marks, Easy Files' recent list, the downloads list. Each with the file or store that holds it and the reason. */
const NEVER_NAMED = Object.freeze({
  'the analytics ID and its marks': 'metrics.json (NEVER_STORES): an install id; it is how this computer is counted, so a copy would count one computer twice',
  'Easy Files\' recent list': 'desktop/easy-files.cjs keeps no list: the pop-up is built live from this computer\'s clipboard, screenshot folder and latest downloads, and its thumbnails live in memory only (only the two on/off switches in download-preferences.json move)',
  'the downloads list': 'the downloads database table and download-recovery.json hold paths and files on this computer'
});
const SCHEMA_NOISE = /^(chrome\/common\/|extensions\/common\/|Contents\/)/;

// ---------------------------------------------------------------- 9.4 Site settings

/** Files under desktop/** that call `setPolicy(` (reviewed by hand; a new writer file fails the guard until it is classified here). */
const POLICY_WRITERS = Object.freeze([
  'desktop/browser-services/exit-cleanup.cjs', 'desktop/browser-services/https-first.cjs', 'desktop/browser-services/https-only.cjs',
  'desktop/browser-services/optional-filtering.cjs', 'desktop/browser-services/proxy-settings.cjs', 'desktop/browser-services/script-rules.cjs',
  'desktop/browser-services/search-providers.cjs', 'desktop/browser-services/spellcheck-policy.cjs', 'desktop/browser-services/website-languages.cjs', 'desktop/browser-services/zap.cjs',
  'desktop/content-blocking.cjs', 'desktop/database.cjs', 'desktop/main.cjs', 'desktop/site-appearance.cjs'
]);
/** Keys of the `'*'` profile policy that move. */
const MOVED_POLICY_KEYS = Object.freeze(['blocking', 'httpsOnly', 'searchProviders', 'websiteLanguages', 'aiContent', 'annoyances', 'rejectCookies', 'popupAds', 'sourceDomains']);
const NEVER_POLICY_KEYS = Object.freeze({
  networkProxy: 'can hold proxy credentials and is specific to a network',
  exitCleanup: 'arms jobs that delete this computer\'s data when Acira closes; the person turns it on where they want it',
  spellcheck: 'depends on the dictionaries installed on each computer and the platform'
});
/** Keys of the profile policy that are not part of the `'*'` row. Per-site rows are `scripts:<site>`, `http://<host>` (HTTPS-first fallback) and the per-site blocking/filtering rows. */
const SCRIPTS_MODE_SITE = 'scripts:*';
const SITE_POLICY_KEYS = Object.freeze(['scripts', 'mode', 'httpFallback', 'blocking', 'aiContent', 'annoyances', 'rejectCookies', 'popupAds', 'dark']);
/** Per-site rows that are not the plain site policies above. `dark:<site>` = {dark:'exclude'} (Always dark leaves the site alone, site-appearance.cjs) rides with the site policies; `zap:<host>` = {rules} (the parts the person removed from a site, browser-services/zap.cjs) has its own list in the payload (`sites.zap`) because each rule is checked by Zap's own cleaner. */
const DARK_PREFIX = 'dark:', ZAP_PREFIX = 'zap:';

/**
 * Permission names the app stores (permission-engine.cjs). An "allow" moves only for these; "deny" always moves.
 * Anything not named here is treated as powerful, so a permission added later never travels as an allow by accident.
 */
const LOW_RISK_ALLOW = Object.freeze(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'multiple-downloads', 'speaker-selection', 'sound', 'autoplay']);
/** Documented, for the reader and the tests; the rule is "not in LOW_RISK_ALLOW". */
const POWERFUL_PERMISSIONS = Object.freeze(['media', 'media-audio', 'media-video', 'camera', 'microphone', 'geolocation', 'geolocation-approximate', 'notifications', 'clipboard-read', 'display-capture', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'bluetooth', 'idle-detection', 'storage-access', 'top-level-storage-access', 'window-management', 'local-fonts', 'local-network', 'local-network-access', 'loopback-network', 'openExternal']);
/** Does a stored permission decision travel? */
function permissionMoves(permission, decision) {
  if (decision === 'allow') return LOW_RISK_ALLOW.includes(permission);
  return decision === 'deny' || decision === 'block';
}

// ---------------------------------------------------------------- caps (section 10)

const CAPS = Object.freeze({
  bookmarks: 50000, history: 50000, tabs: 500, favorites: 24, readingList: 200, permissions: 5000, sitePolicies: 2000,
  extensions: 200, webApps: 50, pictures: 12, picturesBytes: 20 * 1024 * 1024, passwords: 10000, faviconsBytes: 3 * 1024 * 1024, faviconEach: 16 * 1024,
  profilePicture: 64 * 1024, shortcuts: 400, zoomOrigins: 5000, tabGroups: 200, spaceName: 40,
  zapHosts: 600, zapRules: 3000, zapRuleBytes: 4096, darkSites: 500, sidePanelSites: 6
});

module.exports = {
  ROWS, DEFAULT_ROWS,
  LOOK_SETTINGS, LAYOUT_SETTINGS, MOTION_SETTINGS, BEHAVIOUR_SETTINGS, SEARCH_SETTINGS, LANGUAGE_SETTINGS,
  LOOK_ROW_SETTINGS, EARLY_SETTINGS, MOVED_SETTINGS, POLICY_SETTINGS, NEVER_SETTINGS, SAMPLE_SETTINGS,
  UI_PREFS, NEVER_UI_KEYS, MOVED_STORES, NEVER_STORES, SCHEMA_NOISE, UI_PREF_FIELDS, UI_PREF_WHOLE, STORE_FIELDS, BETA14_ITEMS, IDENTITY_PARTS, NEVER_NAMED,
  POLICY_WRITERS, MOVED_POLICY_KEYS, NEVER_POLICY_KEYS, SCRIPTS_MODE_SITE, SITE_POLICY_KEYS, DARK_PREFIX, ZAP_PREFIX,
  LOW_RISK_ALLOW, POWERFUL_PERMISSIONS, permissionMoves, CAPS
};
