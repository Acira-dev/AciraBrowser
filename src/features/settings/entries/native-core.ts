import { defineSettings } from '../model';

import { t, translateText, type MessageId } from '../../../i18n';
import en from '../../../i18n/en.json';
/** Everyday-browser controls owned by the native core. Each id is a `data-setting` anchor in settings/panels/*.tsx. */
const shortcuts: [id: string, title: string, aliases?: string[]][] = [
  ['new-tab', 'New tab', ['open tab', 'ctrl t']], ['reopen-tab', 'Reopen closed tab', ['undo close tab', 'restore tab', 'ctrl shift t']], ['private-tab', 'New private tab', ['incognito tab', 'private browsing tab', 'private tab']], ['close-tab', 'Close tab', ['ctrl w']],
  ['next-tab', 'Next tab', ['switch tab', 'ctrl tab']], ['prev-tab', 'Previous tab', ['switch tab', 'ctrl shift tab']], ['move-tab-left', 'Move tab left', ['reorder tab']], ['move-tab-right', 'Move tab right', ['reorder tab']],
  ['select-last-tab', 'Go to last tab', ['ctrl 9']], ['tab-viewer', 'Open tab switcher', ['all tabs', 'tab search']], ['duplicate-tab', 'Duplicate tab', ['clone tab']], ['pin-tab', 'Pin or unpin tab', ['pinned tab']],
  ['mute-tab', 'Mute or unmute tab', ['sound', 'audio']], ['move-tab-window', 'Move tab to new window', ['detach tab']], ['close-other-tabs', 'Close other tabs', []], ['close-tabs-right', 'Close tabs to the right', []],
  ['new-window', 'New window', ['ctrl n']], ['private-window', 'New private window', ['incognito', 'ctrl shift n']], ['close-window', 'Close window', []], ['quit', 'Close Acira', ['quit', 'exit', 'close browser']], ['fullscreen', 'Full screen', ['f11']],
  ['focus-mode', 'Focus mode', ['compact view', 'hide toolbar', 'distraction free']], ['compact-toolbar', 'Compact toolbar', ['slim toolbar', 'smaller toolbar', 'one row']], ['workspace', 'Toggle sidebar', ['hide sidebar', 'show sidebar']], ['switch-profile', 'Switch profile', ['accounts']],
  ['back', 'Back', ['previous page']], ['forward', 'Forward', ['next page']], ['home', 'Home', []], ['reload', 'Reload', ['refresh', 'f5']], ['hard-reload', 'Reload and bypass cache', ['hard refresh', 'force reload']],
  ['address', 'Focus address bar', ['url bar', 'omnibox', 'location', 'ctrl l']], ['command-palette', 'Command search', ['palette', 'commands']],
  ['find', 'Find in page', ['search page', 'ctrl f']], ['find-next', 'Find next', []], ['find-prev', 'Find previous', []], ['print', 'Print', ['ctrl p']], ['save-page', 'Save page as', ['download page']],
  ['save-pdf', 'Save page as PDF', ['export pdf']], ['zoom-in', 'Zoom in', ['bigger', 'ctrl plus']], ['zoom-out', 'Zoom out', ['smaller', 'ctrl minus']], ['zoom-reset', 'Actual size', ['reset zoom', 'ctrl 0']],
  ['devtools', 'Developer tools', ['inspect', 'f12', 'console']], ['reader-mode', 'Reader mode', ['reading view']], ['bookmark', 'Bookmark this page', ['favorite', 'ctrl d']], ['bookmark-all', 'Bookmark all tabs', []],
  ['toggle-bookmarks-bar', 'Show or hide bookmarks bar', ['favorites bar']], ['bookmarks-manager', 'Bookmarks', ['all bookmarks']], ['history', 'History', ['ctrl h']], ['downloads', 'Downloads', ['ctrl j']],
  ['clear-data', 'Clear browsing data', ['delete history', 'clear cookies']], ['settings', 'Settings', ['preferences', 'options']], ['menu', 'Open menu', ['main menu']], ['focus-toolbar', 'Focus the toolbar', ['f10', 'keyboard toolbar']], ['open-file', 'Open a file', ['ctrl o', 'open local file']],
];
/** Alt+1 to Alt+8 (Ctrl on a Mac) open workspaces: found by "workspace", "workspaces" and "spaces". */
const workspaceShortcuts: typeof shortcuts = Array.from({ length: 8 }, (_, index) => [`switch-workspace-${index + 1}`, t('nativeCore.switchToWorkspace', { n: index + 1 }), ["workspaces", "workspace", "spaces", "switch workspace", `alt ${index + 1}`]]);
/** A command's name in the interface language: the shortcut registry's own name when it reads the same in English, else this title's. */
const commandName = (id: string, title: string) => {
  const key = `shortcutCmd.${id}` as MessageId;
  return (en as Record<string, string>)[key] === title ? t(key) : translateText(title);
};

