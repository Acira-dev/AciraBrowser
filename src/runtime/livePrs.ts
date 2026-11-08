/** Live pull requests (item 31): what the main process tells the sidebar about the "Pull requests" live folder
 *  (desktop/live-prs/service.cjs `status`), and the small rules the interface draws it by. Types and pure functions only. */

/** The adapter row every source hands over (desktop/live-prs/model.cjs normalizeRow). */
export type LivePrState = 'open' | 'closed' | 'merged';
export type LivePrRelation = 'author' | 'review' | 'assigned' | 'mentioned' | 'recent';
export interface LivePrRow { id: string; title: string; url: string; repo: string; number: number; state: LivePrState; draft: boolean; reviewRequested: boolean; updatedAt: number; relations: LivePrRelation[] }

/** The folder's filters. `repos` null = every repository. */
export interface LivePrsFilters { author: boolean; review: boolean; assigned: boolean; mentioned: boolean; drafts: boolean; recent: boolean; repos: string[] | null }
export type LivePrsFilterPatch = Partial<Omit<LivePrsFilters, 'repos'>> & { repos?: string[] | null };

/** Why the last refresh failed (the rows of the last good one stay). */
export type LivePrsError = 'offline' | 'rate-limited' | 'unreadable' | 'error';
export type LivePrsPhase = 'loading' | 'ok' | 'signed-out' | 'error';

/** No folder in this window: private, Tor and secured windows (`supported` false) never offer it; `folder` null means it was not added. */
export type LivePrsStatus =
  | { supported: false; folder: null }
  | { supported: true; folder: null }
  | { supported: true; folder: { name: string; filters: LivePrsFilters; hidden: number }; phase: LivePrsPhase; loading: boolean; error: LivePrsError | null; failures: number; rows: LivePrRow[]; repos: string[]; total: number; more: boolean; updatedAt: number; nextAt: number; source: string; refresh?: 'started' | 'running' | 'recent' | 'wait' | 'stopped' };
export type LivePrsFolder = Extract<LivePrsStatus, { folder: { name: string } }>;
export const hasLiveFolder = (status: LivePrsStatus | null | undefined): status is LivePrsFolder => !!status && status.supported && status.folder !== null;

/** `owner/repo#number` of a github.com pull request address or any page of it (files, checks), lower-cased for comparing; null for anything else. */
export function pullKeyOf(url: string): string | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? `${match[1]}/${match[2]}#${match[3]}`.toLowerCase() : null;
}

/** What a row looks like: the glyph and colour it takes (draft is an open pull request that is not ready). */
export type LivePrLook = 'open' | 'draft' | 'merged' | 'closed';
export const prLook = (row: Pick<LivePrRow, 'state' | 'draft'>): LivePrLook => (row.state === 'open' ? (row.draft ? 'draft' : 'open') : row.state);
/** A finished pull request is dimmed like a done item. */
export const prDone = (row: Pick<LivePrRow, 'state'>) => row.state !== 'open';

/** The look of up to three sheets of the folder's icon, front sheet first: the newest open ones, else the newest finished. */
export function sheetLooks(rows: readonly LivePrRow[]): LivePrLook[] {
  const open = rows.filter((row) => row.state === 'open'), rest = rows.filter((row) => row.state !== 'open');
  const looks = [...open, ...rest].slice(0, 3).map(prLook);
  return looks.length ? looks : ['open'];
}

/** The review requests the person has not seen yet: ones that arrived while the folder was closed make its blue dot. */
export const unseenReviews = (rows: readonly LivePrRow[], seen: readonly string[]) => rows.filter((row) => row.reviewRequested && !seen.includes(row.id));

/** What the folder says when it has no rows of its own to show (empty, signed out and error states), or null when the rows speak. */
export type LivePrsNote = 'loading' | 'signed-out' | 'nothing-waiting' | 'all-filtered' | 'error-offline' | 'error-rate-limited' | 'error-unreadable' | 'error-other';
export function liveNote(status: LivePrsFolder): LivePrsNote | null {
  if (status.phase === 'signed-out') return 'signed-out';
  if (status.rows.length) return null;
  if (status.phase === 'loading') return 'loading';
  if (status.phase === 'error') return status.error === 'offline' ? 'error-offline' : status.error === 'rate-limited' ? 'error-rate-limited' : status.error === 'unreadable' ? 'error-unreadable' : 'error-other';
  return status.total > 0 || status.folder.hidden > 0 ? 'all-filtered' : 'nothing-waiting';
}

/** True when the last refresh failed but earlier rows are still shown: the folder adds one quiet line under them. */
export const staleRows = (status: LivePrsFolder) => status.phase === 'error' && status.rows.length > 0;

/** Minutes since the last good refresh, for "Updated 3 min ago" (the menu's line); null if there was none. */
export const minutesSince = (updatedAt: number, now = Date.now()) => (updatedAt > 0 ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : null);

/** Where "More on GitHub" and "Sign in to GitHub" go. */
export const GITHUB_PULLS = 'https://github.com/pulls';
export const GITHUB_SIGN_IN = 'https://github.com/login';

/** Which view of the filters is on: the menu's row labels use these ids in this order. */
export const FILTER_KEYS = ['author', 'review', 'assigned', 'mentioned'] as const;
export type LiveRelationFilter = (typeof FILTER_KEYS)[number];

/** The seen-review list is kept per profile in this window's storage (it is a convenience, not state): a reload without it shows the dot once more. */
const SEEN_KEY = (profileId: string) => `acira-live-prs-seen:${profileId}`;
export function readSeenReviews(profileId: string): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(SEEN_KEY(profileId)) || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : []; } catch { return []; }
}
export function writeSeenReviews(profileId: string, ids: readonly string[]) {
  try { localStorage.setItem(SEEN_KEY(profileId), JSON.stringify([...new Set(ids)].slice(-200))); } catch { /* the dot may show once more */ }
}
