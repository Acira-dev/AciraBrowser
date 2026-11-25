import { FAVORITES_ACROSS, type SidebarSize } from '../runtime/sidebarSizes';

/** The Favorites stack (Beta 14, L1): how many places the Favorites grid has before the rest gather in one stack tile that opens a panel.
 *
 *  Settings › Tabs › Sidebar › Favorites › "Favorites before the stack": 6, 9, 12 (the default), 16, 20 or Show all. With the limit at 12 and exactly 12
 *  Favorites, all 12 show as tiles. From the 13th on, the last place becomes the stack and holds the rest (so a stack always holds two or more). In the Narrow
 *  sidebar (2 across) the stack never comes later than 8 places, four rows. If the Favorite you are on is one of the folded ones, it sits at the front of the stack
 *  (the selected look). Pure: no DOM, so the rule is tested without a window. */
export const STACK_LIMIT_CHOICES = [6, 9, 12, 16, 20] as const;
export type StackLimitChoice = (typeof STACK_LIMIT_CHOICES)[number] | 'all';
export const DEFAULT_STACK_LIMIT = 12 as const;
/** The Narrow sidebar never stacks later than this many places. */
export const NARROW_STACK_LIMIT = 8;

export const validStackLimit = (value: unknown): value is StackLimitChoice => value === 'all' || (STACK_LIMIT_CHOICES as readonly unknown[]).includes(value);
/** What a saved choice means: nothing saved is the default. */
export const stackLimitOf = (saved: unknown): StackLimitChoice => (validStackLimit(saved) ? saved : DEFAULT_STACK_LIMIT);

/** The places the grid has at a size: the chosen number, at most 8 in the Narrow sidebar; `Infinity` for Show all. */
export function placesBeforeStack(choice: StackLimitChoice | undefined, size: SidebarSize): number {
  const chosen = stackLimitOf(choice);
  const places = chosen === 'all' ? Infinity : chosen;
  return size === 'narrow' ? Math.min(places, NARROW_STACK_LIMIT) : places;
}

export interface FavoritesFold<T> {
  /** More Favorites than places: the last place is the stack. */
  overflow: boolean;
  /** The tiles drawn in the grid (all of them when nothing folds). */
  shown: T[];
  /** The Favorites that gather in the stack, in the order they have in the grid and the panel. */
  folded: T[];
  /** The stack's own order: the selected Favorite first when it is folded, then the others. Three of these show as plates. */
  stacked: T[];
}

/** Splits the Favorites at `places`: the first places-1 show, the rest fold. `frontId`: the Favorite that is selected, put at the front of the stack when folded. */
export function foldFavorites<T extends { id: string }>(apps: readonly T[], places: number, frontId?: string): FavoritesFold<T> {
  if (!(apps.length > places)) return { overflow: false, shown: [...apps], folded: [], stacked: [] };
  const take = Math.max(1, places - 1), shown = apps.slice(0, take), folded = apps.slice(take);
  const front = frontId ? folded.find(app => app.id === frontId) : undefined;
  return { overflow: true, shown, folded, stacked: front ? [front, ...folded.filter(app => app !== front)] : folded };
}

/** Columns while a stack is drawn: the size's own (2, 3 or 4 across). Without a stack the grid keeps its usual reflow (runtime/sidebarSizes.ts favoriteColumns). */
export const stackColumns = (size: SidebarSize): number => FAVORITES_ACROSS[size];

/** How many plates show in the stack (the front one and up to two behind it). */
export const STACK_PLATES = 3;

/** The panel is at least this many rows tall, and as tall as the grid it covers otherwise (it scrolls inside when there are more). */
export const PANEL_MIN_ROWS = 3;
export const panelRows = (places: number, columns: number, tiles: number): number => Math.max(PANEL_MIN_ROWS, Math.ceil(Math.min(places, tiles) / columns));
