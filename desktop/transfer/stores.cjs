'use strict';
// The adapters between the app's own modules and the `stores.*` shapes that payload.cjs (reading, on the sending computer) and apply.cjs (writing and Undo, on
// the receiving one) take. Each adapter is a few lines over a module that already has its own validation, so a value that is not acceptable is refused by the
// module itself and the transfer treats it like any other value it could not apply. tests/helpers/transfer-fixture.cjs `fakeStores()` has the same shapes in memory.
//
//   const stores = createTransferStores({ privacy: () => contentBlocking.antiTracking, network: () => nativeNetwork, ... })
//
// Every source is a function returning the module (or undefined while the app has not made it yet), because main.cjs makes most of them lazily. A store whose
// module is missing is left out of the result, and the transfer skips it (the payload code tests `if (stores.x)`).
const fs = require('node:fs');
const path = require('node:path');

const TOR_LEVELS = ['standard', 'safer', 'safest'];
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/** A promise a caller does not wait for must not turn a late error into an unhandled rejection. */
const quietly = (maybePromise) => { try { void Promise.resolve(maybePromise).catch(() => {}); } catch { /* sync throw: nothing waits */ } };

/** Anti-tracking (privacy-plus.json): the eight choices of `contentBlocking.antiTracking`. */
function privacyStore(source) {
  return { get: () => ({ ...source().get() }), set: (patch) => { source().set(patch); } };
}

/** Network privacy (native-network-preferences.json): what is saved, which applies after a restart. */
function networkStore(source) {
  return { get: () => clone(source().status().saved), set: (value) => { source().save(clone(value)); } };
}

/** Automatic filter-list updates. */
function filtersStore(source) {
  return { automatic: () => source().status().automatic !== false, setAutomatic: (value) => { source().setAutomatic(value === true); } };
}

/** Downloads: only "ask where to save", never the folder (a path on the other computer). */
function downloadsStore(source) {
  return {
    askWhere: () => source().get().askWhere === true, setAskWhere: (value) => { source().set({ askWhere: value === true }); },
    // Easy Files (Beta 14): whether the small window offers recent files, and whether it does so in private windows too
    offer: () => ({ files: source().get().offerFiles !== false, private: source().get().offerFilesPrivate === true }),
    setOffer: (value) => { source().set({ offerFiles: value.files !== false, offerFilesPrivate: value.private === true }); }
  };
}

/** The profile's key pair, certificate, welcome flag and recognition state, through the module that owns them (identity.cjs: its four calls, and the outcomes the apply records). */
function identityStore(source) {
  return require('./identity.cjs').createBridge(source);
}

/** Passwords on or off (not the passwords: those are `vault`). The service's own request keeps the file and the memory together. */
function passwordsStore(source) {
  return {
    enabled: () => source().enabled !== false,
    setEnabled: (value) => { quietly(source().handle({ type: 'passwords.settings', enabled: value === true }, { privateMode: false, profileId: 'transfer', window: null })); }
  };
}

/** Rewind: `{enabled, days}`, written through the service's own request (it prunes what the new length no longer keeps). */
function rewindStore(source, context) {
  return {
    get: () => ({ ...source().settings() }),
    set: (value) => { source().handle({ type: 'rewind.settings', enabled: value.enabled === true, days: value.days }, context()); }
  };
}

/**
 * Tor preferences `{level, downloadWarning, preferOnion}`. When the Tor service exists it is asked (it keeps the values in memory); when it does not, the small
 * settings file it reads at creation is read and written directly, so reading these never starts anything. The one thing the service cannot do is show the download
 * warning again (it only has "Got it"), so putting that back is written to the file and shows at the next start.
 */
