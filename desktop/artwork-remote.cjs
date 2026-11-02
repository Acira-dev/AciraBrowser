'use strict';
/** Optional new-tab collections from keyless open sources (Wikimedia Commons).
 *
 *  Privacy rules (docs: J's review): nothing is fetched unless the person chose a collection AND a new tab is being shown; one picture
 *  per request; the main process fetches (never the page) with no cookies, no Referer, a fixed generic User-Agent, https only and
 *  redirects only to allow-listed hosts; every picture is verified (magic bytes, size, dimensions) and cached on this computer, then
 *  served with no network call; the list of pictures is one cached JSON per collection, refreshed at most once a day. Captions and
 *  credits come from that cached list. Private and Tor windows never reach this module. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { artworkImageInfo, MAX_INPUT_BYTES } = require('./artwork-image.cjs');
const LISTS = require('./artwork-remote-lists.cjs');

const HOSTS = new Set(['commons.wikimedia.org', 'upload.wikimedia.org', 'api.artic.edu', 'www.artic.edu', 'collectionapi.metmuseum.org', 'images.metmuseum.org']);
const DAY = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
/** Pictures are asked for at 3840 px (the largest Commons thumbnail step; a smaller original is returned as it is) and only pictures whose original is at least 2560 × 1440 are listed, so
 *  a large window never shows an enlarged picture. */
const WIDTH = 3840, MIN_WIDTH = 2560, MIN_HEIGHT = 1440;
const URL_CHARS = 3000;
const FILE = /^[a-f0-9]{24}\.(jpg|png)$/;
const strip = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 160);
const hash = (text, n = 24) => crypto.createHash('sha256').update(text).digest('hex').slice(0, n);

/** A hand-checked list of Wikimedia Commons pictures (desktop/artwork-remote-lists.cjs): keyless, open licenses only (public domain, CC0, CC BY,
 *  CC BY-SA), JPEG, at least 2560 px wide. Each refresh asks Commons about the listed files in a few short requests and keeps only those that still
 *  have an open licence and the size. The picture is the upload.wikimedia.org thumbnail without the tracking-style query string the API adds. */
function wikimedia(label, files) {
  return {
    label, host: 'commons.wikimedia.org',
    listUrls: () => {
      const query = (names) => `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime%7Csize&iiurlwidth=${WIDTH}&titles=${names.map((name) => encodeURIComponent('File:' + name)).join('%7C')}`;
      const urls = [];
      let batch = [];
      for (const name of files) {
        if (batch.length && (batch.length >= 50 || query([...batch, name]).length > URL_CHARS)) { urls.push(query(batch)); batch = []; }
        batch.push(name);
      }
      if (batch.length) urls.push(query(batch));
      return urls;
    },
    parse(json) {
      return Object.values(json?.query?.pages || {}).map((page) => {
        const info = page.imageinfo?.[0], meta = info?.extmetadata || {}, license = strip(meta.LicenseShortName?.value);
        if (!info?.thumburl || info.mime !== 'image/jpeg' || !(info.width >= MIN_WIDTH && info.height >= MIN_HEIGHT) || !/public domain|cc0|cc by(?!-nc)/i.test(license)) return null;
        let imageUrl;
        try { const u = new URL(info.thumburl); if (u.hostname === 'thumb.wikimedia.org') u.hostname = 'upload.wikimedia.org'; u.search = ''; imageUrl = u.href; } catch { return null; }
        return { title: strip(meta.ObjectName?.value) || strip(page.title).replace(/^File:/, ''), artist: strip(meta.Artist?.value), date: strip(meta.DateTimeOriginal?.value).replace(/^(\d{4})-.*$/, '$1').slice(0, 40), license, credit: 'Wikimedia Commons', source: info.descriptionurl, imageUrl };
      });
    },
  };
}

/** Each collection says where its list comes from and how one answer becomes `{ title, artist, date, license, credit, source, imageUrl }`. */
const COLLECTIONS = {
  landscapes: wikimedia('Wikimedia Commons: landscapes', LISTS.landscapes),
  nature: wikimedia('Wikimedia Commons: nature', LISTS.nature),
  space: wikimedia('Wikimedia Commons: space', LISTS.space),
  architecture: wikimedia('Wikimedia Commons: architecture', LISTS.architecture),
};

const allowed = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && HOSTS.has(u.hostname) && !u.username && !u.password; } catch { return false; } };

/** `request(url)` must return `{ status, headers, bytes }` for ONE hop and never follow redirects itself (the app gives it an isolated,
 *  cookieless session); this module follows at most three redirects, each to an allow-listed host. */
