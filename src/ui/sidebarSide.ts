import type { Settings, SidebarSide } from '../runtime/types';
import type { MessageId } from '../i18n';

/** Which side of the window the sidebar stands on. One value, `settings.sidebarSide`, shared by every window like the sidebar's width.
 * The side is physical in every language: Arabic's right-to-left reading direction does not move it (rtl.css keeps the frame left to
 * right, because the native page bounds and the Mac window buttons are physical), and the window buttons stay on the left on a Mac. */
export const sidebarSideOf = (settings: Pick<Settings, 'sidebarSide'> | null | undefined): SidebarSide => settings?.sidebarSide === 'right' ? 'right' : 'left';

/** The same value for code that has no settings at hand: the interface's root carries it (App publishes it as `data-sidebar-side`). */
export const rootSidebarSide = (root: Pick<HTMLElement, 'dataset'> | null | undefined = typeof document === 'undefined' ? undefined : document.documentElement): SidebarSide => root?.dataset.sidebarSide === 'right' ? 'right' : 'left';


/** The messages that name the edge the sidebar comes from have a twin for the right (the left one is the original). */
const RIGHT_EDGE = {
  'windowview.edgeSide': 'windowview.edgeSideRight',
  'windowview.closedSidebarEdge': 'windowview.closedSidebarEdgeRight',
  'windowview.closedSidebarEdgeDetail': 'windowview.closedSidebarEdgeDetailRight',
  'windowview.firstRun': 'windowview.firstRunRight',
} as const satisfies Record<string, MessageId>;
export const sidebarEdgeId = (id: keyof typeof RIGHT_EDGE, side: SidebarSide): MessageId => side === 'right' ? RIGHT_EDGE[id] : id;

type Box = { x: number; y: number; width: number; height: number };
/** Did the page card just move with the docked sidebar (main glides it on the sidebar's spring: layout `pageMotion: 'slide'`)? The card's near edge, the one beside the
 * sidebar, travels at least 40px while its far edge stays (within 8px) or the card keeps its size (a floating reveal), and the card stays at its height. With the
 * sidebar on the left the near edge is the card's left one, on the right its right one. */
export function pageSlidesWithSidebar(side: SidebarSide, was: Box | null | undefined, page: Box, reducedMotion: boolean): boolean {
  if (!was || reducedMotion) return false;
  const sameWidth = Math.abs(page.width - was.width) <= 1, left = page.x - was.x, right = page.x + page.width - was.x - was.width;
  const [near, far] = side === 'right' ? [right, left] : [left, right];
  return Math.abs(near) >= 40 && (Math.abs(far) <= 8 || sameWidth) && Math.abs(page.y - was.y) <= 40;
}

/** x and width of a box seen from the other side of a window `viewport` wide (the same box in a mirror): the mirror of the mirror is the box. */
export const mirrorSpan = (x: number, width: number, viewport: number): { x: number; width: number } => ({ x: viewport - x - width, width });
