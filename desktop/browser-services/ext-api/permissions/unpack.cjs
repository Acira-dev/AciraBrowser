'use strict';
// chrome.permissions helpers for the main process: Chromium's URLPattern::Parse / GetAsString, UnpackPermissionSet and PackPermissionSet
// (extensions/common/url_pattern.cc, extensions/browser/api/permissions/permissions_api_helpers.cc), applied over Acira's permission table
// (extension-permission-table.cjs, WP0). Nothing here keeps state: grants live in the table, never in a second store.

const table = require('../../extension-permission-table.cjs'); // pure helpers only: patternCovers, knownPermissions

// Extension::kValidHostPermissionSchemes (extension.cc): chrome, http, https, file, ftp, ws, wss, uuid-in-package.
const VALID_SCHEMES = ['chrome', 'http', 'https', 'file', 'ftp', 'ws', 'wss', 'uuid-in-package'];
// Schemes with a default port: only these accept a numeric port in a pattern (URLPattern::IsValidPortForScheme).
const PORT_SCHEMES = ['http', 'https', 'ftp', 'ws', 'wss'];

const PARSE_ERRORS = {
  scheme: 'Missing scheme separator.',
  invalidScheme: 'Invalid scheme.',
  wrongScheme: 'Wrong scheme type.',
  emptyHost: 'Host can not be empty.',
  wildcard: 'Invalid host wildcard.',
  emptyPath: 'Empty path.',
  port: 'Invalid port.',
  host: 'Invalid host.'
};

/** The message Chromium gives for an API permission name it does not know. */
const unknownPermission = name => `'${name}' is not a recognized permission.`;
/** The message Chromium gives for a host pattern it cannot parse. */
const invalidOrigin = (pattern, why) => `Invalid value for origin pattern ${pattern}: ${why}`;

function canonicalHost(host) {
  if (host.includes('\0')) return '';
  try {
    const url = new URL(`http://${host}/`);
    // A host with a path, query, port, credentials or spaces is not a bare host.
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.port) return '';
    return url.hostname;
  } catch {
    return '';
  }
}

/**
 * URLPattern::Parse for extension host permissions. Returns {ok: true, pattern} or {ok: false, error}. pattern: {spec, all, scheme, host,
 * subdomains, port, path}. `spec` is URLPattern::GetAsString() ("https://*.example.com/*", "<all_urls>", "file:///*").
 */
function parsePattern(input) {
  const fail = error => ({ok: false, error});
  if (typeof input !== 'string') return fail(PARSE_ERRORS.scheme);
  if (input === '<all_urls>') return {ok: true, pattern: {spec: '<all_urls>', all: true, scheme: '*', host: '', subdomains: true, port: '*', path: '/*'}};
  let at = input.indexOf('://'), standard = true;
  if (at < 0) { at = input.indexOf(':'); standard = false; }
  if (at < 0) return fail(PARSE_ERRORS.scheme);
  const scheme = input.slice(0, at);
  if (scheme !== '*' && !VALID_SCHEMES.includes(scheme)) return fail(PARSE_ERRORS.invalidScheme);
  // Every scheme that can be a host permission is "standard" (written scheme://host/path); `*` too.
  if (!standard) return fail(PARSE_ERRORS.wrongScheme);
  const hostStart = at + 3;
  if (hostStart >= input.length) return fail(PARSE_ERRORS.emptyHost);
  let host = '', subdomains = false, port = '*', pathStart;
  if (scheme === 'file') {
    const end = input.indexOf('/', hostStart);
    // file://* is file:///* ; the host part of other file URLs is ignored.
    pathStart = end < 0 ? hostStart - 1 : end;
  } else {
    const end = input.indexOf('/', hostStart);
    if (end === hostStart) return fail(PARSE_ERRORS.emptyHost);
    if (end < 0) return fail(PARSE_ERRORS.emptyPath);
    const hostAndPort = input.slice(hostStart, end);
    let portAt = -1;
    if (hostAndPort[0] !== '[') portAt = hostAndPort.indexOf(':');
    else {
      const close = hostAndPort.indexOf(']');
      if (close < 0) return fail(PARSE_ERRORS.host);
      if (close === 1) return fail(PARSE_ERRORS.emptyHost);
      if (close < hostAndPort.length - 1) {
        if (hostAndPort[close + 1] !== ':') return fail(PARSE_ERRORS.host);
        portAt = close + 1;
      }
    }
    if (portAt >= 0) {
      const candidate = hostAndPort.slice(portAt + 1);
      const valid = candidate === '*' || (PORT_SCHEMES.includes(scheme) && /^\d{1,5}$/.test(candidate) && Number(candidate) < 65536);
      if (!valid) return fail(PARSE_ERRORS.port);
      port = candidate;
    }
    let piece = portAt >= 0 ? hostAndPort.slice(0, portAt) : hostAndPort;
    if (!piece) return fail(PARSE_ERRORS.emptyHost);
    if (piece === '*') { subdomains = true; piece = ''; }
    else if (piece.startsWith('*.')) {
      if (piece.length === 2) return fail(PARSE_ERRORS.emptyHost);
      subdomains = true;
      piece = piece.slice(2);
    }
    host = piece;
    pathStart = end;
  }
  const path = input.slice(pathStart);
  if (host.includes('*')) return fail(PARSE_ERRORS.wildcard);
  if (host) {
    host = host.startsWith('[') ? host.toLowerCase() : canonicalHost(host);
    if (!host) return fail(PARSE_ERRORS.host);
  }
  let spec = `${scheme}://`;
  if (scheme !== 'file') {
    if (subdomains) spec += host ? '*.' : '*';
    spec += host;
    if (port !== '*') spec += `:${port}`;
  }
  spec += path;
  return {ok: true, pattern: {spec, all: false, scheme, host, subdomains, port, path}};
}

