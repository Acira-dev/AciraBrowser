'use strict';
// chrome.downloads, the pure part: Acira's download records <-> Chromium's DownloadItem, downloads.search's query semantics
// (chrome/browser/extensions/api/downloads/downloads_api.cc + chrome/browser/download/download_query.cc), the validation of
// downloads.download's options, and onChanged deltas. No Electron, no files written: everything here is testable on plain objects.
const fs = require('node:fs');
const vm = require('node:vm');

/** Chromium's error strings (downloads_api.cc, download_extension_errors). */
const ERRORS = Object.freeze({
  invalidId: 'Invalid downloadId',
  invalidURL: 'Invalid URL',
  invalidFilename: 'Invalid filename',
  invalidFilter: 'Invalid query filter',
  invalidOrderBy: 'Invalid orderBy field',
  invalidQueryLimit: 'Invalid query limit',
  invalidHeaderName: 'Invalid request header name',
  invalidHeaderUnsafe: 'Unsafe request header name',
  invalidHeaderValue: 'Invalid request header value',
  notComplete: 'Download must be complete',
  notInProgress: 'Download must be in progress',
  notResumable: 'DownloadItem.canResume must be true',
  fileAlreadyDeleted: 'Download file already deleted',
  fileNotRemoved: 'Unable to remove file',
  openPermission: 'The "downloads.open" permission is required',
  generic: "I'm afraid I can't do that."
});

const iso = ms => new Date(ms).toISOString();
const finite = value => typeof value === 'number' && Number.isFinite(value);

// ------------------------------------------------------------------------------------------------ record -> DownloadItem

/** Acira's record status -> Chromium's DownloadItem.state. A cancelled download is interrupted (error USER_CANCELED) in Chromium too. */
function stateOf(status) {
  if (status === 'Ready') return 'complete';
  if (status === 'Downloading' || status === 'Paused') return 'in_progress';
  return 'interrupted';
}

/**
 * One download record (the Downloads page's, see download-engine.cjs) as the DownloadItem an extension sees.
 * `id` is the integer id (ids.cjs); options.exists(path) answers whether a finished file is still on disk.
 */
function toItem(record, id, {exists = file => fs.existsSync(file)} = {}) {
  // The manager holds every download paused while its file name is being chosen (the Save dialog, an extension's suggestion): a record that is
  // "Paused" yet can neither be paused nor resumed is that hold, not the person's pause. Chrome's onCreated says paused:false there.
  const held = record.status === 'Paused' && record.canPause === false && record.canResume === false;
  const status = held ? 'Downloading' : String(record.status || ''), state = stateOf(status);
  const url = typeof record.url === 'string' ? record.url : '';
  const total = finite(record.totalBytes) && record.totalBytes > 0 ? record.totalBytes : -1;
  const received = finite(record.receivedBytes) ? record.receivedBytes : 0;
  const item = {
    id,
    // The manager's record keeps the address the download ended at (url); originalUrl is the one that was asked for, when a redirect happened.
    url: typeof record.originalUrl === 'string' && record.originalUrl ? record.originalUrl : url,
    finalUrl: typeof record.finalUrl === 'string' && record.finalUrl ? record.finalUrl : url,
    referrer: typeof record.referrer === 'string' ? record.referrer : '',
    filename: typeof record.path === 'string' ? record.path : '',
    incognito: false,
    danger: 'safe',
    mime: typeof record.mime === 'string' ? record.mime : '',
    startTime: iso(finite(record.startedAt) ? record.startedAt : 0),
    state,
    paused: status === 'Paused',
    canResume: (status === 'Paused' || state === 'interrupted') && record.canResume === true,
    bytesReceived: received,
    totalBytes: total,
    fileSize: state === 'complete' ? (total >= 0 ? total : received) : total,
    exists: state === 'complete' && typeof record.path === 'string' && record.path ? !!exists(record.path) : true
  };
  if (state !== 'in_progress' && finite(record.endedAt)) item.endTime = iso(record.endedAt);
  if (state === 'in_progress' && status === 'Downloading' && finite(record.eta) && record.eta > 0 && finite(record.updatedAt)) item.estimatedEndTime = iso(record.updatedAt + record.eta * 1000);
  if (status === 'Cancelled') item.error = 'USER_CANCELED';
  else if (state === 'interrupted') item.error = typeof record.interruptReason === 'string' && record.interruptReason ? record.interruptReason : 'NETWORK_FAILED';
  if (typeof record.byExtensionId === 'string' && record.byExtensionId) {
    item.byExtensionId = record.byExtensionId;
    if (typeof record.byExtensionName === 'string') item.byExtensionName = record.byExtensionName;
  }
  return item;
}

