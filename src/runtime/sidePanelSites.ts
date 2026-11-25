import type { BrowserAction, BrowserSnapshot } from './types';

/** Side panel sites (Beta 14, brief section AF): a website pinned to open in a floating panel over the page, one click, no tab.
 *
 *  A pinned site is kept on its PROFILE (`BrowserProfile.sidePanelSites`, so it is per profile, shared by the profile's windows through the shared
 *  profile list, saved with the profiles, and rides along when a profile is transferred). It is a saved address with a name and an icon, a remembered
 *  width and a dock choice: never page content, never anything read from the site. At most six. Pure; main (desktop/side-panel-sites.cjs) holds the live pages. */
export const SIDE_PANEL_MAX_SITES = 6;
export const SIDE_PANEL_DEFAULT_WIDTH = 400;
export const SIDE_PANEL_MIN_WIDTH = 340;
/** Beta 14.1 (a Windows member, 21 Nov: "its width is very limited"): the panel can be dragged up to three quarters of the page area, so the widest it can be is the
 *  window's to say (desktop/side-panel-sites.cjs `maxWidthFor`, which also keeps the page beside a docked panel). What is REMEMBERED is the width as dragged, kept
 *  under this sanity cap; a smaller window shows it narrower and the remembered width comes back when the window is wide again. */
export const SIDE_PANEL_MAX_WIDTH = 4000;
/** The share of the page area a panel may take at most (14.1: three quarters). */
export const SIDE_PANEL_MAX_SHARE = 0.75;
/** "Keep side panel sites running for": minutes, 0 = until Acira closes. The default is the brief's 15. */
export const SIDE_PANEL_KEEP_CHOICES = [5, 15, 60, 0] as const;
export const SIDE_PANEL_KEEP_DEFAULT = 15;

export interface SidePanelSite {
  id: string;
  /** The page the panel opens (http or https, no sign-in details, without query or fragment). */
  url: string;
  /** The name the icon's hover and the panel header show: the page's own title when it was pinned, shortened. */
  title: string;
  /** The site's own icon as a small image data URL; the icons are never tinted. Absent until the site has shown one. */
  icon?: string;
  /** The width the person dragged the panel to for this site (340 and up; a window shows at most three quarters of its page area); absent = 400. */
  width?: number;
  /** True = the panel is docked beside the page for this site (the page gives it room); absent = floating, the default. */
  docked?: boolean;
}

export type PinStatus = 'added' | 'exists' | 'full' | 'invalid';
export interface PinResult { sites: SidePanelSite[]; id?: string; status: PinStatus }

export const SITE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const validSiteId = (value: unknown): value is string => typeof value === 'string' && SITE_ID.test(value);

/** The address a pinned site opens: http(s) only, no sign-in details, lower-case host, without query and fragment (a deep link to one message or one
 *  search would be stale tomorrow; the site's own page is what the person pinned). Null when it cannot be a side panel site. */
export function normalizeSiteUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
  url.hash = ''; url.search = '';
  return url.href;
}

/** What makes two addresses the same pinned site: scheme, host, port and path, the trailing slash aside. */
export function siteKey(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return url.toLowerCase(); }
}

const cleanTitle = (value: unknown, url: string): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (text) return text;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Site'; }
};
const cleanIcon = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 24576 && /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i.test(value) ? value : undefined;
export const clampWidth = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, value))) : undefined;
/** The width a site opens at: its remembered one, else 400. */
export const siteWidth = (site: Pick<SidePanelSite, 'width'> | undefined | null): number => clampWidth(site?.width) ?? SIDE_PANEL_DEFAULT_WIDTH;

