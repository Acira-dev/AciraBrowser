'use strict';
// Applying a validated payload on the receiving computer (spec section 11): merge rules, all or nothing, Undo.
//
// Order (11.1), each step recorded on the batch BEFORE it writes, so a cut-off apply can be taken back at the next start:
//   1. create the target profile (a new one only)
//   2. one database transaction: Spaces, groups and tabs, bookmarks, history, permissions, zoom, policies, then the batch with state 'applying'
//   3. settings except the look, the app-wide stores, shortcuts, and only the ticked lines of 10.1
//   4. site icons, routines, pictures, passwords, the Pull requests folder
//   5. the look (applyLook), inside the reveal: the Look, Layout and Motion keys; the renderer then writes its interface preferences
//   6. applied(): the batch becomes 'done'. If it never happens the batch stays 'applying' and is rolled back at the next start.
//
// Everything this module touches comes through `deps`, so the tests run it on a real BrowserDatabase and fake stores.

const crypto = require('node:crypto');
/** JSON with the keys of every object in order, so two recipes that say the same thing compare equal whatever order they were written in. */
const stableJson = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))) : item));
const inventory = require('./inventory.cjs');
const payloads = require('./payload.cjs');
const zapLib = require('../browser-services/zap.cjs');

const PLATFORM_NAMES = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };
const platformName = (platform) => PLATFORM_NAMES[platform] || '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') || 'Site'; } catch { return 'Site'; } };
const MAIN_NAME = 'Main';

/** Does this profile still look untouched? (one Space with no name, no pinned tabs, no bookmarks, under 50 visits) — the default target is "Into this profile". */
function isFresh(state, profileId) {
  const own = (state.workspaces || []).filter((item) => item.browserProfileId === profileId);
  if (own.length > 1 || (own[0] && (own[0].name || own[0].icon || own[0].color))) return false;
  if ((state.tabs || []).some((tab) => tab.browserProfileId === profileId && tab.pinned)) return false;
  if ((state.bookmarkNodes || []).some((node) => node.browserProfileId === profileId)) return false;
  return (state.browsingHistory || []).filter((visit) => visit.browserProfileId === profileId).length < 50;
}

/** A flat bookmark list (parentId links) in the shape the importers' collectBookmarks reads. */
function bookmarkTree(rows) {
  const ids = new Set(rows.map((row) => row.id)), byParent = new Map();
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) && row.parentId !== row.id ? row.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(row);
  }
  const build = (parent, depth) => (depth > 60 ? [] : (byParent.get(parent) || []).sort((a, b) => a.position - b.position).map((row) => (row.url
    ? { type: 'url', name: row.title, url: row.url, guid: 'acira-' + row.id }
    : { type: 'folder', name: row.title, guid: 'acira-' + row.id, children: build(row.id, depth + 1) })));
  return build(null, 0);
}

/** The Spaces of a payload with their pinned tabs, groups and loose tabs, in the shape addSpaces takes. */
function spacesOf(payload) {
  const spaces = payload.spaces || [];
  if (!spaces.length) return [];
  const first = spaces[0].id, known = new Set(spaces.map((space) => space.id));
  const where = (item) => (known.has(item.workspaceId) ? item.workspaceId : first);
  const groups = payload.tabGroups || [];
  const tabs = [...(payload.pinnedTabs || []).map((tab) => ({ ...tab, pinned: true, groupId: null })), ...(payload.groupTabs || []), ...(payload.openTabs || [])];
  return spaces.map((space) => {
    const own = groups.filter((group) => where(group) === space.id);
    const mine = tabs.filter((tab) => where(tab) === space.id);
    return {
      key: space.id, name: space.name || '', ...(space.icon ? { icon: space.icon } : {}), ...(space.color ? { color: space.color } : {}),
      allPinned: mine.filter((tab) => tab.pinned),
      pinned: mine.filter((tab) => tab.pinned),
      groups: own.map((group) => ({ name: group.name, color: group.color, collapsed: group.collapsed, ...(group.pinned === true ? { pinned: true } : {}), tabs: mine.filter((tab) => tab.groupId === group.id) })),
      tabs: mine.filter((tab) => !tab.pinned && !own.some((group) => group.id === tab.groupId))
    };
  });
}
const pinnedUrls = (tabs) => [...new Set(tabs.map((tab) => tab.url))].sort();

/**
 * What the Spaces will do on this profile, without doing it (the preview uses it): which Spaces are new, which are duplicates of ones already here,
 * which will not fit (MAX_WORKSPACES), and whether the empty default Space is reused.
 */
function planSpaces(state, profileId, payload, { maxWorkspaces = require('../runtime.cjs').MAX_WORKSPACES } = {}) {
  const incoming = spacesOf(payload), suffix = platformName(payload.app?.platform);
  const own = (state.workspaces || []).filter((item) => item.browserProfileId === profileId);
  const pinnedOf = (workspace) => (state.tabs || []).filter((tab) => tab.browserProfileId === profileId && tab.pinned && (tab.workspaceId || own[0]?.id) === workspace.id);
  // The profile's empty first Space (no name, icon, colour or pinned tab) is taken over by the first incoming Space; a brand-new profile has none yet and gets one.
  const eligible = own.length <= 1 && !(own[0] && (own[0].name || own[0].icon || own[0].color)) && !(own[0] && pinnedOf(own[0]).length);
  const existing = eligible ? [] : own;
  let room = eligible ? maxWorkspaces : Math.max(0, maxWorkspaces - own.length);
  const duplicates = [], add = [], overflow = [];
  for (const space of incoming) {
    const name = space.name || MAIN_NAME, pins = pinnedUrls(space.allPinned);
    const match = existing.find((item) => [name, name + (suffix ? ' · ' + suffix : '')].includes(item.name || MAIN_NAME) && same(pinnedUrls(pinnedOf(item)), pins));
    if (match) { duplicates.push(space.key); continue; }
    if (room <= 0) { overflow.push(space); continue; }
    room--; add.push(space);
  }
  return { incoming, add, duplicates, overflow, reuse: eligible && add.length > 0, suffix };
}

