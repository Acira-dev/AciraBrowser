import type { BookmarkNode, HistoryVisit } from '../runtime/types';
import { currentLocale, t } from '../i18n';

/** Where a page lives: the site for the web, the full address for Acira's own and demo pages. */
export function pageHost(url: string) {
  if (url.startsWith('acira://')) return url;
  // Fast path for the common plain ASCII address: History asks this for every visit (thousands), and new URL() is the slow part.
  const plain = /^https?:\/\/(?![^/?#]*@)([a-z0-9.-]+)(?:[:/?#]|$)/i.exec(url);
  if (plain) return plain[1].toLowerCase().replace(/^www\./, '');
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Intl formatters are expensive to build and History formats thousands of dates: one per locale. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function cachedFormat(kind: string, options: Intl.DateTimeFormatOptions) {
  const locale = currentLocale(), key = kind + '|' + locale;
  let format = formatters.get(key);
  if (!format) { format = new Intl.DateTimeFormat(locale, options); formatters.set(key, format); }
  return format;
}
const dayFormat = () => cachedFormat('day', { weekday: 'long', month: 'long', day: 'numeric' });
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
/** "Today", "Yesterday", then the date; the key groups records by local day. */
export function dayOf(value: string | number | undefined, now = new Date()) {
  const date = new Date(value ?? NaN);
  if (Number.isNaN(date.getTime())) return { label: t('lib.earlier'), key: 0 };
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  return { label: days <= 0 ? t('lib.today') : days === 1 ? t('lib.yesterday') : dayFormat().format(date), key: startOfDay(date) };
}

/** Bookmarks that show on the bookmarks bar: the ones at the top level (starred pages) and the pages inside the bar folder. */
export function barBookmarks(nodes: BookmarkNode[], profileId: string): BookmarkNode[] {
  const mine = nodes.filter(node => node.browserProfileId === profileId);
  const kids = (parent: string | null) => mine.filter(node => (node.parentId ?? null) === parent).sort((a, b) => a.position - b.position);
  const bar = mine.find(node => !node.url && !node.parentId && node.title.trim().toLowerCase() === 'bookmarks bar');
  const seen = new Set<string>(), out: BookmarkNode[] = [];
  // A Tor bookmark is its own entry beside an ordinary one of the same page.
  const add = (node: BookmarkNode) => { const key = (node.tor ? 'tor:' : '') + node.url; if (node.url && !seen.has(key)) { seen.add(key); out.push(node); } };
  for (const node of kids(null)) { if (node.url) add(node); else if (node.id === bar?.id) kids(node.id).forEach(add); }
  return out;
}

const trackingParam = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_eid$|mc_cid$|igshid$|ref$|ref_src$|_hsenc$|_hsmi$)/i;
/** The same page however it was reached: no fragment, no tracking parameters, no www, no trailing slash. */
export function pageKey(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (trackingParam.test(key)) parsed.searchParams.delete(key);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase(), path = parsed.pathname.replace(/\/+$/, '') || '/', query = parsed.searchParams.toString();
    return `${parsed.protocol}//${host}${parsed.port ? ':' + parsed.port : ''}${path}${query ? '?' + query : ''}`;
  } catch { return url; }
}

const searchHosts = /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|yandex\.[a-z.]+|baidu\.com|ecosia\.org|startpage\.com|kagi\.com|brave\.com)$/i;
const searchPath = /(^|\/)(search|results|sch|find|s)(\/|$)|Special:Search/i;
const queryKeys = ['q', 'query', 'search', 'search_query', 'k', 'text', 'p', 'keyword', 'keywords', 'wd', 'searchTerm', '_nkw'];
/** A page of search results (any engine, a site's own search, or one of the user's search providers) is never a page worth saving. */
export function isSearchResultUrl(url: string, templates: string[] = []) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (templates.some(template => { try { const known = new URL(template.replace('%s', 'x')); return known.hostname.replace(/^www\./, '').toLowerCase() === host && known.pathname === parsed.pathname && !!parsed.search; } catch { return false; } })) return true;
  const hasQuery = queryKeys.some(key => parsed.searchParams.has(key));
  if (searchHosts.test(host)) return hasQuery || searchPath.test(parsed.pathname);
  return hasQuery && searchPath.test(parsed.pathname);
}