/** Stored sites, made whole: bad rows dropped, one row per address, at most six, only known fields. */
export function cleanSites(value: unknown): SidePanelSite[] {
  if (!Array.isArray(value)) return [];
  const out: SidePanelSite[] = [], ids = new Set<string>(), keys = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const input = row as Record<string, unknown>, url = normalizeSiteUrl(input.url);
    if (!validSiteId(input.id) || !url || ids.has(input.id) || keys.has(siteKey(url))) continue;
    ids.add(input.id); keys.add(siteKey(url));
    const icon = cleanIcon(input.icon), width = typeof input.width === 'number' ? clampWidth(input.width) : undefined;
    out.push({ id: input.id, url, title: cleanTitle(input.title, url), ...(icon ? { icon } : {}), ...(width !== undefined && width !== SIDE_PANEL_DEFAULT_WIDTH ? { width } : {}), ...(input.docked === true ? { docked: true } : {}) });
    if (out.length >= SIDE_PANEL_MAX_SITES) break;
  }
  return out;
}

/** Pin a site. An address that is already pinned answers 'exists' with its id (never a second copy); the seventh is 'full'. */
export function pinSite(sites: readonly SidePanelSite[], input: { id: string; url: string; title?: string; icon?: string }): PinResult {
  const list = cleanSites(sites), url = normalizeSiteUrl(input.url);
  if (!url || !validSiteId(input.id)) return { sites: list, status: 'invalid' };
  const known = list.find(site => siteKey(site.url) === siteKey(url));
  if (known) return { sites: list, id: known.id, status: 'exists' };
  if (list.length >= SIDE_PANEL_MAX_SITES) return { sites: list, status: 'full' };
  const id = list.some(site => site.id === input.id) ? `${input.id}-${list.length + 1}` : input.id, icon = cleanIcon(input.icon);
  return { sites: [...list, { id, url, title: cleanTitle(input.title, url), ...(icon ? { icon } : {}) }], id, status: 'added' };
}
export const unpinSite = (sites: readonly SidePanelSite[], id: string): SidePanelSite[] => sites.filter(site => site.id !== id);
/** The site moves to `index` (clamped) among the others: drag to order. */
export function moveSite(sites: readonly SidePanelSite[], id: string, index: number): SidePanelSite[] {
  const from = sites.findIndex(site => site.id === id);
  if (from < 0 || !Number.isFinite(index)) return [...sites];
  const next = [...sites], [site] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.round(index))), 0, site);
  return next;
}
/** The remembered width of one site; null forgets it (Settings: reset the width). */
export function setSiteWidth(sites: readonly SidePanelSite[], id: string, width: number | null): SidePanelSite[] {
  return sites.map(site => {
    if (site.id !== id) return site;
    const { width: _old, ...rest } = site, next = width === null ? undefined : clampWidth(width);
    return next === undefined || next === SIDE_PANEL_DEFAULT_WIDTH ? rest : { ...rest, width: next };
  });
}
export function setSiteDocked(sites: readonly SidePanelSite[], id: string, docked: boolean): SidePanelSite[] {
  return sites.map(site => {
    if (site.id !== id) return site;
    const { docked: _old, ...rest } = site;
    return docked ? { ...rest, docked: true } : rest;
  });
}
/** The site's own icon, kept as the page shows it (a smaller or larger one replaces the old); an unusable one changes nothing. */
export function setSiteIcon(sites: readonly SidePanelSite[], id: string, icon: string): SidePanelSite[] {
  const clean = cleanIcon(icon);
  return clean ? sites.map(site => site.id === id ? { ...site, icon: clean } : site) : [...sites];
}

/** What Settings counts (brief B8): how many sites are pinned, in the four buckets. Never which sites. */
export const pinnedBucket = (count: number): '0' | '1' | '2-3' | '4-6' => count <= 0 ? '0' : count === 1 ? '1' : count <= 3 ? '2-3' : '4-6';

/** The unread count a site signals in its title, as chat and mail sites do: "(3) WhatsApp", "(12) Inbox", "(99+) Discord". Nothing else in the title or the page
 *  is read. 0 = no unread signal. */
