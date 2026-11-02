/** Pure types and helpers for the Settings registry. No Vite-only imports, so Node tests can load it. */

export const settingsSections = [
  'Appearance',
  'Profiles',
  'Tabs',
  'New tab',
  'Search',
  'Privacy',
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
  | 'website-open' // needs an open website tab in this profile
  | 'appearance-changed' // Reset rows exist only while something differs from the default
  | 'toolbar-changed'
  | 'newtab-changed'
  | 'stock-search'
  | 'custom-search'
  | 'vertical-tabs'; // sidebar-tabs layout only // only the three built-in engines exist; custom engines use the Search engines panel

export interface SettingsContext {
  customGlassColors: boolean;
  privateProfile: boolean;
  desktop: boolean;
  websiteOpen: boolean;
  appearanceChanged?: boolean;
  toolbarChanged?: boolean;
  newTabChanged?: boolean;
  stockSearch?: boolean;
  verticalTabs?: boolean;
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
};

/** Build entries for one section/group with defaults filled in. */
export function defineSettings(section: string, entries: readonly EntryInput[]): SettingsEntry[] {
  return entries.map((entry) => ({
    ...entry,
    section,
    aliases: (entry.aliases ?? []).map((alias) => alias.toLowerCase()),
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
    default:
      return true;
  }
}

