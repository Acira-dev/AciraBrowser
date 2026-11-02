'use strict';
/** On-device thumbnails for the cover picker's grid.
 *
 *  A tile in the picker is about 200 CSS px wide, but the built-in paintings are 2560 px originals and the open collections 3840 px:
 *  ten of them decode, upload and scale for the first frames of the popup. A 480 px JPEG is made here, once, cached in userData and
 *  served from there; until it exists the original is served, so a tile never waits and nothing is shipped twice (artwork-renditions.cjs
 *  does the same for the framed new tab). Built-in paintings are made one at a time in the background, the whole catalogue after the
 *  first request; a collection picture is made as soon as its file has been saved. The cache is bounded and every file is verified. */
const fs = require('node:fs');
const path = require('node:path');
const { artworkImageInfo } = require('./artwork-image.cjs');

const WIDTH = 480;
const QUALITY = 74;
const MAX_CACHE_BYTES = 12 * 1024 * 1024;
const BUILT_IN = /^[a-z][a-z0-9-]{1,40}$/;
const REMOTE_FILE = /^[A-Za-z0-9_.-]{1,160}\.(?:jpg|jpeg|png)$/;
const IMAGE_HEADERS = { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' };

/** `encode(bytes)` turns original image bytes into thumbnail bytes (injectable so tests need no Electron). */
function createArtworkThumbs({ root, dist, remoteDirectory, nativeImage, encode, delay = 60, warmGap = 120, schedule = (task, ms) => setTimeout(task, ms).unref?.() }) {
  const cache = path.resolve(root, 'artwork-thumbs');
  const originals = path.resolve(dist, 'artwork', 'catalog-v2');
  const remote = path.resolve(remoteDirectory);
  const pending = new Set();
  let queue = Promise.resolve(), warmed = false;
  const resize = encode || ((bytes) => {
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (!size.width || size.width <= WIDTH) return null;
    return image.resize({ width: WIDTH, quality: 'good' }).toJPEG(QUALITY);
  });

  /** `built-in/<id>` or `remote/<file>` → the original's path, or null. */
  const originalPath = (key) => {
    const [kind, name] = key.split('/');
    if (kind === 'built-in' && BUILT_IN.test(name)) {
      const file = path.resolve(originals, `${name}.jpg`);
      return file.startsWith(originals + path.sep) && fs.existsSync(file) ? file : null;
    }
    if (kind === 'remote' && REMOTE_FILE.test(name)) {
      const file = path.resolve(remote, name);
      try { const stat = fs.lstatSync(file); return file.startsWith(remote + path.sep) && stat.isFile() && !stat.isSymbolicLink() ? file : null; } catch { return null; }
    }
    return null;
  };
  /** The key includes the original's size, so a changed picture never serves a stale thumbnail. */
  const cachePath = (key, original) => path.join(cache, `${key.replace('/', '-')}-${fs.statSync(original).size}-${WIDTH}q${QUALITY}.jpg`);
  const valid = (bytes) => {
    try {
      const info = artworkImageInfo(bytes);
      return info.mime === 'image/jpeg' && info.width <= WIDTH;
    } catch {
      return false;
    }
  };
  const cached = (key, original) => {
    try {
      const file = cachePath(key, original);
      const bytes = fs.readFileSync(file);
      if (valid(bytes)) {
        try { fs.utimesSync(file, new Date(), new Date()); } catch { /* recency is best effort */ }
        return bytes;
      }
      fs.rmSync(file, { force: true });
    } catch { /* not made yet */ }
    return null;
  };
  /** Least recently used thumbnails go first, so the cache never grows past its bound. */
  const prune = () => {
    try {
      const files = fs.readdirSync(cache).map((name) => ({ file: path.join(cache, name), stat: fs.statSync(path.join(cache, name)) })).filter((item) => item.stat.isFile());
      let total = files.reduce((sum, item) => sum + item.stat.size, 0);
      for (const item of files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
        if (total <= MAX_CACHE_BYTES) break;
        fs.rmSync(item.file, { force: true });
        total -= item.stat.size;
      }
    } catch { /* an unreadable cache is rebuilt on demand */ }
  };
  const make = (key) => {
    const original = originalPath(key);
    if (!original) return false;
    try {
      if (cached(key, original)) return true;
      const bytes = resize(fs.readFileSync(original));
      if (!bytes || !valid(bytes)) return false;
      fs.mkdirSync(cache, { recursive: true });
      const target = cachePath(key, original);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
      prune();
      return true;
    } catch {
      return false;
    }
  };
  /** One picture at a time (each costs the main process about 15 ms), a moment after it was asked for, so nothing runs while a popup is opening. */
  const ensure = (key, wait = delay) => {
    if (pending.has(key) || !originalPath(key)) return;
    pending.add(key);
    queue = queue.then(() => new Promise((resolve) => schedule(() => { try { make(key); } finally { pending.delete(key); resolve(); } }, wait)));
  };
  /** The first request for a built-in painting queues the whole catalogue, so the next time the picker opens every tile is small. */
  const warm = () => {
    if (warmed) return;
    warmed = true;
    try { for (const name of fs.readdirSync(originals)) if (name.endsWith('.jpg')) ensure(`built-in/${name.slice(0, -4)}`, warmGap); } catch { /* no catalogue, nothing to warm */ }
  };

  /** `acira-browser-ui://ui/artwork-t/<id>.jpg` (built-in) or `.../artwork-t/remote/<file>` (open collections): the thumbnail when it exists, otherwise the original while it is made. */
  function response(url) {
    const parts = url.pathname.split('/');
    if (url.hostname !== 'ui' || url.search || url.hash || parts[1] !== 'artwork-t') return null;
    let key = null;
    if (parts.length === 3) { const match = /^(.+)\.jpg$/.exec(parts[2]); if (match) key = `built-in/${match[1]}`; }
    else if (parts.length === 4 && parts[2] === 'remote') key = `remote/${decodeURIComponent(parts[3])}`;
    if (!key) return null;
    const original = originalPath(key);
    if (!original) return new Response('Image unavailable', { status: 404 });
    const bytes = cached(key, original);
    if (bytes) return new Response(bytes, { headers: { ...IMAGE_HEADERS, 'Cache-Control': 'public, max-age=86400' } });
    ensure(key);
    if (key.startsWith('built-in/')) warm();
    const mime = original.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new Response(fs.readFileSync(original), { headers: { ...IMAGE_HEADERS, 'Content-Type': mime, 'Cache-Control': 'no-store' } });
  }

  return { response, ensure, make, warm, cached: (key) => { const original = originalPath(key); return original ? cached(key, original) : null; }, pending: () => pending.size, drain: () => queue, cacheDirectory: cache };
}

module.exports = { createArtworkThumbs, THUMB_WIDTH: WIDTH, MAX_CACHE_BYTES };
