'use strict';
// Builds resources/filters/engine.bin from the bundled filter lists, so a first run does not spend about a second parsing them.
//   node scripts/build-filter-engine.cjs [filters directory]              always build (release builds)
//   node scripts/build-filter-engine.cjs --if-stale [filters directory]   build only when missing or out of date (npm run build, launch.mjs)
// The file is the same compiled engine the browser caches in a profile, keyed by the list hashes, the resource file and the engine version:
// when any of those differ at run time the browser ignores it and parses the lists, so a stale file is slow, never wrong.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {createHash} = require('node:crypto');
const {createFilterUpdates, engineCacheKey, SOURCES} = require('../desktop/browser-services/filter-updates.cjs');
const defaultDirectory = path.join(__dirname, '..', 'resources', 'filters');

function buildFilterEngine(filtersPath) {
  const directory = path.resolve(filtersPath), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-engine-'));
  try {
    fs.rmSync(path.join(directory, 'engine.bin'), {force: true});
    createFilterUpdates({filtersPath: directory, cachePath: scratch});
    const built = path.join(scratch, 'engine.bin');
    if (!fs.existsSync(built)) throw new Error('The filter engine was not written');
    const target = path.join(directory, 'engine.bin');
    fs.copyFileSync(built, target);
    return {file: target, bytes: fs.statSync(target).size};
  } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
}

/** Whether engine.bin is there and carries the key the browser will compute for these lists (the same function). A few ms: it hashes the
 * lists and reads the file's header, it never loads the engine. */
function bundledEngineCurrent(filtersPath = defaultDirectory) {
  const directory = path.resolve(filtersPath);
  try {
    const raw = fs.readFileSync(path.join(directory, 'engine.bin')), length = raw.readUInt32LE(0);
    const {key} = JSON.parse(raw.subarray(4, 4 + length).toString('utf8'));
    const hashes = SOURCES.map(source => createHash('sha256').update(fs.readFileSync(path.join(directory, source.id), 'utf8')).digest('hex'));
    return key === engineCacheKey(directory, hashes);
  } catch { return false; }
}

/** Builds engine.bin only when it is missing or out of date. Returns null when it was already current. */
function ensureFilterEngine(filtersPath = defaultDirectory) {
  return bundledEngineCurrent(filtersPath) ? null : buildFilterEngine(filtersPath);
}

if (require.main === module) {
  const args = process.argv.slice(2), ifStale = args.includes('--if-stale'), directory = args.find(arg => !arg.startsWith('--')) || defaultDirectory;
  const started = Date.now(), result = ifStale ? ensureFilterEngine(directory) : buildFilterEngine(directory);
  console.log(result ? `${result.file}: ${(result.bytes / 1048576).toFixed(1)} MB in ${Date.now() - started} ms` : `${path.join(path.resolve(directory), 'engine.bin')} is current`);
}
module.exports = {buildFilterEngine, bundledEngineCurrent, ensureFilterEngine};
