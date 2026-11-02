'use strict';
/** On-device renditions of the built-in paintings for the framed new tab.
 *
 *  The framed view shows a painting at 880 CSS px or less, but the catalog ships 2560 px originals (decoding and uploading
 *  one costs ~100 ms of frames on every new tab). Instead of shipping a second copy of every painting, the first time a
 *  painting is shown the 1760 px (2x) rendition is made here, cached in userData and served from there. Until it exists the
 *  original is served, so the page never waits. The cache is bounded and every file is verified before it is served. */
const fs = require('node:fs');
const path = require('node:path');
const { artworkImageInfo } = require('./artwork-image.cjs');

const WIDTH = 1760;
const QUALITY = 80;
const MAX_CACHE_BYTES = 20 * 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const IMAGE_HEADERS = { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' };

/** `encode(bytes)` turns original JPEG bytes into rendition bytes (injectable so tests need no Electron). */
function createArtworkRenditions({ root, dist, nativeImage, encode, delay = 1500, schedule = (task, ms) => setTimeout(task, ms).unref?.() }) {
  const cache = path.resolve(root, 'artwork-renditions');
  const originals = path.resolve(dist, 'artwork', 'catalog-v2');
  const pending = new Set();
  let queue = Promise.resolve();
  const resize = encode || ((bytes) => {
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (!size.width || size.width <= WIDTH) return null;
    return image.resize({ width: WIDTH, quality: 'best' }).toJPEG(QUALITY);
  });

  const originalPath = (id) => {
    if (!ID.test(id)) return null;
    const file = path.resolve(originals, `${id}.jpg`);
    return file.startsWith(originals + path.sep) && fs.existsSync(file) ? file : null;
  };
  /** The cache key includes the original's size, so a changed painting never serves a stale rendition. */
  const cachePath = (id, original) => path.join(cache, `${id}-${fs.statSync(original).size}-${WIDTH}q${QUALITY}.jpg`);
  const valid = (bytes) => {
    try {
      const info = artworkImageInfo(bytes);
      return info.mime === 'image/jpeg' && info.width <= WIDTH;
    } catch {
      return false;
    }
  };
  const cached = (id, original) => {
    try {
      const file = cachePath(id, original);
      const bytes = fs.readFileSync(file);
      if (valid(bytes)) {
        try { fs.utimesSync(file, new Date(), new Date()); } catch { /* recency is best effort */ }
        return bytes;
      }
      fs.rmSync(file, { force: true });
    } catch { /* not made yet */ }
    return null;
  };
  /** Least recently used renditions go first, so the cache never grows past its bound. */
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
  const make = (id) => {
    const original = originalPath(id);
    if (!original) return false;
    try {
      if (cached(id, original)) return true;
      const bytes = resize(fs.readFileSync(original));
      if (!bytes || !valid(bytes)) return false;
      fs.mkdirSync(cache, { recursive: true });
      const target = cachePath(id, original);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
      prune();
      return true;
    } catch {
      return false;
    }
  };
  /** One painting at a time, a moment after it was asked for, so nothing runs while a page is opening. */
  const ensure = (id) => {
    if (pending.has(id) || !originalPath(id)) return;
    pending.add(id);
    queue = queue.then(() => new Promise((resolve) => schedule(() => { try { make(id); } finally { pending.delete(id); resolve(); } }, delay)));
  };

  /** `acira-browser-ui://ui/artwork-r/<id>.jpg`: the rendition when it exists, otherwise the original while it is made. */
  function response(url) {
    const parts = url.pathname.split('/');
    const match = parts.length === 3 && parts[1] === 'artwork-r' && /^(.+)\.jpg$/.exec(parts[2]);
    if (url.hostname !== 'ui' || !match || url.search || url.hash) return null;
    const id = match[1];
    const original = originalPath(id);
    if (!original) return new Response('Image unavailable', { status: 404 });
    const bytes = cached(id, original);
    if (bytes) return new Response(bytes, { headers: { ...IMAGE_HEADERS, 'Cache-Control': 'public, max-age=86400' } });
    ensure(id);
    return new Response(fs.readFileSync(original), { headers: { ...IMAGE_HEADERS, 'Cache-Control': 'no-store' } });
  }

  return { response, ensure, make, cached: (id) => { const original = originalPath(id); return original ? cached(id, original) : null; }, pending: () => pending.size, drain: () => queue, cacheDirectory: cache };
}

module.exports = { createArtworkRenditions, RENDITION_WIDTH: WIDTH, MAX_CACHE_BYTES };