function createTransferApply(deps) {
  const { database, imports, getState, commit } = deps;
  const uuid = deps.randomUUID || crypto.randomUUID;
  const now = deps.now || Date.now;
  const stores = deps.stores || {};
  const maxWorkspaces = deps.maxWorkspaces ?? require('../runtime.cjs').MAX_WORKSPACES;
  const pending = new Map(); // batchId -> { payload, request, blocked, profileId } kept until applyLook / applied / undo

  /** B's values for the safety comparison (10.1) and for the "before" records. */
  function current(profileId) {
    const policy = database.policy(profileId, '*') || {};
    const mode = database.policy(profileId, inventory.SCRIPTS_MODE_SITE)?.mode || 'default';
    return {
      privacy: stores.privacy?.get(), network: stores.network?.get(), policy, scriptsMode: mode,
      scriptAllowed: database.policies(profileId).filter((row) => row.site.startsWith('scripts:') && row.scripts === 'allow').map((row) => row.site.slice('scripts:'.length)),
      torLevel: stores.tor?.get().level, passwordsEnabled: stores.passwords?.enabled(), livePrsFolder: Boolean(stores.livePrs?.folder(profileId)),
      searchEngineIds: (deps.searchEngineIds ? deps.searchEngineIds(profileId) : []), searchProviders: policy.searchProviders || null,
      settings: { engineSuggestions: getState().settings.engineSuggestions, engineSuggestionsAddress: getState().settings.engineSuggestionsAddress, imageSearchCustom: getState().settings.imageSearchCustom }
    };
  }
  const persist = (batch) => database.updateImport({ ...batch });
  /** The profile's own settings (its Light/Dark, colours and search choice) as they were, recorded once, so Undo can give them back. */
  function recordOwnBefore(batch, profileId) {
    if ('profileSettingsBefore' in batch) return;
    batch.profileSettingsBefore = clone(getState().browserProfiles.find((item) => item.id === profileId)?.settings || null);
    persist(batch);
  }
  /** Progress for the screens (R6's ticks): the service passes `onStep`; nothing here depends on it. */
  const step = (name) => { try { deps.onStep?.(name); } catch { /* progress is a courtesy */ } };

  /** The validated payload, with the ticked/unticked changes of 10.1 worked out for this profile. */
  function prepare(payload, request) {
    const profileId = request.profileId;
    const lines = payloads.safetyLines(payload, current(profileId));
    const ticked = new Set(request.safety || []);
    return { lines, blocked: new Set(lines.filter((line) => !ticked.has(line.id)).map((line) => line.id)) };
  }

  /** What the preview shows before anything is written. */
  function preview(payload, { profileId, target = 'current', state = getState() } = {}) {
    const existingId = target === 'current' ? profileId : null;
    const basis = existingId || profileId;
    const plan = planSpaces(existingId ? state : { ...state, workspaces: [], tabs: [] }, existingId || '', payload, { maxWorkspaces });
    return {
      counts: payloads.countsOf(payload), safety: payloads.safetyLines(payload, current(basis)), fresh: isFresh(state, profileId),
      spaces: { add: plan.add.length, duplicates: plan.duplicates.length, overflow: plan.overflow.length, overflowTabs: plan.overflow.reduce((n, space) => n + space.pinned.length + space.groups.reduce((m, group) => m + group.tabs.length, 0) + space.tabs.length, 0), reuse: Boolean(plan.reuse) },
      notMoved: payload.notMoved || { lockedSpaces: 0, lockedTabs: 0 },
      changesSpacesMode: payload.settings?.spaces === 'profiles' && getState().settings.spaces !== 'profiles',
      language: payload.settings?.language && payload.settings.language !== 'system' && payload.settings.language !== getState().settings.language ? payload.settings.language : null
    };
  }

  // ------------------------------------------------------------------ apply (steps 1-4)

  async function apply(payload, request) {
    const include = request.include || Object.fromEntries((payload.included || []).map((row) => [row, true]));
    const rowOn = (row) => include[row] !== false && (payload.included || []).includes(row);
    let createdProfileId = null;
    let batch = null;
    const startState = getState();
    let profileId = request.profileId ?? startState.activeBrowserProfileId;
    try {
      // 1. the target profile
      if (request.target === 'new') {
        const taken = new Set(startState.browserProfiles.map((item) => item.name));
        let name = payload.profile?.name || 'Profile';
        for (let n = 2; taken.has(name); n++) name = (payload.profile?.name || 'Profile') + ' ' + n;
        createdProfileId = await deps.createProfile({ name, color: payload.profile?.color, picture: payload.profile?.picture, email: payload.profile?.email });
        profileId = createdProfileId;
      } else if (startState.browserProfiles.find((item) => item.id === profileId)?.private) throw new Error('Moving a profile is not available in a private window.');
      const { blocked } = prepare(payload, { profileId, safety: request.safety });
      const sender = platformName(payload.app?.platform);

      const batchId = 'import-' + uuid();
      batch = {
        id: batchId, profileId, ...(profileId !== startState.activeBrowserProfileId ? { initiatorProfileId: startState.activeBrowserProfileId } : {}),
        sourceId: 'transfer:' + crypto.createHash('sha256').update(String(payload.createdAt) + (payload.profile?.name || '')).digest('hex').slice(0, 24),
        browser: 'Acira', name: ('From ' + (payload.profile?.name || 'Acira') + (sender ? ' · ' + sender : '')).slice(0, 120), createdAt: now(),
        transfer: true, state: 'applying', ...(createdProfileId ? { createdProfileId } : {}),
        bookmarkIds: [], historyIds: [], results: [], tabIds: [], groupIds: [], workspaceIds: [],
        sender: { platform: payload.app?.platform || '', version: payload.app?.version || '' }
      };

      // 2. one transaction: state-bound parts + the batch record
      database.transaction(() => {
        const next = structuredClone(getState());
            // Spaces, groups, tabs
        if ((rowOn('spaces') || rowOn('openTabs')) && payload.spaces?.length) {
          const plan = planSpaces(next, profileId, payload, { maxWorkspaces });
          const toAdd = plan.add.filter((space) => rowOn('spaces') || space.tabs.length);
          const trim = (space) => (rowOn('spaces') ? space : { ...space, pinned: [], groups: [] });
          const reuse = plan.reuse ? imports.ensureOwnWorkspace(next, profileId)[0].id : null;
          imports.addSpaces(next, batch, profileId, toAdd.map(trim), { suffix: plan.suffix ? ' · ' + plan.suffix : ' · Imported', reuse });
          // Spaces that do not fit: their tabs become bookmarks, so nothing is lost
          if (plan.overflow.length && rowOn('spaces')) {
            payload = { ...payload, bookmarks: [...(payload.bookmarks || []), ...overflowBookmarks(plan.overflow, plan.suffix, uuid)] };
            batch.overflow = { spaces: plan.overflow.length };
          }
          batch.results.push({ category: 'spaces', status: 'imported', count: toAdd.length, workspaces: toAdd.length, tabs: batch.tabIds.length, skipped: plan.duplicates.length + plan.overflow.length });
        }
        // Bookmarks
        if (rowOn('bookmarks') && payload.bookmarks?.length) {
          const left = { notWeb: 0 };
          const incoming = imports.collectBookmarks({ top: bookmarkTree(payload.bookmarks) }, profileId, batch.id, 'acira-transfer', left);
          const { added, duplicates } = imports.mergeBookmarks(next.bookmarkNodes, incoming, profileId, batch.id);
          batch.bookmarkIds.push(...added.map((node) => node.id));
          batch.results.push({ category: 'bookmarks', status: 'imported', count: added.filter((node) => node.url).length, folders: added.filter((node) => !node.url).length, skipped: duplicates + left.notWeb });
        }
        // History
        if (rowOn('history') && payload.history?.length) {
          const visits = payload.history.map((visit) => ({ id: 'visit-' + uuid(), browserProfileId: profileId, profileId: '', url: visit.url, title: visit.title || new URL(visit.url).hostname, time: visit.time, importBatchId: batch.id }));
          const fresh = imports.newVisits(next.browsingHistory, visits, profileId);
          next.browsingHistory.push(...fresh.added);
          next.browsingHistory.sort((a, b) => b.time.localeCompare(a.time));
          batch.historyIds.push(...fresh.added.map((visit) => visit.id));
          batch.results.push({ category: 'history', status: 'imported', count: fresh.added.length, skipped: fresh.duplicates });
        }
        batch.importedBookmarks = next.bookmarkNodes.filter((node) => node.importBatchId === batch.id).map((node) => ({ ...node }));
        // Site settings (add where absent; this computer's own decisions win)
        if (rowOn('privacy') && payload.sites) siteSettings(next, payload.sites, profileId, batch, blocked);
        if (rowOn('spaces') && payload.profile?.sidePanelSites?.length) sidePanelSites(next, payload.profile.sidePanelSites, profileId, batch);
        if (rowOn('spaces') && payload.favorites?.length) batch.favorites = payload.favorites.map(({ url, title }) => ({ url, title }));
        next.revision++;
        next.bookmarks = [...new Set(next.bookmarkNodes.filter((node) => node.browserProfileId === profileId && node.url).map((node) => node.url))];
        database.recordImport(batch);
        commit(next);
      });

      step('spaces'); step('bookmarks'); step('history');
      // 3. settings except the look, the app-wide stores, shortcuts
      early(payload, batch, profileId, rowOn, blocked);
      step('settings'); step('sites');
      // 4. icons, routines, pictures, passwords, the Pull requests folder
      await late(payload, batch, profileId, rowOn, blocked, request.target === 'new' ? 'new' : 'current');
      step('other');
      persist(batch);
      pending.set(batch.id, { payload, request, blocked, profileId, rowOn });
      return {
        batchId: batch.id, profileId, createdProfileId, results: batch.results, counts: payloads.countsOf(payload), needsRestart: Boolean(batch.needsRestart),
        ui: payload.ui || { profile: {}, global: {} }, favorites: rowOn('spaces') ? payload.favorites || [] : [], readingList: rowOn('reading') ? payload.readingList || [] : [],
        extensions: rowOn('extensions') ? payload.extensions || [] : [], webApps: rowOn('extensions') ? payload.webApps || [] : [],
        language: payload.settings?.language && payload.settings.language !== 'system' && payload.settings.language !== getState().settings.language && rowOn('settings') ? payload.settings.language : null,
        notMoved: payload.notMoved || { lockedSpaces: 0, lockedTabs: 0 }, overflow: batch.overflow || null
      };
    } catch (error) {
      // All or nothing: take back whatever was recorded, and remove a profile this apply made.
      console.error('Transfer apply failed and was taken back:', String(error?.stack || error).slice(0, 1500));
      try { if (batch && database.imports(batch.profileId).some((item) => item.id === batch.id)) imports.undoBatch(database.imports(batch.profileId).find((item) => item.id === batch.id)); } catch (undoError) { console.warn('Transfer rollback:', undoError?.message || undoError); }
      try { if (createdProfileId && deps.removeProfile) await deps.removeProfile(createdProfileId); } catch { /* the profile is empty and harmless */ }
      throw Object.assign(new Error('Something went wrong, so nothing was changed.'), { code: 'apply-failed', cause: error });
    }
  }

  /** Permissions, zoom and per-site policies (add where absent), and the profile policy (replace the moved keys). */
  function siteSettings(next, sites, profileId, batch, blocked) {
    batch.permissionKeys = []; batch.sitePolicyBefore = {};
    for (const row of sites.permissions || []) {
      if (database.permission(profileId, row.requester, row.embedder, row.permission) !== undefined) continue;
      database.setPermission(profileId, row.requester, row.embedder, row.permission, row.decision === 'block' ? 'deny' : row.decision);
      batch.permissionKeys.push({ requester: row.requester, embedder: row.embedder, permission: row.permission });
    }
    batch.zoomAdded = [];
    for (const [origin, zoom] of Object.entries(sites.zoom || {})) {
      if (next.originZooms?.[profileId]?.[origin] !== undefined) continue;
      ((next.originZooms ||= {})[profileId] ||= {})[origin] = zoom; batch.zoomAdded.push(origin);
    }
    const incoming = { ...sites.profilePolicy };
    if (blocked.has('blocking')) delete incoming.blocking;
    if (blocked.has('httpsOnly')) delete incoming.httpsOnly;
    if (incoming.searchProviders) incoming.searchProviders = withoutBlockedEngines(incoming.searchProviders, blocked, database.policy(profileId, '*')?.searchProviders);
    if (!incoming.searchProviders) delete incoming.searchProviders;
    if (Object.keys(incoming).length) {
      const before = database.policy(profileId, '*');
      batch.profilePolicyBefore = before ? clone(before) : null;
      database.setPolicy(profileId, '*', { ...(before || {}), ...incoming });
      batch.profilePolicyAfter = { ...incoming };
    }
    for (const row of sites.sitePolicies || []) {
      const isScripts = row.site.startsWith('scripts:');
      // Unticked "Allow JavaScript on more sites": a stricter row still applies (a block, or the mode "everywhere"); an allow row and the looser mode do not.
      if (isScripts && blocked.has('scripts') && (row.site === inventory.SCRIPTS_MODE_SITE ? row.payload.mode !== 'everywhere' : row.payload.scripts === 'allow')) continue;
      const before = database.policy(profileId, row.site);
      if (before && row.site !== inventory.SCRIPTS_MODE_SITE) continue;
      if (before && row.site === inventory.SCRIPTS_MODE_SITE && same(before.mode, row.payload.mode)) continue;
      batch.sitePolicyBefore[row.site] = before ? clone(before) : null;
      database.setPolicy(profileId, row.site, { ...(before || {}), ...row.payload });
    }
    // The parts the person removed from sites (Zap): add the rules this profile does not already have, one row per host (never a second copy of the same part, never past Zap's own limits)
    batch.zapAdded = {};
    const zapHosts = (database.policies(profileId) || []).filter((row) => row.site.startsWith(inventory.ZAP_PREFIX)).length;
    for (const row of sites.zap || []) {
      const key = inventory.ZAP_PREFIX + row.host;
      const before = database.policy(profileId, key);
      if (!before && zapHosts + Object.keys(batch.zapAdded).length >= zapLib.LIMITS.hosts) continue;
      const have = Array.isArray(before?.rules) ? before.rules : [];
      const ids = new Set(have.map((rule) => rule.id)), added = [];
      for (const rule of row.rules) {
        if (have.length + added.length >= zapLib.LIMITS.rulesPerHost) break;
        if (ids.has(rule.id) || [...have, ...added].some((other) => (other.sels || []).some((selector) => rule.sels.includes(selector)))) continue;
        added.push(rule); ids.add(rule.id);
      }
      if (!added.length) continue;
      database.setPolicy(profileId, key, { ...(before || {}), rules: [...have, ...added].sort((a, b) => a.at - b.at) });
      batch.zapAdded[row.host] = added.map((rule) => rule.id);
    }
    if (Object.keys(batch.zapAdded).length) { try { zapLib.sharedZap(database).reload(profileId); } catch { /* Zap reads its rows again at the next page */ } }
    batch.results.push({ category: 'sites', status: 'imported', count: batch.permissionKeys.length + Object.keys(batch.sitePolicyBefore).length + Object.keys(batch.zapAdded).length + batch.zoomAdded.length });
  }

  /** Beta 14 (AF): the pinned side panel sites join the target profile's own (an address already pinned stays as it is; six at most). Written into the draft state with the Spaces, so no toast per site and Undo is one step. */
  function sidePanelSites(next, incoming, profileId, batch) {
    const profile = next.browserProfiles.find((item) => item.id === profileId);
    if (!profile || profile.private || profile.tor) return;
    const mine = Array.isArray(profile.sidePanelSites) ? profile.sidePanelSites : [];
    const keys = new Set(mine.map((site) => payloads.sidePanelKey(site.url))), ids = new Set(mine.map((site) => site.id)), added = [];
    for (const site of incoming) {
      if (mine.length + added.length >= inventory.CAPS.sidePanelSites) break;
      const key = payloads.sidePanelKey(site.url);
      if (keys.has(key)) continue;
      let id = site.id;
      for (let n = 2; ids.has(id); n++) id = site.id.slice(0, 58) + '-' + n;
      keys.add(key); ids.add(id);
      added.push({ ...site, id, ...(site.title ? {} : { title: hostOf(site.url) }) });
    }
    if (!added.length) return;
    profile.sidePanelSites = [...mine, ...added];
    batch.sidePanelAdded = added.map((site) => site.id);
  }

  /** Step 3. Behaviour/search settings (one dispatch), the app-wide stores, shortcuts. Every group records its "before" value first. */
  function early(payload, batch, profileId, rowOn, blocked) {
    const dispatch = deps.dispatch;
    const patch = {};
    const rows = { settings: rowOn('settings') };
    if (rows.settings && payload.settings) {
      for (const key of inventory.EARLY_SETTINGS) {
        if (payload.settings[key] === undefined) continue;
        let value = clone(payload.settings[key]);
        if (key === 'searchProviders' && value) value = withoutBlockedEngines(value, blocked, getState().settings.searchProviders);
        if (value === null || value === undefined) { if (payload.settings[key] !== null) continue; }
        try { deps.validateSettings?.({ [key]: value }); } catch { continue; }
        patch[key] = value;
      }
    }
    // lines left unticked: suggestions stay as they were, an address of their own (and the choice that points at it) does not arrive
    if (blocked.has('suggest')) delete patch.engineSuggestions;
    if (blocked.has('suggest:custom')) { if (patch.engineSuggestionsFrom === 'custom') delete patch.engineSuggestionsFrom; delete patch.engineSuggestionsAddress; }
    if (blocked.has('imageSearch:custom')) { if (patch.imageSearch === 'custom') delete patch.imageSearch; delete patch.imageSearchCustom; delete patch.imageSearchCustomPost; }
    if (Object.keys(patch).length) updateSettings(batch, patch);

    // the profile's own search choice (its own Light/Dark and colours move with the Look row, in applyLook)
    if (payload.profile?.settings && rowOn('settings')) {
      const own = {};
      for (const key of ['searchEngine', 'searchProviderId']) if (payload.profile.settings[key]) own[key] = payload.profile.settings[key];
      if (Object.keys(own).length) {
        recordOwnBefore(batch, profileId);
        dispatch({ type: 'browser.profile.settings', id: profileId, patch: own });
      }
    }

    batch.appPrefsBefore = batch.appPrefsBefore || {}; batch.appPrefsAfter = batch.appPrefsAfter || {};
    const prefs = payload.appPrefs || {};
    const group = (name, row, read, write, incoming, storeName = name) => {
      if (!rowOn(row) || incoming === undefined || !stores[storeName]) return;
      const before = read();
      batch.appPrefsBefore[name] = clone(before);
      persist(batch);
      write(incoming);
      batch.appPrefsAfter[name] = clone(read());
      if (!same(before, batch.appPrefsAfter[name])) batch.results.push({ category: name, status: 'imported', count: 1 });
    };
    if (prefs.privacy) {
      const privacy = { ...prefs.privacy };
      if (blocked.has('phishing')) { delete privacy.phishingLists; delete privacy.pageWarnings; }
      for (const name of ['cnameUncloaking', 'skipTrackingRedirects', 'stripTrackingParams', 'deAmp', 'fingerprint']) if (blocked.has('protection:' + name)) delete privacy[name];
      group('privacy', 'privacy', () => stores.privacy.get(), (value) => stores.privacy.set(value), privacy);
    }
    if (prefs.network) {
      const network = { ...prefs.network };
      if (blocked.has('dns')) delete network.dns; if (blocked.has('cookies')) delete network.cookies; if (blocked.has('gpc')) delete network.gpc;
      group('network', 'privacy', () => stores.network.get(), (value) => { const now0 = stores.network.get(); stores.network.set({ ...now0, ...value }); if (!same(stores.network.get(), now0)) batch.needsRestart = true; }, network);
    }
    if (prefs.filtersAutomatic !== undefined) group('filters', 'privacy', () => stores.filters.automatic(), (value) => stores.filters.setAutomatic(value), prefs.filtersAutomatic);
    if (prefs.tor && !blocked.has('tor')) group('tor', 'privacy', () => stores.tor.get(), (value) => stores.tor.set({ ...stores.tor.get(), ...value }), prefs.tor);
    if (prefs.downloadsAskWhere !== undefined) group('downloads', 'settings', () => stores.downloads.askWhere(), (value) => stores.downloads.setAskWhere(value), prefs.downloadsAskWhere);
    if (prefs.downloadsOffer !== undefined && stores.downloads?.offer) group('downloadsOffer', 'settings', () => stores.downloads.offer(), (value) => stores.downloads.setOffer(value), prefs.downloadsOffer, 'downloads');
    if (prefs.passwordsEnabled !== undefined && !blocked.has('passwords')) group('passwords', 'settings', () => stores.passwords.enabled(), (value) => stores.passwords.setEnabled(value), prefs.passwordsEnabled);
    if (prefs.rewind) group('rewind', 'settings', () => stores.rewind.get(), (value) => stores.rewind.set({ ...stores.rewind.get(), ...value }), prefs.rewind);
    if (payload.shortcuts && rowOn('settings') && stores.shortcuts) {
      batch.shortcutsBefore = stores.shortcuts.exportJson();
      persist(batch);
      const outcome = stores.shortcuts.apply(payload.shortcuts);
      batch.shortcutsAfter = stores.shortcuts.exportJson();
      batch.results.push({ category: 'shortcuts', status: 'imported', count: outcome?.applied ?? Object.keys(payload.shortcuts.bindings).length, skipped: outcome?.skipped || 0 });
    }
  }

  /** Step 4. */
  async function late(payload, batch, profileId, rowOn, blocked, identityMode) {
    if (payload.favicons && stores.favicons && (rowOn('spaces') || rowOn('bookmarks') || rowOn('history'))) {
      const icons = new Map();
      for (const [host, data] of Object.entries(payload.favicons)) {
        if (stores.favicons.get(profileId, host)) continue;
        const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
        if (bytes.length) icons.set(host, bytes);
      }
      batch.faviconHosts = [...icons.keys()];
      persist(batch);
      if (icons.size) stores.favicons.adopt(profileId, icons);
    }
    if (payload.routines?.length && rowOn('reading') && stores.routines) {
      // A tab set the profile already has (the same recipe, from an earlier copy or its own) is not added again: a second copy adds only what is new (spec 11.2, "adds nothing the second time").
      const same = (recipe) => stableJson(recipe);
      const have = new Set((await stores.routines.export(profileId)).map(same));
      const fresh = payload.routines.filter((recipe) => !have.has(same(recipe)));
      persist(batch);
      batch.routineIds = fresh.length ? await stores.routines.import(profileId, fresh) : [];
      batch.results.push({ category: 'routines', status: 'imported', count: batch.routineIds.length, skipped: payload.routines.length - fresh.length });
    }
    if (payload.pictures?.length && rowOn('pictures') && stores.artwork) {
      // A picture is stored re-encoded on this computer, so its bytes cannot be compared with the sender's. What is compared is what an earlier copy brought: the fingerprint of the
      // incoming bytes is kept in that copy's batch (a fingerprint, never the picture), and a picture whose fingerprint is there while the picture itself is still here is not added again.
      const fingerprint = (picture) => crypto.createHash('sha256').update(String(picture.data)).digest('hex');
      const present = new Set((await stores.artwork.export(profileId)).map((item) => item.id));
      const brought = new Set(database.imports(profileId).filter((item) => item.transfer && !item.undoneAt).flatMap((item) => item.pictureSources || []).filter((item) => present.has(item.id)).map((item) => item.hash));
      const fresh = payload.pictures.filter((picture) => !brought.has(fingerprint(picture)));
      persist(batch);
      batch.pictureNames = []; batch.pictureSources = [];
      for (const picture of fresh) { // one at a time: each one's fingerprint is kept with the id it was given
        const [id] = await stores.artwork.import(profileId, [picture]);
        if (id) { batch.pictureNames.push(id); batch.pictureSources.push({ hash: fingerprint(picture), id }); }
      }
      batch.results.push({ category: 'pictures', status: 'imported', count: batch.pictureNames.length, skipped: payload.pictures.length - fresh.length });
    }
    if (payload.passwords?.length && rowOn('passwords') && stores.vault) {
      persist(batch);
      const outcome = await stores.vault.add(profileId, payload.passwords);
      batch.passwordIds = outcome.added;
      batch.results.push({ category: 'passwords', status: 'imported', count: outcome.added.length, skipped: outcome.kept });
    }
    if (payload.livePrs && rowOn('spaces') && !blocked.has('livePrs') && stores.livePrs && !stores.livePrs.folder(profileId)) {
      batch.livePrsBefore = null;
      persist(batch);
      stores.livePrs.adopt(profileId, payload.livePrs);
      batch.livePrsAdded = true;
    }
    // The profile's key pair, certificate, welcome flag and recognition state (identity.cjs). Written through the module that owns them (mode 'new' for the profile this apply created,
    // 'current' otherwise); what the batch keeps is the outcome and a small receipt, never the key: a profile whose own identity was used keeps it ('kept'), and a second copy of the
    // same profile changes nothing ('same'), so Undo has nothing to take back but what this transfer wrote.
    if (payload.identity && rowOn('settings') && stores.identity) {
      persist(batch);
      try {
        const outcome = await stores.identity.import(profileId, payload.identity, { mode: identityMode });
        batch.identity = { status: outcome.status, verified: outcome.verified ?? null, insider: outcome.insider === true, number: outcome.number ?? null, certDropped: outcome.certDropped === true };
        if (outcome.status === 'imported' && outcome.receipt) batch.identityReceipt = clone(outcome.receipt);
      } catch (error) { batch.identity = { status: 'failed' }; console.warn('Transfer (identity):', error?.message || error); }
    }
  }

  // ------------------------------------------------------------------ the look (step 5) and the end (step 6)

  /** Main's half of the reveal: the Look, Layout and Motion keys. */
  function applyLook(batchId) {
    const held = pending.get(batchId);
    if (!held) throw new Error('This transfer is no longer waiting to apply its look.');
    const { payload, rowOn } = held;
    const batch = findBatch(batchId, held.profileId);
    const patch = {};
    if (rowOn('look') && payload.settings) {
      for (const key of inventory.LOOK_ROW_SETTINGS) {
        if (payload.settings[key] === undefined) continue;
        try { deps.validateSettings?.({ [key]: payload.settings[key] }); } catch { continue; }
        patch[key] = clone(payload.settings[key]);
      }
    }
    // 13.6: a profile on "This profile" owns its Light/Dark and colours, and a settings.update goes to it instead of the computer's look. The transfer sets the computer's
    // look first (so the profile's own is cleared for that moment) and then the profile's own, as the sender had it, so this profile shows what the sender's showed.
    const profile = getState().browserProfiles.find((item) => item.id === held.profileId);
    const mine = rowOn('look') && Boolean(profile);
    // only the profile the reducer routes to (the active one) has its own look cleared first; a profile made for this transfer is addressed directly
    if (mine && profile.id === getState().activeBrowserProfileId && profile.settings?.appearance) { recordOwnBefore(batch, profile.id); deps.dispatch({ type: 'browser.profile.settings', id: profile.id, patch: { appearance: null } }); }
    if (Object.keys(patch).length) updateSettings(batch, patch);
    const own = payload.profile?.settings;
    if (mine && own?.appearance) {
      recordOwnBefore(batch, profile.id);
      deps.dispatch({ type: 'browser.profile.settings', id: profile.id, patch: { appearance: own.appearance, ...(own.look ? { look: clone(own.look) } : {}) } });
    }
    return { ok: true, changed: Object.keys(patch).length + (mine && own?.appearance ? 1 : 0) };
  }

  /** Step 6. */
  function applied(batchId) {
    const held = pending.get(batchId);
    const batch = findBatch(batchId, held?.profileId);
    if (!batch) throw new Error('This transfer was not found.');
    if (batch.state === 'applying') { batch.state = 'done'; persist(batch); }
    pending.delete(batchId);
    return { ok: true };
  }

  function findBatch(batchId, profileId) {
    for (const id of [profileId, ...getState().browserProfiles.map((item) => item.id)]) {
      const hit = id && database.imports(id).find((item) => item.id === batchId);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * One settings.update, recorded: the reducer normalizes (the glass slider moves three keys, the window view mirrors the toolbar layout), so the record is the
   * difference between the settings before and after, every key that moved. previousSettings holds the first "before" of a key, importedSettings the last value
   * the transfer wrote, and settingsAbsent the keys that did not exist before (Undo deletes them again).
   */
  function updateSettings(batch, patch) {
    const before = clone(getState().settings);
    deps.dispatch({ type: 'settings.update', patch });
    const after = getState().settings;
    batch.previousSettings ||= {}; batch.importedSettings ||= {}; batch.settingsAbsent ||= [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(before[key], after[key])) continue;
      if (!(key in batch.previousSettings) && !batch.settingsAbsent.includes(key)) { if (before[key] === undefined) batch.settingsAbsent.push(key); else batch.previousSettings[key] = clone(before[key]); }
      batch.importedSettings[key] = clone(after[key]);
    }
    persist(batch);
  }

  // ------------------------------------------------------------------ Undo (the other stores; the state-bound part is imports.undoBatch)

  /** Inside imports' undo transaction: everything that lives in the database or the window state. */
  function undoInTransaction(batch, next) {
    if (!batch.transfer) return;
    const profileId = batch.profileId;
    for (const key of batch.permissionKeys || []) database.setPermission(profileId, key.requester, key.embedder, key.permission, 'ask');
    for (const [site, before] of Object.entries(batch.sitePolicyBefore || {})) {
      const now0 = database.policy(profileId, site);
      if (before) database.setPolicy(profileId, site, before); else if (now0) database.deletePolicy(profileId, site);
    }
    // the parts removed from sites: take out only the rules the transfer added (the person may have removed more since)
    for (const [host, ids] of Object.entries(batch.zapAdded || {})) {
      const key = inventory.ZAP_PREFIX + host, current = database.policy(profileId, key);
      if (!current || !Array.isArray(current.rules)) continue;
      const rest = current.rules.filter((rule) => !ids.includes(rule.id));
      if (rest.length) database.setPolicy(profileId, key, { ...current, rules: rest }); else database.deletePolicy(profileId, key);
    }
    if (Object.keys(batch.zapAdded || {}).length) { try { zapLib.sharedZap(database).reload(profileId); } catch { /* read again at the next page */ } }
    if (batch.sidePanelAdded?.length) {
      const profile = next.browserProfiles.find((item) => item.id === profileId);
      if (profile?.sidePanelSites) { const rest = profile.sidePanelSites.filter((site) => !batch.sidePanelAdded.includes(site.id)); if (rest.length) profile.sidePanelSites = rest; else delete profile.sidePanelSites; }
    }
    if ('profilePolicyBefore' in batch) {
      if (batch.profilePolicyBefore) database.setPolicy(profileId, '*', batch.profilePolicyBefore); else database.deletePolicy(profileId, '*');
    }
    // settings the transfer wrote: back to the first value, but only where it still holds what the transfer wrote (the generic Undo compares with ===, which cannot see objects)
    for (const [key, value] of Object.entries(batch.previousSettings || {})) if (same(next.settings[key], batch.importedSettings?.[key])) next.settings[key] = clone(value);
    for (const key of batch.settingsAbsent || []) if (same(next.settings[key], batch.importedSettings?.[key])) delete next.settings[key];
    if (batch.zoomAdded?.length && next.originZooms?.[profileId]) { for (const origin of batch.zoomAdded) delete next.originZooms[profileId][origin]; if (!Object.keys(next.originZooms[profileId]).length) delete next.originZooms[profileId]; }
  }
  /** After the transaction: the app-wide stores, the shortcuts and the other files, each only if it still holds what the transfer wrote. */
  function undoAfterCommit(batch) {
    if (!batch.transfer) return;
    const profileId = batch.profileId;
    const restore = (name, read, write, storeName = name) => {
      if (!(name in (batch.appPrefsBefore || {})) || !stores[storeName]) return;
      try { if (same(read(), batch.appPrefsAfter?.[name])) write(batch.appPrefsBefore[name]); } catch (error) { console.warn('Transfer undo (' + name + '):', error?.message || error); }
    };
    restore('privacy', () => stores.privacy.get(), (v) => stores.privacy.set(v));
    restore('network', () => stores.network.get(), (v) => { stores.network.set(v); });
    restore('filters', () => stores.filters.automatic(), (v) => stores.filters.setAutomatic(v));
    restore('tor', () => stores.tor.get(), (v) => stores.tor.set(v));
    restore('downloads', () => stores.downloads.askWhere(), (v) => stores.downloads.setAskWhere(v));
    restore('downloadsOffer', () => stores.downloads.offer(), (v) => stores.downloads.setOffer(v), 'downloads');
    restore('passwords', () => stores.passwords.enabled(), (v) => stores.passwords.setEnabled(v));
    restore('rewind', () => stores.rewind.get(), (v) => stores.rewind.set(v));
    try { if (batch.shortcutsBefore !== undefined && stores.shortcuts && stores.shortcuts.exportJson() === batch.shortcutsAfter) stores.shortcuts.restore(batch.shortcutsBefore); } catch (error) { console.warn('Transfer undo (shortcuts):', error?.message || error); }
    try { if (batch.faviconHosts?.length) stores.favicons.remove(profileId, batch.faviconHosts); } catch (error) { console.warn('Transfer undo (site icons):', error?.message || error); }
    try { if (batch.routineIds?.length) stores.routines.remove(batch.routineIds); } catch (error) { console.warn('Transfer undo (routines):', error?.message || error); }
    try { if (batch.pictureNames?.length) stores.artwork.remove(profileId, batch.pictureNames); } catch (error) { console.warn('Transfer undo (pictures):', error?.message || error); }
    try { if (batch.passwordIds?.length) stores.vault.remove(profileId, batch.passwordIds); } catch (error) { console.warn('Transfer undo (passwords):', error?.message || error); }
    try { if (batch.identityReceipt && stores.identity) stores.identity.undo(profileId, batch.identityReceipt); } catch (error) { console.warn('Transfer undo (identity):', error?.message || error); }
    try { if (batch.livePrsAdded) stores.livePrs.remove(profileId); } catch (error) { console.warn('Transfer undo (pull requests):', error?.message || error); }
    try { if ('profileSettingsBefore' in batch) deps.dispatch({ type: 'browser.profile.settings', id: profileId, patch: { appearance: null, searchEngine: null, searchProviderId: null, ...(batch.profileSettingsBefore || {}) } }); } catch (error) { console.warn('Transfer undo (profile):', error?.message || error); }
    try { deps.afterSettingsUndo?.(batch); } catch { /* the native frame catches up on the next change */ }
    pending.delete(batch.id);
  }

  return { apply, applyLook, applied, preview, current, isFresh, undoHooks: { inTransaction: undoInTransaction, afterCommit: undoAfterCommit }, hasPending: (id) => pending.has(id) };
}

/** Pinned tabs of Spaces that do not fit become bookmarks in a folder named after the sender's platform ("Spaces from Windows"). */
function overflowBookmarks(spaces, platform, uuid) {
  const rootId = 'overflow-' + uuid();
  const rows = [{ id: rootId, parentId: null, title: platform ? 'Spaces from ' + platform : 'Spaces', position: 1e6, createdAt: 0 }];
  spaces.forEach((space, at) => {
    const folderId = 'overflow-' + uuid();
    rows.push({ id: folderId, parentId: rootId, title: space.name, position: at, createdAt: 0 });
    [...space.pinned, ...space.groups.flatMap((group) => group.tabs), ...space.tabs].forEach((tab, index) => rows.push({ id: 'overflow-' + uuid(), parentId: folderId, title: tab.customTitle || tab.title || tab.url, url: tab.url, position: index, createdAt: 0 }));
  });
  return rows;
}

/** A search-provider choice without the engines whose line is unticked (their ids are 'search:<id>'); the default falls back when its engine goes. */
function withoutBlockedEngines(choice, blocked, fallbackChoice) {
  if (!choice || !Array.isArray(choice.engines)) return choice;
  const engines = choice.engines.filter((engine) => !blocked.has('search:' + engine.id));
  if (engines.length === choice.engines.length) return choice;
  if (!engines.length) return fallbackChoice || null;
  return { ...choice, engines, defaultId: engines.some((engine) => engine.id === choice.defaultId) ? choice.defaultId : (fallbackChoice?.defaultId && engines.some((engine) => engine.id === fallbackChoice.defaultId) ? fallbackChoice.defaultId : engines[0].id) };
}

module.exports = { createTransferApply, planSpaces, spacesOf, isFresh, bookmarkTree, overflowBookmarks, withoutBlockedEngines, platformName };
