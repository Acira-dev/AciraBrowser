'use strict';
// Who counts each feature of the daily usage message (usage-facts.cjs USES): one entry per name, so a count that stays 0 because nothing calls it is found by a test, not by a person reading the dashboard
// (13.8 had `mediaControls` listening for an action the now-playing card never sends, and `passwordFills`, `extensionInstalls` and `extensionPopupOpens` with no caller at all).
// Pure data; nothing here runs in the app. tests/usage-counters-wired.test.cjs checks every claim against the source.
//   main      main.cjs calls `usageNote('<name>')` itself
//   service   a service of its own counts it: it calls `note('<name>')` (main hands it usageNote); the call is in the file the table names
//   hook      usage-hooks.cjs counts it from an action, a browser command or a service request
//   ui        the interface calls `noteUse('<name>')`
//   popup     opening the popup of that `kind` is one use (noteUse.ts POPUP_USES)
//   pending   the feature is still being built by the session named; it counts by calling `noteUse` (interface) or `usageNote` (main) with this name where the feature is used (docs/launch/METRICS.md, "Counting a new feature")
const PRODUCERS = Object.freeze({
  // before Beta 14
  torTabs: { via: 'main' }, torWindows: { via: 'main' }, privateTabs: { via: 'main' }, privateWindows: { via: 'main' }, splitView: { via: 'main' }, rewind: { via: 'main' }, tabSets: { via: 'main' },
  peek: { via: 'main' }, seamlessReveals: { via: 'ui' }, workspaceSwitches: { via: 'main' }, tabGroups: { via: 'main' }, vpnToggles: { via: 'main' }, commandBar: { via: 'ui' }, protectionPanel: { via: 'popup', kind: 'protection' },
  // schema 4: feature use that was not counted before
  downloads: { via: 'main' }, bookmarksAdded: { via: 'hook' }, bookmarksOpened: { via: 'ui' }, historyOpened: { via: 'hook' }, findInPage: { via: 'hook' }, zoomChanges: { via: 'hook' },
  passwordSaves: { via: 'main' }, passwordFills: { via: 'main' }, extensionInstalls: { via: 'main' }, extensionPopupOpens: { via: 'main' }, importAttempted: { via: 'hook' }, importCompleted: { via: 'main' },
  settingsOpened: { via: 'hook' }, shortcutsEditorOpened: { via: 'ui' }, newTabPageActions: { via: 'ui' }, fullscreen: { via: 'main' }, printOrSavePdf: { via: 'hook' }, siteProtectionToggles: { via: 'main' },
  // Beta 14's own features (B8), built
  nowPlayingCardActions: { via: 'hook' }, pictureInPictureManual: { via: 'ui' }, favoritesStackOpens: { via: 'ui' }, tabSwitcherOpens: { via: 'popup', kind: 'switcher' }, tabViewerOpens: { via: 'popup', kind: 'tabs' },
  bookmarksPopupOpens: { via: 'popup', kind: 'bookmarks' }, feedbackSent: { via: 'main' },
  // Beta 14's own features (B8), still being built: the owner calls the helper where the feature is used
  pictureInPictureAutomatic: { via: 'pending', owner: 'Y automatic picture-in-picture' },
  layoutPickerOpened: { via: 'pending', owner: 'K2 layout picker' },
  groupNested: { via: 'pending', owner: 'AE groups inside groups' }, groupReordered: { via: 'pending', owner: 'AE reordering groups' },
  extensionOverflowOpens: { via: 'pending', owner: 'AD extension buttons in the sidebar' },
  sidePanelOpens: { via: 'pending', owner: 'AF side panel sites' },
  pinnedTabSlept: { via: 'pending', owner: 'P closing a pinned tab puts it to sleep' },
  screenshotsArea: { via: 'pending', owner: 'R screenshot' }, screenshotsVisible: { via: 'pending', owner: 'R screenshot' }, screenshotsFull: { via: 'pending', owner: 'R screenshot' },
  zapUsed: { via: 'pending', owner: 'S Zap' }, zapRestored: { via: 'pending', owner: 'S Zap' },
  easyFilesShown: { via: 'pending', owner: 'AB Easy Files' }, easyFilesPickedClipboard: { via: 'pending', owner: 'AB Easy Files' }, easyFilesPickedScreenshot: { via: 'pending', owner: 'AB Easy Files' },
  easyFilesPickedDownload: { via: 'pending', owner: 'AB Easy Files' }, easyFilesPickedBrowse: { via: 'pending', owner: 'AB Easy Files' },
  imageSearchesGoogle: { via: 'pending', owner: 'X search for an image' }, imageSearchesTineye: { via: 'pending', owner: 'X search for an image' }, imageSearchesYandex: { via: 'pending', owner: 'X search for an image' },
  imageSearchesBing: { via: 'pending', owner: 'X search for an image' }, imageSearchesCustom: { via: 'pending', owner: 'X search for an image' },
  searchSuggestionPicked: { via: 'pending', owner: 'W search suggestions' },
  devtoolsOpenedRight: { via: 'pending', owner: 'V developer tools in the tab' }, devtoolsOpenedBottom: { via: 'pending', owner: 'V developer tools in the tab' }, devtoolsOpenedWindow: { via: 'pending', owner: 'V developer tools in the tab' },
  // Beta 14, the Insider programme (rule 11 of the final design, 15 Nov): the service (desktop/insider/insider-service.cjs) counts what it answers; the interface counts what it only shows.
  // Never the token, the code, the number or the key: a name is all that is counted.
  insiderActivated: { via: 'service' },
  insiderDeclined: { via: 'service' },
  insiderCodeOk: { via: 'service' },
  insiderCodeInvalid: { via: 'service' },
  insiderCodeUsed: { via: 'service' },
  insiderCodeExpired: { via: 'service' },
  insiderCodeRevoked: { via: 'service' },
  insiderCodeRateLimited: { via: 'service' },
  insiderCodeOffline: { via: 'service' },
  insiderInviteCreated: { via: 'service' },
  insiderMoveCodeMade: { via: 'service' },
  insiderChannelOn: { via: 'service' },
  insiderChannelOff: { via: 'service' },
  insiderSheetShown: { via: 'ui' },
  insiderInviteCopied: { via: 'ui' },
  insiderSealCloser: { via: 'ui' },
  insiderCardOpened: { via: 'ui' },
  insiderCardShared: { via: 'pending', owner: 'AL welcome card step (Share) and the member card' },
});

