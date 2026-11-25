import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import { iconHostOf } from './suggestionRows';

/**
 * The real site icons for the address suggestions list (brief section O, point 3): Acira keeps the icon of every visited site on this computer
 * (the History page already draws from it), so a row shows the site's own icon instead of a globe, and asking for it costs the network nothing.
 *
 * The list opens often and the store can hold hundreds of icons (up to 400 a profile), so the answer is kept for a minute per profile: a list that
 * opens again has its icons on its first frame, and the store is read again in the background when the kept answer is older than that. Nothing is
 * kept for long: three minutes after the last use the answer is dropped, so an idle browser holds none of it (the lowest-RAM goal).
 */
const FRESH_MS = 60_000, DROP_MS = 180_000;
let kept: { scope: string; at: number; icons: Record<string, string> } | null = null, dropTimer: ReturnType<typeof setTimeout> | undefined;
const keep = (scope: string, icons: Record<string, string>, at: number) => { kept = { scope, at, icons }; clearTimeout(dropTimer); dropTimer = setTimeout(() => { kept = null; }, DROP_MS); };
const keptFor = (scope: string) => kept && kept.scope === scope ? kept : null;

/** Test hooks: forget the kept answer, or keep one. */
export function forgetStoredSiteIcons() { kept = null; clearTimeout(dropTimer); }
export function seedStoredSiteIcons(scope: string, icons: Record<string, string>, at = Date.now()) { keep(scope, icons, at); clearTimeout(dropTimer); }

/** `scope` is the active profile's id: icons of another profile are never shown. Returns a lookup by page address. */
export function useStoredSiteIcons(scope: string, now: () => number = Date.now): (url: string) => string | undefined {
  const [icons, setIcons] = useState<Record<string, string>>(() => keptFor(scope)?.icons ?? {});
  useEffect(() => {
    const known = keptFor(scope);
    setIcons(known?.icons ?? {});
    if (known && now() - known.at < FRESH_MS) return;
    let alive = true;
    void Promise.resolve(runtime.service?.({ type: 'favicons.list' })).then(result => {
      const next = result?.favicons ?? {};
      keep(scope, next, now());
      if (alive) setIcons(next);
    }).catch(() => { /* no store to read: the globe stays */ });
    return () => { alive = false; };
  }, [scope]);
  return useCallback((url: string) => icons[iconHostOf(url)], [icons]);
}