export function unreadFromTitle(title: unknown): number {
  if (typeof title !== 'string') return 0;
  const match = /^\s*\((\d{1,5})(\+?)\)/.exec(title.slice(0, 40));
  return match ? Math.min(99999, Number(match[1])) : 0;
}

/** Whether a link leaves the site the panel shows. Same registrable site (the panel's own address, its subdomains) stays in the panel; anything else opens as a tab. `siteOf` gives a host's
 *  registrable domain (null for an address that has none: an IP, a single-label host, which only match on the exact host). */
export function staysInPanel(from: string, to: string, siteOf: (host: string) => string | null): boolean {
  let a: URL, b: URL;
  try { a = new URL(from); b = new URL(to); } catch { return false; }
  if (!['http:', 'https:'].includes(b.protocol) || b.username || b.password) return false;
  if (a.host.toLowerCase() === b.host.toLowerCase()) return true;
  const sa = siteOf(a.hostname.toLowerCase()), sb = siteOf(b.hostname.toLowerCase());
  return !!sa && sa === sb;
}

/** Minutes a closed panel's site keeps running, from the setting: 5, 15, 60 or 0 (until Acira closes); anything else is the default 15. */
export const keepMinutes = (value: unknown): number => (SIDE_PANEL_KEEP_CHOICES as readonly number[]).includes(value as number) ? value as number : SIDE_PANEL_KEEP_DEFAULT;

export type SidePanelToast = 'sidepanel.added' | 'sidepanel.exists' | 'sidepanel.full' | 'sidepanel.invalid' | 'sidepanel.private';
type SidePanelAction = Extract<BrowserAction, { type: `sidepanel.${string}` }>;

/** The reducer's half: one of the six side panel actions on a profile's list. Returns false when nothing changed at all (the caller keeps the previous state); a refusal that says why with a toast (a repeat, the seventh site, a page that cannot be pinned, a private window) returns true, because the toast is the change. A private window has no pinned list (nothing
 *  private is saved); a profile that is not there changes nothing. `freshId` is the id a pinned site gets unless the action brings its own. */
export function applySidePanelAction(s: BrowserSnapshot, action: SidePanelAction, freshId: string, say: (id: SidePanelToast, params?: Record<string, string | number>, tone?: 'error' | 'info' | 'status') => void): boolean {
  const profile = s.browserProfiles.find(item => item.id === (action.profileId || s.activeBrowserProfileId));
  if (!profile) return false;
  if (profile.private || profile.tor) { if (action.type === 'sidepanel.pin') { say('sidepanel.private', undefined, 'info'); return true; } return false; }
  const before = JSON.stringify(profile.sidePanelSites || []), list = cleanSites(profile.sidePanelSites);
  let next: SidePanelSite[] = list;
  switch (action.type) {
    case 'sidepanel.pin': {
      const wanted = validSiteId(action.id) ? action.id : freshId, done = pinSite(list, { id: wanted, url: action.url, title: action.title, icon: action.icon });
      const name = done.sites.find(site => site.id === done.id)?.title || '';
      if (done.status === 'invalid') { say('sidepanel.invalid', undefined, 'error'); return true; }
      if (done.status === 'full') { say('sidepanel.full', { max: SIDE_PANEL_MAX_SITES }, 'error'); return true; }
      if (done.status === 'exists') { say('sidepanel.exists', { name }, 'info'); return true; }
      next = done.sites; say('sidepanel.added', { name }, 'status');
      break;
    }
    case 'sidepanel.unpin': next = unpinSite(list, action.id); break;
    case 'sidepanel.move': next = moveSite(list, action.id, action.index); break;
    case 'sidepanel.width': next = setSiteWidth(list, action.id, action.width); break;
    case 'sidepanel.dock': next = setSiteDocked(list, action.id, action.docked); break;
    case 'sidepanel.icon': next = setSiteIcon(list, action.id, action.icon); break;
  }
  if (JSON.stringify(next) === before) return false;
  if (next.length) profile.sidePanelSites = next; else delete profile.sidePanelSites;
  return true;
}
