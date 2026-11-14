'use strict';
// 13.8 (smoothness): a filter-list update no longer holds the main thread. On 13.8 ba6910ed the swap after a download read and validated every list, expanded every
// filter of the new engine just to count them (getFilters) and wrote two ~10 MB cache files with writeFileSync + fsync, all on main: ~150 ms on an M5 (Chromium trace
// + main-process CPU profile), ~20 s after every start and every 4 hours, longer on a slow laptop. Now the worker counts the rules, the disk work is asynchronous and the
// validation takes one list per turn. These tests fail on 13.8: the cache files are written with writeFileSync, getFilters() runs on main, the worker sends no count.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {randomUUID} = require('node:crypto');
const {Worker} = require('node:worker_threads');
const {ElectronBlocker} = require('@ghostery/adblocker-electron');
const {createFilterUpdates, SOURCES} = require('../desktop/browser-services/filter-updates.cjs');

const text = (source, rule) => (source.hosts ? '! Title: Peter Lowe\n' : `! Title: ${source.match || source.title}\n`) + '! reviewed fixture padding\n'.repeat(55) + rule + '\n';
const scriptlets = () => JSON.stringify({scriptlets: Array.from({length: 60}, (_, i) => ({name: 'fixture-' + i + '.js', aliases: [], body: 'function fixture' + i + '(){/* ' + 'x'.repeat(150) + ' */}', dependencies: []})), redirects: []});
function fixture(extra = {}) {
  const root = path.resolve('.qa-profiles/services-unit/filter-off-main-' + randomUUID()), baseline = path.join(root, 'baseline');
  fs.mkdirSync(baseline, {recursive: true});
  for (const s of SOURCES) fs.writeFileSync(path.join(baseline, s.id), text(s, '||old.example^'));
  fs.writeFileSync(path.join(baseline, 'resources.json'), scriptlets());
  const state = {rule: '||new.example^'};
  const download = async url => { const s = SOURCES.find(x => x.url === url || (x.mirrors || []).includes(url)); return {status: 200, text: text(s, state.rule), etag: '"' + state.rule + '"'}; };
  // no engineFactory and no io: the production path (worker build, real fs)
  const options = {filtersPath: baseline, cachePath: path.join(root, 'cache'), download, ...extra};
  return {root, options, state, session: {isPersistent: () => true}, current: path.join(root, 'cache', 'current.json'), previous: path.join(root, 'cache', 'previous.json')};
}

test('the swap writes the list cache with asynchronous file calls, never writeFileSync on the main thread', async () => {
  const f = fixture(), service = createFilterUpdates(f.options);
  const syncWrites = [], asyncOpens = [], realWrite = fs.writeFileSync, realOpen = fs.promises.open;
  fs.writeFileSync = function (file, ...rest) { syncWrites.push(String(typeof file === 'number' ? 'fd' : file)); return realWrite.call(this, file, ...rest); };
  fs.promises.open = function (file, ...rest) { asyncOpens.push(String(file)); return realOpen.call(this, file, ...rest); };
  try { await service.refresh(f.session); } finally { fs.writeFileSync = realWrite; fs.promises.open = realOpen; }
  assert.equal(service.status().source, 'updated');
  assert.deepEqual(syncWrites.filter(file => file === 'fd' || /current\.json|previous\.json|engine\.bin/.test(file)), [], 'no synchronous cache write: ' + syncWrites.join(', '));
  assert.ok(asyncOpens.some(file => /current\.json\..*\.tmp$/.test(file)), 'current.json goes through a temporary file opened asynchronously');
  assert.ok(asyncOpens.some(file => /previous\.json\..*\.tmp$/.test(file)), 'previous.json too');
  const saved = JSON.parse(fs.readFileSync(f.current, 'utf8'));
  assert.ok(saved.lists.every(item => item.text.includes('||new.example^')), 'the new lists are on disk');
  // a restart reads what was written
  assert.equal(createFilterUpdates(f.options).status().source, 'cached');
});

test('the new engine is checked from the worker\'s rule count, without expanding every filter on the main thread', async () => {
  const proto = Object.getPrototypeOf(ElectronBlocker.parse('||a.example^'));
  const real = proto.getFilters; let calls = 0;
  const f = fixture({buildEngine: async listText => Object.assign(ElectronBlocker.parse(listText).serialize(), {rules: 8})});
  const service = createFilterUpdates(f.options);
  proto.getFilters = function (...args) { calls++; return real.apply(this, args); };
  try { await service.refresh(f.session); } finally { proto.getFilters = real; }
  assert.equal(service.status().source, 'updated');
  assert.equal(calls, 0, 'getFilters() did not run on the main thread during the swap');
  // a count of zero is refused exactly like an engine with no rules was
  const empty = fixture({buildEngine: async listText => Object.assign(ElectronBlocker.parse(listText).serialize(), {rules: 0})});
  const refused = createFilterUpdates(empty.options), before = refused.getEngine();
  await assert.rejects(refused.refresh(empty.session), /produced no usable rules/);
  assert.equal(refused.getEngine(), before, 'the running engine stays');
  // a builder that sends no count (an older worker) is still checked the old way
  calls = 0; const old = fixture({buildEngine: async listText => ElectronBlocker.parse(listText).serialize()});
  const legacy = createFilterUpdates(old.options);
  proto.getFilters = function (...args) { calls++; return real.apply(this, args); };
  try { await legacy.refresh(old.session); } finally { proto.getFilters = real; }
  assert.ok(calls >= 1, 'the fallback check ran');
});

test('the worker sends the number of rules with the engine bytes', async () => {
  const listText = '||one.example^\n||two.example^\nexample.com##.ad\n';
  const message = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'desktop', 'browser-services', 'filter-engine-worker.cjs'), {workerData: {text: listText, resources: '', checksum: 'x'}});
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.ok(message.bytes && message.bytes.byteLength > 0);
  assert.equal(message.rules, 3);
});

test('an asynchronous write that fails keeps the running engine and the last good cache', async () => {
  const f = fixture(), service = createFilterUpdates(f.options);
  await service.refresh(f.session);
  const engine = service.getEngine(), good = fs.readFileSync(f.current, 'utf8');
  f.state.rule = '||next.example^';
  const realRename = fs.promises.rename;
  fs.promises.rename = function (from, to, ...rest) { if (String(to).endsWith('current.json')) return Promise.reject(new Error('injected atomic rename failure')); return realRename.call(this, from, to, ...rest); };
  try { await assert.rejects(service.refresh(f.session), /rename/); } finally { fs.promises.rename = realRename; }
  assert.equal(service.getEngine(), engine, 'the running engine stays');
  assert.equal(fs.readFileSync(f.current, 'utf8'), good, 'current.json is the last good one');
  assert.deepEqual(fs.readdirSync(path.dirname(f.current)).filter(name => name.endsWith('.tmp')), [], 'no temporary file is left behind');
});