export default [
  ...defineSettings('Shortcuts', [
    { id: 'shortcuts-editor', title: t("nativeCore.keyboardShortcuts"), description: t("nativeCore.changeClearResetAndExport"), aliases: ['hotkeys', 'key bindings', 'keybindings', 'remap', 'customize shortcuts', 'rebind', 'accelerator'], when: 'desktop' },
    ...[...shortcuts, ...workspaceShortcuts].map(([id, title, aliases = []]) => ({ id: `shortcut-${id}`, title: t("nativeCore.shortcutTitle", { title: commandName(id, title) }), description: t("nativeCore.changeTheKeyCombinationFor"), group: 'Shortcuts', aliases: ['hotkey', 'key', 'shortcut', ...aliases], when: 'desktop' as const })),
  ]),
  ...defineSettings('Downloads', [
    { id: 'downloads-folder', title: t("nativeCore.downloadLocation"), group: 'Save files', description: t("nativeCore.folderWhereDownloadsAreSaved"), aliases: ['downloads folder', 'save to', 'download directory', 'where files go'], when: 'desktop' },
    { id: 'downloads-ask', title: t("nativeCore.askWhereToSaveEach"), group: 'Save files', description: t("nativeCore.showTheSaveDialogFor"), aliases: ['save as', 'prompt', 'choose location', 'always ask'], when: 'desktop' },
  ]),
  ...defineSettings('Privacy', [
    { id: 'site-permissions', title: t("nativeCore.sitePermissions"), group: 'Site permissions', description: t("nativeCore.cameraMicrophoneLocationNotificationsAnd"), aliases: ['camera', 'microphone', 'mic', 'location', 'geolocation', 'notifications', 'clipboard', 'allow', 'block', 'revoke', 'reset permissions'], when: 'regular-profile' },
  ]),
  ...defineSettings('Search', [
    { id: 'search-default-engine', title: t("nativeCore.defaultSearchEngine"), group: 'Search engines', description: t("nativeCore.usedForAnythingTypedIn"), aliases: ['google', 'duckduckgo', 'bing', 'search provider'], when: 'custom-search' },
    { id: 'search-engine-list', title: t("nativeCore.searchEnginesAndShortcuts"), group: 'Search engines', description: t("nativeCore.enginesAndTheirKeywordShortcuts"), aliases: ['bangs', '!d', 'keyword', 'custom search', 'site search'], when: 'desktop' },
    { id: 'search-engine-add', title: t("nativeCore.addASearchEngine"), group: 'Search engines', description: t("nativeCore.nameShortcutAndAHttps"), aliases: ['custom engine', 'new search engine', 'wikipedia', 'github search'], when: 'desktop' },
  ]),
  ...defineSettings('Tabs', [
    { id: 'memory-saver-enabled', title: t("nativeCore.putUnusedTabsToSleep"), group: 'Memory saver', description: t("nativeCore.freesMemoryForTabsYou"), aliases: ['memory saver', 'sleeping tabs', 'discard tabs', 'tab hibernation', 'performance', 'ram', 'cpu', 'slow computer', 'battery'], when: 'regular-profile' },
    { id: 'memory-saver-after', title: t("nativeCore.sleepAfter"), group: 'Memory saver', description: t("nativeCore.howLongATabCan"), aliases: ['memory saver time', 'inactive tabs', 'idle minutes', 'tab timeout'], when: 'regular-profile' },
    { id: 'memory-saver-sites', title: t("nativeCore.neverPutTheseSitesTo"), group: 'Memory saver', description: t("nativeCore.sitesWhoseTabsAlwaysStay"), aliases: ['exceptions', 'always keep active', 'never sleep', 'allow list', 'keep awake'], when: 'regular-profile' },
  ]),
  ...defineSettings('Languages', [
    { id: 'spellcheck-enabled', title: t("nativeCore.checkSpelling"), group: 'Spell checking', description: t("nativeCore.underlineMisspelledWordsInText"), aliases: ['spellcheck', 'spell checker', 'typo', 'red underline', 'autocorrect'], when: 'desktop' },
    { id: 'spellcheck-languages', title: t("nativeCore.spellingLanguages"), group: 'Spell checking', description: t("nativeCore.languagesUsedToCheckSpelling"), aliases: ['dictionary', 'language', 'multilingual'], when: 'desktop' },
  ]),
];
