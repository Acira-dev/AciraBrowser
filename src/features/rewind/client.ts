import { currentLocale, t } from '../../i18n';

/** Trusted-chrome channel to the main-process Rewind service (desktop/rewind/rewind.cjs). */
export type RewindReason = 'group-close' | 'tabs-close' | 'window-close' | 'periodic' | 'manual';
export interface RewindSummary {
  id: string; createdAt: number; reason: RewindReason; label: string; tabCount: number; groupCount: number; splitCount?: number; skipped: number; expiresAt: number;
  windowId: string; sessionId: string; hosts: string[]; siteCount: number; sites: string[]; groups: { name: string; color: string; count?: number }[];
  /** Tabs of this moment that aren't open now. */ closed: number;
  /** Since the previous moment of the same window in the same session (the first one counts everything as added). */ added?: number; removed?: number; first?: boolean;
  /** Matching tabs when the list was searched. */ hits?: number;
  /** Kept past the age limit until forgotten. */ kept?: boolean;
}
export interface RewindTab { ref: string; groupRef: string | null; order: number; title: string; url: string; pinned: boolean; open: boolean; active?: boolean }
export interface RewindGroup { ref: string; name: string; color: string; order: number; collapsed: boolean; count?: number }
export interface RewindDetail extends RewindSummary { groups: RewindGroup[]; tabs: RewindTab[]; splits?: { tabRefs: string[]; layout: string }[] }
export interface RewindState { private?: boolean; enabled: boolean; days: number; session?: string; closedTabs?: number; checkpoints: RewindSummary[]; ok?: boolean; code?: string; id?: string }
export interface RestoreResult { ok: boolean; restored?: number; tabIds?: string[]; skipped?: { title: string; reason: string }[]; groups?: string[]; token?: string; window?: boolean; split?: boolean; code?: string; message?: string }

/** One tab that was closed (the closed-tab log): the same page once, newest close, none that are open now. */
export interface ClosedTab {
  id: string; url: string; title: string; closedAt: number; group: string | null; groupColor: string; pinned: boolean;
  split: { layout: string; partners: { url: string; title: string }[] } | null;
  /** How many tabs of this group that closed together are still closed (the group restores as a unit when this is 2 or more). */ groupSize: number; kept: boolean;
}
export interface TabsState { private?: boolean; enabled: boolean; days: number; session?: string; current?: string; total: number; tabs: ClosedTab[] }
/** A window as it last was, with its earlier saved states folded under it. */
export interface WindowCard extends RewindSummary {
  key: string; closedWindow: boolean; current: boolean; earlierCount: number;
  earlier: { id: string; createdAt: number; reason: RewindReason; label: string; tabCount: number; missing: number; kept?: boolean }[];
}
export interface WindowsState { private?: boolean; enabled: boolean; days: number; session?: string; current?: string; windows: WindowCard[] }

type Request = { type: 'rewind.list'; query?: string } | { type: 'rewind.save' | 'rewind.clear' } | { type: 'rewind.get'; id: string } | { type: 'rewind.remove'; id: string; window?: boolean }
  | { type: 'rewind.tabs'; query?: string; limit?: number } | { type: 'rewind.windows'; query?: string }
  | { type: 'rewind.reopen'; ids: string[]; newWindow?: boolean; unit?: boolean }
  | { type: 'rewind.restore'; id: string; refs?: string[]; all?: boolean; newWindow?: boolean } | { type: 'rewind.undo'; token: string } | { type: 'rewind.keep'; id: string; kept: boolean } | { type: 'rewind.settings'; enabled?: boolean; days?: number };
const bridge = () => (window as unknown as { acira?: { rewind?: (request: Request) => Promise<{ rewind: unknown }> } }).acira?.rewind;
export const rewindAvailable = () => Boolean(bridge());
export async function rewind<T = RewindState>(request: Request): Promise<T> {
  const call = bridge(); if (!call) throw new Error(t('rewind.needsDesktop'));
  return (await call(request)).rewind as T;
}

