import type { Settings, WindowUi } from './types';
import { toolbarLayout } from './toolbarLayout';

/** R3-68 + R3-65: one dial for how much chrome a window shows, replacing the Toolbar select, the Focus switch and the hidden
 * "Hide until needed" flag (docs/launch/research/SEAMLESS_MODE_SPEC.md §3). Ordered by how much is on screen:
 *  - full      everything, always visible
 *  - compact   a smaller toolbar; everything is still there
 *  - focus     only what you need to read and navigate
 *  - seamless  just the page; point at an edge for the toolbar or the sidebar
 * Tabs in a strip or in the sidebar is a separate, unchanged choice. Pure and shared: the renderer, the reducer and (through
 * the runtime bundle) the main process all read it from here. */
export const windowViews = ['full', 'compact', 'focus', 'seamless'] as const;
export type WindowView = (typeof windowViews)[number];
export const isWindowView = (value: unknown): value is WindowView => typeof value === 'string' && (windowViews as readonly string[]).includes(value);

/** Which edges reveal chrome while the view is Seamless. Both on unless the person turns one off. */
export interface SeamlessEdges { top: boolean; side: boolean }
export const seamlessEdgesOf = (settings: { seamlessEdges?: Partial<SeamlessEdges> } | null | undefined): SeamlessEdges => ({ top: settings?.seamlessEdges?.top !== false, side: settings?.seamlessEdges?.side !== false });

/** R5 (founder: "if I close the sidebar, it must not open automatically when the mouse nears the edge, especially in Full
 * view"): outside Seamless, whether a closed sidebar shows when the pointer rests at the left edge is a switch per view.
 * Full keeps a closed sidebar closed; Compact and Focus show it, as before. Seamless has its own switch (`seamlessEdges.side`). */
export type PeekView = Exclude<WindowView, 'seamless'>;
export const peekViews = ['full', 'compact', 'focus'] as const satisfies readonly PeekView[];
export type SidebarPeek = Record<PeekView, boolean>;
export const sidebarPeekDefaults: Readonly<SidebarPeek> = { full: false, compact: true, focus: true };
/** The marker restoreSnapshot writes once a profile has had the per-view defaults (`settings.sidebarPeekDefault`). */
export const SIDEBAR_PEEK_DEFAULT = 1;
export const sidebarPeekOf = (settings: { sidebarPeek?: Partial<SidebarPeek> } | null | undefined): SidebarPeek => {
  const saved = settings?.sidebarPeek && typeof settings.sidebarPeek === 'object' ? settings.sidebarPeek : {};
  return { full: typeof saved.full === 'boolean' ? saved.full : sidebarPeekDefaults.full, compact: typeof saved.compact === 'boolean' ? saved.compact : sidebarPeekDefaults.compact, focus: typeof saved.focus === 'boolean' ? saved.focus : sidebarPeekDefaults.focus };
};

/** "Hide the toolbar" (Settings › Appearance › Layout, 13.3): with tabs in a sidebar (but not Sidebar mode, which has no toolbar to hide) the Full, Compact and Focus toolbar goes the way
 * Seamless's does: nothing over the page until the pointer rests at the top edge. The view stays what it is and the sidebar behaves as it does there; only the toolbar's hiding and its reveal are
 * Seamless's. Seamless itself never needs it (it hides the toolbar already). Pure and shared with main, which watches the top edge for it. */
export const hideToolbarOn = (settings: { hideToolbar?: boolean; verticalTabs?: boolean; addressInSidebar?: boolean } | null | undefined, view: WindowView): boolean =>
  settings?.hideToolbar === true && settings.verticalTabs === true && settings.addressInSidebar !== true && view !== 'seamless';

type Legacy = Partial<Settings> & { automaticCompact?: boolean; pinExpanded?: boolean };

/** The default view for every window. Settings written before the dial existed carry only the Toolbar choice: its
 * "automatic" (or the older automaticCompact flag) was Compact, everything else Full. */
export function windowViewOf(settings: Legacy | null | undefined): WindowView {
  // A settings object that still carries the oldest flags and no Toolbar choice is being migrated: they decide.
  if (settings && settings.automaticCompact !== undefined && settings.toolbarLayout === undefined) return toolbarLayout(settings) === 'automatic' ? 'compact' : 'full';
  if (isWindowView(settings?.windowView)) return settings.windowView;
  return toolbarLayout(settings ?? {}) === 'automatic' ? 'compact' : 'full';
}

/** This window's view: its own choice (persisted with the session) or else the default. */
export function effectiveView(settings: Legacy | null | undefined, windowUi: Pick<WindowUi, 'view'> | null | undefined): WindowView {
  return isWindowView(windowUi?.view) ? windowUi.view : windowViewOf(settings);
}

/** What `windowUi.view` becomes when `mode` is toggled for this window. Toggling the mode in force returns to the default
 * (null), or to Full when the default is that mode; toggling another mode replaces this one, so views never stack.
 * `null` clears the window's own choice. */
export function toggleView(settings: Legacy | null | undefined, windowUi: Pick<WindowUi, 'view'> | null | undefined, mode: WindowView): WindowView | null {
  if (effectiveView(settings, windowUi) !== mode) return mode;
  return windowViewOf(settings) === mode ? 'full' : null;
}

/** The old Focus switch (`ui.update { focusMode }`, routines, shortcuts) in terms of the dial. Turning Focus off leaves any
 * other view alone. */
export function viewForFocus(settings: Legacy | null | undefined, windowUi: Pick<WindowUi, 'view'> | null | undefined, on: boolean): WindowView | null {
  if (on) return 'focus';
  return effectiveView(settings, windowUi) === 'focus' ? toggleView(settings, windowUi, 'focus') : isWindowView(windowUi?.view) ? windowUi.view : null;
}

/** The old Toolbar setting kept in step with the dial for everything that still reads it (usage facts, layout diffing). */
export const toolbarLayoutFor = (view: WindowView): 'expanded' | 'automatic' => view === 'compact' ? 'automatic' : 'expanded';

/** A settings patch with the dial and its legacy mirror reconciled: a patch that names `windowView` wins; an old writer that
 * only names `toolbarLayout` (setup, the Appearance panel of an older build, the shortcut) moves Compact on or off and leaves
 * Focus and Seamless as they were. Patches that name neither pass through untouched. */
export function windowViewPatch(settings: Legacy, patch: Partial<Settings>): Partial<Settings> {
  let view: WindowView | undefined;
  if (isWindowView(patch.windowView)) view = patch.windowView;
  else if (patch.toolbarLayout !== undefined) {
    const current = windowViewOf(settings);
    view = patch.toolbarLayout === 'automatic' ? 'compact' : current === 'compact' ? 'full' : current;
  }
  return view ? { ...patch, windowView: view, toolbarLayout: toolbarLayoutFor(view) } : patch;
}

/** Hide until needed (the renderer-only localStorage flag of UF-008) is Seamless: once, at boot. Returns the settings patch
 * to apply and whether to tell the person (the sidebar now hides too). Nothing happens when the flag is off; when the
 * default is already Seamless the flag is only cleared, with no notice. */
export function migrateAutoHide(settings: Legacy, flag: boolean): { patch: Partial<Settings> | null; notify: boolean } {
  if (!flag || windowViewOf(settings) === 'seamless') return { patch: null, notify: false };
  return { patch: { windowView: 'seamless' }, notify: true };
}
