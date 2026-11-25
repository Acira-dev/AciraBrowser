import { useSyncExternalStore } from 'react';
import { runtime } from '../../runtime/client';
import type { EasyFilesAnswer, EasyFilesOffer } from '../../runtime/types';
import { setShownOffer } from './layout';

/**
 * Easy Files (Beta 14, section AB): what the main process offered for the file a page asked for. Main sends it to every interface renderer of the window as a
 * browser event (the chrome places the pop-up, the overlay draws it); thumbnails follow one by one. Names, sizes and ages only: paths never leave main, and the
 * answer (a pick, "Browse all files…", a cancel) carries the offer's token, so a late answer to an old pop-up can never act on a new one.
 */
export type Shown = { offer: EasyFilesOffer | null; thumbs: Readonly<Record<string, string>> };
let current: Shown = { offer: null, thumbs: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export const easyFilesShown = () => current;
export const subscribeEasyFiles = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useEasyFiles = () => useSyncExternalStore(subscribeEasyFiles, easyFilesShown, easyFilesShown);
/** What ONE pop-up shows: the offer that was current when it opened, kept while the store moves on to a newer request (a pop-up that is still leaving when the page asks again must neither
 *  show nor answer for the next request: its unmount would cancel it), and updated by its own thumbnails. */
export function ownShown(own: Shown | null, live: Shown): Shown {
  if (!own || !own.offer) return live;
  return live.offer && live.offer.token === own.offer.token ? live : own;
}
export function setEasyFilesOffer(offer: EasyFilesOffer | null) { current = { offer, thumbs: offer?.thumbs ?? {} }; setShownOffer(offer); emit(); }
/** The offer leaves memory (and its thumbnails with it) once its pop-up has finished leaving. */
let forgetTimer: ReturnType<typeof setTimeout> | undefined;
export function forgetEasyFilesOffer(token: string, after = 600) {
  clearTimeout(forgetTimer);
  forgetTimer = setTimeout(() => { if (current.offer?.token === token) setEasyFilesOffer(null); }, after);
}

runtime.subscribeBrowser(event => {
  if (event.type === 'ui' && event.action === 'easy-files' && event.easyFiles) { clearTimeout(forgetTimer); setEasyFilesOffer(event.easyFiles); }
  else if (event.type === 'easy-files-thumb' && current.offer?.token === event.token) { current = { ...current, thumbs: { ...current.thumbs, [event.id]: event.src } }; emit(); }
});

/** The pop-up's answer. `pick` takes one or several ids; the same call is made from the chrome or the overlay. */
export const answerEasyFiles = (request: EasyFilesAnswer) => runtime.easyFiles?.(request) ?? Promise.resolve(undefined);

