'use strict';
// Phishing and malware address lists that work for everyone, with no account and no key: malware-filter's "Phishing URL Blocklist" (OpenPhish, PhishTank,
// IPThreat) and "Online Malicious URL Blocklist" (abuse.ch URLhaus). Both are public, refreshed twice a day, and are the lists uBlock Origin users add for the
// same purpose. They are downloaded with the other filter lists (same HTTPS-only transport, no extra server of ours), kept on disk, and matched in memory.
// A listed address on a top-level navigation gets Acira's warning page; a listed address as a page resource is simply blocked.
//
// Licences (verified 24 Oct 2026 from the projects' READMEs): URLhaus filter: CC0 1.0 and MIT, data CC0. Phishing filter: filter data CC BY-SA 4.0, sources
// OpenPhish and PhishTank "free of charge", IPThreat CC BY-SA 4.0. Acira downloads the lists at run time and ships none of their data, so the share-alike
// terms are met by crediting them (Settings → Privacy and THIRD_PARTY_NOTICES.md).
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { downloadList } = require('./public-list-download.cjs');
const SOURCES = Object.freeze([
  Object.freeze({ id: 'phishing', kind: 'phishing', title: 'Phishing URL Blocklist', credit: 'malware-filter (OpenPhish, PhishTank, IPThreat)', file: 'phishing.txt',
    urls: Object.freeze(['https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt', 'https://curbengh.github.io/malware-filter/phishing-filter.txt']) }),
  Object.freeze({ id: 'malware', kind: 'malware', title: 'Online Malicious URL Blocklist', credit: 'malware-filter (abuse.ch URLhaus)', file: 'malware.txt',
    urls: Object.freeze(['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt', 'https://curbengh.github.io/malware-filter/urlhaus-filter-online.txt']) }),
  // A plain list of about 390,000 active phishing domains (MIT, Mitchell Krog and Nissar Chababy). Kept as 53-bit hashes (about 8 MB) so a third list does not
  // cost tens of megabytes; a wrong match needs two independent 32-bit hashes to collide, roughly 1 in 4.5 quadrillion per lookup.
  Object.freeze({ id: 'phishing-db', kind: 'phishing', title: 'Phishing.Database active domains', credit: 'Phishing.Database (MIT)', file: 'phishing-db.txt', headerless: true, compact: true, minEntries: 50000,
    urls: Object.freeze(['https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt']) })
]);
const PERIOD = 24 * 60 * 60 * 1000, STALE = 7 * PERIOD, MAX_BYTES = 16 * 1024 * 1024, MAX_ENTRIES = 600000, MIN_ENTRIES = 500;
const IP4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const hashHost = text => { let a = 0x811c9dc5, b = 0x1b873593; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 2654435761) ^ (b >>> 13); } return (a >>> 0) * 2097152 + ((b >>> 0) & 0x1fffff); };
/** A plain one-domain-per-line list, kept as a sorted array of hashes (about 3 MB for 390,000 domains, binary-searched). */
function sortedHashes(text, hash, limit) {
  const found = []; let entries = 0;
  for (let from = 0; from < text.length;) {
    let to = text.indexOf('\n', from); if (to < 0) to = text.length;
    const line = text.slice(from, to).trim().toLowerCase(); from = to + 1;
    if (!line || line[0] === '#' || line[0] === '!' || line.length > 253 || !line.includes('.') || !/^[a-z0-9._-]+$/.test(line)) continue;
    found.push(hash(line)); if (++entries > limit) throw new Error('Threat list is too large.');
  }
  const sorted = Float64Array.from(found).sort(); let size = 0; for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[size++] = sorted[i];
  return { sorted: sorted.subarray(0, size), entries };
}
const compactList = ({ sorted, entries }) => {
  const size = sorted.length;
  const has = value => { let low = 0, high = size - 1; while (low <= high) { const mid = (low + high) >> 1, at = sorted[mid]; if (at === value) return true; if (at < value) low = mid + 1; else high = mid - 1; } return false; };
  return { hosts: new Set(), paths: new Map(), hashes: { has, size }, entries };
};
function parseCompactDomains(text) { return compactList(sortedHashes(text, hashHost, MAX_ENTRIES * 2)); }
/** The same, off the main thread: hashing and sorting 390,000 domains takes about half a second. */
function parseCompactDomainsAsync(text) {
  const { Worker } = require('node:worker_threads');
  const source = `const { parentPort, workerData } = require('node:worker_threads'); const hashHost = ${hashHost.toString()}; const sortedHashes = ${sortedHashes.toString()};
    try { const result = sortedHashes(workerData.text, hashHost, workerData.limit); const copy = new Float64Array(result.sorted); parentPort.postMessage({ sorted: copy, entries: result.entries }, [copy.buffer]); } catch (error) { parentPort.postMessage({ error: String(error.message || error) }); }`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { text, limit: MAX_ENTRIES * 2 } });
    worker.once('message', message => { worker.terminate(); message.error ? reject(new Error(message.error)) : resolve(compactList(message)); });
    worker.once('error', reject);
  });
}

