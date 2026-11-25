'use strict';
// Payload v2 (spec section 10): what leaves the sending computer, and how the receiving one reads it.
//
//   buildPayload(deps, request)   the sender: reads the profile, the interface preferences the renderer collected and the app-wide stores
//   validatePayload(raw, current) the receiver: the payload is UNTRUSTED. Each section is checked on its own; a bad section is dropped and
//                                  reported, the rest still applies. It also lists the changes that lower protection or redirect traffic
//                                  (10.1): they are unticked by default and applied only when the person ticks them.
//   pack / unpack                 Brotli (async, with the inflated-size guard) around the JSON
//
// Nothing here touches the network, the disk or the DOM. Everything it reads comes through `deps`, so tests use fakes.

/** How long Rewind keeps moments (desktop/rewind/rewind.cjs DAYS): any other number from a file would make the whole apply fail, so it snaps to the nearest. */
const REWIND_DAYS = [1, 3, 7];
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const inventory = require('./inventory.cjs');
const zapLib = require('../browser-services/zap.cjs');
const identityLib = require('./identity.cjs');

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);
const { CAPS } = inventory;
const MAX_INFLATED = 128 * 1024 * 1024;
const FORMAT = 'acira-profile';
const VERSION = 2;

// ---------------------------------------------------------------- small checks

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, fallback = '') => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : fallback);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const finite = (value, min, max, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);
const hex = (value) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined);
/** An http(s) address without credentials, or null (the same rule as the importers). */
function webUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hostname ? url.href : null;
  } catch { return null; }
}
const timeOf = (value) => { const at = Date.parse(value); return Number.isFinite(at) ? at : NaN; };
const iconData = (value, max) => (typeof value === 'string' && value.length <= max && /^data:image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(value) ? value : undefined);
const size = (value) => { try { return JSON.stringify(value).length; } catch { return Infinity; } };
/** A JSON value of bounded size and depth with no keys that could poison a prototype. */
function plainJson(value, { bytes = 65536, depth = 8 } = {}) {
  const walk = (node, level) => {
    if (level > depth) throw new Error('too deep');
    if (Array.isArray(node)) return node.map((item) => walk(item, level + 1));
    if (isObject(node)) {
      const out = {};
      for (const key of Object.keys(node)) { if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue; out[key] = walk(node[key], level + 1); }
      return out;
    }
    if (node === null || ['string', 'number', 'boolean'].includes(typeof node)) return node;
    throw new Error('not JSON');
  };
  try { const out = walk(value, 0); return size(out) <= bytes ? out : undefined; } catch { return undefined; }
}
/** A secure-DNS endpoint the way secure-dns.cjs accepts it: https, no credentials, no query or fragment, optionally ending in the {?dns} template. */
function dnsServer(value) {
  if (typeof value !== 'string' || !value.length || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  const base = value.endsWith('{?dns}') ? value.slice(0, -6) : value;
  if (/[{}]/.test(base)) return false;
  try { const url = new URL(base); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
}
const BUILT_IN_SEARCH = new Set(['google', 'duckduckgo', 'bing']);

// ---------------------------------------------------------------- compression

/** JSON text of the payload, Brotli-compressed (async, so a large profile never blocks the main thread). */
async function pack(payload, { quality = 9 } = {}) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  if (json.length > MAX_INFLATED) throw new Error('The profile is too large to move.');
  return brotliCompress(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } });
}
/** The reverse; refuses to inflate past 128 MiB (a Brotli bomb), and bytes that are not JSON. */
async function unpack(bytes) {
  let json;
  try { json = await brotliDecompress(bytes, { maxOutputLength: MAX_INFLATED }); }
  catch (error) { const bomb = error && (error.code === 'ERR_BUFFER_TOO_LARGE' || /larger than/i.test(String(error.message))); throw Object.assign(new Error(bomb ? 'The data is larger than any Acira profile.' : 'The data could not be read.'), { code: bomb ? 'too-large' : 'damaged' }); }
  try { return JSON.parse(json.toString('utf8')); } catch { throw Object.assign(new Error('The data could not be read.'), { code: 'damaged' }); }
}

// ---------------------------------------------------------------- building (sender)

/**
 * @param deps   { getState, database, app:{version,platform}, now?, stores:{…optional readers…} }
 * @param request { profileId, include:{row:boolean}, historyDays:0|90|30, ui:{profile,global,readingList}, passwords:boolean (the gate said yes, and the destination is locked), identity:'code'|'locked-file'|false (the destination is locked: a code, or a password-locked file; the module refuses any other) }
 * @returns { payload, counts }
 */
