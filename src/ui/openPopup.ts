import { useSyncExternalStore } from 'react';

/** The kind of popup that is open in this window, for the control that opened it: its arrow turns while the popup is up and turns back as it closes. */
let openKind: string | null = null;
const listeners = new Set<() => void>();

export function publishOpenPopup(kind: string | null) {
  if (kind === openKind) return;
  openKind = kind;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useOpenPopup = () => useSyncExternalStore(subscribe, () => openKind, () => null);
