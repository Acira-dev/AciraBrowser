import type { BrowserSnapshot } from '../../runtime/types';
import type { CatalogArtwork } from '../../ui/newTabPreferences';

type History = BrowserSnapshot['browsingHistory'];

export const address = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
export const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return address(url); } };

export interface ArtworkCaption { title: string; byline: string[]; museum?: string }
/** What sits under the painting: the title, then artist and year. The museum and licence are only a tooltip, never printed. */
export function artworkCaption(artwork: Pick<CatalogArtwork, 'name' | 'artist' | 'date' | 'provider' | 'rights'>): ArtworkCaption {
  const clean = (value?: string) => (value ?? '').trim();
  const museum = [clean(artwork.provider), clean(artwork.rights)].filter(Boolean).join(' · ');
  return { title: clean(artwork.name), byline: [clean(artwork.artist), clean(artwork.date)].filter(Boolean), museum: museum || undefined };
}

/** History that belongs to one profile. Entries recorded before profiles existed belong to the first profile. */
export const profileHistory = (history: History, profileId: string, firstProfileId?: string) => history.filter((item) => (item.browserProfileId ?? firstProfileId) === profileId);

/** Frequently visited pages, newest tie-break. Only ordinary web addresses count and private windows see none. */
export function frequentPages(history: History, skip: Set<string>, limit: number, privateMode = false) {
  if (privateMode) return [];
  const pages = new Map<string, { url: string; title: string; count: number; time: string }>();
  for (const item of history) {
    if (!/^https?:\/\//i.test(item.url)) continue;
    const current = pages.get(item.url);
    if (current) current.count++;
    else pages.set(item.url, { url: item.url, title: item.title, count: 1, time: item.time });
  }
  return [...pages.values()].filter((item) => !skip.has(item.url)).sort((a, b) => b.count - a.count || b.time.localeCompare(a.time)).slice(0, Math.max(0, limit));
}

/** A short, restrained list of distinct recent pages. Private windows never reveal ordinary history. */
export function recentPages(history: History, limit = 4, privateMode = false) {
  if (privateMode) return [];
  // First visit of each distinct address, newest first: one pass that stops at the limit (it was a findIndex per item, quadratic over 5000 visits: ~50 ms for every New tab).
  const seen = new Set<string>(), found: History = [];
  for (const item of history) {
    if (item.url.startsWith('acira://') || seen.has(item.url)) continue;
    seen.add(item.url); found.push(item);
    if (found.length >= limit) break;
  }
  return found;
}

const byHistory = new WeakMap<object, Map<string, unknown>>();
/** A result worked out from the history list is kept for as long as the list itself is the same one (the reducer replaces it when it changes), so every new New tab page reuses it. */
export function fromHistory<T>(history: object, key: string, compute: () => T): T {
  let kept = byHistory.get(history); if (!kept) { kept = new Map(); byHistory.set(history, kept); }
  if (!kept.has(key)) { if (kept.size > 24) kept.clear(); kept.set(key, compute()); }
  return kept.get(key) as T;
}

/** The name under a 56px tile. A page title is a sentence ("Pull requests · acira-dev/browser"), so use the part of it that names
 *  the site, then a short title as it is, and otherwise the site's own name. An address loses its scheme, www and port. */
export function tileLabel(title: string, url: string) {
  const name = /^https?:\/\//i.test(title.trim()) ? '' : title.trim(), where = host(url), isAddress = (value: string) => /^[\d.:[\]a-f]+$/i.test(value);
  const bare = (value: string) => isAddress(value) ? value.replace(/:\d+$/, '') : value.replace(/^https?:\/\/(www\.)?/i, '');
  if (!name || isAddress(where)) return bare(name || where);
  const labels = where.split('.'), second = labels[labels.length - 2] || '';
  const base = (labels.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(second) ? labels[labels.length - 3] : second) || labels[0];
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const part = name.split(/\s+[\u2013\u2014\u00b7|:-]\s+/).map((item) => item.trim()).find((item) => item.length > 0 && item.length <= 18 && !item.includes('/') && !/^\S+\.[a-z]{2,}$/i.test(item) && key(item).includes(key(base)));
  if (part) return part;
  if (name.length <= 14 && !/^https?:\/\//i.test(name) && !name.includes('/')) return name;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** A new tab in a private or Tor tab (even one opened in an ordinary profile) never shows links built from browsing history. */
export const isPrivateNewTab = (profilePrivate: boolean, tabPrivacy?: string) => profilePrivate || tabPrivacy === 'private' || tabPrivacy === 'tor';

/** One link per site: five pages on the same site make one tile, the first (most relevant) wins. */
export function distinctSites<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { let key = item.url; try { key = new URL(item.url).host.replace(/^www\./, ''); } catch { /* keep the address */ } return !seen.has(key) && Boolean(seen.add(key)); });
}