async function buildPayload(deps, request) {
  const state = deps.getState();
  const profile = state.browserProfiles.find((item) => item.id === request.profileId && !item.private && !item.tor);
  if (!profile) throw new Error('Private browsing data cannot be moved.');
  const include = Object.fromEntries(inventory.ROWS.map((row) => [row, request.include?.[row] === true]));
  const stores = deps.stores || {};
  const ui = isObject(request.ui) ? request.ui : {};
  const uiProfile = isObject(ui.profile) ? ui.profile : {}, uiGlobal = isObject(ui.global) ? ui.global : {};
  const now = deps.now ? deps.now() : Date.now();
  const counts = {};
  const payload = {
    format: FORMAT, version: VERSION, minReader: 2, createdAt: new Date(now).toISOString(),
    app: { version: String(deps.app?.version || ''), platform: String(deps.app?.platform || process.platform) },
    included: inventory.ROWS.filter((row) => include[row]),
    profile: {
      name: profile.name, color: profile.color, ...(profile.avatar ? { avatar: profile.avatar } : {}),
      ...(profile.picture && profile.picture.length <= CAPS.profilePicture ? { picture: profile.picture } : {}),
      ...(profile.email ? { email: profile.email } : {}), ...(profile.settings ? { settings: { ...profile.settings } } : {})
    }
  };
  const mine = (item) => item.browserProfileId === profile.id;
  // Beta 14 (AF): the profile's pinned side panel sites go with its Spaces (they are part of what the sidebar holds for this profile); the preview does not list them apart
  if (include.spaces) { const pinned = cleanSidePanelSites(profile.sidePanelSites); if (pinned.length) payload.profile.sidePanelSites = pinned; }

  // ---- settings (Look and layout, Settings/search/shortcuts)
  const wanted = [...(include.look ? inventory.LOOK_ROW_SETTINGS : []), ...(include.settings ? [...inventory.BEHAVIOUR_SETTINGS, ...inventory.SEARCH_SETTINGS, ...inventory.LANGUAGE_SETTINGS] : [])];
  if (wanted.length) {
    payload.settings = {};
    for (const key of wanted) if (state.settings[key] !== undefined) payload.settings[key] = structuredClone(state.settings[key]);
  }

  // ---- interface preferences the renderer collected
  const uiOut = { profile: {}, global: {} };
  for (const pref of inventory.UI_PREFS) {
    if (!include[pref.row] || pref.id === 'readingList') continue;
    const source = pref.scope === 'global' ? uiGlobal : uiProfile;
    if (source[pref.id] === undefined) continue;
    if (pref.id === 'sidebarApps') { const { apps, ...rest } = source[pref.id]; uiOut.profile.sidebarApps = rest; } // the apps themselves travel as `favorites`
    else uiOut[pref.scope][pref.id] = source[pref.id];
  }
  if (Object.keys(uiOut.profile).length || Object.keys(uiOut.global).length) payload.ui = uiOut;

  // ---- app-wide preference stores
  const appPrefs = {};
  if (include.privacy) {
    if (stores.privacy) appPrefs.privacy = { ...stores.privacy.get() };
    if (stores.network) appPrefs.network = structuredClone(stores.network.get());
    if (stores.filters) appPrefs.filtersAutomatic = stores.filters.automatic();
    if (stores.tor) appPrefs.tor = { ...stores.tor.get() };
  }
  if (include.settings) {
    if (stores.downloads) { appPrefs.downloadsAskWhere = stores.downloads.askWhere(); if (stores.downloads.offer) appPrefs.downloadsOffer = stores.downloads.offer(); }
    if (stores.passwords) appPrefs.passwordsEnabled = stores.passwords.enabled();
    if (stores.rewind) appPrefs.rewind = { ...stores.rewind.get() };
  }
  if (Object.keys(appPrefs).length) payload.appPrefs = appPrefs;
  if (include.settings && stores.shortcuts) {
    try { const table = JSON.parse(stores.shortcuts.exportJson()); if (Object.keys(table.bindings || {}).length) { payload.shortcuts = table; counts.shortcuts = Object.keys(table.bindings).length; } } catch { /* none */ }
  }

  // ---- Spaces, groups, pinned tabs, Favorites
  const hosts = new Set();
  const noteHost = (url) => { try { hosts.add(new URL(url).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* skip */ } };
  const movableTab = (tab) => mine(tab) && !tab.privacy && !tab.favoriteId && webUrl(tab.url);
  if (include.spaces) {
    const spaces = (state.workspaces || []).filter((item) => mine(item) && !item.secured && !item.parked);
    const secured = (state.workspaces || []).filter((item) => mine(item) && item.secured).length;
    payload.spaces = spaces.map((item) => ({ id: item.id, name: item.name || '', ...(item.icon ? { icon: item.icon } : {}), ...(item.color ? { color: item.color } : {}) }));
    const kept = new Set(spaces.map((item) => item.id));
    const firstId = spaces[0]?.id;
    const spaceOf = (item) => (item.workspaceId && kept.has(item.workspaceId) ? item.workspaceId : firstId);
    payload.tabGroups = (state.tabGroups || []).filter((group) => mine(group) && !group.fromWorkspaceId).slice(0, CAPS.tabGroups).map((group) => ({ id: group.id, name: group.name, color: group.color, collapsed: group.collapsed === true, ...(group.pinned === true ? { pinned: true } : {}), workspaceId: spaceOf(group) }));
    const groupIdByName = new Map(payload.tabGroups.map((group) => [group.workspaceId + '\0' + group.name, group.id]));
    const tabRow = (tab) => ({ url: webUrl(tab.url), title: text(tab.title, 2048), ...(tab.customTitle ? { customTitle: text(tab.customTitle, 2048) } : {}), workspaceId: spaceOf(tab), groupId: !tab.pinned && tab.group ? groupIdByName.get(spaceOf(tab) + '\0' + tab.group) || null : null });
    const securedTabs = (state.tabs || []).filter((tab) => mine(tab) && tab.privacy === 'secured').length;
    payload.pinnedTabs = (state.tabs || []).filter((tab) => movableTab(tab) && tab.pinned).slice(0, CAPS.tabs).map(tabRow);
    payload.pinnedTabs.forEach((tab) => noteHost(tab.url));
    // A pinned tab never sits in a group (tabGroups.ts clears it), so the tabs of a group are unpinned ones; they travel with their group (the Arc folders' counterpart), the loose open tabs only with their own row.
    payload.groupTabs = (state.tabs || []).filter((tab) => movableTab(tab) && !tab.pinned && tab.group && groupIdByName.has(spaceOf(tab) + '\0' + tab.group)).slice(0, CAPS.tabs).map(tabRow);
    payload.groupTabs.forEach((tab) => noteHost(tab.url));
    if (uiProfile.sidebarApps?.apps) {
      payload.favorites = uiProfile.sidebarApps.apps.slice(0, CAPS.favorites).flatMap((app) => { const url = webUrl(app.url); return url ? [{ url, title: text(app.title, 80), ...(iconData(app.icon, 96 * 1024) ? { icon: app.icon } : {}) }] : []; });
      payload.favorites.forEach((favorite) => noteHost(favorite.url));
    }
    counts.spaces = payload.spaces.length; counts.pinned = payload.pinnedTabs.length; counts.groupTabs = payload.groupTabs.length; counts.favorites = payload.favorites?.length || 0; counts.lockedSpaces = secured; counts.lockedTabs = securedTabs;
    if (secured) payload.notMoved = { lockedSpaces: secured, lockedTabs: securedTabs }; // said on the preview ("1 locked Space not moved"), never the Spaces themselves
    if (stores.livePrs) { const folder = stores.livePrs.folder(profile.id); if (folder) payload.livePrs = { name: text(folder.name, 80, 'Pull requests'), filters: structuredClone(folder.filters || {}) }; }
  }
  if (include.openTabs) {
    payload.openTabs = (state.tabs || []).filter((tab) => movableTab(tab) && !tab.pinned && !(tab.group && include.spaces)).slice(0, CAPS.tabs).map((tab) => ({ url: webUrl(tab.url), title: text(tab.title, 2048), workspaceId: tab.workspaceId || null, groupId: null }));
    counts.openTabs = payload.openTabs.length;
  }

  // ---- bookmarks and history
  if (include.bookmarks) {
    payload.bookmarks = (state.bookmarkNodes || []).filter(mine).slice(0, CAPS.bookmarks).map(({ id, parentId, title, url, position, createdAt }) => ({ id, parentId: parentId ?? null, title, ...(url ? { url } : {}), position, createdAt }));
    counts.bookmarks = payload.bookmarks.filter((node) => node.url).length;
    for (const node of payload.bookmarks) if (node.url) noteHost(node.url);
  }
  if (include.history) {
    const cutoff = request.historyDays > 0 ? now - request.historyDays * 86400000 : -Infinity;
    payload.history = (state.browsingHistory || []).filter((visit) => mine(visit) && timeOf(visit.time) >= cutoff).slice(0, CAPS.history).map(({ url, title, time }) => ({ url, title, time }));
    counts.history = payload.history.length;
    const seen = new Set();
    for (const visit of payload.history) { if (seen.size >= 500) break; try { const host = new URL(visit.url).hostname; if (!seen.has(host)) { seen.add(host); noteHost(visit.url); } } catch { /* skip */ } }
  }
  if (include.reading && Array.isArray(ui.readingList)) { payload.readingList = ui.readingList.slice(0, CAPS.readingList); counts.reading = payload.readingList.length; }
  if (include.spaces || include.bookmarks || include.history) {
    if (stores.favicons && hosts.size) {
      const icons = {}; let total = 0;
      for (const host of hosts) {
        const data = stores.favicons.get(profile.id, host);
        if (!iconData(data, CAPS.faviconEach)) continue;
        if (total + data.length > CAPS.faviconsBytes) break;
        icons[host] = data; total += data.length;
      }
      if (Object.keys(icons).length) payload.favicons = icons;
    }
  }
  if (include.reading && stores.routines) { try { const routines = stores.routines.export(profile.id); if (routines.length) { payload.routines = routines; counts.routines = routines.length; } } catch { /* none */ } }

  // ---- site settings (Privacy and site settings)
  if (include.privacy) {
    const permissions = (deps.database?.permissions(profile.id) || []).filter((row) => inventory.permissionMoves(row.permission, row.decision)).slice(0, CAPS.permissions);
    const policy = deps.database?.policy(profile.id, '*') || {};
    const sitePolicies = (deps.database?.policies(profile.id) || []).filter((row) => row.site !== '*').slice(0, CAPS.sitePolicies).map(({ site, ...rest }) => ({ site, payload: pick(rest, inventory.SITE_POLICY_KEYS) })).filter((row) => Object.keys(row.payload).length);
    const zap = zapRowsOf(deps.database, profile.id);
    payload.sites = { permissions, zoom: { ...(state.originZooms?.[profile.id] || {}) }, profilePolicy: pick(policy, inventory.MOVED_POLICY_KEYS), sitePolicies, ...(zap.length ? { zap } : {}) };
    counts.sites = permissions.length + sitePolicies.length + zap.length + Object.keys(payload.sites.zoom).length;
  }

  // ---- extensions, web apps, pictures, passwords
  if (include.extensions) {
    if (stores.extensions) payload.extensions = stores.extensions.list(profile.id).filter((item) => /^[a-p]{32}$/.test(item.id)).slice(0, CAPS.extensions).map((item) => ({ id: item.id, name: text(item.name, 120), enabled: item.enabled !== false, pinned: item.pinned === true }));
    if (stores.webApps) payload.webApps = stores.webApps.list(profile.id).flatMap((app) => { const startUrl = webUrl(app.startUrl); return startUrl ? [{ name: text(app.name, 120), startUrl }] : []; }).slice(0, CAPS.webApps);
    counts.extensions = payload.extensions?.length || 0; counts.webApps = payload.webApps?.length || 0;
  }
  if (include.pictures && stores.artwork) {
    const pictures = await stores.artwork.export(profile.id);
    let total = 0; payload.pictures = [];
    for (const picture of pictures.slice(0, CAPS.pictures)) { total += picture.data.length; if (total > CAPS.picturesBytes * 4 / 3) break; payload.pictures.push(picture); }
    counts.pictures = payload.pictures.length;
  }
  // the profile's key pair, Insider pass, welcome flag and recognition state (identity.cjs): with the Settings row, only to a destination that is locked (a code, or a file with a password; request.identity)
  if (include.settings && (request.identity === 'code' || request.identity === 'locked-file') && stores.identity) {
    try { const identity = await stores.identity.export(profile.id, request.identity); if (identity) { payload.identity = identity; counts.identity = 1; } } catch { /* a profile with no identity module or key has nothing to copy */ }
  }
  if (include.passwords && request.passwords === true && stores.vault) {
    payload.passwords = (await stores.vault.all(profile.id)).slice(0, CAPS.passwords).map((row) => ({ origin: row.origin, username: row.username, password: row.password, ...(row.note ? { note: row.note } : {}) }));
    counts.passwords = payload.passwords.length;
  }
  return { payload, counts };
}
/** The parts the person removed from sites (Zap, `zap:<host>` rows = {rules}), as [{host, rules}] with the caps; a database that cannot be read gives none. */
function zapRowsOf(database, profileId) {
  const out = [];
  let total = 0, rows = [];
  try { rows = database?.policies(profileId) || []; } catch { rows = []; }
  for (const row of rows) {
    if (!row || typeof row.site !== 'string' || !row.site.startsWith(inventory.ZAP_PREFIX) || !Array.isArray(row.rules)) continue;
    const rules = row.rules.filter((rule) => size(rule) <= CAPS.zapRuleBytes).slice(0, zapLib.LIMITS.rulesPerHost);
    if (!rules.length || out.length >= CAPS.zapHosts || total + rules.length > CAPS.zapRules) continue;
    total += rules.length;
    out.push({ host: row.site.slice(inventory.ZAP_PREFIX.length), rules: structuredClone(rules) });
  }
  return out;
}

/** A side panel site's address as the side panel itself keeps it (src/runtime/sidePanelSites.ts normalizeSiteUrl): http or https, no sign-in details, no query or fragment. */
function sidePanelUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
  url.hash = ''; url.search = '';
  return url.href;
}
const sidePanelKey = (href) => { try { const u = new URL(href); return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return href.toLowerCase(); } };
/** The pinned side panel sites of a file, made whole the way the reducer does (cleanSites): bad rows dropped, one row per address, at most six, only known fields. */
function cleanSidePanelSites(value) {
  const out = [], ids = new Set(), keys = new Set();
  for (const row of Array.isArray(value) ? value.slice(0, 12) : []) {
    if (!isObject(row)) continue;
    const url = sidePanelUrl(row.url);
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(row.id) || !url || ids.has(row.id) || keys.has(sidePanelKey(url))) continue;
    ids.add(row.id); keys.add(sidePanelKey(url));
    const title = text(row.title, 120).replace(/\s+/g, ' ').trim();
    const icon = typeof row.icon === 'string' && row.icon.length <= 24576 && /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/i.test(row.icon) ? row.icon : undefined;
    const width = typeof row.width === 'number' && Number.isFinite(row.width) ? Math.round(Math.min(560, Math.max(340, row.width))) : undefined;
    out.push({ id: row.id, url, ...(title ? { title } : {}), ...(icon ? { icon } : {}), ...(width !== undefined && width !== 400 ? { width } : {}), ...(row.docked === true ? { docked: true } : {}) });
    if (out.length >= CAPS.sidePanelSites) break;
  }
  return out;
}