// --- time ---------------------------------------------------------------------------------------------------------------------------
const formats = new Map<string, Intl.DateTimeFormat>();
const format = (kind: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${kind}|${currentLocale()}`; let f = formats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(currentLocale(), options); formats.set(key, f); }
  return f;
};
const startOf = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysBetween = (at: number, now: number) => Math.round((startOf(now) - startOf(at)) / 86400000);
/** Time of day only, for rows under a day label. */
export const clock = (at: number) => format('clock', { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
/** "Today 4:07 PM", "Yesterday 6:45 PM", "Mon, 26 Oct 4:07 PM". */
export function when(at: number, now = Date.now()) {
  const diff = daysBetween(at, now);
  if (diff <= 0) return `${t('lib.today')} ${clock(at)}`;
  if (diff === 1) return `${t('lib.yesterday')} ${clock(at)}`;
  return `${format('short-day', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at))} ${clock(at)}`;
}
/** Day section label: Today, Yesterday, then "Thursday, 22 October". */
export function day(at: number, now = Date.now()) {
  const diff = daysBetween(at, now);
  return diff <= 0 ? t('lib.today') : diff === 1 ? t('lib.yesterday') : format('weekday', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(at));
}

/** The time bands of the Tabs view: the last hour, the rest of today, yesterday, this week, older (kept tabs). */
export type Band = 'hour' | 'today' | 'yesterday' | 'week' | 'older';
export function band(at: number, now = Date.now()): Band {
  if (now - at < 3600000 && daysBetween(at, now) <= 0) return 'hour';
  const diff = daysBetween(at, now);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? 'week' : 'older';
}
export const bandLabel = (id: Band) => t(({ hour: 'rewind.bandHour', today: 'rewind.bandToday', yesterday: 'lib.yesterday', week: 'rewind.bandWeek', older: 'rewind.bandOlder' } as const)[id]);
/** What a row says about when: minutes ago inside the last hour, the time of day today and yesterday, the weekday after that. */
export function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60000)), diff = daysBetween(at, now);
  if (minutes < 1) return t('rewind.justNow');
  if (minutes < 60 && diff <= 0) { try { return new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'always', style: 'short' }).format(-minutes, 'minute'); } catch { return clock(at); } }
  if (diff <= 1) return clock(at);
  return `${format('weekday-short', { weekday: 'short' }).format(new Date(at))} ${clock(at)}`;
}

// --- naming -------------------------------------------------------------------------------------------------------------------------
const list = (names: string[]) => { try { return new Intl.ListFormat(currentLocale(), { style: 'long', type: 'conjunction' }).format(names); } catch { return names.join(', '); } };
/** What's in a moment or a window, the way you'd name it: its groups, else its main sites ("Mail, Figma and 4 more"). */
export function title(item: RewindSummary) {
  if (item.groups.length) {
    const names = item.groups.slice(0, 2).map(g => g.name), rest = item.tabCount - item.groups.reduce((n, g) => n + (g.count ?? 0), 0);
    if (item.groups.length > 2) return t('rewind.titleMore', { names: names.join(', '), count: item.groups.length - 2 });
    // One group and loose tabs: say both, so two windows of the same project read differently ("Q4 launch and 3 other tabs").
    return item.groups.length === 1 && rest > 0 ? t('rewind.titleOtherTabs', { name: names[0], count: rest }) : list(names);
  }
  const sites = item.sites.slice(0, 2), more = Math.max(0, item.siteCount - sites.length);
  return sites.length ? (more ? t('rewind.titleMore', { names: sites.join(', '), count: more }) : list(sites)) : t('plural.tabs', { count: item.tabCount });
}
/** Why it was saved, in a few plain words. */
export function why(item: RewindSummary) {
  switch (item.reason) {
    case 'group-close': return t('rewind.whyGroup', { name: item.label });
    case 'tabs-close': return item.removed ? t('rewind.whyTabs', { tabs: t('plural.tabs', { count: item.removed }) }) : t('rewind.whySeveral');
    case 'window-close': return t('rewind.whyWindow');
    case 'manual': return t('rewind.whyManual');
    default: return item.first || (!item.added && !item.removed) ? t('rewind.whyAuto') : [item.added ? t('rewind.whyOpened', { count: item.added }) : '', item.removed ? t('rewind.whyClosed', { count: item.removed }) : ''].filter(Boolean).join(' · ');
  }
}
/** "7 days", "3 days", "1 day": what the Rewind setting keeps. */
export const daysLabel = (days: number) => t(days === 1 ? 'rewind.1Day' : days === 3 ? 'rewind.3Days' : 'rewind.7Days');
export const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export const canonical = (url: string) => { try { return new URL(url).href; } catch { return url; } };
