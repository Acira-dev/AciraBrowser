// What the sheet's screens reach out to, in one place so a test can hand them stand-ins: the service call, the interface preferences of the profile, the
// profile's id, the clock, the clipboard. Nothing here runs until a screen asks.
import { createContext, useContext } from 'react';
import { runtime } from '../../runtime/client';
import type { CollectedUi } from '../../ui/profileUiPrefs';
import { transferCall } from './client';
import type { TransferRequest, TransferResultBag } from './types';

export interface SheetEnv {
  call: (request: TransferRequest) => Promise<TransferResultBag>;
  /** The profile this window is showing (the active tab's profile, else the active profile). */
  profileId: () => Promise<string>;
  /** The interface preferences a transfer carries (they live in this page's localStorage, spec 9.2). */
  collectUi: (profileId: string) => Promise<CollectedUi>;
  now: () => number;
  /** Puts text on the clipboard from a trusted click. */
  copy: (text: string) => Promise<void>;
  /** Asks for an update check (the "Check for updates" action of the newer-Acira message). */
  checkForUpdates: () => Promise<unknown>;
}

export const defaultEnv: SheetEnv = {
  call: transferCall,
  profileId: async () => {
    const snapshot = await runtime.getSnapshot();
    return snapshot.tabs.find(tab => tab.id === snapshot.activeTabId)?.browserProfileId ?? snapshot.activeBrowserProfileId;
  },
  collectUi: async profileId => (await import('../../ui/profileUiPrefs')).collectUiPrefs(profileId),
  now: () => Date.now(),
  copy: async text => (await import('../../ui/pageActions')).copyText(text),
  checkForUpdates: () => runtime.service({ type: 'update.check' }).catch(() => undefined),
};

export const SheetEnvContext = createContext<SheetEnv>(defaultEnv);
export const useSheetEnv = (): SheetEnv => useContext(SheetEnvContext);
