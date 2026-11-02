import { useEffect } from 'react';
import { setRailPrefs } from './railPrefs';

/** The tab layout lives in two places: the native setting `verticalTabs` (shared by every window and saved with the browser)
 * and the per-profile "sidebar-only tabs" switch (this profile's browser storage). AciraSidebar keeps them together whenever
 * one of them changes while it is running. They can still disagree when a window starts: browser storage was cleared (clear on
 * exit), a profile has never had its switch set, a window opened before the other one saved. The strip is drawn from the
 * switch and the sidebar's tab list from the setting, so one saying "toolbar" and the other "sidebar" leaves NO tab list on
 * screen at all, and nothing to click to get one back. The native setting is the truth; this puts the switch back in line. */
export const layoutRepair = (native: boolean, rail: boolean): { tabs: boolean } | null => native === rail ? null : { tabs: native };

/** A change made in Settings reaches the switch first and the setting an IPC round trip later; give that time to finish. */
export const layoutRepairMs = 700;

export function useLayoutRepair(native: boolean, rail: boolean, profileId: string, privateMode: boolean) {
  useEffect(() => {
    const patch = layoutRepair(native, rail);
    if (!patch) return;
    const timer = setTimeout(() => setRailPrefs(patch, profileId, privateMode), layoutRepairMs);
    return () => clearTimeout(timer);
  }, [native, rail, profileId, privateMode]);
}
