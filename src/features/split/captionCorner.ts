import { SPLIT_LAYOUTS, type SplitState } from '../../runtime/splitLayout';

/** Windows, Sidebar mode: the window's caption buttons are a notch over the window's top-right corner (desktop/caption-notch.cjs: 138 px of buttons, a 144 x 36 corner that
 * shows them the moment the pointer is there). In a split that corner is the title row of the pane at the top right, so that pane's reload and close buttons sat under the
 * window's own minimise / maximise / close (reported 10 Nov 2026: split view in the Sidebar + address layout "doesn't work, it's really glitchy and weird").
 * The pane whose title row reaches that corner keeps its buttons left of it (split.css `[data-caption-corner]`). Returns its index in the split's panes, or -1.
 * A pane's place is absolute (paneEdges), never mirrored for a right-to-left interface, and the caption buttons are always at the right: the top row's last cell is that pane. */
export function captionCornerPane(split: Pick<SplitState, 'layout' | 'tabIds'> | null | undefined, captionNotch: boolean): number {
  if (!captionNotch || !split || (split.tabIds?.length ?? 0) < 2) return -1;
  const top = SPLIT_LAYOUTS[split.layout]?.areas?.[0];
  const index = top?.length ? top[top.length - 1] : -1;
  return Number.isInteger(index) && index >= 0 && index < split.tabIds.length ? index : -1;
}

/** Is a Windows caption box over the page's top-right corner? The Sidebar-mode notch, or the caption
 * that stays hidden over the page while the toolbar is hidden over it (Seamless, Hide the toolbar): its 138 px of buttons are still the window's, so a split's top-right title
 * row under them lost its close and reload the same way (the overlap matrix: 98 of 320 states, all pre-existing). Not in full screen (no caption buttons). Read from the toolbar
 * being hidden as a layout (Seamless / Hide the toolbar on), not from a reveal, so the buttons never move while the top bar comes and goes. */
export const captionOverPage = (platform: string, notch: boolean, toolbarHidden: boolean, fullscreen: boolean): boolean => notch || (platform === 'win32' && toolbarHidden && !fullscreen);