const realTitle = (title: string, host: string) => { const text = title.trim(); return text.length > 1 && !/^https?:\/\//i.test(text) && text.toLowerCase() !== host.toLowerCase() && text.toLowerCase() !== 'new tab'; };
/** Pages worth offering to save: visited more than once or lately, not already saved, not search results, one entry per page
 *  (however the address was spelled), the most used page title for each, and titled pages ahead of untitled ones. */
export function suggestHistory(history: Pick<HistoryVisit, 'url' | 'title' | 'time'>[], savedUrls: Iterable<string | undefined>, options: { templates?: string[]; limit?: number } = {}) {
  const saved = new Set([...savedUrls].filter((url): url is string => !!url).map(pageKey));
  const pages = new Map<string, { url: string; host: string; titles: Map<string, number>; visits: number; latest: string }>();
  for (const visit of history) {
    if (!/^https?:\/\//i.test(visit.url) || isSearchResultUrl(visit.url, options.templates)) continue;
    const key = pageKey(visit.url);
    if (saved.has(key)) continue;
    const host = pageHost(visit.url), page = pages.get(key) ?? { url: visit.url, host, titles: new Map(), visits: 0, latest: '' };
    page.visits++;
    if (visit.time > page.latest) page.latest = visit.time;
    if (visit.url.length < page.url.length) page.url = visit.url;
    if (realTitle(visit.title ?? '', host)) page.titles.set(visit.title.trim(), (page.titles.get(visit.title.trim()) ?? 0) + 1);
    pages.set(key, page);
  }
  const ranked = [...pages.values()].map(page => ({ url: page.url, host: page.host, title: [...page.titles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '', visits: page.visits, latest: page.latest }))
    .sort((a, b) => Number(!!b.title) - Number(!!a.title) || b.visits - a.visits || b.latest.localeCompare(a.latest));
  const seen = new Set<string>(), out: { url: string; title: string; visits: number }[] = [];
  for (const page of ranked) {
    const label = `${page.host}|${page.title.toLowerCase()}`;
    if (page.title && seen.has(label)) continue;
    seen.add(label);
    out.push({ url: page.url, title: page.title || page.host, visits: page.visits });
    if (out.length >= (options.limit ?? 5)) break;
  }
  return out;
}

/** Layout numbers of a day in History (library.css): the first day sits 12px under the toolbar, later ones 20px; then a 28px header, 6px of list padding and 40px rows. */
export const dayLayout = { lead: 12, gap: 20, head: 28, pad: 6 };
/** Top edge of every day (and the total height at the end), when day i holds counts[i] rows of rowHeight each. */
export function dayOffsets(counts: number[], rowHeight = 40): number[] {
  const offsets = [0];
  counts.forEach((rows, index) => offsets.push(offsets[index] + (index === 0 ? dayLayout.lead : dayLayout.gap) + dayLayout.head + dayLayout.pad + rows * rowHeight));
  return offsets;
}
/** The days that touch [top - overscan, bottom + overscan] (positions relative to the first day's top): { first, last } inclusive, or null when none do. */
export function daySpan(offsets: number[], top: number, bottom: number, overscan: number): { first: number; last: number } | null {
  const days = offsets.length - 1, from = top - overscan, to = bottom + overscan;
  if (days < 1 || to <= 0 || from >= offsets[days]) return null;
  let low = 0, high = days - 1;
  while (low < high) { const mid = (low + high) >> 1; if (offsets[mid + 1] > from) high = mid; else low = mid + 1; }
  const first = low; low = first; high = days - 1;
  while (low < high) { const mid = (low + high + 1) >> 1; if (offsets[mid] < to) low = mid; else high = mid - 1; }
  return { first, last: low };
}
