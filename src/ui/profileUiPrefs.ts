import { readRailPrefs, setRailPrefs, SIDEBAR_FOLDERS, type RailPrefs } from './railPrefs';
import { normalizeToolbarItems, readToolbarItems, setToolbarItems } from './toolbarPrefs';
import { normalizeMenuLayout, readMenuLayout, setMenuLayout } from './menuPrefs';
import { readNewTabPreferences, updateNewTabPreferences } from './newTabPreferences';
import { readingList, restoreReadingItem, type ReadingItem } from './readingList';
import { readSidebarApps, seedSidebarApps, setSidebarAppsHidden, setSidebarAppsLimit, setSidebarAppsPlace, type SidebarApps } from './sidebarApps';
import { DEFAULT_STACK_LIMIT, validStackLimit, type StackLimitChoice } from './favoritesStackLimit';
import { applyImportedFavorites } from './importedFavorites';
import { ctrlTabModeFrom, ctrlTabShowFrom, readCtrlTabMode, readCtrlTabShow, setCtrlTabMode, setCtrlTabShow, type CtrlTabMode, type CtrlTabShow } from './tabMru';

/**
 * The interface preferences a profile transfer moves (spec 9.2). They live in the renderer's localStorage, not in the database, so the renderer
 * collects them on the sending computer and writes them on the receiving one. Each goes through its own module's reader and setter, so the value
 * is normalized on the way in and each module's change event fires; the previous raw values are kept under `acira-imported-ui:<batchId>` before the
 * first write, and `undoUiPrefs` puts them back exactly (also after a restart that rolled an unfinished apply back).
 */

/** What `payload.ui` carries (and `collectUiPrefs` returns), besides the Favorites and the reading list, which have their own payload sections. */
export interface UiPrefs {
  profile: {
    sidebarApps?: { hidden: boolean; seeded: boolean; place?: 'bottom'; /** How many Favorites show before the stack (Settings › Tabs › Sidebar › Favorites); absent = the default. */ limit?: StackLimitChoice };
    railPrefs?: Pick<RailPrefs, 'tabs' | 'newTabsTop' | 'newTabsTopChosen' | 'folders' | 'folded' | 'sections'>;
    toolbarItems?: unknown;
    menuLayout?: unknown;
    newTab?: unknown;
  };
  global: { ctrlTabMode?: CtrlTabMode; ctrlTabShow?: CtrlTabShow; downloadsHideCompleted?: boolean; rewindView?: 'tabs' | 'windows' };
}
/** What the sending side hands to `transfer.send`: the preferences plus the two lists that become payload sections. */
export interface CollectedUi extends UiPrefs { profile: UiPrefs['profile'] & { sidebarApps?: SidebarApps }; readingList: ReadingItem[] }
/** What the receiving side hands to `applyUiPrefs` after `transfer.apply`: the validated `ui`, the Favorites and the reading list. */
export interface IncomingUi { ui: UiPrefs; favorites?: readonly { url: string; title?: string; icon?: string }[]; readingList?: readonly ReadingItem[] }

const SAVED = 'acira-imported-ui:';
const DOWNLOADS = 'acira.downloads.hideCompleted';
const REWIND = 'acira.rewind.view';
/** Where each preference sits in localStorage for a profile, and the event its module listens to (`null`: read when the page opens). */
const keys = (profileId: string) => ({
  sidebarApps: { key: 'acira-sidebar-apps:' + profileId, event: 'acira-sidebar-apps' },
  railPrefs: { key: 'acira-rail-prefs:' + profileId, event: 'acira-rail-prefs' },
  toolbarItems: { key: 'acira-toolbar-items:' + profileId, event: 'acira-toolbar-items' },
  menuLayout: { key: 'acira-menu-layout:' + profileId, event: 'acira-menu-layout' },
  newTab: { key: 'acira-new-tab:' + profileId, event: 'storage' },
  readingList: { key: 'acira-reading-list:' + profileId, event: 'acira-reading-list' },
  ctrlTabMode: { key: 'acira-ctrl-tab-mode', event: 'acira-ctrl-tab-mode' },
  ctrlTabShow: { key: 'acira-ctrl-tab-show', event: 'acira-ctrl-tab-show' },
  downloadsHideCompleted: { key: DOWNLOADS, event: null },
  rewindView: { key: REWIND, event: null }
});
type PrefId = keyof ReturnType<typeof keys>;

