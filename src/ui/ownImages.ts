import { hashText, randomPick, rotationInterval, rotatePick } from './artworkPicks';
import type { NewTabPreferences } from './newTabPreferences';

/**
 * 14.1 (a Discord ask the team called really important): the person's OWN pictures on the New Tab, several of them, cycling.
 *
 *   - `only`  "Your images" is the New Tab's collection: the page shows only the person's pictures. "Change artwork" (every new tab, hour or
 *             day) cycles through them; "Only when I press Change" keeps the one chosen; "Another image" goes to another of them.
 *   - `mixed` "Mix in your images": the chosen collection (the paintings or an open collection) and the person's pictures share the rotation,
 *             the person's at a fair share (one in three with one picture, one in two with two or more) instead of 5 among ~90 paintings.
 *   - `off`   today's behaviour, the default.
 *
 * "Only my picks" (artworkPicks.ts), when it is on and has something to show, decides before this. Nothing here reads a picture: the ids are
 * `personal:<uuid>` (the form the preferences and the picks use) and the page resolves the one it shows. Pure, so the rules are testable.
 */
export type OwnImages = 'off' | 'mixed' | 'only';
export const OWN_IMAGES: readonly OwnImages[] = ['off', 'mixed', 'only'];
export const ownImagesOf = (prefs: Pick<NewTabPreferences, 'ownImages'>): OwnImages => prefs.ownImages === 'only' || prefs.ownImages === 'mixed' ? prefs.ownImages : 'off';

/** How much of the rotation the person's own pictures get when they are mixed in: a third with one picture (it would come back every other tab), half with more. */
export const ownShare = (count: number): number => count <= 0 ? 0 : count === 1 ? 1 / 3 : 1 / 2;

/** murmur3's 32-bit finaliser over the rotation's string hash: neighbouring tab ids (tab-1, tab-2...) hash to neighbouring numbers, so their remainders cluster;
 *  mixed this way the share holds for any ids. */
const mix = (value: number): number => { let h = value >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };

/** What the rotation's "slot" is for this tab, hour or day, the same key the rotation itself uses (artworkPicks.ts rotatePick). */
const slotKey = (interval: 'tab' | 'hour' | 'day', profile: string, date: Date, tabSeed: string): string =>
  interval === 'tab' ? 'tab|' + tabSeed : interval === 'hour' ? 'hour|' + profile + date.toISOString().slice(0, 13) : 'day|' + profile + date.toDateString();

/**
 * "My artworks" on every new tab goes ROUND the pictures (each once before any comes back), not at random: with two or three pictures a random
 * pick repeats the same one tab after tab. Each tab gets its turn the first time its page asks and keeps it (its picture never changes under it);
 * the next turn is remembered per profile (localStorage; a private window only in memory), so a restart carries on where it was.
 */
export function createOwnTurns(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const given = new Map<string, number>(), memory = new Map<string, number>();
  const read = (key: string): number => { if (memory.has(key)) return memory.get(key)!; let value = 0; try { const raw = storage?.getItem('acira-own-turn:' + key); value = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : 0; } catch { /* no storage: start at the first */ } memory.set(key, value); return value; };
  const write = (key: string, value: number) => { memory.set(key, value); try { storage?.setItem('acira-own-turn:' + key, String(value)); } catch { /* memory only */ } };
  /** The turn of tab `seed` for profile `key` (`private` keeps it in memory). */
  return (key: string, seed: string, privateMode = false): number => {
    const id = key + '|' + seed, have = given.get(id);
    if (have !== undefined) return have;
    const turn = read((privateMode ? 'private:' : '') + key);
    if (!privateMode) write(key, (turn + 1) % 1_000_000_000); else memory.set('private:' + key, turn + 1);
    given.set(id, turn);
    if (given.size > 512) given.delete(given.keys().next().value as string);
    return turn;
  };
}
export type OwnTurn = (seed: string) => number;

export type OwnChoice = {
  /** The person's pictures have not been listed yet: hold what is on screen (never flash the first painting). */
  waiting: boolean;
  /** The own picture this tab shows (`personal:<uuid>`), or null: the collection's picture. */
  id: string | null;
};

/**
 * The own picture a New Tab shows, or none. `own` is the ids of the person's pictures that can be shown now (null: not listed yet). With
 * "Your images" and no picture left, the page falls back to the collection (never an empty frame), as "Only my picks" does.
 */
export function ownChoice(prefs: Pick<NewTabPreferences, 'ownImages' | 'artwork' | 'perTab' | 'hourly' | 'daily'>, own: readonly string[] | null, profile: string, date: Date, tabSeed: string, turn?: OwnTurn): OwnChoice {
  const mode = ownImagesOf(prefs);
  if (mode === 'off') return { waiting: false, id: null };
  if (!own) return { waiting: true, id: null };
  if (!own.length) return { waiting: false, id: null };
  const interval = rotationInterval(prefs);
  if (mode === 'only') {
    if (!interval) return { waiting: false, id: own.includes(prefs.artwork) ? prefs.artwork : own[0] };
    // every new tab: the next in turn (round, not random) where the page keeps turns; by the hour or the day: the time decides, the same in every tab
    if (interval === 'tab' && turn) return { waiting: false, id: own[turn(tabSeed) % own.length] };
    return { waiting: false, id: rotatePick(own, interval, profile, date, tabSeed) };
  }
  // mixed: a picture that never changes by itself is the collection's (the Change button can still land on one of the person's)
  if (!interval) return { waiting: false, id: null };
  const key = slotKey(interval, profile, date, tabSeed);
  if ((mix(hashText('own-share|' + key)) % 1000) / 1000 >= ownShare(own.length)) return { waiting: false, id: null };
  return { waiting: false, id: interval === 'tab' && turn ? own[turn(tabSeed) % own.length] : own[mix(hashText('own-pick|' + key)) % own.length] };
}

/**
 * "Another image" with the person's pictures in play, for this tab only. Returns the own picture to show next, or null: the collection's
 * shuffle (a painting or a new collection picture) as before. `currentId` is what the tab shows now.
 *   - only: always another of the person's pictures (the same one when it is the only one);
 *   - mixed: from one of the person's pictures, back to the collection; from the collection, one of the person's at their share.
 */
export function ownShuffle(prefs: Pick<NewTabPreferences, 'ownImages'>, own: readonly string[], currentId: string, random: () => number = Math.random): string | null {
  const mode = ownImagesOf(prefs);
  if (mode === 'off' || !own.length) return null;
  if (mode === 'only') return randomPick(own, currentId, random);
  if (own.includes(currentId)) return null;
  return random() < ownShare(own.length) ? randomPick(own, currentId, random) : null;
}
