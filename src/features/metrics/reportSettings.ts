import type { BrowserRuntime } from '../../runtime/types';
import { readCtrlTabMode, subscribeCtrlTabMode } from '../../ui/tabMru';
import { readSidebarApps } from '../../ui/sidebarApps';

/** Beta 14 (B8): the choice of a setting that lives in the interface (localStorage) and not in the saved settings, reported to main so the daily usage message can say it as a value of a closed list.
 *  Main keeps only a `name` of its list of Beta 14's own settings and a `value` of that field's list (usage-facts.cjs acceptReport), in memory, from an ordinary window; anything else is dropped.
 *  Whoever builds one of those settings calls this where the choice changes and once at start-up: `reportSetting('hiddenSidebarReveal', 'handle')`. Fire and forget, never throws. */
export function reportSetting(name: string, value: string) {
  try { const native = (window as { acira?: BrowserRuntime }).acira; if (native) void native.service({ type: 'metrics.setting', name, value }).catch(() => undefined); } catch { /* not in the app */ }
}

/** The two choices that already live in the interface: Ctrl+Tab's mode (ui/tabMru.ts) and Favorites before the stack (ui/sidebarApps.ts, per profile). Reported 4 s after start, when either changes, and when the
 *  window is focused again (the other profile's choice). Only the window's own interface view reports (not the popup layer), and never a private window or profile. */
export function installSettingsReport() {
  const native = (window as { acira?: BrowserRuntime }).acira;
  if (!native || new URLSearchParams(location.search).get('view')) return;
  const sent: Record<string, string> = {};
  const send = (name: string, value: string) => { if (sent[name] === value) return; sent[name] = value; reportSetting(name, value); };
  const scan = async () => {
    try {
      const snapshot = await native.getSnapshot();
      const profile = snapshot.browserProfiles.find((item) => item.id === snapshot.activeBrowserProfileId);
      if (!profile || profile.private) return;
      send('ctrlTabMode', readCtrlTabMode());
      send('favoritesBeforeStack', String(readSidebarApps(profile.id, false).limit ?? 12));
    } catch { /* a report that cannot be made is never a problem for the window */ }
  };
  setTimeout(() => void scan(), 4000);
  window.addEventListener('focus', () => void scan());
  window.addEventListener('acira-sidebar-apps', () => void scan());
  subscribeCtrlTabMode(() => void scan());
}
