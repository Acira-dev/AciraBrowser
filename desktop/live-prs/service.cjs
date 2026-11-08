'use strict';
// Live pull requests: the folder's settings per profile (kept in live-prs.json), one refresher per profile that has the folder, and the
// answer the sidebar draws (`status`). One instance serves every window of the process: windows of the same profile share one source
// and one refresh timer, so two windows never ask GitHub twice.
//
// Off unless the person adds the folder (the sidebar's right-click menu, "Add live folder"): a profile with no `folder` entry has no
// refresher, no timer and no request. Private, Tor and secured windows never get one (`supported` false, decided by the caller).
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const model = require('./model.cjs');
const { createRefresher } = require('./refresh.cjs');

const ROW_ID = /^[\w.-]{1,100}\/[\w.-]{1,100}#\d{1,9}$/;
const PROFILE_ID = /^[\w.:-]{1,100}$/;
const emptyFile = () => ({ v: 1, profiles: {} });

/**
 * @param {{file: string, sourceFor: (profile: any) => {id: string, fetch: Function}, now?: () => number, setTimer?: Function, clearTimer?: Function, warn?: (message: string) => void, policy?: object}} options
 */
function createLivePrs({ file, sourceFor, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, warn = (message) => console.warn(message), policy }) {
  let data = null;
  const load = () => {
    if (data) return data;
    const raw = readJsonFile(file, { maxBytes: 2_000_000 });
    data = raw && raw.v === 1 && raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles) ? raw : emptyFile();
    return data;
  };
  const save = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, JSON.stringify(data)); } catch (error) { warn('Live pull requests: settings not saved: ' + error.message); } };
  const folderOf = (profileId) => { const entry = load().profiles[profileId]?.folder; return entry && typeof entry === 'object' ? entry : null; };

  /** profileId -> { profile, refresher, listeners:Set<{emit,alive,visible}>, source } */
  const running = new Map();
  const listenersOf = (profileId) => running.get(profileId)?.listeners ?? new Set();
  const notify = (profileId) => {
    const entry = running.get(profileId);
    if (!entry) return;
    for (const listener of [...entry.listeners]) {
      let alive = false;
      try { alive = listener.alive(); } catch { alive = false; }
      if (!alive) { entry.listeners.delete(listener); continue; }
      try { listener.emit({ type: 'live-prs-changed', profileId }); } catch { /* a window that is closing */ }
    }
  };
  const anyVisible = (profileId) => [...listenersOf(profileId)].some((listener) => { try { return listener.alive() && listener.visible(); } catch { return false; } });

  function ensureRunning(profile) {
    let entry = running.get(profile.id);
    if (entry) { entry.profile = profile; return entry; }
    const source = sourceFor(profile);
    const refresher = createRefresher({
      source,
      wanted: () => { const folder = folderOf(profile.id); const filters = model.normalizeFilters(folder?.filters); return { relations: model.relationsWanted(filters), recent: filters.recent }; },
      now, setTimer, clearTimer, policy,
      visible: () => anyVisible(profile.id),
      onChange: () => notify(profile.id),
    });
    entry = { profile, refresher, listeners: new Set(), source };
    running.set(profile.id, entry);
    return entry;
  }
  function attach(profile, listener) {
    const entry = ensureRunning(profile);
    entry.listeners.add(listener);
    entry.refresher.start();
    return entry;
  }
  function stopFor(profileId) {
    const entry = running.get(profileId);
    if (!entry) return;
    entry.refresher.stop();
    running.delete(profileId);
  }

  /** What the sidebar draws, from the folder's settings and the refresher's last answer. */
  function status(profile, { supported = true } = {}) {
    if (!supported) return { supported: false, folder: null };
    const folder = folderOf(profile.id);
    if (!folder) return { supported: true, folder: null };
    const entry = running.get(profile.id);
    const held = entry?.refresher.snapshot() ?? { phase: 'idle', loading: false, rows: [], more: false, updatedAt: 0, error: null, nextAt: 0, failures: 0 };
    const filters = model.normalizeFilters(folder.filters);
    const hidden = folder.hidden && typeof folder.hidden === 'object' ? folder.hidden : {};
    const rows = model.visibleRows(held.rows, filters, { now: now(), hidden });
    return {
      supported: true,
      folder: { name: model.folderName(folder.name), filters, hidden: Object.keys(hidden).length },
      phase: held.phase === 'idle' ? 'loading' : held.phase,
      loading: held.loading, error: held.error, failures: held.failures,
      rows, repos: model.repositoriesOf(held.rows, filters), total: held.rows.length, more: held.more,
      updatedAt: held.updatedAt, nextAt: held.nextAt, source: entry?.source.id ?? 'none',
    };
  }

  const validProfile = (profile) => profile && PROFILE_ID.test(String(profile.id)) && !profile.private && !profile.tor;
  const patchFolder = (profileId, change) => { const entry = load().profiles[profileId]; if (!entry?.folder) return false; change(entry.folder); save(); return true; };

  return {
    status,
    /** A window of the profile asks for the folder: it joins the refresh and, when the folder exists, the first load starts. */
    watch(profile, listener, options) { if (!validProfile(profile) || options?.supported === false) return status(profile, { supported: false }); if (folderOf(profile.id)) attach(profile, listener); return status(profile, options); },
    /** "Add live folder": the folder appears with its default filters and the first load starts. */
    add(profile, listener) {
      if (!validProfile(profile)) throw new Error('Live pull requests are for ordinary profiles.');
      if (!folderOf(profile.id)) { (load().profiles[profile.id] ??= {}).folder = { name: 'Pull requests', filters: model.defaultFilters(), hidden: {}, createdAt: now() }; save(); }
      attach(profile, listener);
      notify(profile.id);
      return status(profile);
    },
    /** "Remove live folder": the settings and every timer go; nothing is left to ask GitHub. */
    remove(profile) {
      const entry = load().profiles[profile.id];
      if (entry?.folder) { delete entry.folder; if (!Object.keys(entry).length) delete load().profiles[profile.id]; save(); }
      // Every window of the profile hears it (and asks again, and finds no folder) before the refresher and its listeners go.
      notify(profile.id);
      stopFor(profile.id);
      return { supported: true, folder: null };
    },
    setFilters(profile, patch) {
      let grew = false;
      const changed = patchFolder(profile.id, (folder) => {
        const before = model.normalizeFilters(folder.filters);
        const next = model.patchFilters(before, patch);
        grew = model.relationsWanted(next).some((relation) => !before[relation]) || (next.recent && !before.recent);
        folder.filters = next;
      });
      if (changed) { if (grew) running.get(profile.id)?.refresher.refreshNow({ force: true }); notify(profile.id); }
      return status(profile);
    },
    rename(profile, name) { if (patchFolder(profile.id, (folder) => { folder.name = model.folderName(name); })) notify(profile.id); return status(profile); },
    /** The × on a row that is not a tab: hidden until it changes. Touches nothing on GitHub. */
    hide(profile, rowId) {
      if (typeof rowId !== 'string' || !ROW_ID.test(rowId)) throw new Error('Choose a pull request from the folder.');
      const held = running.get(profile.id)?.refresher.snapshot().rows.find((row) => row.id === rowId);
      if (held && patchFolder(profile.id, (folder) => { folder.hidden = { ...(folder.hidden || {}), [rowId]: { updatedAt: held.updatedAt, state: held.state } }; })) notify(profile.id);
      return status(profile);
    },
    refresh(profile) { const result = running.get(profile.id)?.refresher.refreshNow() ?? 'stopped'; return { ...status(profile), refresh: result }; },
    noteVisible(profileId) { running.get(profileId)?.refresher.noteVisible(); },
    notePageLoaded(profileId) { running.get(profileId)?.refresher.notePageLoaded(); },
    noteSignedIn(profileId) { running.get(profileId)?.refresher.noteSignedIn(); },
    isRunning: (profileId) => running.has(profileId),
    shutdown() { for (const id of [...running.keys()]) stopFor(id); },
  };
}

let shared = null;
/** The process-wide instance (main.cjs builds one per process, windows share it). */
function sharedLivePrs(options) { return (shared ??= createLivePrs(options)); }

module.exports = { createLivePrs, sharedLivePrs };
