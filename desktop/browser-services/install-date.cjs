'use strict';
// When this copy of Acira was first run, as a local date: `<userData>/install.json` {"installedAt":"<ISO time>"}. It never leaves the computer; the only thing
// ever derived from it is a bucket of days (0 / 1 / 2-3 / 4-7 / 8-14 / 15-28 / 29+), used by the billboard's targeting (billboard.cjs) and, if the analytics
// session chooses, for its own day buckets. It does not depend on the usage-count switch: turning sharing off deletes metrics.json, not this.
// An install from before this file existed gets the best evidence there is: the oldest creation time among the files a first run makes (the browser
// database, the setup record), else now. Written once, then never changed.
const fs = require('node:fs'), path = require('node:path');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');

const FILE = 'install.json', DAY = 24 * 60 * 60 * 1000;
const EVIDENCE = ['browser.sqlite', 'browser-state.json', path.join('setup', 'onboarding.json'), 'window-state.json'];
const BUCKETS = Object.freeze(['0', '1', '2-3', '4-7', '8-14', '15-28', '29+']);

/** The bucket of a number of whole days since install. */
function dayBucket(days) {
  const n = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
  return n <= 1 ? String(n) : n <= 3 ? '2-3' : n <= 7 ? '4-7' : n <= 14 ? '8-14' : n <= 28 ? '15-28' : '29+';
}

/** installedAt in ms, creating `install.json` on first use. Never throws: a read-only folder just gives the estimate again next time. */
function installedAt({ directory, io = fs, now = Date.now } = {}) {
  const file = path.join(directory, FILE), at = now();
  const saved = readJsonFile(file, { fileSystem: io, now });
  const known = saved && Date.parse(saved.installedAt);
  if (Number.isFinite(known) && known > 0 && known <= at + DAY) return known;
  let oldest = Infinity;
  for (const name of EVIDENCE) {
    try { const stat = io.statSync(path.join(directory, name)); const born = stat.birthtimeMs > 0 ? stat.birthtimeMs : 0; if (born > 0 && born < oldest) oldest = born; } catch { /* not there */ }
  }
  const first = Number.isFinite(oldest) && oldest <= at ? oldest : at;
  try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(file, JSON.stringify({ installedAt: new Date(first).toISOString() }), { fileSystem: io }); } catch { /* the estimate is used again next time */ }
  return first;
}

/** Whole days between installedAt and now (UTC calendar days), never negative. */
function daysSinceInstall(installed, now = Date.now()) {
  if (!Number.isFinite(installed)) return null;
  const day = (time) => Math.floor(time / DAY);
  return Math.max(0, day(now) - day(installed));
}

module.exports = { installedAt, daysSinceInstall, dayBucket, BUCKETS, FILE };