function createRemoteArtwork({ root, request, prepare, thumbnail, now = () => Date.now() }) {
  const directory = path.resolve(root, 'artwork-remote');
  const inflight = new Map();

  async function get(url, limit) {
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!allowed(target)) throw Error('Refused: this address is not an allowed picture source.');
      await prepare?.();
      const reply = await request(target);
      if ([301, 302, 303, 307, 308].includes(reply.status)) { target = new URL(reply.headers?.location || '', target).href; continue; }
      if (reply.status !== 200) throw Error('The picture source did not answer.');
      if (reply.bytes.length > limit) throw Error('The picture is too large.');
      return reply.bytes;
    }
    throw Error('Too many redirects.');
  }
  const ensureDir = () => fs.mkdirSync(directory, { recursive: true });

  async function list(collection) {
    const spec = COLLECTIONS[collection];
    if (!spec) throw Error('Unknown collection.');
    ensureDir();
    const file = path.join(directory, collection + '.json');
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    if (cached && Array.isArray(cached.items) && cached.items.length && now() - cached.fetchedAt < DAY) return cached.items;
    try {
      const items = [];
      for (const url of spec.listUrls()) items.push(...spec.parse(JSON.parse((await get(url, 2 * 1024 * 1024)).toString('utf8'))));
      const usable = items.filter((item) => item && item.title && allowed(item.imageUrl));
      if (usable.length) { fs.writeFileSync(file + '.tmp', JSON.stringify({ fetchedAt: now(), items: usable })); fs.renameSync(file + '.tmp', file); return usable; }
    } catch (error) { if (!cached?.items?.length) throw error; }
    return cached.items;
  }

  function trim() {
    const files = fs.readdirSync(directory).filter((name) => FILE.test(name)).map((name) => ({ name, ...fs.statSync(path.join(directory, name)) })).sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) { if (total <= MAX_CACHE_BYTES) break; fs.unlinkSync(path.join(directory, file.name)); total -= file.size; }
  }

  async function image(item) {
    const base = hash(item.imageUrl);
    for (const ext of ['jpg', 'png']) { const cached = path.join(directory, `${base}.${ext}`); if (fs.existsSync(cached)) { fs.utimesSync(cached, new Date(), new Date()); return `${base}.${ext}`; } }
    const bytes = await get(item.imageUrl, MAX_INPUT_BYTES), info = artworkImageInfo(bytes);
    const name = `${base}.${info.mime === 'image/png' ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(directory, name), bytes);
    trim();
    // The picker's tile is a small copy made before the picture is handed on, so its first frame never decodes the full-size file.
    try { thumbnail?.(name); } catch { /* the tile falls back to the full picture */ }
    return name;
  }

  /** One picture, stable for this seed and exclusion while the list is unchanged. Manual choices exclude the previous image. */
  async function pick(collection, seed, excludeId) {
    ensureDir();
    const key = collection + '|' + seed + '|' + (excludeId || '');
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const listed = await list(collection);
      const alternatives = excludeId ? listed.filter(item => `${collection}:${hash(item.imageUrl, 12)}` !== excludeId) : listed;
      const items = alternatives.length ? alternatives : listed;
      let at = parseInt(hash(String(seed), 8), 16) % items.length, lastError;
      for (let tries = 0; tries < Math.min(3, items.length); tries++, at = (at + 1) % items.length) {
        const item = items[at];
        try { const name = await image(item); return { id: `${collection}:${hash(item.imageUrl, 12)}`, src: `acira-browser-ui://ui/artwork-remote/${name}`, name: item.title, artist: item.artist, date: item.date, license: item.license, credit: item.credit, source: item.source, collection }; } catch (error) { lastError = error; }
      }
      throw lastError || Error('No picture is available.');
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  /** The bytes of a cached picture for `acira-browser-ui://ui/artwork-remote/<file>`, or null. Never touches the network. */
  function response(url) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (url.hostname !== 'ui' || !FILE.test(name) || url.search || url.hash) return null;
    const target = path.join(directory, name);
    try { const stat = fs.lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES) return null; return { bytes: fs.readFileSync(target), mime: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }; } catch { return null; }
  }
  return { list, pick, response, collections: () => Object.entries(COLLECTIONS).map(([id, spec]) => ({ id, label: spec.label, host: spec.host })) };
}

/** The real transport: Electron's net on an isolated in-memory session. No cookies, no Referer, one generic User-Agent, no redirects. */
function electronRequest(session, userAgent = 'Acira') {
  return async (url) => {
    const response = await session.fetch(url, { credentials: 'omit', redirect: 'manual', referrerPolicy: 'no-referrer', headers: { 'User-Agent': userAgent, Accept: 'application/json,image/*' }, signal: AbortSignal.timeout(15000) });
    const headers = {};
    response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    return { status: response.status, headers, bytes: Buffer.from(await response.arrayBuffer()) };
  };
}

/** The picture fetches must leave by the same route as the profile's own pages. `status()` is the profile's proxy status
 *  ({ choice, applied, error }); `toNative(choice)` is Electron's proxy config for it. The picture session follows the choice and closes
 *  its old connections when it changes. If the route is unconfirmed, or is Tor, nothing is fetched (the built-in paintings stay). */
function followProfileProxy({ session, status, toNative }) {
  let last = null;
  return async () => {
    const state = status();
    if (!state || state.error || state.applied === false || state.busy) throw Error('This profile’s connection is not confirmed, so no picture is fetched.');
    const mode = state.choice?.mode;
    if (mode !== 'system' && mode !== 'direct' && mode !== 'fixed_servers') throw Error('This connection type uses the built-in paintings only.');
    const key = JSON.stringify(state.choice);
    if (key === last) return;
    await session.setProxy(toNative(state.choice));
    await session.closeAllConnections();
    last = key;
  };
}

module.exports = { createRemoteArtwork, electronRequest, followProfileProxy, HOSTS, COLLECTIONS };