function pick(source, keys) { const out = {}; for (const key of keys) if (source && source[key] !== undefined) out[key] = structuredClone(source[key]); return out; }

// ---------------------------------------------------------------- validating (receiver)

/**
 * @param raw     the parsed JSON (untrusted)
 * @param context { platform, locked:boolean (came from a password-locked file or a code), validateSettings(patch) (throws), current:{ … B's values for the safety comparison … }, searchProvidersChoice? }
 * @returns { status:'ok'|'newer'|'invalid', payload, dropped:[{section,reason}], notes:[string], counts, safety:[{id,…params}] }
 */
function validatePayload(raw, context = {}) {
  const dropped = [], notes = [];
  const drop = (section, reason) => dropped.push({ section, reason });
  const out = { dropped, notes };
  if (!isObject(raw) || raw.format !== FORMAT) return { status: 'invalid', payload: null, dropped, notes, counts: {}, safety: [] };
  if (typeof raw.minReader === 'number' && raw.minReader > VERSION) return { status: 'newer', payload: null, dropped, notes, counts: {}, safety: [] };
  if (raw.version !== VERSION) return { status: 'invalid', payload: null, dropped, notes, counts: {}, safety: [] };
  const clean = { format: FORMAT, version: VERSION, minReader: 2 };
  const attempt = (section, build) => { try { const value = build(); if (value !== undefined) clean[section] = value; } catch (error) { drop(section, String(error?.message || 'invalid')); } };
  const list = (value, cap) => (Array.isArray(value) ? value.slice(0, cap) : []);

  clean.createdAt = Number.isFinite(timeOf(raw.createdAt)) ? new Date(timeOf(raw.createdAt)).toISOString() : new Date(0).toISOString();
  clean.app = { version: text(raw.app?.version, 64), platform: ['win32', 'darwin', 'linux'].includes(raw.app?.platform) ? raw.app.platform : '' };
  clean.included = list(raw.included, 20).filter((row) => inventory.ROWS.includes(row));

  attempt('profile', () => {
    const p = isObject(raw.profile) ? raw.profile : {};
    const settings = isObject(p.settings) ? p.settings : {};
    const own = {};
    if (['light', 'dark', 'system'].includes(settings.appearance)) own.appearance = settings.appearance;
    // 13.6: a profile on "This profile" also owns its Finish and colours (always together with its Light/Dark)
    const look = isObject(settings.look) ? settings.look : null;
    if (own.appearance && look && typeof look.colorPreset === 'string' && look.colorPreset && look.colorPreset.length <= 160 && hex(look.accentColor) && hex(look.browserTint)) {
      own.look = { colorPreset: look.colorPreset, accentColor: hex(look.accentColor), browserTint: hex(look.browserTint) };
      for (const key of ['surfaceColor', 'sidebarColor', 'toolbarColor', 'tabColor']) if (hex(look[key])) own.look[key] = hex(look[key]);
    }
    if (BUILT_IN_SEARCH.has(settings.searchEngine)) own.searchEngine = settings.searchEngine;
    if (typeof settings.searchProviderId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(settings.searchProviderId)) own.searchProviderId = settings.searchProviderId;
    return { name: text(p.name, 60, 'Profile') || 'Profile', ...(hex(p.color) ? { color: hex(p.color) } : {}), ...(typeof p.avatar === 'string' ? { avatar: text(p.avatar, 16) } : {}), ...(iconData(p.picture, CAPS.profilePicture) ? { picture: p.picture } : {}), ...(typeof p.email === 'string' && p.email.length <= 254 ? { email: text(p.email, 254) } : {}), ...(Object.keys(own).length ? { settings: own } : {}), ...(cleanSidePanelSites(p.sidePanelSites).length ? { sidePanelSites: cleanSidePanelSites(p.sidePanelSites) } : {}) };
  });

  attempt('settings', () => {
    if (raw.settings === undefined) return undefined;
    if (!isObject(raw.settings)) throw new Error('not an object');
    const kept = {};
    for (const key of inventory.MOVED_SETTINGS) {
      if (raw.settings[key] === undefined) continue;
      try {
        if (context.validateSettings) context.validateSettings({ [key]: raw.settings[key] });
        kept[key] = key === 'searchProviders' && raw.settings[key] !== null && context.searchProvidersChoice ? context.searchProvidersChoice(raw.settings[key]) : structuredClone(raw.settings[key]);
      } catch { drop('settings.' + key, 'rejected by the settings check'); }
    }
    return kept;
  });

  attempt('ui', () => {
    if (!isObject(raw.ui)) return undefined;
    const result = { profile: {}, global: {} };
    for (const pref of inventory.UI_PREFS) {
      if (pref.id === 'readingList') continue;
      const value = isObject(raw.ui[pref.scope]) ? raw.ui[pref.scope][pref.id] : undefined;
      if (value === undefined) continue;
      const checked = plainJson(value, { bytes: pref.id === 'newTab' ? 262144 : 65536 });
      if (checked === undefined) { drop('ui.' + pref.id, 'too large or not plain data'); continue; }
      result[pref.scope][pref.id] = checked;
    }
    return result;
  });

  attempt('appPrefs', () => {
    if (!isObject(raw.appPrefs)) return undefined;
    const source = raw.appPrefs, result = {};
    if (isObject(source.privacy)) {
      const privacy = {};
      for (const key of ['cnameUncloaking', 'skipTrackingRedirects', 'stripTrackingParams', 'deAmp', 'phishingLists', 'pageWarnings', 'passkeys']) if (typeof source.privacy[key] === 'boolean') privacy[key] = source.privacy[key];
      if (['off', 'standard', 'strict'].includes(source.privacy.fingerprint)) privacy.fingerprint = source.privacy.fingerprint;
      result.privacy = privacy;
    }
    if (isObject(source.network)) {
      const network = {};
      if (typeof source.network.gpc === 'boolean') network.gpc = source.network.gpc;
      if (['block', 'allow'].includes(source.network.cookies)) network.cookies = source.network.cookies;
      if (isObject(source.network.dns)) {
        const dns = source.network.dns;
        if (['system', 'off', 'secure'].includes(dns.mode) && Array.isArray(dns.servers) && dns.servers.length <= 4 && dns.servers.every(dnsServer)) network.dns = { mode: dns.mode, servers: [...dns.servers] };
      }
      result.network = network;
    }
    if (typeof source.filtersAutomatic === 'boolean') result.filtersAutomatic = source.filtersAutomatic;
    if (typeof source.downloadsAskWhere === 'boolean') result.downloadsAskWhere = source.downloadsAskWhere;
    if (isObject(source.downloadsOffer) && typeof source.downloadsOffer.files === 'boolean' && typeof source.downloadsOffer.private === 'boolean') result.downloadsOffer = { files: source.downloadsOffer.files, private: source.downloadsOffer.private };
    if (typeof source.passwordsEnabled === 'boolean') result.passwordsEnabled = source.passwordsEnabled;
    if (isObject(source.rewind) && typeof source.rewind.enabled === 'boolean') result.rewind = { enabled: source.rewind.enabled, ...(Number.isInteger(source.rewind.days) ? { days: REWIND_DAYS.reduce((best, day) => (Math.abs(day - source.rewind.days) < Math.abs(best - source.rewind.days) ? day : best), REWIND_DAYS[0]) } : {}) };
    if (isObject(source.tor) && ['standard', 'safer', 'safest'].includes(source.tor.level)) result.tor = { level: source.tor.level, ...(typeof source.tor.downloadWarning === 'boolean' ? { downloadWarning: source.tor.downloadWarning } : {}), ...(typeof source.tor.preferOnion === 'boolean' ? { preferOnion: source.tor.preferOnion } : {}) };
    return result;
  });

  attempt('shortcuts', () => {
    if (!isObject(raw.shortcuts) || !isObject(raw.shortcuts.bindings)) return undefined;
    const bindings = {};
    for (const [id, accelerators] of Object.entries(raw.shortcuts.bindings).slice(0, CAPS.shortcuts)) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !Array.isArray(accelerators) || accelerators.length > 4) continue;
      const list2 = accelerators.filter((accelerator) => typeof accelerator === 'string' && accelerator.length <= 64);
      bindings[id] = list2;
    }
    return { version: 1, app: 'acira-browser', bindings };
  });

  // ---- profile data
  attempt('spaces', () => {
    if (raw.spaces === undefined) return undefined;
    const ids = new Set();
    return list(raw.spaces, 64).flatMap((space) => {
      if (!isObject(space) || typeof space.id !== 'string' || ids.has(space.id)) return [];
      ids.add(space.id);
      return [{ id: text(space.id, 120), name: text(space.name, 40), ...(typeof space.icon === 'string' && space.icon.length <= 16 ? { icon: space.icon } : {}), ...(hex(space.color) ? { color: hex(space.color) } : {}) }];
    });
  });
  const spaceIds = new Set((clean.spaces || []).map((space) => space.id));
  attempt('tabGroups', () => {
    if (raw.tabGroups === undefined) return undefined;
    const ids = new Set();
    return list(raw.tabGroups, CAPS.tabGroups).flatMap((group) => {
      if (!isObject(group) || typeof group.id !== 'string' || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim()) return [];
      ids.add(group.id);
      return [{ id: text(group.id, 120), name: text(group.name, 64), color: ['none', 'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].includes(group.color) ? group.color : 'grey', collapsed: group.collapsed === true, ...(group.pinned === true ? { pinned: true } : {}), workspaceId: spaceIds.has(group.workspaceId) ? group.workspaceId : null }];
    });
  });
  const groupIds = new Set((clean.tabGroups || []).map((group) => group.id));
  const tabs = (section) => attempt(section, () => {
    if (raw[section] === undefined) return undefined;
    return list(raw[section], CAPS.tabs).flatMap((tab) => {
      const url = isObject(tab) ? webUrl(tab.url) : null;
      if (!url) return [];
      return [{ url, title: text(tab.title, 2048), ...(typeof tab.customTitle === 'string' && tab.customTitle ? { customTitle: text(tab.customTitle, 2048) } : {}), workspaceId: spaceIds.has(tab.workspaceId) ? tab.workspaceId : null, groupId: groupIds.has(tab.groupId) ? tab.groupId : null }];
    });
  });
  tabs('pinnedTabs'); tabs('groupTabs'); tabs('openTabs');
  attempt('favorites', () => {
    if (raw.favorites === undefined) return undefined;
    const seen = new Set();
    return list(raw.favorites, CAPS.favorites).flatMap((favorite) => {
      const url = isObject(favorite) ? webUrl(favorite.url) : null;
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ url, title: text(favorite.title, 80), ...(iconData(favorite.icon, 96 * 1024) ? { icon: favorite.icon } : {}) }];
    });
  });
  attempt('notMoved', () => (isObject(raw.notMoved) ? { lockedSpaces: Math.max(0, Math.min(99, Math.trunc(Number(raw.notMoved.lockedSpaces)) || 0)), lockedTabs: Math.max(0, Math.min(9999, Math.trunc(Number(raw.notMoved.lockedTabs)) || 0)) } : undefined));
  attempt('livePrs', () => {
    if (!isObject(raw.livePrs)) return undefined;
    const filters = {};
    if (isObject(raw.livePrs.filters)) {
      for (const key of ['author', 'review', 'assigned', 'mentioned', 'drafts', 'recent']) if (typeof raw.livePrs.filters[key] === 'boolean') filters[key] = raw.livePrs.filters[key];
      if (Array.isArray(raw.livePrs.filters.repos)) filters.repos = raw.livePrs.filters.repos.filter((repo) => typeof repo === 'string' && /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(repo)).slice(0, 50);
      else if (raw.livePrs.filters.repos === null) filters.repos = null;
    }
    return { name: text(raw.livePrs.name, 80, 'Pull requests') || 'Pull requests', filters };
  });
  attempt('bookmarks', () => {
    if (raw.bookmarks === undefined) return undefined;
    const ids = new Set();
    const rows = list(raw.bookmarks, CAPS.bookmarks).flatMap((node) => {
      if (!isObject(node) || typeof node.id !== 'string' || ids.has(node.id) || typeof node.title !== 'string') return [];
      const url = node.url === undefined ? undefined : webUrl(node.url);
      if (node.url !== undefined && !url) return [];
      ids.add(node.id);
      return [{ id: text(node.id, 120), parentId: typeof node.parentId === 'string' ? text(node.parentId, 120) : null, title: text(node.title, 2048), ...(url ? { url } : {}), position: Number.isFinite(node.position) ? node.position : 0, createdAt: Number.isFinite(node.createdAt) ? node.createdAt : 0 }];
    });
    return rows;
  });
  attempt('history', () => {
    if (raw.history === undefined) return undefined;
    return list(raw.history, CAPS.history).flatMap((visit) => {
      const url = isObject(visit) ? webUrl(visit.url) : null;
      const at = isObject(visit) ? timeOf(visit.time) : NaN;
      return url && Number.isFinite(at) ? [{ url, title: text(visit.title, 2048), time: new Date(Math.min(Date.now(), Math.max(0, at))).toISOString() }] : [];
    });
  });
  attempt('favicons', () => {
    if (!isObject(raw.favicons)) return undefined;
    const icons = {}; let total = 0;
    for (const [host, data] of Object.entries(raw.favicons)) {
      if (!/^[a-z0-9.-]{1,253}$/i.test(host) || !iconData(data, CAPS.faviconEach)) continue;
      total += data.length; if (total > CAPS.faviconsBytes) break;
      icons[host.toLowerCase()] = data;
    }
    return icons;
  });
  attempt('readingList', () => {
    if (!Array.isArray(raw.readingList)) return undefined;
    return list(raw.readingList, CAPS.readingList).flatMap((item) => { const url = isObject(item) ? webUrl(item.url) : null; return url ? [{ ...plainJson(item, { bytes: 8192 }), url }] : []; });
  });
  attempt('routines', () => (Array.isArray(raw.routines) ? raw.routines.slice(0, 200).filter((item) => size(item) <= 65536) : undefined));
  attempt('sites', () => {
    if (!isObject(raw.sites)) return undefined;
    const sites = { permissions: [], zoom: {}, profilePolicy: {}, sitePolicies: [] };
    for (const row of list(raw.sites.permissions, CAPS.permissions)) {
      if (!isObject(row) || typeof row.requester !== 'string' || typeof row.embedder !== 'string' || typeof row.permission !== 'string' || !['allow', 'deny', 'block'].includes(row.decision)) continue;
      if (!inventory.permissionMoves(row.permission, row.decision)) continue; // a powerful "allow" never imports, whatever the file says
      sites.permissions.push({ requester: text(row.requester, 300), embedder: text(row.embedder, 300), permission: text(row.permission, 80), decision: row.decision });
    }
    if (isObject(raw.sites.zoom)) for (const [origin, zoom] of Object.entries(raw.sites.zoom).slice(0, CAPS.zoomOrigins)) if (typeof zoom === 'number' && Number.isFinite(zoom) && /^[\w.:\/-]{1,300}$/.test(origin)) sites.zoom[origin] = finite(zoom, 25, 500, 100);
    if (isObject(raw.sites.profilePolicy)) {
      const policy = raw.sites.profilePolicy;
      for (const key of ['blocking', 'httpsOnly', 'aiContent', 'annoyances', 'rejectCookies', 'popupAds']) if (typeof policy[key] === 'boolean') sites.profilePolicy[key] = policy[key];
      if (Array.isArray(policy.sourceDomains)) sites.profilePolicy.sourceDomains = policy.sourceDomains.filter((domain) => typeof domain === 'string' && /^[a-z0-9.-]{1,253}$/i.test(domain)).slice(0, 100);
      if (Array.isArray(policy.websiteLanguages) && policy.websiteLanguages.length <= 8 && policy.websiteLanguages.every((language) => typeof language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(language))) sites.profilePolicy.websiteLanguages = [...policy.websiteLanguages];
      if (policy.searchProviders !== undefined) {
        try { sites.profilePolicy.searchProviders = (context.searchProvidersChoice || ((value) => value))(policy.searchProviders); } catch { drop('sites.searchProviders', 'not valid'); }
      }
    }
    let darkCount = 0;
    for (const row of list(raw.sites.sitePolicies, CAPS.sitePolicies)) {
      if (!isObject(row) || typeof row.site !== 'string' || row.site.length > 300 || row.site === '*' || !isObject(row.payload)) continue;
      // Always dark's "leave this site alone" rows: a site name and exactly {dark:'exclude'}
      if (row.site.startsWith(inventory.DARK_PREFIX)) {
        if (/^dark:[a-z0-9.-]{1,253}$/i.test(row.site) && row.payload.dark === 'exclude' && darkCount < CAPS.darkSites) { sites.sitePolicies.push({ site: row.site.toLowerCase(), payload: { dark: 'exclude' } }); darkCount++; }
        continue;
      }
      const payload = {};
      if (['allow', 'block'].includes(row.payload.scripts)) payload.scripts = row.payload.scripts;
      if (row.payload.scripts === undefined && typeof row.payload.httpFallback === 'boolean') payload.httpFallback = row.payload.httpFallback;
      for (const key of ['blocking', 'aiContent', 'annoyances', 'rejectCookies', 'popupAds']) if (typeof row.payload[key] === 'boolean') payload[key] = row.payload[key];
      if (row.site === inventory.SCRIPTS_MODE_SITE && !['default', 'everywhere'].includes(row.payload.mode)) continue;
      if (row.site === inventory.SCRIPTS_MODE_SITE) payload.mode = row.payload.mode;
      if (Object.keys(payload).length) sites.sitePolicies.push({ site: text(row.site, 300), payload });
    }
    // The parts the person removed from sites (Zap): every rule goes through Zap's own cleaner, so a file cannot carry a selector Zap itself would refuse
    let zapTotal = 0;
    for (const row of list(raw.sites.zap, CAPS.zapHosts)) {
      if (!isObject(row) || typeof row.host !== 'string' || !/^(?:[a-z0-9]|[a-z0-9][a-z0-9.-]{0,251}[a-z0-9])$/.test(row.host)) continue;
      const rules = [];
      for (const input of list(row.rules, zapLib.LIMITS.rulesPerHost)) {
        if (!isObject(input) || size(input) > CAPS.zapRuleBytes || zapTotal + rules.length >= CAPS.zapRules) continue;
        try { rules.push(zapLib.cleanRule(input, { now: finite(input.at, 0, 4102444800000, Date.now()), id: typeof input.id === 'string' && /^[a-z0-9]{6,24}$/.test(input.id) ? input.id : undefined })); } catch { /* a rule Zap would not take is left out */ }
      }
      if (rules.length) { zapTotal += rules.length; (sites.zap ||= []).push({ host: row.host, rules }); }
    }
    return sites;
  });
  attempt('extensions', () => (Array.isArray(raw.extensions) ? list(raw.extensions, CAPS.extensions).flatMap((item) => (isObject(item) && /^[a-p]{32}$/.test(item.id) ? [{ id: item.id, name: text(item.name, 120), enabled: item.enabled !== false, pinned: item.pinned === true }] : [])) : undefined));
  attempt('webApps', () => (Array.isArray(raw.webApps) ? list(raw.webApps, CAPS.webApps).flatMap((item) => { const startUrl = isObject(item) ? webUrl(item.startUrl) : null; return startUrl ? [{ name: text(item.name, 120), startUrl }] : []; }) : undefined));
  attempt('pictures', () => {
    if (!Array.isArray(raw.pictures)) return undefined;
    const result = []; let total = 0;
    for (const picture of list(raw.pictures, CAPS.pictures)) {
      if (!isObject(picture) || !['image/png', 'image/jpeg'].includes(picture.type) || typeof picture.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(picture.data)) continue;
      const bytes = Buffer.from(picture.data, 'base64');
      const magic = picture.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : bytes[0] === 0xff && bytes[1] === 0xd8;
      total += bytes.length; if (!magic || total > CAPS.picturesBytes) continue;
      result.push({ name: text(picture.name, 120), ...(typeof picture.id === 'string' ? { id: text(picture.id, 80) } : {}), type: picture.type, data: picture.data });
    }
    return result;
  });
  if (raw.passwords !== undefined) {
    if (context.locked !== true) notes.push('passwords-ignored');
    else attempt('passwords', () => (Array.isArray(raw.passwords) ? list(raw.passwords, CAPS.passwords).flatMap((row) => (isObject(row) && typeof row.password === 'string' && row.password.length <= 4096 && webUrl(row.origin) ? [{ origin: new URL(row.origin).origin, username: text(row.username, 512), password: row.password, ...(typeof row.note === 'string' && row.note ? { note: text(row.note, 4096) } : {}) }] : [])) : undefined));
  }

  // the identity (identity.cjs): never from a destination that is not locked, whatever a file says; a key that is not an Ed25519 key is no identity
  if (raw.identity !== undefined) {
    if (context.locked !== true) notes.push('identity-ignored');
    else attempt('identity', () => identityLib.cleanIdentity(raw.identity) ?? undefined);
  }

  Object.assign(out, { status: 'ok', payload: clean });
  try { out.counts = countsOf(clean); } catch { out.counts = {}; }
  try { out.safety = safetyLines(clean, context.current || {}); } catch { out.safety = []; drop('safety', 'could not be compared'); }
  return out;
}

