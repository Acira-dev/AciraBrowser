import type { BrowserRuntime } from '../../runtime/types';

/** R4-60 and Beta 14 (B8): one use of an interface-side feature, by NAME only. Main counts it only while usage sharing is on, as a bucket in the next daily message, from an ordinary window (never a private or Tor one,
 *  except the four oldest names); nothing about what was done is recorded: never a site, file, picture, group or folder name, or words. Fire and forget, never throws. Kept apart from useMetrics (which loads the runtime
 *  client) so low-level modules such as chromeEdge stay importable outside the app.
 *  To count a new feature: `noteUse('zapUsed')` where the person does it (once per use), or `usageNote('zapUsed')` in main. The name must be one of UI_USES (desktop/browser-services/usage-hooks.cjs UI_NOTES; a test keeps the
 *  two lists equal); a feature with no name yet needs a closed-list entry first (docs/launch/METRICS.md "Counting a new feature"). */
export const UI_USES = ['seamlessReveals', 'commandBar', 'protectionPanel', 'bookmarksOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened',
  'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept', 'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored',
  'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse', 'imageSearchesGoogle', 'imageSearchesTineye', 'imageSearchesYandex', 'imageSearchesBing', 'imageSearchesCustom',
  'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow',
  'insiderSheetShown', 'insiderInviteCopied', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared', 'windowView'] as const;
export type UiUse = (typeof UI_USES)[number];
export function noteUse(name: UiUse) {
  try { const native = (window as { acira?: BrowserRuntime }).acira; if (native) void native.service({ type: 'metrics.note', name }).catch(() => undefined); } catch { /* not in the app */ }
}
/** Beta 14: a Settings section was opened (its name is one of the ten fixed section names; main keeps only the closed-list id, and counts the one opened most). */
export function noteSettingsSection(section: string) {
  try { const native = (window as { acira?: BrowserRuntime }).acira; if (native) void native.service({ type: 'metrics.note', name: 'settingsSection', section }).catch(() => undefined); } catch { /* not in the app */ }
}
/** Beta 14: a search was made with the default engine of this window. Only the engine's id goes (from a closed list in main), never the words searched. */
export function noteSearch(engine: string) {
  try { const native = (window as { acira?: BrowserRuntime }).acira; if (native) void native.service({ type: 'metrics.note', name: 'search', engine }).catch(() => undefined); } catch { /* not in the app */ }
}

/** Popups whose opening is one use of a counted feature (the popup's `kind` in App.tsx): the protection panel, the All Bookmarks pop-up, the tab viewer (Alt+T) and the Ctrl+Tab switcher. */
const POPUP_USES: Readonly<Record<string, UiUse>> = { protection: 'protectionPanel', bookmarks: 'bookmarksPopupOpens', tabs: 'tabViewerOpens', switcher: 'tabSwitcherOpens' };
/** A popup sheet just opened (called once per opening: the sheet mounts once per overlay id). Other kinds count nothing. */
export function notePopupOpened(kind: string) {
  const name = Object.prototype.hasOwnProperty.call(POPUP_USES, kind) ? POPUP_USES[kind] : undefined;
  if (name) noteUse(name);
}