/** Reads the list syntax these feeds use: `||host/path^$all`, `||host^$all`, or a bare host (domain, IPv4, [IPv6], optionally :port). Anything else is ignored.
 *  Calls host(name) or path(name, rest) per entry; self-contained so the worker below can run it. */
function scanThreatList(text, host, path, limit) {
  let entries = 0;
  for (const raw of String(text).split('\n')) {
    let line = raw.trim();
    if (!line || line[0] === '!' || line[0] === '#' || line.includes(' ') || line.includes('*')) continue;
    const dollar = line.lastIndexOf('$');
    if (dollar >= 0) { if (line.slice(dollar + 1) !== 'all') continue; line = line.slice(0, dollar); }
    if (line.endsWith('^')) line = line.slice(0, -1);
    if (line.startsWith('||')) line = line.slice(2); else if (line[0] === '|' || line[0] === '[' && !/^\[[0-9a-f:.]+\](?::\d+)?$/i.test(line)) continue;
    const slash = line.indexOf('/'), name = (slash < 0 ? line : line.slice(0, slash)).toLowerCase(), rest = slash < 0 ? '' : line.slice(slash);
    if (!name || name.length > 253 || !/^[a-z0-9._:\[\]-]+$/.test(name)) continue;
    if (!rest || rest === '/') host(name); else path(name, rest);
    if (++entries > limit) throw new Error('Threat list is too large.');
  }
  return entries;
}
/** The same lists as a Set of hosts and a Map of host -> path prefixes (tests and small lists). */
function parseThreatList(text) {
  const hosts = new Set(), paths = new Map();
  const entries = scanThreatList(text, name => hosts.add(name), (name, rest) => { const list = paths.get(name); if (list) list.push(rest); else paths.set(name, [rest]); }, MAX_ENTRIES);
  return { hosts, paths, entries };
}
// R4-37: in the app the two URL feeds are kept the way the big domain feed already is: sorted 53-bit hashes (8 bytes an entry) built in a worker, instead of
// about 150,000 strings in a Set and a Map that held some 30 MB of the main process's heap (plus the garbage of parsing 14 MB of text on the main thread).
// Same rules as the Set/Map form (matchEntry); a false match needs two independent 32-bit hashes to collide.
function packThreatList(text, hash, limit) {
  const hosts = [], pathHosts = [], paths = [];
  const entries = scanThreatList(text, name => hosts.push(hash(name)), (name, rest) => { pathHosts.push(hash(name)); paths.push(hash(name + rest)); }, limit);
  const pack = values => { const sorted = Float64Array.from(values).sort(); let size = 0; for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[size++] = sorted[i]; return new Float64Array(sorted.subarray(0, size)); };
  return { hosts: pack(hosts), pathHosts: pack(pathHosts), paths: pack(paths), entries };
}
function packThreatListAsync(text) {
  const { Worker } = require('node:worker_threads');
  const source = `const { parentPort, workerData } = require('node:worker_threads'); const hashHost = ${hashHost.toString()}; const scanThreatList = ${scanThreatList.toString()}; const packThreatList = ${packThreatList.toString()};
    try { const result = packThreatList(workerData.text, hashHost, workerData.limit); parentPort.postMessage(result, [result.hosts.buffer, result.pathHosts.buffer, result.paths.buffer]); } catch (error) { parentPort.postMessage({ error: String(error.message || error) }); }`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { text, limit: MAX_ENTRIES } });
    worker.once('message', message => { worker.terminate(); message.error ? reject(new Error(message.error)) : resolve({ packed: true, hosts: message.hosts, pathHosts: message.pathHosts, paths: message.paths, entries: message.entries }); });
    worker.once('error', reject);
  });
}
const RELEASE_LAST_MATCH = /(?:)/;
const sortedHas = (sorted, value) => { let low = 0, high = sorted.length - 1; while (low <= high) { const mid = (low + high) >> 1, at = sorted[mid]; if (at === value) return true; if (at < value) low = mid + 1; else high = mid - 1; } return false; };
const isSeparator = ch => !/[A-Za-z0-9_\-.%]/.test(ch);
/**
 * The list entry an address matches, as a stable key (the listed host, or listed host plus path prefix), or null. "Continue anyway" is remembered per key, so
 * allowing one listed page on a shared host never allows the other listed pages there.
 */