function countsOf(payload) {
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return {
    spaces: count(payload.spaces), pinned: count(payload.pinnedTabs), groupTabs: count(payload.groupTabs), favorites: count(payload.favorites), openTabs: count(payload.openTabs), bookmarks: count(payload.bookmarks?.filter((node) => node.url)),
    history: count(payload.history), reading: count(payload.readingList), routines: count(payload.routines), extensions: count(payload.extensions), webApps: count(payload.webApps), pictures: count(payload.pictures), passwords: count(payload.passwords),
    shortcuts: Object.keys(payload.shortcuts?.bindings || {}).length,
    sites: count(payload.sites?.permissions) + count(payload.sites?.sitePolicies) + count(payload.sites?.zap) + Object.keys(payload.sites?.zoom || {}).length
  };
}

// ---------------------------------------------------------------- the changes that need a tick (10.1)

const PROTECTIONS = ['cnameUncloaking', 'skipTrackingRedirects', 'stripTrackingParams', 'deAmp'];
const FINGERPRINT_ORDER = ['off', 'standard', 'strict'];
const TOR_ORDER = ['standard', 'safer', 'safest'];
const COOKIE_ORDER = ['block', 'allow'];

/**
 * Every incoming value that would lower protection or redirect traffic, compared with this computer's current value.
 * `current`: { privacy, network, policy (the '*' row), scriptsMode, scriptAllowed:[sites], torLevel, passwordsEnabled, livePrsFolder:boolean, searchProviders (the current choice, or null), searchEngineIds:[built-in ids] }
 * Each line: { id, ... } — the renderer words it; the apply request names the ticked ids.
 */
