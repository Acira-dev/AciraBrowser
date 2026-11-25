import { useSyncExternalStore } from 'react';
import { RAIL_PANEL_WIDTH, RAIL_SECTIONS, RAIL_WIDTH, type RailSection, type ShelfSettings } from '../runtime/shelf';

/** The Shelf's rail (Beta 14): a 52 px column of icons. Clicking a section's icon opens that section in a panel beside the rail (the page moves over, as for any docked sidebar);
 * clicking the same icon again, Esc, or the rail's own close takes the panel away. Which panel is open belongs to this window and is never saved: a window starts with the rail alone.
 * App needs it too (the sidebar's column is as wide as the rail, or the rail and its panel), so it lives in a small store both read. */
let open: RailSection | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const railPanelOpen = (): RailSection | null => open;
export const isRailSection = (value: unknown): value is RailSection => typeof value === 'string' && (RAIL_SECTIONS as readonly string[]).includes(value);
/** Opens a section's panel, or closes the panel (null). The same section again toggles it away. */
export function setRailPanel(next: RailSection | null) { if (open === next) return; open = next; listeners.forEach((listener) => listener()); }
export const toggleRailPanel = (section: RailSection) => setRailPanel(open === section ? null : section);
export const useRailPanel = (): RailSection | null => useSyncExternalStore(subscribe, railPanelOpen, railPanelOpen);

/** The width of the sidebar's column while the Shelf is the rail: the rail alone, or the rail and the panel beside it. */
export const railColumnWidth = (panel: RailSection | null): number => RAIL_WIDTH + (panel ? RAIL_PANEL_WIDTH : 0);

/** What `--navigation-width` (the sidebar's grid column) says in a window whose sidebar is open: the setting's width, or the rail's. `--sidebar-width` is the drag preview (ui/sidebarLayout previewSidebarWidth), which wins while the edge is being dragged. */
export function navigationWidth(settings: ShelfSettings & { sidebarWidth?: number }, shelfRail: boolean, panel: RailSection | null): string {
  return `var(--sidebar-width,${shelfRail ? railColumnWidth(panel) : settings.sidebarWidth || 240}px)`;
}
