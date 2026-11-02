'use strict';
// Site icons from a Chromium profile's Favicons database (Chrome, Edge, Brave, Helium, Arc), read from a snapshot copy.
// icon_mapping ties a page to an icon; favicon_bitmaps holds the PNG at one or more sizes.
const fs = require('node:fs'), path = require('node:path');
const { readDatabase } = require('./import-snapshot.cjs');

/** {host: Buffer} for the hosts among `urls`, the bitmap nearest 32px each, at most 64 KB. */
function readChromiumFavicons(location, urls, limit = 2000) {
  if (!fs.existsSync(path.join(location, 'Favicons'))) return new Map();
  const wanted = new Set();
  for (const value of urls) {
    try {
      wanted.add(new URL(value).hostname);
    } catch {}
    if (wanted.size >= limit) break;
  }
  if (!wanted.size) return new Map();
  return readDatabase(location, 'Favicons', (database) => {
    const rows = database
      .prepare('SELECT m.page_url AS page, b.width AS width, b.image_data AS data FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id WHERE b.image_data IS NOT NULL AND b.width BETWEEN 16 AND 64')
      .all();
    const best = new Map();
    for (const row of rows) {
      let host;
      try {
        host = new URL(row.page).hostname;
      } catch {
        continue;
      }
      if (!wanted.has(host) || !row.data || row.data.length > 65536) continue;
      const score = Math.abs(row.width - 32), previous = best.get(host);
      if (!previous || score < previous.score) best.set(host, { score, data: Buffer.from(row.data) });
    }
    return new Map([...best].map(([host, value]) => [host, value.data]));
  });
}

module.exports = { readChromiumFavicons };
