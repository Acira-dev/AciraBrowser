'use strict';
// Tab icons for the browser chrome. The chrome UI used to draw `<img src="https://site/favicon.ico">` itself, which loads outside the tab's session: no
// proxy, no blocking, no cookie partition, and the site learns when you have a tab open. Icons are now fetched through the tab's own session and handed to
// the UI as data URLs. Images only, bounded in size and time, cached by address.
const MAX_BYTES = 64 * 1024, MAX_CACHE = 400, TYPES = /^image\/(?:png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml|avif)$/;
function createTabIcons({ timeoutMs = 15000 } = {}) {
  const cache = new Map();
  /** A data URL for the icon, or '' when it cannot be had. Never throws. */
  async function fetchIcon(session, url) {
    if (!session || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
    // An in-memory session (private tab or window) has no storage path: its icons are fetched every time and never kept here after the page is gone.
    const keep = Boolean(session.storagePath), key = String(session.storagePath || session.partition || '') + '|' + url;
    if (keep && cache.has(key)) return cache.get(key);
    let result = '';
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await session.fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'follow' });
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (response.ok && TYPES.test(type)) { const body = Buffer.from(await response.arrayBuffer()); if (body.length && body.length <= MAX_BYTES) result = `data:${type};base64,${body.toString('base64')}`; }
      } finally { clearTimeout(timer); }
    } catch { result = ''; }
    if (keep) { cache.set(key, result); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
    return result;
  }
  return { fetchIcon, size: () => cache.size };
}
module.exports = { createTabIcons, MAX_BYTES };
