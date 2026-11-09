'use strict';
// Sec-CH-Prefers-Color-Scheme, sent the way Chrome sends it and only to a site that asks for it. Google and Bing choose their light or dark page on the
// server from this hint (they list it in Accept-CH). Electron never sends a hint a site asks for, so they guessed from the last visit: the first search after
// Acira or the Mac changed appearance came out in the old colours, and Bing stayed light. The hint tells a site nothing new: every page already reads the same
// setting through the CSS media query prefers-color-scheme, with or without script, at every fingerprint level (farbling leaves it alone). This is the only
// hint added; the Sec-CH-UA trio comes from chrome-identity.cjs / tor-identity.cjs, and every other hint a site lists (UA details, network, device) stays unsent.
//  - A site asks with Accept-CH on a top-level page from a secure origin; a later Accept-CH that leaves the hint out withdraws it (Chrome's rule).
//  - The hint then goes on that origin's top-level pages, and on its own requests and frames while it is the page in the tab; never to another origin.
//  - Critical-CH: a first page loaded without the hint by an origin that has just asked for it is loaded once more with it (GET only), as Chrome restarts it.
//  - Ordinary profiles remember which origins asked (a small file in the profile's own folder), so the first page after a restart is right too. Private and
//    Tor sessions keep the list in memory only. Clearing a session's cookies clears the list for the same sites, as Chrome ties it to cookies (guard below).
// The value is what every page's prefers-color-scheme follows: nativeTheme (Acira's appearance, or the system's when it follows the system), or what the tab is told
// when Website appearance (site-appearance.cjs) says Light or Dark for it (dark(details) answers per request). It is a bare token, dark
// or light, as Chrome sends it: Google draws its light page for a quoted "dark" (checked live, 4 Nov 2026).
const fs = require('node:fs'), path = require('node:path');
const HINT = 'Sec-CH-Prefers-Color-Scheme', NAME = HINT.toLowerCase(), FILE = 'Color Scheme Hint.json', LIMIT = 500;
let getDomain = null; try { ({ getDomain } = require('tldts')); } catch { /* Same host only. */ }

function secureOrigin(url) {
  try { const parsed = new URL(String(url)); if (parsed.protocol === 'https:' || parsed.protocol === 'http:' && /^(?:127\.0\.0\.1|localhost|\[::1\])$/.test(parsed.hostname)) return parsed.origin; } catch { }
  return null;
}
/** Every value of one header, whatever its capitalisation; request headers hold strings, response headers arrays. */
function valuesOf(headers, name) {
  const out = []; for (const key of Object.keys(headers || {})) if (key.toLowerCase() === name) { const value = headers[key]; for (const item of Array.isArray(value) ? value : [value]) out.push(String(item)); }
  return out;
}
const tokens = values => values.flatMap(value => value.split(',')).map(token => token.trim().toLowerCase()).filter(Boolean);
const siteOf = origin => { try { const host = new URL(origin).hostname; return (getDomain && getDomain(host)) || host; } catch { return String(origin); } };

const states = new WeakMap();
function load(state) {
  if (state.origins) return state.origins;
  state.origins = new Set();
  if (state.file) try { const saved = JSON.parse(fs.readFileSync(state.file, 'utf8')); for (const origin of Array.isArray(saved?.origins) ? saved.origins.slice(-LIMIT) : []) if (secureOrigin(origin) === origin) state.origins.add(origin); } catch { /* None yet, or unreadable: sites ask again. */ }
  return state.origins;
}
function write(state) {
  clearTimeout(state.timer); state.timer = null;
  if (!state.file) return;
  try {
    if (!state.origins.size) { fs.rmSync(state.file, { force: true }); return; }
    const temporary = state.file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ version: 1, origins: [...state.origins] })); fs.renameSync(temporary, state.file);
  } catch { /* A profile folder being removed: nothing to keep. */ }
}
function remember(state, origin) {
  const set = load(state); if (set.has(origin)) return;
  set.add(origin); if (set.size > LIMIT) set.delete(set.values().next().value);
  if (state.file && !state.timer) { state.timer = setTimeout(() => write(state), 500); state.timer.unref?.(); }
}
/** scope: {all} | {origins} | {except}; matched by site, so clearing a site's cookies forgets every origin of it. Written at once (a quit may follow). */
function forget(state, scope) {
  const set = load(state); if (!set.size) return;
  const sites = new Set((scope.origins || scope.except || []).map(siteOf));
  for (const origin of [...set]) { const match = sites.has(siteOf(origin)); if (scope.all || (scope.origins && match) || (scope.except && !match)) set.delete(origin); }
  write(state);
}
/** Which remembered origins a session clearing call takes with it: only calls that clear cookies. */
function clearedBy(name, options) {
  const list = value => Array.isArray(value) ? value.map(item => secureOrigin(item) || String(item)) : null;
  if (name === 'clearStorageData') {
    if (options && Array.isArray(options.storages) && !options.storages.some(item => String(item).toLowerCase() === 'cookies')) return null;
    return options && typeof options.origin === 'string' && options.origin ? { origins: list([options.origin]) } : { all: true };
  }
  if (options && Array.isArray(options.dataTypes) && !options.dataTypes.includes('cookies')) return null;
  if (options && Array.isArray(options.origins)) return { origins: list(options.origins) };
  if (options && Array.isArray(options.excludeOrigins)) return { except: list(options.excludeOrigins) };
  return { all: true };
}

