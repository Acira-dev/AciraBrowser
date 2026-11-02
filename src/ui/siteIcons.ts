import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { BrowserSnapshot } from '../runtime/types';

const hostOf = (url: string) => {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
};

/** Site icons for pages that list sites you are not on (History, Bookmarks, new tab links): ready-made images kept on this computer
 *  while you were on each site, so showing them asks the network for nothing. Returns a lookup by page address. */
export function useSiteIcons(state: BrowserSnapshot) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const stamp = `${state.activeBrowserProfileId}:${state.browsingHistory.length}:${state.bookmarkNodes.length}`;
  useEffect(() => {
    let alive = true;
    void runtime.service({ type: 'favicons.list' }).then(result => { if (alive) setIcons(result.favicons ?? {}); }).catch(() => {});
    return () => { alive = false; };
  }, [stamp]);
  return useCallback((url: string) => icons[hostOf(url)], [icons]);
}