/** Chromium's GetAsString for a pattern string, or the input when it does not parse. */
const normalize = input => { const parsed = parsePattern(input); return parsed.ok ? parsed.pattern.spec : String(input); };

/** Does the pattern list `patterns` give the pattern `asked` (both specs)? */
const covered = (patterns, asked) => patterns.some(pattern => table.patternCovers(pattern, asked));

const unique = list => [...new Set(list)];
const strings = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

/** Host patterns the manifest's content scripts run on (Chromium's "scriptable hosts"), normalized. */
function scriptableHosts(manifest) {
  const out = [];
  for (const script of Array.isArray(manifest && manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const match of strings(script && script.matches)) out.push(normalize(match));
  }
  return unique(out);
}

/**
 * UnpackPermissionSet: splits a request ({permissions, origins}) by what the extension's manifest says about each entry. Throws
 * Error(<Chromium's message>) for an unknown permission name or an unparsable pattern.
 *   apis:    {required, optional, unlisted}      (names)
 *   origins: {required, optional, scriptable, unlisted, restricted}   (normalized patterns; restricted = file: patterns, Acira never gives
 *            extensions file access)
 */
function unpack(permissionTable, extension, request) {
  const decl = permissionTable.declared(extension);
  const manifest = extension && extension.manifest || {};
  const known = table.knownPermissions();
  const apis = {required: [], optional: [], unlisted: []};
  for (const name of strings(request && request.permissions)) {
    if (name.includes('|')) {
      // "usbDevices|{…}" is the only permission with arguments; Acira has no USB device permission to give.
      const base = name.slice(0, name.indexOf('|'));
      if (base !== 'usbDevices') throw new Error('Only the usbDevices permission supports arguments.');
      apis.unlisted.push(name);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(known, name)) throw new Error(unknownPermission(name));
    if (decl.permissions.includes(name)) apis.required.push(name);
    else if (decl.optionalPermissions.includes(name)) apis.optional.push(name);
    else apis.unlisted.push(name);
  }
  const origins = {required: [], optional: [], scriptable: [], unlisted: [], restricted: []};
  const scriptable = scriptableHosts(manifest);
  for (const text of strings(request && request.origins)) {
    const parsed = parsePattern(text);
    if (!parsed.ok) throw new Error(invalidOrigin(text, parsed.error));
    const {spec, scheme} = parsed.pattern;
    if (scheme === 'file') { origins.restricted.push(spec); continue; }
    let used = false;
    if (covered(decl.origins, spec)) { used = true; origins.required.push(spec); }
    else if (covered(decl.optionalOrigins, spec)) { used = true; origins.optional.push(spec); }
    if (covered(scriptable, spec)) { used = true; origins.scriptable.push(spec); }
    if (!used) origins.unlisted.push(spec);
  }
  for (const key of Object.keys(apis)) apis[key] = unique(apis[key]);
  for (const key of Object.keys(origins)) origins[key] = unique(origins[key]);
  return {apis, origins};
}

/** PackPermissionSet: {permissions, origins}, both always present. */
function pack({permissions = [], origins = []} = {}) {
  return {permissions: unique(strings(permissions)), origins: unique(strings(origins).map(normalize))};
}

// Permissions whose install warnings are empty in Chromium (chrome_permission_message_rules.cc has no rule for them). Asking for only
// these needs no prompt: permissions.request grants at once, as in Chrome. Everything else, and every host pattern, is confirmed.
const SILENT = new Set(['activeTab', 'alarms', 'background', 'browsingData', 'contextMenus', 'cookies', 'declarativeContent',
  'declarativeNetRequestWithHostAccess', 'fontSettings', 'gcm', 'identity', 'idle', 'offscreen', 'pageCapture', 'power', 'proxy',
  'scripting', 'search', 'sidePanel', 'storage', 'system.cpu', 'system.display', 'system.memory', 'system.network', 'tabCapture', 'tts',
  'unlimitedStorage', 'userScripts', 'webRequest', 'webRequestAuthProvider', 'webRequestBlocking']);
/** Does granting this set show a warning (so the user must confirm)? Unknown names count as warnings. */
const needsPrompt = ({permissions = [], origins = []} = {}) => origins.length > 0 || permissions.some(name => !SILENT.has(name));

/**
 * The extension's active host patterns for permissions.getAll: explicit hosts + content-script hosts (PackPermissionSet reads
 * effective_hosts), normalized. `active` is the table's {permissions, origins}.
 */
function effectiveOrigins(manifest, active) {
  return unique([...strings(active.origins).map(normalize), ...scriptableHosts(manifest)]);
}

module.exports = {parsePattern, normalize, unpack, pack, needsPrompt, effectiveOrigins, scriptableHosts, unknownPermission, invalidOrigin, SILENT,
  PARSE_ERRORS};
