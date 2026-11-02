'use strict';
// Firefox (and Zen, which keeps Firefox's profile format; Helium's add-zen-importer patch reads both the same way).
// Profiles are listed in profiles.ini; bookmarks and history live in places.sqlite, site icons in favicons.sqlite. Both
// databases are read from a private snapshot copy (import-snapshot.cjs), so this works while Firefox is open.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { readDatabase } = require('./import-snapshot.cjs');

/** [browser, folder holding profiles.ini] for this platform. */
function firefoxRoots(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [['Firefox', path.join(roaming, 'Mozilla', 'Firefox')], ['Zen', path.join(roaming, 'zen')]];
  }
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [['Firefox', path.join(base, 'Firefox')], ['Zen', path.join(base, 'zen')]];
  }
  return [['Firefox', path.join(home, '.mozilla', 'firefox')], ['Zen', path.join(home, '.zen')]];
}

/** profiles.ini sections as [{name, location, isDefault}]. Install sections name the profile Firefox opens by default. */
function readProfiles(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8');
  } catch {
    return [];
  }
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line);
    if (header) {
      current = { section: header[1], values: {} };
      sections.push(current);
      continue;
    }
    const pair = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (pair && current) current.values[pair[1]] = pair[2];
  }
  const installDefaults = new Set(sections.filter((s) => /^Install/i.test(s.section) && s.values.Default).map((s) => s.values.Default));
  const profiles = [];
  for (const { section, values } of sections) {
    if (!/^Profile\d+$/i.test(section) || !values.Path) continue;
    const relative = values.IsRelative !== '0';
    const location = relative ? path.join(root, ...values.Path.split(/[\\/]/)) : values.Path;
    profiles.push({ name: values.Name || path.basename(location), location, isDefault: installDefaults.has(values.Path) || values.Default === '1' });
  }
  return profiles;
}

/** "default-release" and friends read as "Default"; anything a person named stays as they named it. */
const displayName = (name) => (/^default(-release|-esr|-nightly|-beta|-dev-edition)?$/i.test(name) ? 'Default' : name);

/** The Firefox Account email shown under the profile, when the person is signed in (local file, never sent anywhere). */
function accountEmail(location) {
  try {
    const signed = JSON.parse(fs.readFileSync(path.join(location, 'signedInUser.json'), 'utf8'));
    const email = signed?.accountData?.email;
    return typeof email === 'string' && email.length <= 254 ? email : undefined;
  } catch {
    return undefined;
  }
}

const webURL = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

// Firefox's fixed roots by guid, named so the toolbar lands on Acira's bookmarks bar (core.ts finds it by this title).
const ROOTS = [
  ['toolbar_____', 'bookmark_bar', 'Bookmarks bar'],
  ['menu________', 'menu', 'Bookmarks menu'],
  ['unfiled_____', 'other', 'Other bookmarks'],
  ['mobile______', 'mobile', 'Mobile bookmarks'],
];

/** places.sqlite bookmarks as a Chromium Bookmarks object ({roots:{key:{name, children}}}) for the shared importer.
 *  Separators, smart folders (place: queries) and non-web addresses are left out. */
function bookmarksFrom(database) {
  const rows = database
    .prepare('SELECT b.id, b.type, b.parent, b.position, b.title, b.guid, b.dateAdded, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
    .all();
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent).push(row);
  }
  const visit = (id, depth = 0) =>
    depth > 64
      ? []
      : (children.get(id) || []).flatMap((row) => {
          if (row.type === 1) {
            const url = webURL(row.url);
            return url ? [{ type: 'url', name: String(row.title || new URL(url).hostname).slice(0, 2048), url, guid: 'firefox-' + row.guid }] : [];
          }
          if (row.type === 2) return [{ type: 'folder', name: String(row.title || 'Folder').slice(0, 2048), guid: 'firefox-' + row.guid, children: visit(row.id, depth + 1) }];
          return [];
        });
  const roots = {};
  for (const [guid, key, name] of ROOTS) {
    const root = rows.find((row) => row.guid === guid);
    if (!root) continue;
    const items = visit(root.id);
    if (items.length) roots[key] = { name, children: items };
  }
  return { roots };
}

function readBookmarks(location) {
  return readDatabase(location, 'places.sqlite', bookmarksFrom);
}

/** Visited pages, newest first: [{url, title, time (ms)}]. Firefox stores microseconds since 1970. `skipped.notWeb` (optional) counts the rows left out as not web pages. */
function readHistory(location, limit = 50000, skipped = null) {
  return readDatabase(location, 'places.sqlite', (database) => {
    const query = database.prepare('SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?');
    query.setReadBigInts(true);
    return query.all(limit).flatMap((row) => {
      const url = webURL(row.url);
      if (!url && skipped) skipped.notWeb++;
      return url ? [{ url, title: row.title ? String(row.title) : '', time: Number(row.last_visit_date / 1000n) }] : [];
    });
  });
}

function countHistory(location) {
  return readDatabase(location, 'places.sqlite', (database) => Number(database.prepare('SELECT count(*) AS count FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0').get().count));
}

/** The best small icon for each site among `urls`, as {host: Buffer} (PNG or ICO bytes, 16–64px, at most 64 KB each).
 *  favicons.sqlite maps pages to icons; one icon per host is enough for bookmark and history rows. */
function readFavicons(location, urls, limit = 2000) {
  if (!fs.existsSync(path.join(location, 'favicons.sqlite'))) return new Map();
  const wanted = new Set();
  for (const value of urls) {
    try {
      wanted.add(new URL(value).hostname);
    } catch {}
    if (wanted.size >= limit) break;
  }
  return readDatabase(location, 'favicons.sqlite', (database) => {
    const rows = database
      .prepare(
        'SELECT p.page_url AS page, i.width AS width, i.data AS data FROM moz_pages_w_icons p JOIN moz_icons_to_pages ip ON ip.page_id = p.id JOIN moz_icons i ON i.id = ip.icon_id WHERE i.data IS NOT NULL AND i.width BETWEEN 16 AND 64',
      )
      .all();
    const best = new Map();
    for (const row of rows) {
      let hostname;
      try {
        hostname = new URL(row.page).hostname;
      } catch {
        continue;
      }
      if (!wanted.has(hostname) || !row.data || row.data.length > 65536) continue;
      const previous = best.get(hostname);
      // Prefer 32px (crisp at 16px on a 2x screen), then the nearest size.
      const score = Math.abs(row.width - 32);
      if (!previous || score < previous.score) best.set(hostname, { score, data: Buffer.from(row.data) });
    }
    return new Map([...best].map(([hostname, value]) => [hostname, value.data]));
  });
}

module.exports = { firefoxRoots, readProfiles, displayName, accountEmail, bookmarksFrom, readBookmarks, readHistory, countHistory, readFavicons };
