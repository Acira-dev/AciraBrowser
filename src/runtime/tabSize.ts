/** 14.3 "Tab size" (reported 21 Nov: "no tab size setting, only Interface size"): how tall the tabs are, apart from Interface size (which scales everything).
 *  - Small    the sidebar's rows 28 px, the strip along the top 32 px with 26 px tabs
 *  - Standard what Acira has always drawn: rows 32 px, the strip 36 px with 30 px tabs (no attribute on the root, so nothing changes for anyone who never picks)
 *  - Large    rows 38 px, the strip 40 px with 34 px tabs
 * The sidebar's rows are its list rows (tabs, New tab, groups, bookmarks: one rhythm), and the Mini rail's tile follows them. Favorites, the Compact view's one-row toolbar and the
 * pop-ups keep their own sizes. Text and icons keep their size: Interface size is the setting for those. Pure and shared (the reducer, Settings and the window's geometry read it). */
export type TabSize = 'small' | 'standard' | 'large';
export const TAB_SIZES: readonly TabSize[] = ['small', 'standard', 'large'];
export const isTabSize = (value: unknown): value is TabSize => value === 'small' || value === 'standard' || value === 'large';
export const tabSizeOf = (settings: { tabSize?: unknown } | null | undefined): TabSize => (settings?.tabSize === 'small' || settings?.tabSize === 'large' ? settings.tabSize : 'standard');
/** The row along the top that holds the tabs (design-tokens.json geometry.tabRow is Standard's 36). */
export const TAB_ROW_HEIGHT: Readonly<Record<TabSize, number>> = { small: 32, standard: 36, large: 40 };
/** A tab in that row (3 px of air above and below, as today). */
export const TOP_TAB_HEIGHT: Readonly<Record<TabSize, number>> = { small: 26, standard: 30, large: 34 };
/** The sidebar's row (sidebar.css --sb-row is Standard's 32). */
export const SIDEBAR_ROW_HEIGHT: Readonly<Record<TabSize, number>> = { small: 28, standard: 32, large: 38 };
export const tabRowHeight = (settings: { tabSize?: unknown } | null | undefined): number => TAB_ROW_HEIGHT[tabSizeOf(settings)];
