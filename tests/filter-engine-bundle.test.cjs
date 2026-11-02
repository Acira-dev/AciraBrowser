'use strict';
// A first run has no filter cache. The installer ships resources/filters/engine.bin (scripts/build-filter-engine.cjs); it must be used
// while it matches the bundled lists and be ignored, silently, the moment anything differs.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto'), os = require('node:os'), path = require('node:path');
const {ElectronBlocker} = require('@ghostery/adblocker-electron');
const {createFilterUpdates} = require('../desktop/browser-services/filter-updates.cjs');
const {buildFilterEngine} = require('../scripts/build-filter-engine.cjs');

const repoFilters = path.join(__dirname, '../resources/filters');
const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const copyFilters = () => { const directory = temp('acira-filters-'); for (const name of fs.readdirSync(repoFilters)) if (name !== 'engine.bin') fs.copyFileSync(path.join(repoFilters, name), path.join(directory, name)); return directory; };
// counts how often the lists are really parsed
function countParses(work) {
  const original = ElectronBlocker.parse; let parses = 0;
  ElectronBlocker.parse = function (...args) { parses++; return original.apply(this, args); };
  try { return {result: work(), parses: () => parses}; } finally { ElectronBlocker.parse = original; }
}
const withCleanup = (directories, work) => { try { return work(); } finally { for (const directory of directories) fs.rmSync(directory, {recursive: true, force: true}); } };

// one build serves the tests that only read it
const built = copyFilters(); const info = buildFilterEngine(built);
test.after(() => fs.rmSync(built, {recursive: true, force: true}));

test('the build writes a compiled engine next to the lists', () => {
  assert.equal(info.file, path.join(built, 'engine.bin')); assert.ok(info.bytes > 1_000_000, 'a real engine, not an empty file: ' + info.bytes);
});

test('a first run with the shipped engine does not parse the lists', () => {
  const cache = temp('acira-cache-');
  withCleanup([cache], () => {
    const {result: updates, parses} = countParses(() => createFilterUpdates({filtersPath: built, cachePath: cache}));
    assert.equal(parses(), 0, 'the lists were not parsed');
    const engine = updates.getEngine(); assert.equal(typeof engine.onBeforeRequest, 'function');
    assert.ok(engine.getFilters().networkFilters.length > 10000, 'it carries the real rules');
    assert.equal(updates.status().source, 'bundled');
  });
});

test('the shipped engine blocks what a freshly parsed one blocks', () => {
  const cache = temp('acira-cache-'), parsedCache = temp('acira-cache-'), copy = copyFilters();
  withCleanup([cache, parsedCache, copy], () => {
    const shipped = createFilterUpdates({filtersPath: built, cachePath: cache}).getEngine();
    const parsed = createFilterUpdates({filtersPath: copy, cachePath: parsedCache}).getEngine(); // no engine.bin here: parses
    const { Request } = require('@ghostery/adblocker-electron');
    for (const url of ['https://doubleclick.net/ads/show.js', 'https://www.google-analytics.com/analytics.js', 'https://example.com/index.html']) {
      const request = Request.fromRawDetails({url, sourceUrl: 'https://news.example/', type: 'script'});
      assert.equal(!!shipped.match(request).match, !!parsed.match(request).match, url);
    }
    assert.equal(shipped.getFilters().networkFilters.length, parsed.getFilters().networkFilters.length);
  });
});

test('lists that differ from the ones it was built from: the engine is ignored and the lists are parsed', () => {
  const copy = copyFilters(), cache = temp('acira-cache-');
  withCleanup([copy, cache], () => {
    fs.copyFileSync(path.join(built, 'engine.bin'), path.join(copy, 'engine.bin'));
    fs.appendFileSync(path.join(copy, 'ubo-filters.txt'), '\n! a newer list\n||changed.example^\n');
    const {parses} = countParses(() => createFilterUpdates({filtersPath: copy, cachePath: cache}));
    assert.equal(parses(), 1, 'parsed once, then cached in the profile');
    assert.ok(fs.existsSync(path.join(cache, 'engine.bin')), 'and the profile cache was written');
  });
});

