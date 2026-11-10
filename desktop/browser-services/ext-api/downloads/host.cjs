'use strict';
// The one hook between chrome.downloads (ext-api/downloads.cjs) and Acira's real downloads manager (browser-services/download-engine.cjs).
// main.cjs connects an app host (app-host.cjs) once; the package reads it at call time, so the order of start-up does not matter, and the
// unit tests connect a fake. Events from the manager (a download was created / changed / erased) go through emit() to every profile's package.
//
// Host contract (all calls name the ordinary profile the extension belongs to; a private, Tor or secured download is never visible):
//   records(profileId)                          -> download records of that profile (the Downloads page's records), private ones left out
//   start(profileId, session, request)          -> Promise<recordId>: request = {url, headers?, filename?, conflictAction?, saveAs?, extension: {id, name}}
//   command(profileId, recordId, action)        -> Promise: 'pause' | 'resume' | 'cancel' | 'show' | 'open'
//   erase(profileId, recordIds)                 -> Promise: forget the records (never the files)
//   removeFile(profileId, recordId)             -> Promise: delete the downloaded file from disk
//   showDefaultFolder()                         -> open the Downloads folder
//   exists(path)                                -> does the downloaded file still exist (optional; defaults to fs)
//
// chrome.downloads.onDeterminingFilename (determine.cjs): each profile's package registers how to ask its extensions (setDeterminer); the manager asks
// determiner(profileId) before it names a file. {listening(): boolean, determine(item): Promise<{filename?, conflictAction?}>}.
let current = null;
const listeners = new Set();
const determiners = new Map();

module.exports = {
  /** Connect the host; returns a function that disconnects it. */
  connect(host) { current = host; return () => { if (current === host) current = null; }; },
  current: () => current,
  /** A profile's package says how its extensions are asked to suggest a file name. Returns a function that takes it back. */
  setDeterminer(profileId, determiner) { determiners.set(profileId, determiner); return () => { if (determiners.get(profileId) === determiner) determiners.delete(profileId); }; },
  /** The determiner of a profile, or null. */
  determiner: profileId => determiners.get(profileId) || null,
  /** Listen for manager events {type: 'created' | 'changed' | 'erased', profileId, record}. Returns an unsubscribe function. */
  on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  emit(event) { for (const listener of [...listeners]) { try { listener(event); } catch { /* one extension's listener never stops the rest */ } } }
};
