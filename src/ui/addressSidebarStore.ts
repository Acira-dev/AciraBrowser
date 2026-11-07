import { useSyncExternalStore } from 'react';

/** What the sidebar needs to know about the address block: it is drawn at the top of the sidebar (`block`), and its pill row is open
 * (`open`). The block lives in the toolbar (App.tsx, AddressMore.tsx); the sidebar leaves room for it and, while the row is open,
 * slides its content down on the same curve (data attributes on its <aside>, address-in-sidebar.css). One tiny store, one writer each. */
export interface AddressSidebarState { block: boolean; open: boolean }
let current: AddressSidebarState = { block: false, open: false };
const listeners = new Set<() => void>();

export function publishAddressSidebar(patch: Partial<AddressSidebarState>): void {
  const next = { ...current, ...patch };
  if (next.block === current.block && next.open === current.open) return;
  current = next.block ? next : { block: false, open: false };
  listeners.forEach(listener => listener());
}
export const readAddressSidebar = (): AddressSidebarState => current;
export const useAddressSidebar = (): AddressSidebarState => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