// ------------------------------------------------------------------------------------------------ onChanged

/** The DownloadDelta fields (downloads.webidl) in Chromium's order; bytesReceived is not one of them (it changes constantly). */
const DELTA_FIELDS = ['url', 'finalUrl', 'filename', 'danger', 'mime', 'startTime', 'endTime', 'state', 'canResume', 'paused', 'error', 'totalBytes', 'fileSize', 'exists'];

/** {id, <field>: {previous?, current?}} for the fields that differ, or null when none does (Chromium sends no event then). */
function deltaOf(before, after) {
  const delta = {id: after.id};
  for (const field of DELTA_FIELDS) {
    const was = before[field], now = after[field];
    if (was === now) continue;
    const change = {};
    if (was !== undefined) change.previous = was;
    if (now !== undefined) change.current = now;
    delta[field] = change;
  }
  return Object.keys(delta).length > 1 ? delta : null;
}

// ------------------------------------------------------------------------------------------------ search

const SORT_FIELDS = new Set(['bytesReceived', 'danger', 'endTime', 'error', 'exists', 'fileSize', 'filename', 'finalUrl', 'id', 'mime', 'paused', 'referrer', 'startTime', 'state', 'totalBytes', 'url']);
/** Chromium sorts DownloadItem.state by its enum (IN_PROGRESS, COMPLETE, CANCELLED, INTERRUPTED). */
const STATE_ORDER = {in_progress: 0, complete: 1, interrupted: 3};
const EQUALITY = ['id', 'url', 'finalUrl', 'filename', 'danger', 'mime', 'startTime', 'endTime', 'state', 'paused', 'error', 'bytesReceived', 'totalBytes', 'fileSize', 'exists'];
const TIME_FIELDS = new Set(['startTime', 'endTime']);

