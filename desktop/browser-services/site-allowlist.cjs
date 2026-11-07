'use strict';
// Acira's reviewed allow-list: hosts the team confirmed are wrongly listed by a threat feed (after a "Report a problem" report, in the Supabase
// dashboard, table site_allowlist). A host on it is never blocked as a whole host by the threat lists (threat-lists.cjs matchEntry, the same place
// as the top-sites guard) nor by the look-alike address check; a listed path on it still is. Fetched once a day with the threat lists: a plain GET with no
// cookie, no query and no identifier. A failed or odd answer changes nothing: the last good copy (or none) stays in use, so blocking stays as it was.
// beta.11: the list is a static file beside the update feed (`site-allowlist.json`, FILE_NAME; the same raw.githubusercontent.com host the update check
// already uses), so asking for it tells no Acira-run server anything. Until that file is published (the feed answers 404 or 410) the client still asks
// the old read-only Supabase function (supabase/functions/allowlist), and only then: a network failure or a 5xx keeps the last copy and asks nobody
// else. Once the file exists the Supabase request never happens; the fallback can then be deleted (docs/launch/SITE_ALLOWLIST.md).
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { reportHost } = require('./site-reports.cjs'), { readJsonFile } = require('../atomic-file.cjs');
const { checkedEndpoint } = require('./metrics.cjs'), { feedFolderURL } = require('./release-feed.cjs');

const FILE = 'site-allowlist.json', PERIOD = 24 * 60 * 60 * 1000, MAX_BYTES = 512 * 1024, MAX_HOSTS = 20000;
/** The static copy's name in the feed folder (and in the app's own cache folder, where the last good copy is kept). */
const FILE_NAME = 'site-allowlist.json';

/** Where the static copy is: beside the update feed. A test profile reaches only what QA names (ACIRA_SITE_ALLOWLIST_FILE, plain http on 127.0.0.1), never the shipped feed. */
function allowlistFileURL(env = process.env, { feedFolder = feedFolderURL } = {}) {
  if (env.ACIRA_BROWSER_TEST_DATA) return checkedEndpoint(env.ACIRA_SITE_ALLOWLIST_FILE || '', { allowLocal: true });
  const folder = feedFolder();
  return folder ? checkedEndpoint(folder + FILE_NAME) : '';
}

/** The file is not there (yet): the feed answered 404 or 410. Only this sends the client to the old endpoint. */
const isMissing = (error) => error && (error.status === 404 || error.status === 410);

/** The hosts of an endpoint answer ({"schema":1,"hosts":[...]}), or throws. Every host must be one a report could name. */
function parseAllowlist(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new Error('The allow-list is too large.');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1 || !Array.isArray(value.hosts) || value.hosts.length > MAX_HOSTS) throw new Error('Unexpected allow-list.');
  const hosts = new Set();
  for (const host of value.hosts) { if (typeof host !== 'string' || reportHost('https://' + host + '/') !== host) throw new Error('Unexpected allow-list host.'); hosts.add(host); }
  return hosts;
}

/** `hostname` and the listed parents up to `entry` (a threat-list entry that blocks hostname as a whole host: hostname itself or a parent of it). */
function between(hostname, entry) {
  const name = String(hostname).toLowerCase(), top = String(entry).toLowerCase().replace(/:\d+$/, '');
  if (name !== top && !name.endsWith('.' + top)) return [];
  const labels = name.split('.'), steps = labels.length - top.split('.').length, out = [];
  for (let i = 0; i <= steps; i++) out.push(labels.slice(i).join('.'));
  return out;
}

/** `fetchText(url, session)` -> the answer's text, or throws on any failure (status other than 200, too large, timeout). */
function createSiteAllowlist({ cachePath, endpoint = '', fileUrl = '', fetchText = electronFetchText, io = fs, now = Date.now }) {
  const file = path.join(cachePath, FILE);
  let hosts = new Set(), updated = null, loaded = false, refreshing = null, lastError = null, source = null;
  function load() {
    if (loaded) return; loaded = true;
    // No copy yet, or a damaged one (kept aside first, atomic-file.cjs readJsonFile): none is used until the next fetch.
    try { const saved = readJsonFile(file, { fileSystem: io }); if (!saved) return; const parsed = parseAllowlist(JSON.stringify({ schema: 1, hosts: saved.hosts })); hosts = parsed; updated = Number.isFinite(saved.updated) ? saved.updated : null; } catch { /* hosts this Acira refuses: none is used */ }
  }
  /** True when a whole-host threat-list `entry` must not block `hostname`: hostname, or a parent of it no higher than the entry, is on the list. */
  function covers(hostname, entry) { if (!hosts.size) return false; for (const name of between(hostname, entry)) if (hosts.has(name)) return true; return false; }
  /** True when hostname or any parent of it is on the list (the look-alike check judges the name, not an entry). */
  function allows(hostname) { if (!hosts.size) return false; const labels = String(hostname).toLowerCase().split('.'); for (let i = 0; i < labels.length - 1; i++) if (hosts.has(labels.slice(i).join('.'))) return true; return false; }
  async function refresh(session) {
    load();
    if (!endpoint && !fileUrl) return status();
    if (!refreshing) refreshing = (async () => {
      try {
        let text, from = 'file';
        if (fileUrl) {
          try { text = await fetchText(fileUrl, session); } catch (error) { if (!(endpoint && isMissing(error))) throw error; from = 'endpoint'; }
        } else from = 'endpoint';
        if (from === 'endpoint') text = await fetchText(endpoint, session);
        const next = parseAllowlist(text);
        hosts = next; updated = now(); lastError = null; source = from;
        try { io.mkdirSync(cachePath, { recursive: true }); const tmp = file + '.' + randomUUID().slice(0, 8); io.writeFileSync(tmp, JSON.stringify({ hosts: [...hosts].sort(), updated })); io.renameSync(tmp, file); } catch { /* A read-only profile keeps it in memory. */ }
      } catch (error) { lastError = String(error?.message || error); }
    })().finally(() => { refreshing = null; });
    await refreshing;
    return status();
  }
  /** Fetches when there is no copy or it is a day old; called on the threat lists' schedule (never from a private or Tor session). */
  async function maybeRefresh(session) { load(); if ((endpoint || fileUrl) && (updated === null || now() - updated >= PERIOD)) return refresh(session); return status(); }
  function status() { return { entries: hosts.size, updated, lastError, source }; }
  return { load, covers, allows, refresh, maybeRefresh, status };
}

/** The real fetch: the profile's session (its proxy), GET, no cookies, no Referer, no cache, no redirects, 30 seconds, 512 KB at most. */
async function electronFetchText(url, session) {
  const response = await session.fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) throw Object.assign(new Error('The allow-list answered HTTP ' + response.status + '.'), { status: response.status });
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('The allow-list is too large.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('The allow-list is too large.');
  return bytes.toString('utf8');
}

module.exports = { createSiteAllowlist, parseAllowlist, between, allowlistFileURL, FILE_NAME, MAX_HOSTS, MAX_BYTES };