test('a different engine version or resource file, a damaged file or a truncated file are all ignored', () => {
  for (const damage of [
    file => { const raw = fs.readFileSync(file), length = raw.readUInt32LE(0), header = JSON.parse(raw.subarray(4, 4 + length).toString()); header.key = 'engine-from-another-version'; const text = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(4); prefix.writeUInt32LE(text.length); fs.writeFileSync(file, Buffer.concat([prefix, text, raw.subarray(4 + length)])); },
    file => fs.writeFileSync(file, crypto.randomBytes(5000)),
    file => fs.writeFileSync(file, fs.readFileSync(file).subarray(0, 3000)),
    file => fs.writeFileSync(file, Buffer.alloc(0)),
  ]) {
    const copy = copyFilters(), cache = temp('acira-cache-');
    withCleanup([copy, cache], () => {
      fs.copyFileSync(path.join(built, 'engine.bin'), path.join(copy, 'engine.bin')); damage(path.join(copy, 'engine.bin'));
      const {result: updates, parses} = countParses(() => createFilterUpdates({filtersPath: copy, cachePath: cache}));
      assert.equal(parses(), 1, 'fell back to parsing'); assert.equal(typeof updates.getEngine().onBeforeRequest, 'function');
    });
  }
});

test('without a shipped engine the lists are parsed as before', () => {
  const copy = copyFilters(), cache = temp('acira-cache-');
  withCleanup([copy, cache], () => { assert.equal(countParses(() => createFilterUpdates({filtersPath: copy, cachePath: cache})).parses(), 1); });
});

test('list updates still work: a new list set compiles from its own text, and the profile cache is used from then on', async () => {
  const cache = temp('acira-cache-');
  await withCleanup([cache], async () => {
    const {SOURCES} = require('../desktop/browser-services/filter-updates.cjs');
    const downloads = []; const download = async (url) => { downloads.push(url); const source = SOURCES.find(item => item.url === url); return fs.readFileSync(path.join(built, source.id), 'utf8') + '\n! updated ' + url.length + '\n||updated-rule.example^\n'; };
    const updates = createFilterUpdates({filtersPath: built, cachePath: cache, download});
    const session = {isPersistent: () => true};
    const before = fs.existsSync(path.join(cache, 'engine.bin'));
    await updates.refresh(session);
    assert.equal(downloads.length, SOURCES.length, 'every list, and nothing else (scriptlet code is never downloaded)'); assert.equal(updates.status().source, 'updated'); assert.equal(updates.status().scriptlets.source, 'bundled', 'the scriptlets stay the ones shipped with the build');
    assert.equal(before, false); assert.ok(fs.existsSync(path.join(cache, 'engine.bin')), 'the updated engine is cached in the profile');
    const again = countParses(() => createFilterUpdates({filtersPath: built, cachePath: cache, download}));
    assert.equal(again.parses(), 0, 'the next start loads the updated engine from the profile, not the shipped one and not by parsing');
    assert.equal(again.result.status().source, 'cached');
  });
});

// Source runs (npm run build, node launch.mjs, the founder demo) start like an installed build: the engine is built when it is missing or
// out of date, judged by the very key the browser computes, so a fresh profile from source never parses the lists on the main thread.
test('the staleness check uses the browser\'s own key: current right after a build, stale when a list changes or the file is gone', () => {
  const {bundledEngineCurrent, ensureFilterEngine} = require('../scripts/build-filter-engine.cjs');
  assert.equal(bundledEngineCurrent(built), true, 'a fresh build is current');
  assert.equal(ensureFilterEngine(built), null, 'and is not rebuilt');
  const copy = copyFilters();
  withCleanup([copy], () => {
    assert.equal(bundledEngineCurrent(copy), false, 'no engine.bin: stale');
    fs.copyFileSync(path.join(built, 'engine.bin'), path.join(copy, 'engine.bin'));
    assert.equal(bundledEngineCurrent(copy), true);
    fs.appendFileSync(path.join(copy, 'easylist.txt'), '\n||stale.example^\n');
    assert.equal(bundledEngineCurrent(copy), false, 'a changed list: stale');
  });
});

test('npm run build and launch.mjs build the engine when it is stale, as the release builds always do', () => {
  const root = path.join(__dirname, '..'), build = require('../package.json').scripts.build, launch = fs.readFileSync(path.join(root, 'launch.mjs'), 'utf8');
  assert.match(build, /&& node scripts\/build-filter-engine\.cjs --if-stale$/);
  assert.match(launch, /const \{ bundledEngineCurrent \} = require\('\.\/scripts\/build-filter-engine\.cjs'\);\s*if \(!bundledEngineCurrent\(\)\)/);
  assert.ok(launch.indexOf('bundledEngineCurrent()') < launch.indexOf("spawn(require('electron')"), 'before the browser starts');
});

test('the engine in this checkout, if one has been built, matches the bundled lists', { skip: !fs.existsSync(path.join(repoFilters, 'engine.bin')) && 'engine.bin is built at package time' }, () => {
  const cache = temp('acira-cache-');
  withCleanup([cache], () => assert.equal(countParses(() => createFilterUpdates({filtersPath: repoFilters, cachePath: cache})).parses(), 0, 'rebuild it: node scripts/build-filter-engine.cjs'));
});