const get = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const put = (key: string, raw: string | null) => { try { if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw); } catch { /* storage unavailable: nothing to restore either */ } };
const notify = (event: string | null, key: string) => {
  if (!event) return;
  try { window.dispatchEvent(event === 'storage' ? new StorageEvent('storage', { key }) : new Event(event)); } catch { /* a window without events */ }
};

/** Reads each preference through its own module, so the value comes back normalized. */
export function collectUiPrefs(profileId: string): CollectedUi {
  const apps = readSidebarApps(profileId);
  const rail = readRailPrefs(profileId);
  return {
    profile: {
      sidebarApps: apps,
      railPrefs: { tabs: rail.tabs, newTabsTop: rail.newTabsTop, newTabsTopChosen: rail.newTabsTopChosen, folders: rail.folders, folded: rail.folded, sections: rail.sections },
      toolbarItems: readToolbarItems(profileId),
      menuLayout: readMenuLayout(profileId),
      newTab: readNewTabPreferences(profileId)
    },
    global: {
      ctrlTabMode: readCtrlTabMode(),
      ctrlTabShow: readCtrlTabShow(),
      downloadsHideCompleted: get(DOWNLOADS) === '1',
      rewindView: get(REWIND) === 'windows' ? 'windows' : 'tabs'
    },
    readingList: [...readingList(profileId)]
  };
}

/** The saved raw values of one batch, or null. */
function savedFor(batchId: string): { profileId: string; prefs: Partial<Record<PrefId, string | null>> } | null {
  try { const value = JSON.parse(get(SAVED + batchId) || 'null'); return value && typeof value === 'object' && value.prefs ? value : null; } catch { return null; }
}

/**
 * Writes the incoming preferences into the profile. The previous raw values of everything about to be written are saved first. A preference the payload does not
 * carry is left as it is. Returns the ids written, for the receipt.
 */