function torStore({ peek, file }) {
  const fromFile = () => {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    return { level: TOR_LEVELS.includes(saved.level) ? saved.level : 'standard', downloadWarning: saved.downloadWarning !== false, preferOnion: saved.preferOnion === true };
  };
  const toFile = (next) => { fs.mkdirSync(path.dirname(file), { recursive: true }); require('../atomic-file.cjs').writeFileAtomic(file, JSON.stringify(next)); };
  return {
    get() {
      const live = peek();
      return live ? { level: live.level(), downloadWarning: live.downloadWarning() !== false, preferOnion: live.preferOnion() === true } : fromFile();
    },
    set(value) {
      const live = peek(), next = { ...this.get(), ...value };
      if (!TOR_LEVELS.includes(next.level)) throw new Error('Choose Standard, Safer or Safest.');
      if (!live) { toFile({ level: next.level, downloadWarning: next.downloadWarning !== false, preferOnion: next.preferOnion === true }); return; }
      if (live.level() !== next.level) live.handle({ type: 'tor.level-set', level: next.level }, {});
      if (live.preferOnion() !== (next.preferOnion === true)) live.handle({ type: 'tor.onion-prefer-set', prefer: next.preferOnion === true }, {});
      if (live.downloadWarning() !== false && next.downloadWarning === false) live.handle({ type: 'tor.download-warning-dismiss' }, {});
      else if (live.downloadWarning() === false && next.downloadWarning !== false) toFile({ level: next.level, downloadWarning: true, preferOnion: next.preferOnion === true });
    }
  };
}

/**
 * Custom keyboard shortcuts. `apply` filters the incoming table binding by binding against this computer's registry (a key it refuses, or a command it does not
 * have, is skipped and counted) and replaces the custom table with what is left; `restore` puts back the text `exportJson` gave before (Undo).
 */
function shortcutsStore(source) {
  return {
    exportJson: () => source().exportJson(),
    apply(table) {
      const registry = source(), known = new Set(registry.list().map((command) => command.id));
      const kept = {};
      let skipped = 0;
      for (const [id, accelerators] of Object.entries(table?.bindings || {})) {
        if (!known.has(id) || !Array.isArray(accelerators)) { skipped++; continue; }
        // A key another command uses (and the table does not move) is left to that command: the registry would otherwise empty this one's bindings.
        const usable = accelerators.flatMap((raw) => {
          const accelerator = registry.canonical(raw), info = accelerator && registry.describe(accelerator, id);
          if (!info?.valid || (info.conflict && info.conflict.id !== id && !Object.hasOwn(table.bindings, info.conflict.id))) return [];
          return [accelerator];
        });
        if (accelerators.length && !usable.length) { skipped++; continue; }
        kept[id] = usable;
      }
      const result = registry.importJson(JSON.stringify({ version: 1, bindings: kept }));
      if (!result.ok) throw new Error(result.message || 'The shortcuts could not be applied.');
      // What the registry kept is what was applied.
      const now = JSON.parse(registry.exportJson()).bindings || {};
      let applied = 0;
      for (const [id, accelerators] of Object.entries(kept)) { if (!accelerators.length || (now[id] || []).length) applied++; else skipped++; }
      return { applied, skipped };
    },
    restore(text) {
      const result = source().importJson(text);
      if (!result.ok) throw new Error(result.message || 'The shortcuts could not be restored.');
    }
  };
}

/** Site icons by host: the store has exactly these three. */
function faviconsStore(source) {
  return { get: (profileId, host) => source().get(profileId, host), adopt: (profileId, icons) => source().adopt(profileId, icons), remove: (profileId, hosts) => source().remove(profileId, hosts) };
}

/** Tab sets ("routines"): the recipes of the profile out; recipes in through the library's own save (which validates each); ids back for Undo. */
function routinesStore(source, getState) {
  return {
    export: (profileId) => source().library().filter((item) => item.binding?.profileId === profileId).map((item) => clone(item.recipe)),
    async import(profileId, list) {
      const service = source(), ids = [];
      for (const recipe of list) {
        const outcome = service.save({ recipe, profileId }, getState());
        if (outcome?.ok && outcome.id) ids.push(outcome.id);
      }
      return ids;
    },
    remove(ids) {
      const service = source();
      for (const id of ids) quietly(service.handle({ type: 'routines.delete', id }, { privateMode: false, windowId: 'transfer', state: getState }));
    }
  };
}