function safetyLines(payload, current) {
  const lines = [];
  const add = (line) => lines.push(line);
  const privacy = payload.appPrefs?.privacy;
  if (privacy) {
    const now = current.privacy || {};
    if ((privacy.phishingLists === false && now.phishingLists !== false) || (privacy.pageWarnings === false && now.pageWarnings !== false)) add({ id: 'phishing' });
    for (const name of PROTECTIONS) if (privacy[name] === false && now[name] !== false) add({ id: 'protection:' + name, name });
    if (privacy.fingerprint && FINGERPRINT_ORDER.indexOf(privacy.fingerprint) < FINGERPRINT_ORDER.indexOf(now.fingerprint || 'standard')) add({ id: 'protection:fingerprint', name: 'fingerprint' });
  }
  const network = payload.appPrefs?.network;
  if (network) {
    const now = current.network || {};
    if (network.dns) {
      const nowDns = now.dns || { mode: 'system', servers: [] };
      if (network.dns.mode === 'secure' && network.dns.servers.length && JSON.stringify(network.dns.servers) !== JSON.stringify(nowDns.servers)) add({ id: 'dns', mode: 'custom', host: hostOf(network.dns.servers[0]) });
      else if (network.dns.mode === 'off' && nowDns.mode !== 'off') add({ id: 'dns', mode: 'off' });
    }
    if (network.cookies && COOKIE_ORDER.indexOf(network.cookies) > COOKIE_ORDER.indexOf(now.cookies || 'block')) add({ id: 'cookies' });
    if (network.gpc === false && now.gpc === true) add({ id: 'gpc' });
  }
  const policy = payload.sites?.profilePolicy;
  if (policy) {
    const now = current.policy || {};
    if (policy.blocking === false && now.blocking !== false) add({ id: 'blocking' });
    if (policy.httpsOnly === false && now.httpsOnly === true) add({ id: 'httpsOnly' });
  }
  const scriptRows = (payload.sites?.sitePolicies || []).filter((row) => row.site.startsWith('scripts:'));
  const incomingMode = scriptRows.find((row) => row.site === inventory.SCRIPTS_MODE_SITE)?.payload.mode;
  const nowMode = current.scriptsMode || 'default';
  const looser = incomingMode === 'default' && nowMode === 'everywhere';
  const newAllows = scriptRows.filter((row) => row.site !== inventory.SCRIPTS_MODE_SITE && row.payload.scripts === 'allow' && !(current.scriptAllowed || []).includes(row.site.slice('scripts:'.length)));
  if (looser || (newAllows.length && (incomingMode || nowMode) === 'everywhere')) add({ id: 'scripts' });
  const providers = [payload.settings?.searchProviders, payload.sites?.profilePolicy?.searchProviders].filter(Boolean);
  const seen = new Set();
  for (const choice of providers) for (const engine of Array.isArray(choice.engines) ? choice.engines : []) {
    if (BUILT_IN_SEARCH.has(engine.id) || (current.searchEngineIds || []).includes(engine.id) || seen.has(engine.id)) continue;
    seen.add(engine.id); add({ id: 'search:' + engine.id, name: engine.name, host: hostOf(engine.template) });
  }
  // Beta 14/X: what you type, or a picture, leaving for a place the person (or a file) chose. Turning suggestions ON, a suggestion address of their own and an image search address of their own are each a line, unticked until ticked
  const mine = payload.settings || {}, now = current.settings || {};
  if (mine.engineSuggestions === true && now.engineSuggestions !== true) add({ id: 'suggest' });
  if (typeof mine.engineSuggestionsAddress === 'string' && mine.engineSuggestionsAddress && mine.engineSuggestionsAddress !== now.engineSuggestionsAddress) add({ id: 'suggest:custom', host: hostOf(mine.engineSuggestionsAddress) });
  if (typeof mine.imageSearchCustom === 'string' && mine.imageSearchCustom && mine.imageSearchCustom !== now.imageSearchCustom) add({ id: 'imageSearch:custom', host: hostOf(mine.imageSearchCustom) });
  const tor = payload.appPrefs?.tor;
  if (tor && TOR_ORDER.indexOf(tor.level) < TOR_ORDER.indexOf(current.torLevel || 'standard')) add({ id: 'tor' });
  if (payload.appPrefs?.passwordsEnabled === false && current.passwordsEnabled !== false) add({ id: 'passwords' });
  if (payload.livePrs && !current.livePrsFolder) add({ id: 'livePrs' });
  return lines;
}
function hostOf(address) { try { return new URL(String(address).replace('{?dns}', '').replace('%s', 'x')).host; } catch { return ''; } }

module.exports = { FORMAT, VERSION, MAX_INFLATED, buildPayload, validatePayload, safetyLines, countsOf, pack, unpack, webUrl, sidePanelKey };