export function applyUiPrefs(profileId: string, batchId: string, incoming: IncomingUi): PrefId[] {
  const where = keys(profileId), ui = incoming.ui || { profile: {}, global: {} };
  const wanted: PrefId[] = [];
  const profile = ui.profile || {}, global = ui.global || {};
  if (profile.sidebarApps || incoming.favorites?.length) wanted.push('sidebarApps');
  if (profile.railPrefs) wanted.push('railPrefs');
  if (profile.toolbarItems !== undefined) wanted.push('toolbarItems');
  if (profile.menuLayout !== undefined) wanted.push('menuLayout');
  if (profile.newTab !== undefined) wanted.push('newTab');
  if (incoming.readingList?.length) wanted.push('readingList');
  if (global.ctrlTabMode !== undefined) wanted.push('ctrlTabMode');
  if (global.ctrlTabShow !== undefined) wanted.push('ctrlTabShow');
  if (typeof global.downloadsHideCompleted === 'boolean') wanted.push('downloadsHideCompleted');
  if (global.rewindView === 'tabs' || global.rewindView === 'windows') wanted.push('rewindView');
  if (!wanted.length) return [];

  // The previous values go down BEFORE the first write (an unfinished apply is rolled back from them at the next start).
  const prefs: Partial<Record<PrefId, string | null>> = {};
  for (const id of wanted) prefs[id] = get(where[id].key);
  put(SAVED + batchId, JSON.stringify({ profileId, at: Date.now(), prefs }));

  if (wanted.includes('sidebarApps')) {
    if (incoming.favorites?.length) applyImportedFavorites(profileId, batchId, incoming.favorites);
    const apps = profile.sidebarApps;
    if (apps) {
      if (apps.seeded) seedSidebarApps(profileId, false, []);
      setSidebarAppsHidden(profileId, false, apps.hidden === true);
      setSidebarAppsPlace(profileId, false, apps.place === 'bottom' ? 'bottom' : 'top');
      setSidebarAppsLimit(profileId, false, validStackLimit(apps.limit) ? apps.limit : DEFAULT_STACK_LIMIT);
    }
  }
  if (wanted.includes('railPrefs') && profile.railPrefs) {
    const rail = profile.railPrefs;
    const patch: Partial<RailPrefs> = {};
    if (typeof rail.tabs === 'boolean') patch.tabs = rail.tabs;
    if (typeof rail.newTabsTop === 'boolean') patch.newTabsTop = rail.newTabsTop;
    if (typeof rail.newTabsTopChosen === 'boolean') patch.newTabsTopChosen = rail.newTabsTopChosen;
    if (SIDEBAR_FOLDERS.includes(rail.folders as never)) patch.folders = rail.folders;
    if (rail.folded && typeof rail.folded === 'object') patch.folded = Object.fromEntries(Object.entries(rail.folded).filter(([, folded]) => typeof folded === 'boolean').slice(0, 64)) as Record<string, boolean>;
    if (rail.sections && Array.isArray(rail.sections.order) && Array.isArray(rail.sections.hidden)) {
      const ids = (list: readonly unknown[]) => list.filter((id): id is string => typeof id === 'string').slice(0, 32);
      // `shelfHidden`: the hidden sections of the Top + sidebar layout, kept apart from `hidden` (railPrefs.ts); without it the other computer's Shelf layout would show every section again.
      patch.sections = { order: ids(rail.sections.order), hidden: ids(rail.sections.hidden), ...(Array.isArray(rail.sections.shelfHidden) ? { shelfHidden: ids(rail.sections.shelfHidden) } : {}) };
    }
    setRailPrefs(patch, profileId);
  }
  if (wanted.includes('toolbarItems')) setToolbarItems(normalizeToolbarItems(profile.toolbarItems), profileId);
  if (wanted.includes('menuLayout')) setMenuLayout(normalizeMenuLayout(profile.menuLayout), profileId);
  if (wanted.includes('newTab') && profile.newTab && typeof profile.newTab === 'object') {
    // A personal picture is a file on the sending computer; without "New tab pictures" the choice would point at nothing, so it is left out.
    const { version: _version, ...choice } = profile.newTab as Record<string, unknown>;
    if (typeof choice.artwork === 'string' && choice.artwork.startsWith('personal:')) delete choice.artwork;
    updateNewTabPreferences(profileId, choice);
  }
  if (wanted.includes('readingList')) for (const item of incoming.readingList || []) restoreReadingItem(profileId, false, item);
  if (wanted.includes('ctrlTabMode')) setCtrlTabMode(ctrlTabModeFrom(global.ctrlTabMode));
  if (wanted.includes('ctrlTabShow')) setCtrlTabShow(ctrlTabShowFrom(global.ctrlTabShow));
  if (wanted.includes('downloadsHideCompleted')) put(DOWNLOADS, global.downloadsHideCompleted ? '1' : '0');
  if (wanted.includes('rewindView')) put(REWIND, global.rewindView === 'windows' ? 'windows' : 'tabs');
  return wanted;
}

/** Puts the previous raw values back (exactly, a key that did not exist is removed again), then drops the record. Safe to call twice and for batches that wrote nothing. */
export function undoUiPrefs(batchId: string): boolean {
  const saved = savedFor(batchId);
  if (!saved) return false;
  const where = keys(saved.profileId);
  for (const [id, raw] of Object.entries(saved.prefs) as [PrefId, string | null][]) {
    if (!where[id]) continue;
    put(where[id].key, raw);
    notify(where[id].event, where[id].key);
  }
  put(SAVED + batchId, null);
  return true;
}

/** At start: the batches main rolled back (`transfer.rolledBack`) that still have a saved record in this renderer. Returns how many were put back. */
export function undoRolledBackUiPrefs(batchIds: readonly string[]): number {
  let undone = 0;
  for (const batchId of batchIds) if (undoUiPrefs(batchId)) undone++;
  return undone;
}
