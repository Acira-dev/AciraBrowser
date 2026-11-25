import { SIDEBAR_SIZES, SIDEBAR_SIZE_ORDER, sizeOf, type SidebarSize } from './sidebarSizes';

/** Beta 14, section K: "Top + sidebar", the Shelf.
 *
 * Tabs along the top exactly as today, plus a sidebar that never lists tabs: Favorites, workspaces, Bookmarks, Reading list, History, Downloads, the now-playing card
 * and the profile button. It is the fourth answer of the Tabs choice (ui/sidebarMode.ts).
 *
 * How it is stored. `verticalTabs` stays what it always was: where the TABS live. In the Shelf it is off, so everything that reads it for the tab strip (the strip row, the
 * Ctrl+Tab order, the per-profile switch `layoutRepair` keeps in line, the tab drag targets, the "new tab to the right" wording) keeps treating the window as tabs on top, with
 * no change. A second setting says there is a sidebar anyway:
 *   shelf        a sidebar beside the page, with no tab list in it (only while `verticalTabs` is off: tabs in the sidebar win)
 *   sidebarRail  the Shelf folded to its smallest size: a 52 px column of icons (only while the Shelf is on)
 * Neither needs a default: not set reads as off, so no profile is migrated.
 *
 * Pure and shared: the renderer, the reducer and (through the runtime bundle) main read it from here. */
export interface ShelfSettings { verticalTabs?: boolean; shelf?: boolean; sidebarRail?: boolean }

/** The Shelf is on: tabs along the top and a sidebar beside the page. */
export const shelfOn = (settings: ShelfSettings | null | undefined): boolean => !!settings && settings.shelf === true && settings.verticalTabs !== true;
/** A sidebar exists in this layout: tabs in it (vertical), or the Shelf. This is the question every "is there a sidebar to open, to peek, to size" check asks; where the TABS are is `verticalTabs`. */
export const sidebarOn = (settings: ShelfSettings | null | undefined): boolean => !!settings && (settings.verticalTabs === true || shelfOn(settings));
/** The sidebar is the Shelf's rail. */
export const railOn = (settings: ShelfSettings | null | undefined): boolean => shelfOn(settings) && settings?.sidebarRail === true;

/** The rail's width, and the width of the section panel that opens beside it (the two together are the Wide-ish 320 the sample measured). */
export const RAIL_WIDTH = 52;
export const RAIL_PANEL_WIDTH = 268;
/** Where a drag of the sidebar's edge stops being the rail and becomes Narrow (the midpoint of 52 and 168). */
export const RAIL_BREAK = 110;

/** The sections the rail gives an icon each; a click opens that section in a panel beside the rail. Favorites first, then the library, in the order the shelf lists them by default. (The workspaces list is a popup from its own icon, which shows only where there is more than one workspace.) */
export const RAIL_SECTIONS = ['favorites', 'bookmarks', 'reading', 'history', 'downloads'] as const;
export type RailSection = (typeof RAIL_SECTIONS)[number];

/** What a layout change writes for the Shelf. Tabs in the sidebar and the Shelf never stand together, so a layout with tabs in the sidebar always writes it off. The rail choice is left alone:
 * a person who folded the Shelf to its rail finds it folded again when they come back to the Shelf. */
export const shelfPatch = (next: { tabs: boolean; shelf?: boolean }): { shelf: boolean } => ({ shelf: next.shelf === true && !next.tabs });

/** The Shelf's sizes: the rail, then the three the sidebar always had. The width setting stays one of the three (Narrow 168, Standard 240, Wide 312); the rail is its own switch, so folding the Shelf to its rail
 * and opening it again returns to the size it had. */
export type ShelfSize = 'rail' | SidebarSize;
export const SHELF_SIZE_ORDER: readonly ShelfSize[] = ['rail', ...SIDEBAR_SIZE_ORDER];
export const shelfSizeOf = (settings: ShelfSettings & { sidebarWidth?: number }): ShelfSize => (railOn(settings) ? 'rail' : sizeOf(settings.sidebarWidth));
/** The next smaller (-1) or larger (+1) size; the ends stay where they are. */
export const steppedShelfSize = (size: ShelfSize, direction: -1 | 1): ShelfSize => SHELF_SIZE_ORDER[Math.max(0, Math.min(SHELF_SIZE_ORDER.length - 1, SHELF_SIZE_ORDER.indexOf(size) + direction))];
/** The settings patch that makes the Shelf a size: the rail is a switch of its own, the others also set the width. */
export const shelfSizePatch = (size: ShelfSize): { sidebarRail: boolean; sidebarWidth?: number } => (size === 'rail' ? { sidebarRail: true } : { sidebarRail: false, sidebarWidth: SIDEBAR_SIZES[size] });
/** The size a dragged edge lands on, from the width the pointer gave it (the rail below RAIL_BREAK, then Narrow, Standard and Wide at their midpoints). */
export const shelfSizeAt = (width: number): ShelfSize => (width < RAIL_BREAK ? 'rail' : sizeOf(width));
