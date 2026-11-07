'use strict';
// Tab icons for the browser chrome. The chrome UI used to draw `<img src="https://site/favicon.ico">` itself, which loads outside the tab's session: no
// proxy, no blocking, no cookie partition, and the site learns when you have a tab open. Icons are now fetched through the tab's own session and handed to
// the UI as data URLs. Images only, bounded in size and time, cached by address.
//
// Which icon: a page declares several (sizes, an .ico, an SVG), so resolveIcon asks icon-pick for the few files worth fetching for the biggest place an
// icon is drawn, measures each real file (icon-image: the true pixel size, the best picture of an .ico), and keeps the first that is sharp enough.
// Only files the page itself declares are fetched, with the same plain request as before (no cookies), and at most MAX_TRIES per page.
const { normalizeIcon, sideOf } = require('./icon-image.cjs');
const { plan, candidatesFrom, needFor, readPageLinks } = require('./icon-pick.cjs');
// The most an icon file may weigh on the wire (a multi-size .ico with a 256 px picture is about 30 KB); what is kept is cut down by icon-image.
const MAX_BYTES = 256 * 1024, MAX_CACHE = 400, TYPES = /^(?:image\/(?:png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml|avif)|(?:application|binary)\/octet-stream)?$/;
function createTabIcons({ timeoutMs = 15000, nativeImage = null } = {}) {
  const cache = new Map();
  /** The icon file at `url` made ready ({type, bytes, data (a data: URL), width, height, vector}), or null when it cannot be had. Never throws. */
  async function fetchImage(session, url, need = needFor(2)) {
    if (!session || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    // An in-memory session (private tab or window) has no storage path: its icons are fetched every time and never kept here after the page is gone.
    const keep = Boolean(session.storagePath), key = String(session.storagePath || session.partition || '') + '|' + need + '|' + url;
    if (keep && cache.has(key)) return cache.get(key);
    let result = null;
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await session.fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'follow' });
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (response.ok && TYPES.test(type)) {
          const body = Buffer.from(await response.arrayBuffer());
          if (body.length && body.length <= MAX_BYTES) result = normalizeIcon({ bytes: body, need, nativeImage });
        }
      } finally { clearTimeout(timer); }
    } catch { result = null; }
    if (keep) { cache.set(key, result); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
    return result;
  }
  /** A data URL for the icon, or '' when it cannot be had. Never throws. */
  async function fetchIcon(session, url) { return (await fetchImage(session, url))?.data || ''; }
  /** The best icon this page declares, for a place `need` device pixels wide: {url, data, bytes, type, width, height, vector}, or null when it has none.
   *  `announced` is the engine's list of icon addresses, `links` the page's own `<link>` tags (icon-pick.readPageLinks) or null when unreadable. */
  async function resolveIcon(session, { announced = [], links = null, pageUrl = '', need = needFor(2) } = {}) {
    let best = null;
    for (const candidate of plan(candidatesFrom({ links, announced, pageUrl }), need)) {
      if (best && !candidate.vector && candidate.px && candidate.px <= sideOf(best)) continue; // it says it is no bigger than what we have
      const found = await fetchImage(session, candidate.url, need);
      if (!found) continue;
      const icon = { url: candidate.url, ...found };
      if (icon.vector || sideOf(icon) >= need) return icon;
      if (!best || sideOf(icon) > sideOf(best)) best = icon;
    }
    return best;
  }
  /** resolveIcon for a page in a tab, given the tab's webContents: reads the page's `<link>` tags (a local read in an isolated world) and calls
   *  `deliver(icon|null)` with the answer. A page whose renderer is too busy to answer within `quickMs` (a heavy page is still loading) gets the best
   *  of the engine's own list at once and, if its tags then show a better icon, a second call: the tab never waits for the page. `current()` says
   *  whether the answer is still wanted (the tab may have moved on). Never throws. */
  async function resolvePageIcon(contents, { announced = [], pageUrl = '', need = needFor(2), deliver, current = () => true, quickMs = 300, readLinks = readPageLinks } = {}) {
    try {
      const session = contents.session, reading = readLinks(contents, { timeoutMs: 4000 });
      let timer;
      const early = await Promise.race([reading, new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), quickMs); })]);
      clearTimeout(timer);
      if (early !== undefined) { const found = await resolveIcon(session, { announced, links: early, pageUrl, need }); if (current()) deliver(found); return; }
      const first = await resolveIcon(session, { announced, links: null, pageUrl, need });
      if (!current()) return;
      deliver(first);
      const links = await reading;
      if (!links || !current()) return;
      const better = await resolveIcon(session, { announced, links, pageUrl, need });
      if (current() && better && (!first || better.url !== first.url)) deliver(better);
    } catch { /* the tab keeps the icon it has */ }
  }
  return { fetchIcon, fetchImage, resolveIcon, resolvePageIcon, size: () => cache.size };
}
module.exports = { createTabIcons, MAX_BYTES };
