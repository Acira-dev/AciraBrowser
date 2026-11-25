/** Pure types and helpers for the Settings registry. No Vite-only imports, so Node tests can load it. */
import { t, type MessageId } from '../../i18n';

export const settingsSections = [
  'Appearance',
  // Beta 14.4: where things are (the Acira menu's View and Tabs rows) and the sidebar have pages of their own, beside how it looks and how tabs behave.
  'Layout',
  'Sidebar',
  'Profiles',
  'Tabs',
  'New tab',
  'Search',
  'Privacy',
  // Beta 14.4: what Acira blocks or guards (ads and trackers, anti-tracking, scams, connections, scripts, filters); Privacy keeps your own data.
  'Protection',
  'Connection',
  'Accessibility',
  'Import & export',
  'About',
] as const;
export type SettingsSectionName = (typeof settingsSections)[number];

/** Conditions under which a control is actually rendered. Search hides entries that are not available. */
export type SettingsAvailability =
  | 'always'
  | 'custom-glass-colors' // Glass opacity + color wells only render with custom colors on
  | 'regular-profile' // hidden/disabled in private windows
  | 'desktop' // needs the native Electron bridge
  | 'system-theme' // Linux: the desktop gave a theme to match (desktop/linux-theme.cjs)
  | 'touchpad-swipe' // Windows and Linux: Tabs › Swipe between pages with two fingers (a Mac follows the macOS switch)
  | 'website-open' // needs an open website tab in this profile
  | 'appearance-changed' // Reset rows exist only while something differs from the default
  | 'toolbar-changed'
  | 'newtab-changed'
  | 'stock-search'
  | 'custom-search'
  | 'sidebar-closable' // not Sidebar + address in Full, where the sidebar is held open and "Show sidebar" has nothing to switch (13.5)
  | 'sidebar-edge' // a closed sidebar comes back from the window's edge here: sidebar tabs, closable, and not Mini (Beta 14: with Mini the rail is what the mouse reaches)
  | 'hide-toolbar-row' // tabs in a sidebar with the toolbar over the page (not Sidebar mode, not Seamless): Appearance › Layout › Hide the toolbar
  | 'insider-channel' // Beta 14.4: About › Updates › Insider builds is offered to this profile (its row is drawn only then)
  | 'vertical-tabs'; // sidebar-tabs layout only // only the three built-in engines exist; custom engines use the Search engines panel

export interface SettingsContext {
  customGlassColors: boolean;
  privateProfile: boolean;
  desktop: boolean;
  /** Linux only: Settings › Appearance › Match my system theme exists. */
  systemTheme?: boolean;
  /** Windows and Linux: Settings › Tabs › Swipe between pages with two fingers exists. */
  touchpadSwipe?: boolean;
  websiteOpen: boolean;
  appearanceChanged?: boolean;
  toolbarChanged?: boolean;
  newTabChanged?: boolean;
  stockSearch?: boolean;
  verticalTabs?: boolean;
  /** Tabs in a sidebar with a toolbar to hide: the "Hide the toolbar" row is shown (the Window view is Full, Compact or Focus, and the address bar is not in the sidebar). */
  hideToolbarRow?: boolean;
  /** The sidebar can be closed in this window (false = Sidebar + address in Full: runtime/windowView.ts sidebarHeldOpen). Absent means it can. */
  sidebarClosable?: boolean;
  /** Beta 14.4: About › Updates offers Insider builds to this profile (runtime/feedback.ts insider.channel.offered). */
  insiderChannel?: boolean;
  /** Beta 14: the closed sidebar is a Mini rail in this window (runtime/miniSidebar.ts miniRailOn), so the edge-reveal rows are not listed. Absent means it is not. */
  miniRail?: boolean;
}

export interface SettingsEntry {
  /** Stable kebab-case id. Never rename: retained search state and links use it. */
  id: string;
  title: string;
  /** One line of context shown under the title in search suggestions. */
  description: string;
  section: string;
  /** Sub-heading inside the section. Second breadcrumb part. */
  group?: string;
  /** Synonyms and nearby words a person might type. Lower-case. */
  aliases: readonly string[];
  /** Value of the `data-setting` attribute on the control row. Defaults to `id`. */
  anchor: string;
  /** DOM id of a collapsed `<details>` that must be opened to reveal the control. */
  expand?: string;
  /** A control people look for by many names and must find at once (R4-56: Tabs, Window view). When the whole query is one of its
   * synonyms it ranks above a title that merely starts with the same word. */
  signpost?: boolean;
  when: SettingsAvailability;
}

type EntryInput = Omit<SettingsEntry, 'anchor' | 'when' | 'aliases' | 'section'> & {
  aliases?: readonly string[];
  anchor?: string;
  expand?: string;
  signpost?: boolean;
  when?: SettingsAvailability;
  /** Beta 14.4: an entry whose home is another page than the file's (the file keeps its stream; the page is where the row renders). */
  section?: string;
};

/** Beta 14.4: the words people type for a setting, in the interface's language: the catalog's `settingsalias.<id>`, comma-separated, when it has one
 *  (titles and descriptions are translated already; these are the everyday words that are not in them: "mode nuit", "Werbeblocker", "fondo de pantalla"). */
export function localAliases(id: string): string[] {
  const key = `settingsalias.${id}` as MessageId, text = t(key);
  return text === key ? [] : text.split(',').map((word) => word.trim()).filter(Boolean);
}

/** Build entries for one section/group with defaults filled in. */
export function defineSettings(section: string, entries: readonly EntryInput[]): SettingsEntry[] {
  return entries.map((entry) => ({
    ...entry,
    section: entry.section ?? section,
    aliases: [...(entry.aliases ?? []), ...localAliases(entry.id)].map((alias) => alias.toLowerCase()),
    anchor: entry.anchor ?? entry.id,
    when: entry.when ?? 'always',
  }));
}

export const anchorSelector = (anchor: string) => `[data-setting="${anchor.replace(/["\\]/g, '')}"]`;

export const breadcrumb = (entry: Pick<SettingsEntry, 'section' | 'group'>) =>
  entry.group && entry.group !== entry.section ? [entry.section, entry.group] : [entry.section];

export function isAvailable(entry: SettingsEntry, context: SettingsContext) {
  switch (entry.when) {
    case 'custom-glass-colors':
      return context.customGlassColors;
    case 'regular-profile':
      return !context.privateProfile;
    case 'desktop':
      return context.desktop;
    case 'system-theme':
      return Boolean(context.systemTheme);
    case 'touchpad-swipe':
      return Boolean(context.touchpadSwipe);
    case 'website-open':
      return context.websiteOpen;
    case 'appearance-changed':
      return Boolean(context.appearanceChanged);
    case 'toolbar-changed':
      return Boolean(context.toolbarChanged);
    case 'newtab-changed':
      return Boolean(context.newTabChanged);
    case 'stock-search':
      return context.stockSearch !== false;
    case 'custom-search':
      return context.stockSearch === false;
    case 'vertical-tabs':
      return Boolean(context.verticalTabs);
    case 'insider-channel':
      return Boolean(context.insiderChannel);
    case 'hide-toolbar-row':
      return Boolean(context.hideToolbarRow);
    case 'sidebar-closable':
      return context.sidebarClosable !== false;
    case 'sidebar-edge':
      return Boolean(context.verticalTabs) && context.sidebarClosable !== false && context.miniRail !== true;
    default:
      return true;
  }
}