function matchEntry(list, url) {
  if (list.hashes) { const name = url.hostname; if (IP4.test(name) || name.startsWith('[')) return null; const labels = name.split('.'); for (let i = 0; i < labels.length - 1; i++) { const suffix = labels.slice(i).join('.'); if (list.hashes.has(hashHost(suffix))) return suffix; } return null; }
  const hostname = url.hostname, hostWithPort = url.port ? url.host : null, isIp = IP4.test(hostname) || hostname.startsWith('[');
  if (list.packed) {
    const host = name => sortedHas(list.hosts, hashHost(name));
    if (host(hostname)) return hostname;
    if (hostWithPort && host(hostWithPort)) return hostWithPort;
    if (!isIp) { const labels = hostname.split('.'); for (let i = 1; i < labels.length - 1; i++) { const parent = labels.slice(i).join('.'); if (host(parent)) return parent; } }
    // A listed prefix matches where the address continues with a separator, ends, or the prefix ends in "/": try exactly those cut points, shortest first.
    for (const key of hostWithPort ? [hostname, hostWithPort] : [hostname]) {
      if (!sortedHas(list.pathHosts, hashHost(key))) continue;
      const target = url.pathname + url.search;
      for (let end = 1; end <= target.length; end++) if ((end === target.length || isSeparator(target[end]) || target[end - 1] === '/') && sortedHas(list.paths, hashHost(key + target.slice(0, end)))) return key + target.slice(0, end);
    }
    return null;
  }
  if (list.hosts.has(hostname)) return hostname;
  if (hostWithPort && list.hosts.has(hostWithPort)) return hostWithPort;
  if (!isIp) { const labels = hostname.split('.'); for (let i = 1; i < labels.length - 1; i++) { const parent = labels.slice(i).join('.'); if (list.hosts.has(parent)) return parent; } }
  for (const key of hostWithPort ? [hostname, hostWithPort] : [hostname]) {
    const prefixes = list.paths.get(key); if (!prefixes) continue;
    const target = url.pathname + url.search;
    for (const prefix of prefixes) if (target.startsWith(prefix) && (target.length === prefix.length || isSeparator(target[prefix.length]) || prefix.endsWith('/'))) return key + prefix;
  }
  return null;
}
const listMatches = (list, url) => matchEntry(list, url) !== null;
function validate(text, source) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || /[\u0000-\u0008\u000B\u000C\u000E-\u001F�]/.test(text) || /^\s*</.test(text)) throw new Error('Invalid ' + source.title + ' content.');
  if (!source.headerless && !new RegExp('^! Title: ' + source.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm').test(text.slice(0, 2048))) throw new Error('Unexpected ' + source.title + ' header.');
  const parsed = source.compact ? parseCompactDomains(text) : parseThreatList(text); if (parsed.entries < (source.minEntries || MIN_ENTRIES)) throw new Error(source.title + ' has too few entries.');
  return parsed;
}

/** validate(), with every feed parsed in a worker: the plain-domain feed into hashes, the URL feeds into packed hashes (R4-37). */
async function validateAsync(text, source) {
  if (!source.compact) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || /[\u0000-\u0008\u000B\u000C\u000E-\u001F�]/.test(text) || /^\s*</.test(text)) throw new Error('Invalid ' + source.title + ' content.');
    if (!source.headerless && !new RegExp('^! Title: ' + source.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm').test(text.slice(0, 2048))) throw new Error('Unexpected ' + source.title + ' header.');
    // A successful match keeps its subject in RegExp.input; the header test above would pin the whole 14 MB list text in the heap until the next match.
    RELEASE_LAST_MATCH.exec('');
    const parsed = await packThreatListAsync(text); if (parsed.entries < (source.minEntries || MIN_ENTRIES)) throw new Error(source.title + ' has too few entries.');
    return parsed;
  }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text) || /^\s*</.test(text)) throw new Error('Invalid ' + source.title + ' content.');
  const parsed = await parseCompactDomainsAsync(text); if (parsed.entries < (source.minEntries || MIN_ENTRIES)) throw new Error(source.title + ' has too few entries.');
  return parsed;
}

