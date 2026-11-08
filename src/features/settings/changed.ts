import type { NewTabPreferences } from '../../ui/newTabPreferences';
import type { Settings, SidebarSide } from '../../runtime/types';
import type { SidebarFolders } from '../../ui/railPrefs';
import { SIDEBAR_SIZES } from '../../runtime/sidebarSizes';
import { defaultAppearancePalette, palettePreference } from '../../runtime/appearancePalettes';

const defaultModules = { workspace: true, artwork: true, name: false, mark: false, search: true, shortcuts: false, saved: true, recent: true };

/** True when the new-tab layout differs from its defaults; the Reset row only exists then. */
export function newTabChanged(prefs: Pick<NewTabPreferences, 'modules' | 'daily' | 'perTab' | 'hourly' | 'collection' | 'caption' | 'frequent' | 'artStyle' | 'artwork'>, defaultArtwork: string) {
  return (Object.keys(defaultModules) as (keyof typeof defaultModules)[]).some((key) => prefs.modules[key] !== defaultModules[key]) || prefs.daily || prefs.perTab === true || prefs.hourly === true || (prefs.collection ?? 'built-in') !== 'built-in' || prefs.caption === false || prefs.frequent || prefs.artStyle !== 'framed' || prefs.artwork !== defaultArtwork;
}

/** The settings Settings › Appearance › Reset appearance looks at and puts back. */
export type AppearanceLook = Partial<Pick<Settings, 'colorPreset' | 'accentColor' | 'browserTint' | 'interfaceScale' | 'systemTheme' | 'reducedMotion' | 'animationSpeed' | 'reducedTransparency' | 'siteColor' | 'glassOpacity' | 'surfaceColor' | 'sidebarColor' | 'toolbarColor' | 'tabColor'>>;

const DEFAULT_GLASS_OPACITY = 64;

/** True when something Reset appearance puts back differs from its default; the Reset row only exists then. Every key in appearanceResetPatch has a test here, so a setting
 * the reset restores can never be one the row ignores (Site color was: tests/settings-reset-lists.test.ts). Custom window colors count only while they are switched on (a glass opacity is set). */
export function appearanceLookChanged(s: AppearanceLook): boolean {
  const defaults = palettePreference(defaultAppearancePalette) as Record<string, unknown>;
  return Object.entries(defaults).some(([key, value]) => (s as Record<string, unknown>)[key] !== value)
    || s.interfaceScale !== 100
    || Boolean(s.systemTheme)
    || Boolean(s.reducedMotion)
    || s.animationSpeed === 'fast'
    || Boolean(s.reducedTransparency)
    || (s.siteColor ?? 'soft') !== 'soft'
    || (typeof s.glassOpacity === 'number' && (s.glassOpacity !== DEFAULT_GLASS_OPACITY || Boolean(s.surfaceColor) || Boolean(s.sidebarColor) || Boolean(s.toolbarColor) || Boolean(s.tabColor)));
}

/** What the Reset button writes: the default finish, interface size, Match my system theme off, Animation speed Premium, motion and transparency on, Site color Soft, and the custom window colors cleared. */
export function appearanceResetPatch(s: AppearanceLook): Partial<Settings> {
  return {
    ...palettePreference(defaultAppearancePalette),
    interfaceScale: 100,
    ...(s.systemTheme ? { systemTheme: false } : {}),
    reducedMotion: false,
    animationSpeed: 'premium',
    reducedTransparency: false,
    siteColor: 'soft',
    ...(typeof s.glassOpacity === 'number'
      ? { glassOpacity: DEFAULT_GLASS_OPACITY, surfaceColor: undefined, sidebarColor: undefined, toolbarColor: undefined, tabColor: undefined }
      : {}),
  };
}

/** What Reset sidebar layout puts back (Settings › Tabs › Sidebar): the sidebar shown, on the left, at Standard size, tabs along the top, Favorites shown at the top with their tabs
 * in the tab list, new tabs at the top, tab groups among the tabs. Kept as they are: the Favorites themselves, the sidebar sections (hidden, reordered) and the edge switches.
 * The button and the check that enables it both read this one list. */
export const SIDEBAR_RESET = {
  settings: { sidebarWidth: SIDEBAR_SIZES.standard, sidebarSide: 'left' as SidebarSide, favoriteTabsInList: true, verticalTabs: false },
  appsHidden: false,
  appsPlace: 'top' as 'top' | 'bottom',
  rail: { tabs: false, newTabsTop: true, newTabsTopChosen: false, folders: 'mixed' as SidebarFolders },
  shown: true,
};

export interface SidebarLayoutNow {
  width: number;
  side: SidebarSide;
  appsHidden: boolean;
  appsPlace: 'top' | 'bottom';
  favoriteTabsInList: boolean | undefined;
  /** Tabs live in the sidebar: the setting or the profile's own copy of it. */
  tabsInSidebar: boolean;
  newTabsTop: boolean | undefined;
  folders: SidebarFolders | undefined;
  open: boolean;
}

/** True when anything Reset sidebar layout puts back differs from its default; the button is enabled then. */
export function sidebarLayoutChanged(now: SidebarLayoutNow): boolean {
  const d = SIDEBAR_RESET;
  return now.width !== d.settings.sidebarWidth
    || now.side !== d.settings.sidebarSide
    || now.appsHidden !== d.appsHidden
    || now.appsPlace !== d.appsPlace
    || (now.favoriteTabsInList ?? d.settings.favoriteTabsInList) !== d.settings.favoriteTabsInList
    || now.tabsInSidebar !== d.settings.verticalTabs
    || (now.newTabsTop ?? d.rail.newTabsTop) !== d.rail.newTabsTop
    || (now.folders ?? d.rail.folders) !== d.rail.folders
    || now.open !== d.shown;
}