const fold = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function parseTime(text) {
  const ms = typeof text === 'string' ? Date.parse(text) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function sortValue(item, field) {
  const value = item[field];
  if (field === 'state') return STATE_ORDER[value];
  if (field === 'startTime' || field === 'endTime') return value === undefined ? -Infinity : Date.parse(value);
  if (value === undefined) return -Infinity;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * A regular expression an extension wrote (filenameRegex, urlRegex, finalUrlRegex), run with a time limit. Chromium uses RE2, which cannot
 * backtrack; V8 can: '(a+)+$' against the address of a download the extension started itself froze the browser's main process. A match that
 * takes longer than the limit (or a pattern that is not an expression) is Chromium's "Invalid query filter".
 */
function timedRegex(source, {limitMs = 50} = {}) {
  let expression;
  if (typeof source !== 'string' || source.length > 4096) throw new Error(ERRORS.invalidFilter);
  try { expression = new RegExp(source); } catch { throw new Error(ERRORS.invalidFilter); }
  const context = vm.createContext({expression, text: ''}), script = new vm.Script('expression.test(text)');
  return text => {
    context.text = text;
    try { return script.runInContext(context, {timeout: limitMs}) === true; } catch { throw new Error(ERRORS.invalidFilter); }
  };
}

/** Compile a DownloadQuery into a predicate + sorter + limit. Throws Chromium's errors for an invalid orderBy, limit, time or regular expression. */
function compileQuery(query = {}) {
  const orderBy = [];
  for (const raw of Array.isArray(query.orderBy) ? query.orderBy : []) {
    const descending = typeof raw === 'string' && raw.startsWith('-'), field = descending ? raw.slice(1) : raw;
    if (!SORT_FIELDS.has(field)) throw new Error(ERRORS.invalidOrderBy);
    orderBy.push({field, descending});
  }
  if (query.limit !== undefined && query.limit !== null && query.limit < 0) throw new Error(ERRORS.invalidQueryLimit);
  const limit = query.limit === undefined || query.limit === null ? 1000 : query.limit;
  const tests = [];
  const terms = Array.isArray(query.query) ? query.query.filter(term => typeof term === 'string' && term) : [];
  if (terms.length) {
    const include = [], exclude = [];
    for (const term of terms) { if (term.startsWith('-') && term.length > 1) exclude.push(fold(term.slice(1))); else include.push(fold(term)); }
    tests.push(item => {
      const haystacks = [item.filename, item.url, item.finalUrl].map(fold);
      return include.every(term => haystacks.some(text => text.includes(term))) && !exclude.some(term => haystacks.some(text => text.includes(term)));
    });
  }
  const times = (key, field, compare) => {
    if (query[key] === undefined) return;
    const ms = parseTime(query[key]);
    if (ms === null) throw new Error(ERRORS.invalidFilter);
    tests.push(item => { const at = item[field] === undefined ? null : Date.parse(item[field]); return at !== null && compare(at, ms); });
  };
  times('startedBefore', 'startTime', (a, b) => a < b);
  times('startedAfter', 'startTime', (a, b) => a > b);
  times('endedBefore', 'endTime', (a, b) => a < b);
  times('endedAfter', 'endTime', (a, b) => a > b);
  if (query.totalBytesGreater !== undefined) tests.push(item => item.totalBytes > query.totalBytesGreater);
  if (query.totalBytesLess !== undefined) tests.push(item => item.totalBytes < query.totalBytesLess);
  for (const [key, field] of [['filenameRegex', 'filename'], ['urlRegex', 'url'], ['finalUrlRegex', 'finalUrl']]) {
    if (query[key] === undefined) continue;
    const matches = timedRegex(query[key]);
    tests.push(item => matches(String(item[field])));
  }
  for (const field of EQUALITY) {
    if (query[field] === undefined) continue;
    if (TIME_FIELDS.has(field)) {
      const wanted = parseTime(query[field]);
      if (wanted === null) throw new Error(ERRORS.invalidFilter);
      tests.push(item => item[field] !== undefined && Date.parse(item[field]) === wanted);
    } else tests.push(item => item[field] === query[field]);
  }
  const compare = (a, b) => {
    for (const {field, descending} of orderBy) {
      const x = sortValue(a, field), y = sortValue(b, field);
      if (x === y) continue;
      const order = x < y ? -1 : 1;
      return descending ? -order : order;
    }
    return a.id - b.id;
  };
  return {match: item => tests.every(test => test(item)), compare, limit};
}

/** downloads.search over an array of DownloadItems: filter, sort (default: by id), limit (default 1000; 0 = all). */
function search(items, query) {
  const compiled = compileQuery(query);
  const found = items.filter(compiled.match).sort(compiled.compare);
  return compiled.limit > 0 ? found.slice(0, compiled.limit) : found;
}

// ------------------------------------------------------------------------------------------------ downloads.download options

const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
/** net::IsSafePortableRelativePath: a relative path inside the Downloads folder: no '..', no drive or UNC root, nothing Windows would refuse. */
function isSafeRelativePath(name) {
  if (typeof name !== 'string' || !name || /^[\\/]/.test(name) || /[\\/]$/.test(name)) return false;
  for (const part of name.split(/[\\/]/)) {
    if (!part || part === '.' || part === '..') return false;
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || /^\s/.test(part) || RESERVED.test(part)) return false;
  }
  return true;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length',
  'cookie', 'cookie2', 'content-transfer-encoding', 'date', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via']);
const unsafeHeader = name => { const lower = name.toLowerCase(); return FORBIDDEN.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-'); };

/**
 * Chromium's checks on downloads.download's DownloadOptions (the schema checks already ran in the page). Returns
 * {url, filename?, conflictAction, saveAs, method, headers: [{name, value}], body?}; throws Chromium's error for anything else.
 */
function normalizeDownloadOptions(options) {
  let url;
  try { url = new URL(options.url); } catch { throw new Error(ERRORS.invalidURL); }
  if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error(ERRORS.invalidURL);
  // downloads_api.cc: "Strip % character as it affects environment variables", then the path must be a safe relative one.
  const wanted = typeof options.filename === 'string' ? options.filename.replace(/%/g, '_') : options.filename;
  if (wanted !== undefined && wanted !== null && !isSafeRelativePath(wanted)) throw new Error(ERRORS.invalidFilename);
  const headers = [];
  for (const header of Array.isArray(options.headers) ? options.headers : []) {
    if (!TOKEN.test(header.name)) throw new Error(ERRORS.invalidHeaderName);
    if (unsafeHeader(header.name)) throw new Error(ERRORS.invalidHeaderUnsafe);
    if (/[\u0000\r\n]/.test(header.value)) throw new Error(ERRORS.invalidHeaderValue);
    headers.push({name: header.name, value: header.value});
  }
  const out = {
    url: url.href,
    conflictAction: options.conflictAction || 'uniquify',
    saveAs: options.saveAs === true,
    method: options.method || 'GET',
    headers
  };
  if (wanted) out.filename = wanted;
  if (options.body !== undefined && options.body !== null) out.body = String(options.body);
  return out;
}

module.exports = {ERRORS, toItem, stateOf, deltaOf, DELTA_FIELDS, compileQuery, search, normalizeDownloadOptions, isSafeRelativePath, timedRegex};