function createThreatLists({ cachePath, download = downloadList, io = fs, now = Date.now, enabled = true }) {
  const lists = new Map(), meta = new Map(); let on = enabled !== false, loaded = false, loading = null, refreshing = null, lastError = null;
  const file = source => path.join(cachePath, source.file), metaPath = path.join(cachePath, 'threat-lists.json');
  const readMeta = () => { try { const saved = JSON.parse(io.readFileSync(metaPath, 'utf8')); for (const source of SOURCES) if (saved && Number.isFinite(saved[source.id]?.updated)) meta.set(source.id, { updated: saved[source.id].updated, listed: saved[source.id].listed }); } catch { /* No saved state yet. */ } };
  const writeMeta = () => { try { io.mkdirSync(cachePath, { recursive: true }); const tmp = metaPath + '.' + randomUUID().slice(0, 8); io.writeFileSync(tmp, JSON.stringify(Object.fromEntries(meta))); io.renameSync(tmp, metaPath); } catch { /* A read-only profile keeps working from memory. */ } };
  /** Reads the cached lists from disk; never throws. */
  function load() {
    if (loaded) return Promise.resolve();
    return loading || (loading = new Promise(resolve => setImmediate(async () => {
      readMeta();
      for (const source of SOURCES) { try { const text = io.readFileSync(file(source), 'utf8'); lists.set(source.id, await validateAsync(text, source)); } catch { meta.delete(source.id); } }
      loaded = true; loading = null; resolve();
    })));
  }
  /** The threat for an address, or null. Never throws and never blocks on I/O. */
  function lookup(address) {
    if (!on || !lists.size) return null;
    let url; try { url = new URL(address); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    for (const source of SOURCES) { const list = lists.get(source.id); const key = list && matchEntry(list, url); if (key) return { kind: source.kind, list: source.title, host: url.hostname, key }; }
    return null;
  }
  async function refreshOne(source, session) {
    let failure;
    for (const url of source.urls) {
      try {
        const text = await download(url, session, { maxBytes: MAX_BYTES, timeoutMs: 10 * 60 * 1000 }), parsed = await validateAsync(text, source);
        io.mkdirSync(cachePath, { recursive: true }); const tmp = file(source) + '.' + randomUUID().slice(0, 8); io.writeFileSync(tmp, text); io.renameSync(tmp, file(source));
        lists.set(source.id, parsed); meta.set(source.id, { updated: now(), listed: parsed.entries }); return true;
      } catch (error) { failure = error; }
    }
    throw failure || new Error('No source for ' + source.title + '.');
  }
  /** Downloads every list (the second mirror when the first fails), validates it, and swaps it in. A failed list keeps the one already on disk. */
  function refresh(session) {
    if (!refreshing) refreshing = (async () => {
      await load(); const errors = [];
      for (const source of SOURCES) { try { await refreshOne(source, session); } catch (error) { errors.push(source.title + ': ' + String(error.message || error)); } }
      lastError = errors.length ? errors.join(' ') : null; writeMeta();
    })().finally(() => { refreshing = null; });
    return refreshing.then(status);
  }
  /** Refreshes when a list is missing or older than a day. Used by the same schedule as the other filter lists. */
  async function maybeRefresh(session) {
    if (!on) return status(); await load();
    if (SOURCES.some(source => !lists.has(source.id) || now() - (meta.get(source.id)?.updated || 0) >= PERIOD)) return refresh(session).catch(() => status());
    return status();
  }
  function status() {
    const age = id => meta.get(id)?.updated ? now() - meta.get(id).updated : null;
    const items = SOURCES.map(source => ({ id: source.id, title: source.title, credit: source.credit, entries: lists.get(source.id)?.entries ?? 0, updated: meta.get(source.id)?.updated ?? null }));
    const ready = items.filter(item => item.entries > 0).length;
    const state = !on ? 'off' : refreshing ? (ready ? 'updating' : 'downloading') : !loaded ? 'loading' : !ready ? (lastError ? 'error' : 'downloading') : items.some(item => (age(item.id) ?? Infinity) > STALE) ? 'stale' : ready < SOURCES.length ? 'partial' : 'active';
    return { enabled: on, state, lists: items, lastError };
  }
  return { load, lookup, refresh, maybeRefresh, status, setEnabled(value) { on = value !== false; }, sources: SOURCES };
}
module.exports = { SOURCES, parseCompactDomains, parseCompactDomainsAsync, validateAsync, parseThreatList, packThreatListAsync, listMatches, matchEntry, createThreatLists, validate };
