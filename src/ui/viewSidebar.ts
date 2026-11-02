import type { WindowView } from '../runtime/windowView';

/** R4-25: with tabs in the sidebar, Compact and Focus tuck the sidebar behind the row's sidebar button, so they visibly differ
 * from Full (the row alone was 4px shorter, which read as "nothing happens"). Ctrl+S and the button open it as always; going
 * back to Full or Seamless reopens it only if the switch itself closed it. Pure: App applies `open` with its sidebar patch. */
export const slimView = (view: WindowView): boolean => view === 'compact' || view === 'focus';

export function tuckSidebarStep(input: { before: WindowView; after: WindowView; sidebarTabs: boolean; open: boolean; reopen: boolean }): { open?: boolean; reopen: boolean } {
  const { before, after, sidebarTabs, open, reopen } = input;
  if (before === after) return { reopen };
  if (!sidebarTabs) return { reopen: false };
  if (slimView(after) && !slimView(before)) return open ? { open: false, reopen: true } : { reopen: false };
  if (!slimView(after) && slimView(before) && reopen) return open ? { reopen: false } : { open: true, reopen: false };
  return { reopen };
}