/** The same for Beta 14's own settings (B8): where the value comes from. `settings`: main reads the saved setting under that key; `interface`: the interface reports it (reportSetting) or the owner does;
 *  `pending`: the setting is being built by the session named, and reads 'unknown' until it is saved under `key` (or reported). */
const SETTING_SOURCES = Object.freeze({
  activeBorderStyle: { via: 'settings', key: 'activeBorder' }, ambientMode: { via: 'settings', key: 'ambientMode' }, favoritesTileOnly: { via: 'settings', key: 'favoriteTabsInList' },
  favoritesBeforeStack: { via: 'interface' }, ctrlTabMode: { via: 'interface' },
  tabSwitcherPictures: { via: 'pending', owner: 'AG Ctrl+Tab viewer', key: 'tabSwitcherPictures' }, hiddenSidebarReveal: { via: 'pending', owner: 'T hidden sidebar', key: 'hiddenSidebarReveal' },
  loadAhead: { via: 'pending', owner: 'U load tabs ahead', key: 'loadAhead' }, searchSuggestions: { via: 'pending', owner: 'W search suggestions', key: 'searchSuggestions' },
  imageSearchService: { via: 'pending', owner: 'X search for an image', key: 'imageSearchService' }, autoPictureInPicture: { via: 'pending', owner: 'Y automatic picture-in-picture', key: 'autoPictureInPicture' },
  easyFiles: { via: 'pending', owner: 'AB Easy Files', key: 'easyFiles' }, screenshotButton: { via: 'pending', owner: 'R screenshot', key: 'screenshotButton' },
  newTabPictureSet: { via: 'pending', owner: 'I new-tab pictures', key: 'newTabPictureSet' },
});

module.exports = { PRODUCERS, SETTING_SOURCES };
