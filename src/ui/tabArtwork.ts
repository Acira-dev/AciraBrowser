import { useSyncExternalStore } from 'react';
import { randomPainting, type NewTabPreferences } from './newTabPreferences';

/**
 * "Another image" belongs to the tab where it was pressed. Hiding the image, a custom image, the collection and the change
 * interval are profile preferences (newTabPreferences.ts) and apply to every new tab; this store only remembers, per tab,
 * the picture that tab shuffled to. It lives in memory (never written to disk, so a private tab leaves nothing behind) and is
 * bound to the profile choices it was made under: when any of them changes, every tab follows the profile again.
 */
export type TabArtworkPick = {
  profile: string;
  /** The profile choices this pick was made under; a different signature means the pick is stale. */
  signature: string;
  /** A remote collection: this tab's own request seed ('' for a built-in painting). */
  seed: string;
  /** A remote collection: the picture that was showing, so the shuffle never lands on it again. */
  excludeId: string;
  /** Built-in paintings: this tab's own painting ('' for a remote collection). */
  artwork: string;
};

const picks = new Map<string, TabArtworkPick>();
const listeners = new Set<() => void>();
/** Closed tabs are never reported, so the oldest picks fall out instead. */
const limit = 64;
const emit = () => listeners.forEach(listener => listener());

/** Everything about the profile's choices that a tab-local pick must stay under. */
export const artworkSignature = (profile: string, privateMode: boolean, prefs: Pick<NewTabPreferences, 'collection' | 'artwork' | 'daily' | 'hourly' | 'perTab' | 'collectionSeed'>) =>
  [profile, privateMode ? 'private' : 'normal', prefs.collection, prefs.artwork, prefs.daily, prefs.hourly, prefs.perTab, prefs.collectionSeed].join('|');

export function tabArtworkPick(tabId: string, signature: string): TabArtworkPick | null {
  const pick = picks.get(tabId);
  return pick && pick.signature === signature ? pick : null;
}

/**
 * Pick a different image for this tab only. `remote` is the collection id when the tab is showing a remote collection,
 * otherwise null (built-in paintings, a personal image, a private tab). `currentId` is what the tab shows now.
 */
export function shuffleTabArtwork(tabId: string, profile: string, signature: string, remote: string | null, currentId: string, random: () => number = Math.random, uuid: () => string = () => crypto.randomUUID()): TabArtworkPick {
  const pick: TabArtworkPick = remote
    ? { profile, signature, seed: uuid(), excludeId: currentId.startsWith(remote + ':') ? currentId : '', artwork: '' }
    : { profile, signature, seed: '', excludeId: '', artwork: randomPainting(currentId, random).id };
  picks.delete(tabId); // re-insert at the end: the oldest pick is the first key
  picks.set(tabId, pick);
  while (picks.size > limit) picks.delete(picks.keys().next().value as string);
  emit();
  return pick;
}

/** Drop the picks of this profile that were made under other choices (the profile changed collection, picture or interval). */
export function dropStaleTabArtwork(profile: string, signature: string) {
  let changed = false;
  for (const [tabId, pick] of picks) if (pick.profile === profile && pick.signature !== signature) { picks.delete(tabId); changed = true; }
  if (changed) emit();
}

export function forgetTabArtwork(tabId: string) { if (picks.delete(tabId)) emit(); }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useTabArtwork = (tabId: string, signature: string) => useSyncExternalStore(subscribe, () => tabArtworkPick(tabId, signature));
