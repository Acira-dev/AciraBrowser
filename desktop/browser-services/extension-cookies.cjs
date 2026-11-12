'use strict';
// Cookies on an extension's own credentialed requests (13.7, Raindrop: "Please log in to start!" while signed in on the site).
//
// Acira blocks third-party cookies for the whole engine (engine-features.cjs), and the engine applies that to requests made by an
// extension's pages and service worker too: they count as third-party to every site. Chrome exempts them. An extension without
// host permission (Raindrop, which asks only for optional "*://*/*") that calls fetch(url, {credentials: 'include'}) gets the site's
// SameSite=None cookie there; here it got none and the site answered "not signed in".
//
// This participant of the request pipeline (request-pipeline.cjs, useSendHeaders) puts those cookies back, with Chrome's limits:
//   - only requests whose initiator is an installed and enabled extension (its pages or worker), never navigations, never Tor;
//   - only when the request itself asked for credentials: the engine marks those with Sec-Fetch-Storage-Access (credentials 'omit'
//     and the same-origin default send none). If a build ever stops sending that header nothing is added: it fails closed;
//   - the extension has host permission for the address: every cookie that matches it (as Chrome, an extension with host permission is
//     first-party); no host permission: only SameSite=None; Secure cookies (third-party context). Lax, Strict and unspecified cookies,
//     the usual login cookies, are never sent to an extension without host permission;
//   - cookies come from the same jar the tabs use (session.cookies); an existing Cookie header is kept and merged without duplicates;
//   - any error returns {}: the request goes out as it would have (the pipeline would cancel it on a throw).
// The extension never sees a cookie value (chrome.cookies needs host permission, ext-api/cookies.cjs); it only gets what the SERVER
// answers, which the server gates with CORS (Access-Control-Allow-Origin for that extension and Allow-Credentials).
// Limit: Set-Cookie on those responses stays blocked, so a site that refreshes its session cookie through an extension request does not
// persist the refresh from there; the site's own tab still does.
const TABLE = Symbol.for('acira.extension.permission-table-v1');
const EXTENSION = /^chrome-extension:\/\/([a-p]{32})$/;
const NAVIGATION = new Set(['mainFrame', 'subFrame']);
const TOR = Symbol.for('acira.tor.session');

/** Records the profile's permission table on its session (extension-apis.cjs), so the pipeline participant can ask host permission. */
function rememberPermissionTable(session, table) {
  try { Object.defineProperty(session, TABLE, {value: table, configurable: true}); } catch {}
}

const headerKey = (headers, name) => Object.keys(headers).find(key => key.toLowerCase() === name);

/** The cookies this request may carry, as one "a=1; b=2" string, or '' for none. `all` = the extension holds host permission for the address. */
function cookieText(cookies, all, existing) {
  const have = new Set(existing.split(';').map(part => part.split('=')[0].trim()).filter(Boolean));
  const parts = [];
  for (const cookie of cookies || []) {
    if (!cookie || typeof cookie.value !== 'string' || typeof cookie.name !== 'string') continue;
    if (!all && !(cookie.sameSite === 'no_restriction' && cookie.secure === true)) continue;
    if (cookie.name && have.has(cookie.name)) continue;
    have.add(cookie.name);
    parts.push(cookie.name ? cookie.name + '=' + cookie.value : cookie.value);
  }
  return parts.join('; ');
}

/** The pipeline participant for one session. `session` is the Electron session; nothing is read from it until a request qualifies. */
function createExtensionCookies(session) {
  return function sendHeaders(details) {
    try {
      const origin = details && details.initiatorOrigin;
      // Ordinary page requests stop at this one test: no lookup, no allocation.
      if (typeof origin !== 'string' || origin.charCodeAt(0) !== 99) return {};
      const match = EXTENSION.exec(origin);
      if (!match) return {};
      if (!/^https?:/i.test(details.url) || NAVIGATION.has(details.resourceType)) return {};
      if (session.__aciraTor || session[TOR]) return {};
      const headers = details.requestHeaders || {};
      if (!headerKey(headers, 'sec-fetch-storage-access')) return {};
      const extension = session.extensions && session.extensions.getExtension(match[1]);
      const table = session[TABLE];
      if (!extension || !table || typeof table.hasOrigin !== 'function') return {};
      const all = !!table.hasOrigin(extension, details.url);
      return Promise.resolve(session.cookies.get({url: details.url})).then(cookies => {
        const key = headerKey(headers, 'cookie');
        const existing = key ? String(headers[key]) : '';
        const added = cookieText(cookies, all, existing);
        if (!added) return {};
        return {requestHeaders: {...headers, [key || 'Cookie']: existing ? existing + '; ' + added : added}};
      }, () => ({}));
    } catch {
      return {};
    }
  };
}

module.exports = {createExtensionCookies, rememberPermissionTable, cookieText, TABLE};