/** Request-header participant. */
function sendHeaders(state, details) {
  const set = load(state); if (!set.size) return {};
  const origin = secureOrigin(details.url); if (!origin || !set.has(origin)) return {};
  const headers = details.requestHeaders || {}; if (valuesOf(headers, NAME).length) return {};
  if (details.resourceType !== 'mainFrame') {
    let page = null; try { page = details.webContents?.getURL?.(); } catch { }
    if (secureOrigin(page) !== origin) return {};
    const site = valuesOf(headers, 'sec-fetch-site')[0]; if (site && site.toLowerCase() !== 'same-origin') return {};
  }
  return { requestHeaders: { ...headers, [HINT]: state.dark(details) ? 'dark' : 'light' } };
}
/** Response-header participant: reads Accept-CH / Critical-CH on top-level pages; returns the one-time restart when Critical-CH needs it. */
function headersReceived(state, details) {
  if (details.resourceType !== 'mainFrame') return {};
  const origin = secureOrigin(details.url); if (!origin) return {};
  const headers = details.responseHeaders || {}, accept = valuesOf(headers, 'accept-ch'); if (!accept.length) return {};
  const had = load(state).has(origin), asks = tokens(accept).includes(NAME);
  if (!asks) { if (had) { state.origins.delete(origin); write(state); } return {}; }
  remember(state, origin);
  if (had || !tokens(valuesOf(headers, 'critical-ch')).includes(NAME) || String(details.method || 'GET').toUpperCase() !== 'GET' || details.statusCode >= 300 && details.statusCode < 400) return {};
  const next = {}; for (const key of Object.keys(headers)) if (key.toLowerCase() !== 'location') next[key] = headers[key];
  next.Location = [details.url];
  return { statusLine: 'HTTP/1.1 307 Temporary Redirect', responseHeaders: next };
}

/** One per session, after the session's other request participants. remember: keep the list in the profile's folder (ordinary profiles only). */
function attach(session, pipeline, { remember: keep = false, dark = () => require('electron').nativeTheme.shouldUseDarkColors } = {}) {
  if (states.has(session)) return states.get(session);
  let folder = null; try { folder = keep && typeof session.getStoragePath === 'function' ? session.getStoragePath() : null; } catch { }
  const state = { origins: null, file: folder ? path.join(folder, FILE) : null, timer: null, dark };
  states.set(session, state);
  pipeline.useSendHeaders(details => sendHeaders(state, details));
  pipeline.useHeaders(details => headersReceived(state, details));
  guard(session);
  return state;
}
/** The cookie tie. Every way Acira clears cookies goes through these two session calls (Clear browsing data, a site's data, clear on quit, a private or Tor
 * window closing). content-blocking.cjs puts this on every session the first time it sees it, before configureSession attaches the hint, because the
 * startup cleanup (clear on quit after a crash or a force quit) clears cookies before that: the saved list is then cleaned on disk, so the first page after
 * such a start does not tell a site it was visited before. */
const guarded = new WeakSet();
function guard(session) {
  if (!session || guarded.has(session)) return;
  guarded.add(session);
  for (const name of ['clearStorageData', 'clearData']) {
    const original = session[name]; if (typeof original !== 'function') continue;
    session[name] = function (...args) { try { const scope = clearedBy(name, args[0]); if (scope) forget(states.get(session) || saved(session), scope); } catch { } return original.apply(this, args); };
  }
}
/** The list on disk of a session the hint is not attached to yet (only an ordinary profile ever has one). */
function saved(session) {
  let folder = null; try { folder = typeof session.getStoragePath === 'function' ? session.getStoragePath() : null; } catch { }
  return { origins: null, file: folder ? path.join(folder, FILE) : null, timer: null };
}
module.exports = { attach, guard, sendHeaders, headersReceived, clearedBy, secureOrigin, HINT, FILE };
