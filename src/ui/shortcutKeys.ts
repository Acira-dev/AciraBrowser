import { useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { formatShortcut, isMac } from './platform';
import { t, translateText, type MessageId } from '../i18n';

/** The keys menus and tooltips show, read live from the shortcut registry (desktop/shortcut-registry.cjs): a key someone set in
 *  Settings › Shortcuts shows everywhere, and a cleared one disappears. Until the first read, outside the desktop app and on
 *  macOS (whose menus keep their written Mac keys), the key written at the call site is shown. */

let keys: Record<string, string> | null = null;
let started = false;
const listeners = new Set<() => void>();

function read(): void {
  if (!runtime.native) return;
  runtime.native({ type: 'shortcuts.list' }).then((result) => {
    const next: Record<string, string> = {};
    for (const command of result.shortcuts?.commands ?? []) if (command.bindings[0]) next[command.id] = command.bindings[0];
    keys = next;
    for (const listener of listeners) listener();
  }, () => undefined);
}
function start(): void {
  if (started) return;
  started = true;
  read();
  runtime.subscribeBrowser((event) => { if (event.type === 'shortcuts-changed') read(); });
}

const ARROWS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓', PageUp: 'PgUp', PageDown: 'PgDn' };
/** "Alt+Left" → "Alt+←", in the app's one spelling (ui/platform formatShortcut). */
const pretty = (accel: string) => formatShortcut(accel.split('+').map((key) => ARROWS[key] ?? key).join(' + '));

/** The key for a registry command, or the written one until the registry has answered. */
export function shortcutFor(id: string, written?: string): string | undefined {
  start();
  if (isMac() || !keys) return written ? formatShortcut(written) : undefined;
  return keys[id] ? pretty(keys[id]) : undefined;
}

/** Re-render when the keys arrive or change. */
export function useShortcutKeys(): void {
  start();
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => keys);
}

/** A registry command's name in the current language, by its stable id (the registry loads before the language is known and
 *  keeps English labels). Tab-set commands arrive already translated by main. */
export function commandLabel(id: string, english: string): string {
  const tab = /^select-tab-(\d)$/.exec(id);
  if (tab) return t('shortcutCmd.select-tab', { n: tab[1] });
  const workspace = /^switch-workspace-(\d)$/.exec(id);
  if (workspace) return t('shortcutCmd.switch-workspace', { n: workspace[1] });
  const key = `shortcutCmd.${id}` as MessageId, text = t(key);
  return text === key ? translateText(english) : text;
}
const GROUPS: Record<string, MessageId> = {
  Tabs: 'shortcutGroup.tabs', Windows: 'shortcutGroup.windows', 'Split view': 'shortcutGroup.splitView', Navigation: 'shortcutGroup.navigation',
  Page: 'shortcutGroup.page', Library: 'shortcutGroup.library', Browser: 'shortcutGroup.browser', 'Tab sets': 'shortcutGroup.tabSets', Extensions: 'shortcutGroup.extensions',
  Unassigned: 'shortcutcat.unassigned',
};
/** A registry category's name in the current language. */
export const commandGroup = (category: string): string => (GROUPS[category] ? t(GROUPS[category]) : translateText(category));

/** Menu rows name their command by label. */
const MENU_COMMANDS: Record<string, string> = {
  'New tab': 'new-tab', 'New private tab': 'private-tab', 'New Tor tab': 'tor-tab', 'New Tor identity': 'tor-identity', 'New window': 'new-window', 'New private window': 'private-window', 'New Tor window': 'tor-window',
  'Find in page': 'find', 'Split view': 'split-view', 'History': 'history', 'Reopen closed tab': 'reopen-tab', 'Rewind': 'rewind', 'Downloads': 'downloads', 'Settings': 'settings',
  'All open tabs': 'tab-viewer', 'Search and commands': 'command-palette', 'Switch profile': 'switch-profile', 'Focus mode': 'focus-mode', 'Exit Focus mode': 'focus-mode', 'Focus': 'focus-mode', 'Turn Focus off': 'focus-mode', 'Seamless': 'seamless-mode',
  'Routines': 'routines', 'Tab sets': 'routines', 'Bookmark this tab': 'bookmark', 'Bookmark this page': 'bookmark', 'Remove bookmark': 'bookmark', 'All bookmarks': 'bookmarks-manager', 'Bookmarks': 'bookmarks-manager',
  'Reader mode': 'reader-mode', 'Print…': 'print', 'Save page as…': 'save-page', 'Reload tab': 'reload', 'Duplicate tab': 'duplicate-tab', 'Copy page address': 'copy-url',
  'Pin tab': 'pin-tab', 'Unpin tab': 'pin-tab', 'Move to new window': 'move-tab-window', 'Mute tab': 'mute-tab', 'Unmute tab': 'mute-tab', 'Close tab': 'close-tab',
  'Close other tabs': 'close-other-tabs', 'Close tabs to the right': 'close-tabs-right', 'Open a file…': 'open-file',
};
/** A menu row's key: the registry's for that command, else what the row wrote. */
let translatedMenu: Record<string, string> | null = null;
export function menuShortcut(label: string, written?: string): string | undefined {
  // Rows pass their label in the current language; the map is keyed by the English one.
  translatedMenu ??= Object.fromEntries(Object.entries(MENU_COMMANDS).map(([english, id]) => [translateText(english), id]));
  const id = MENU_COMMANDS[label] ?? translatedMenu[label];
  return id ? shortcutFor(id, written) : written ? formatShortcut(written) : undefined;
}
