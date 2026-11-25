import type { NewTabPreferences } from './newTabPreferences';

/**
 * "Only my picks" (Beta 14, section I).
 *
 * The person ticks individual pictures: built-in paintings, collection pictures a new tab has already shown them, and their own
 * images. The rotation (a different picture every new tab, hour or day) then changes only among those, or among everything as it
 * always has when the choice is "All pictures".
 *
 * Everything here is plain functions over ids, so the rules can be tested without a window:
 *   - a pick is an id: a built-in painting's catalog id, `personal:<uuid>` for the person's own image, `<collection>:<12 hex>` for a
 *     collection picture (the id the main process gives it, a hash of its address);
 *   - which picks can be shown right now depends on what is available (an image may have been removed, a collection picture may no
 *     longer be kept on this computer, a private window has no collection pictures), so availability is passed in;
 *   - the choice of which pick shows is a pure function of the picks, the profile, the time and the tab, like the rotation it replaces.
 */

export type ArtworkRotation = 'all' | 'picks';
export type RotationInterval = 'tab' | 'hour' | 'day';
export type PickKind = 'built-in' | 'personal' | 'remote';

/** More than every built-in picture, the personal limit (5) and a full local cache of collection pictures. */
export const maxPicks = 200;

const personalPick = /^personal:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const remotePick = /^(?:landscapes|nature|space|architecture):[a-f0-9]{12}$/;

export function pickKind(id: string): PickKind {
  return personalPick.test(id) ? 'personal' : remotePick.test(id) ? 'remote' : 'built-in';
}

/** The same string hash the rotation has always used, so a profile's picture for a tab, hour or day does not change with this feature. */
export function hashText(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Step through a list so neighbouring days differ in subject and tone, yet every entry appears once per cycle. */
export const dailyStride = (count: number): number => [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61].find((step) => gcd(step, count) === 1) ?? 1;
/** The local calendar day as a number. */
export const dayNumber = (date: Date): number => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

/** Saved picks are only ever ids this app knows how to show: a catalog painting, a personal image's id, a collection picture's id. */
export function cleanPicks(input: unknown, isBuiltIn: (id: string) => boolean): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const id of input) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const kind = pickKind(id);
    if (kind === 'built-in' && !isBuiltIn(id)) continue;
    seen.add(id);
    if (seen.size >= maxPicks) break;
  }
  return [...seen];
}

/** Tick or untick one picture. A new pick goes to the end; the list never grows past its limit. */
export function togglePick(picks: readonly string[], id: string): string[] {
  if (picks.includes(id)) return picks.filter((item) => item !== id);
  return picks.length >= maxPicks ? [...picks] : [...picks, id];
}

/** What the rotation is changing, if it is changing at all. The order is the one `selectedArtwork` has always used. */
export function rotationInterval(prefs: Pick<NewTabPreferences, 'hourly' | 'perTab' | 'daily'>): RotationInterval | null {
  return prefs.hourly ? 'hour' : prefs.perTab ? 'tab' : prefs.daily ? 'day' : null;
}

/** What is there to show. A source that is `null` has not answered yet; an empty set has answered and has nothing. */
export type PickSources = { personal: ReadonlySet<string> | null; remote: ReadonlySet<string> | null };
export const pickSources = (personalIds: readonly string[] | null, remoteIds: readonly string[] | null): PickSources => ({
  personal: personalIds ? new Set(personalIds) : null,
  remote: remoteIds ? new Set(remoteIds) : null,
});

/**
 * The picks that can be shown now, in the order they were ticked. `waiting` is true while a source a pick depends on has not answered,
 * so the page holds the picture it has instead of choosing from a pool that is about to change.
 */
export function resolvePicks(picks: readonly string[], sources: PickSources): { ids: string[]; waiting: boolean } {
  const ids: string[] = [];
  let waiting = false;
  for (const id of picks) {
    const kind = pickKind(id);
    if (kind === 'built-in') ids.push(id);
    else {
      const have = kind === 'personal' ? sources.personal : sources.remote;
      if (!have) waiting = true;
      else if (have.has(id)) ids.push(id);
    }
  }
  return { ids, waiting };
}

/** One pick for this tab, hour or day. `tabSeed` is the tab's own id, so every new tab can differ. */
export function rotatePick(pool: readonly string[], interval: RotationInterval, profile: string, date: Date, tabSeed: string): string | null {
  if (!pool.length) return null;
  if (interval === 'tab') return pool[hashText(tabSeed) % pool.length];
  if (interval === 'hour') return pool[hashText(profile + date.toISOString().slice(0, 13)) % pool.length];
  return pool[(dayNumber(date) * dailyStride(pool.length) + hashText(profile)) % pool.length];
}

/** "Another image" while picks are in use: a different pick, never the one on screen unless it is the only one. */
export function randomPick(pool: readonly string[], currentId: string, random: () => number = Math.random): string | null {
  if (!pool.length) return null;
  const others = pool.filter((id) => id !== currentId);
  const from = others.length ? others : pool;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

export type RotationChoice = {
  /** `picks` when the rotation is using the person's picks right now; `all` when it is not (it never is when nothing can be shown from them). */
  source: ArtworkRotation;
  /** The pool is not complete yet: hold what is on screen. */
  waiting: boolean;
  /** The picks that can be shown now. */
  pool: string[];
  /** The pick for this tab, hour or day (null unless `source` is `picks` and the pool is complete). */
  id: string | null;
};

/**
 * What the rotation should use. "All pictures" (the default) and a rotation that never changes both mean nothing here: the page keeps
 * doing what it has always done. "Only my picks" with nothing that can be shown behaves as "All pictures", never as an empty page.
 */
export function rotationChoice(prefs: Pick<NewTabPreferences, 'rotation' | 'picks' | 'hourly' | 'perTab' | 'daily'>, sources: PickSources, profile: string, date: Date, tabSeed: string): RotationChoice {
  const interval = rotationInterval(prefs);
  if (!interval || prefs.rotation !== 'picks') return { source: 'all', waiting: false, pool: [], id: null };
  const { ids, waiting } = resolvePicks(prefs.picks, sources);
  if (waiting) return { source: 'picks', waiting: true, pool: ids, id: null };
  if (!ids.length) return { source: 'all', waiting: false, pool: [], id: null };
  return { source: 'picks', waiting: false, pool: ids, id: rotatePick(ids, interval, profile, date, tabSeed) };
}
