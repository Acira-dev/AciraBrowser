'use strict';
// chrome.downloads.onDeterminingFilename (13.5; it never fired before). Chrome asks every extension that listens, once per download, before the file
// gets its name: each listener is given the item and a `suggest` function and answers {filename, conflictAction} (a path inside the Downloads folder, and
// what to do when it exists) or nothing. The download waits until every extension has answered. If several extensions suggest a name, the one installed
// last wins. This file is the main-process half and has no Electron in it: it asks through `send`, collects the answers and returns one result.
//
// Acira's own rules stay on top of whatever an extension says: a suggestion is only ever a path inside the download folder (the same check
// downloads.download's `filename` gets), the Save dialog still appears when the person asked to be asked where to save, a download nobody may see
// (private, Tor, secured) is never offered to an extension, and an extension that does not answer cannot hold a download for longer than TIMEOUT_MS.
const {randomUUID} = require('node:crypto');
const items = require('./item.cjs');

const ACTIONS = new Set(['uniquify', 'overwrite', 'prompt']);
/** A listener that never calls suggest (a worker that died, an extension that was turned off) holds the download this long, then it goes on without it. Chromium's own limit: ExtensionDownloadsEventRouterData::determine_filename_timeout_ = base::Seconds(15) (13.7 used 10 s). */
const TIMEOUT_MS = 15000;
/**
 * How often an extension that is being waited for is checked to still listen. Chromium drops a determiner the moment its listener goes away
 * (ExtensionDownloadsEventRouter::OnListenerRemoved -> ExtensionDownloadsEventRouterData::DeterminerRemoved: "it is possible for an extension renderer
 * to be unloaded while a download item is waiting for a determiner. In that case, the download item should proceed"). Acira's event layer has no
 * removal notice, so it asks: a listener that is gone on two checks in a row is no longer waited for. Image Downloader listens in its popup,
 * and a closed popup used to hold every download it had started until the time limit.
 */
const LISTENER_POLL_MS = 100;

/**
 * What an extension passed to suggest(): {filename?, conflictAction?}. An empty answer is {} (the download keeps its name). A filename that is not a
 * safe relative path is refused (Chrome: "Invalid filename"), and the extension's other field is dropped with it. Unknown conflict actions are ignored.
 */
function readSuggestion(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  if (value.filename !== undefined && value.filename !== null && value.filename !== '') {
    // downloads_api.cc DetermineFilename: "Allow windows-style directory separators on all platforms", then IsSafePortableRelativePath.
    const filename = String(value.filename).replace(/\\/g, '/');
    if (!items.isSafeRelativePath(filename)) return {error: items.ERRORS.invalidFilename};
    out.filename = filename;
  }
  if (typeof value.conflictAction === 'string' && ACTIONS.has(value.conflictAction)) out.conflictAction = value.conflictAction;
  return out;
}

/**
 * One result from the answers, oldest install first: the last extension that gave a filename sets it, the last that gave a conflict action sets that,
 * each on its own (an extension that only changes the folder does not take back another's "overwrite").
 */
function combine(answers) {
  const out = {};
  for (const answer of answers) {
    const suggestion = answer && answer.suggestion;
    if (!suggestion) continue;
    if (suggestion.filename) out.filename = suggestion.filename;
    if (suggestion.conflictAction) out.conflictAction = suggestion.conflictAction;
  }
  return out;
}

/**
 * deps:
 *   listening()          -> ids of the extensions of this profile that listen for the event now
 *   send(id, payload)    -> sends {k, item} to that extension's listeners (every page and its worker)
 *   order()              -> the ids of the extensions, the one installed first first (an id it does not know counts as installed last)
 *   timeout, setTimer, clearTimer   (tests)
 */
function createDeterminer({listening, send, order = () => [], timeout = TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout, token = randomUUID, pollMs = LISTENER_POLL_MS, setPoll = setInterval, clearPoll = clearInterval}) {
  const pending = new Map();
  return {
    /** Is any extension listening (a download that nobody may rename is not held at all)? */
    listening: () => { try { return listening().length > 0; } catch { return false; } },
    /** Asks them and answers {filename?, conflictAction?}: {} when nobody suggested anything, in time. Never rejects. */
    determine(item) {
      let ids = [];
      try { ids = [...new Set(listening())]; } catch { ids = []; }
      if (!ids.length) return Promise.resolve({});
      const key = token();
      return new Promise(resolve => {
        const entry = {waiting: new Set(ids), answers: new Map(), timer: null, poll: null, absent: new Map()};
        const finish = () => {
          if (!pending.delete(key)) return;
          clearTimer(entry.timer);
          if (entry.poll) clearPoll(entry.poll);
          let known = [];
          try { known = order() || []; } catch { known = []; }
          const rank = id => { const at = known.indexOf(id); return at < 0 ? Infinity : at; };
          const ordered = [...entry.answers].map(([id, suggestion]) => ({id, suggestion})).sort((a, b) => (rank(a.id) === rank(b.id) ? (a.id < b.id ? -1 : 1) : rank(a.id) < rank(b.id) ? -1 : 1));
          resolve(combine(ordered.map(answer => ({suggestion: answer.suggestion}))));
        };
        entry.finish = finish;
        entry.timer = setTimer(finish, timeout);
        entry.timer && entry.timer.unref && entry.timer.unref();
        pending.set(key, entry);
        for (const id of ids) { try { send(id, {k: key, item}); } catch { entry.waiting.delete(id); } }
        if (!entry.waiting.size) { finish(); return; }
        entry.poll = setPoll(() => {
          let now;
          try { now = listening() || []; } catch { return; }
          for (const id of [...entry.waiting]) {
            if (now.includes(id)) { entry.absent.delete(id); continue; }
            const times = (entry.absent.get(id) || 0) + 1;
            entry.absent.set(id, times);
            if (times >= 2) entry.waiting.delete(id);
          }
          if (!entry.waiting.size) finish();
        }, pollMs);
        entry.poll && entry.poll.unref && entry.poll.unref();
      });
    },
    /**
     * An extension's answer (its first one counts; later ones and answers for a download that has moved on are ignored). Throws Chromium's
     * "Invalid filename" for a filename that is not allowed, after counting the extension as answered, so a bad suggestion never holds a download.
     */
    answer(extensionId, key, value) {
      const entry = typeof key === 'string' ? pending.get(key) : null;
      if (!entry || !entry.waiting.has(extensionId)) return;
      entry.waiting.delete(extensionId);
      const read = readSuggestion(value);
      if (!read.error) entry.answers.set(extensionId, read);
      if (!entry.waiting.size) entry.finish();
      if (read.error) throw new Error(read.error);
    },
    /** An extension went away (turned off, removed, reloaded) while it was being asked: it is no longer waited for. */
    forget(extensionId) {
      for (const entry of [...pending.values()]) { if (entry.waiting.delete(extensionId) && !entry.waiting.size) entry.finish(); }
    },
    dispose() { for (const entry of [...pending.values()]) entry.finish(); }
  };
}

module.exports = {readSuggestion, combine, createDeterminer, TIMEOUT_MS, ACTIONS};
