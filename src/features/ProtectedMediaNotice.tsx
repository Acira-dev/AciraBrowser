import { useEffect, useRef } from 'react';
import { runtime } from '../runtime/client';
import type { BrowserAction, BrowserSnapshot } from '../runtime/types';

import { t } from '../i18n';
/** Explain a rejected protected-playback request once per site. ECS builds (Mac, Windows Widevine builds) prepare Widevine automatically;
 * other builds, unsupported codecs or component/service failures may still reject it. */
export const protectedMediaText = "Acira couldn't start protected playback on this site.";
const storageKey = 'acira-protected-media-seen';
const sessionSeen = new Set<string>();

function seen(profileId: string, host: string, persistent: boolean) {
  if (sessionSeen.has(profileId + '|' + host)) return true;
  if (!persistent) return false;
  try { return (JSON.parse(localStorage.getItem(storageKey) || '{}')[profileId] ?? []).includes(host); } catch { return false; }
}
function remember(profileId: string, host: string, persistent: boolean) {
  sessionSeen.add(profileId + '|' + host);
  if (!persistent) return;
  try {
    const all = JSON.parse(localStorage.getItem(storageKey) || '{}');
    all[profileId] = [...new Set([...(all[profileId] ?? []), host])].slice(-500);
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch { /* the notice just comes back next time */ }
}

export function ProtectedMediaNotice({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => runtime.subscribeBrowser(event => {
    if (event.type !== 'protected-media') return;
    const current = latest.current, tab = current.tabs.find(item => item.id === event.tabId);
    // Only the tab the person is looking at; a background tab says nothing and is told again when it is shown.
    if (!tab || tab.id !== current.activeTabId || !/^[a-z0-9.-]{1,253}$/i.test(event.host)) return;
    const profileId = tab.browserProfileId, persistent = !current.browserProfiles.find(profile => profile.id === profileId)?.private;
    if (seen(profileId, event.host, persistent)) return;
    remember(profileId, event.host, persistent);
    dispatch({ type: 'toast', text: protectedMediaText, tone: 'info', action: { label: t("protectedmedianotice.learnMore"), settings: 'known-limits', command: { type: 'tab.new', url: 'acira://settings' } } });
  }), [dispatch]);
  return null;
}