/** Personal new tab pictures, as bytes. A temporary scope of the profile does the reading and writing (and tells open windows when the list changed). */
function artworkStore(source) {
  const within = async (profileId, work) => {
    const scope = source().createScope({ profileId, privateMode: false });
    try { return await work(scope); } finally { scope.dispose(); }
  };
  return {
    export: (profileId) => within(profileId, (scope) => scope.exportAll()),
    import: (profileId, list) => within(profileId, async (scope) => {
      const ids = [];
      for (const picture of list) {
        try { ids.push(await scope.importBytes(Buffer.from(picture.data, 'base64'), picture.name)); } catch { /* the thirteenth picture, one over the profile's 20 MB, or one that does not decode: the rest still arrive */ }
      }
      return ids;
    }),
    remove: (profileId, ids) => within(profileId, (scope) => { for (const id of ids) { try { scope.remove(id); } catch { /* already gone */ } } })
  };
}

/** Saved passwords. `add` never changes a login this computer already has (same site and username): the existing one stays, and is counted as kept. */
function vaultStore(source, normalizeOrigin) {
  return {
    count: (profileId) => source().status(profileId).count || 0,
    all: async (profileId) => source().all(profileId),
    async add(profileId, rows) {
      const vault = source(), added = [];
      let kept = 0;
      for (const row of rows) {
        const origin = normalizeOrigin(row.origin);
        if (!origin || vault.list(profileId).some((item) => item.origin === origin && item.username === String(row.username ?? '').trim())) { kept++; continue; }
        try {
          const outcome = vault.save(profileId, { origin: row.origin, username: row.username, password: row.password, note: row.note });
          if (outcome.created) added.push(outcome.id); else kept++;
        } catch { kept++; }
      }
      return { added, kept };
    },
    remove: (profileId, ids) => { const vault = source(); for (const id of ids) { try { vault.remove(profileId, id); } catch { /* already gone */ } } }
  };
}

/** The Pull requests folder of a profile: its name and filters out, the same in on a computer that has none, taken away again by Undo. */
function livePrsStore(source) {
  return {
    folder(profileId) {
      const status = source().status({ id: profileId }, { supported: true });
      return status.folder ? { name: status.folder.name, filters: clone(status.folder.filters) } : null;
    },
    adopt: (profileId, folder) => { source().adopt({ id: profileId }, folder); },
    remove: (profileId) => { source().remove({ id: profileId }); }
  };
}

/**
 * @param sources one function per module, each returning the module or undefined: privacy, network, filterLists, downloadPreferences, passwords, rewind,
 *   rewindContext, tor ({peek, file}), shortcuts, favicons, routines, artwork, vault, livePrs, extensions, webApps, getState, normalizeOrigin
 */
function createTransferStores(sources) {
  const has = (name) => typeof sources[name] === 'function';
  const stores = {};
  if (has('privacy')) stores.privacy = privacyStore(sources.privacy);
  if (has('network')) stores.network = networkStore(sources.network);
  if (has('filterLists')) stores.filters = filtersStore(sources.filterLists);
  if (has('downloadPreferences')) stores.downloads = downloadsStore(sources.downloadPreferences);
  if (has('passwords')) stores.passwords = passwordsStore(sources.passwords);
  if (has('rewind')) stores.rewind = rewindStore(sources.rewind, sources.rewindContext || (() => ({ privateMode: false, windowId: 'transfer', state: sources.getState, dispatch: () => {} })));
  if (sources.tor) stores.tor = torStore(sources.tor);
  if (has('shortcuts')) stores.shortcuts = shortcutsStore(sources.shortcuts);
  if (has('favicons')) stores.favicons = faviconsStore(sources.favicons);
  if (has('routines')) stores.routines = routinesStore(sources.routines, sources.getState);
  if (has('artwork')) stores.artwork = artworkStore(sources.artwork);
  if (has('vault')) stores.vault = vaultStore(sources.vault, sources.normalizeOrigin || ((value) => value));
  if (has('livePrs')) stores.livePrs = livePrsStore(sources.livePrs);
  // the profile's key pair, certificate, welcome flag and recognition state (identity.cjs has the API; main passes the module that owns them, or none and the identity is skipped)
  if (has('identity')) stores.identity = identityStore(sources.identity);
  if (has('extensions')) stores.extensions = { list: (profileId) => sources.extensions()?.list(profileId)?.extensions || [] };
  if (has('webApps')) stores.webApps = { list: (profileId) => sources.webApps().list().filter((item) => item.profileId === profileId) };
  return stores;
}

module.exports = { createTransferStores, TOR_LEVELS };
