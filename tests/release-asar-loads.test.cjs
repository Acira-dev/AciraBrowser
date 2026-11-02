'use strict';
// qa/release-asar-loads.cjs is the release gate's "everything it loads is shipped" walker. It is only worth anything if it can fail:
// these tests pack small real asars and break them, the way r22 broke (a desktop file required a file the package does not ship).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const asar = require('@electron/asar');
const { checkAsar, selfTest } = require('../qa/release-asar-loads.cjs');

const APP = {
  'package.json': JSON.stringify({ name: 'mini', main: 'desktop/main.cjs' }),
  'desktop/main.cjs': [
    "const fs = require('node:fs'), path = require('path'), electron = require('electron');",
    "const helper = require('./helper.cjs');",
    "const data = require('./data.json');",
    "const dep = require('left-pad');",
    "const html = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');",
    "try { require('./optional.cjs'); } catch { /* absent is fine */ }",
    "// require('./only-in-a-comment.cjs')",
    "const sqlite = require('node:sqlite');",
  ].join('\n'),
  'desktop/helper.cjs': "module.exports = require('./sub/leaf.cjs');",
  'desktop/sub/leaf.cjs': 'module.exports = 1;',
  'desktop/data.json': '{}',
  'desktop/page.html': '<title>x</title>',
  'node_modules/left-pad/package.json': JSON.stringify({ name: 'left-pad', main: 'index.js' }),
  'node_modules/left-pad/index.js': 'module.exports = 1;',
};

async function pack(overrides = {}, removed = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-gate-test-')), tree = path.join(dir, 'app');
  for (const [rel, body] of Object.entries({ ...APP, ...overrides })) {
    if (removed.includes(rel)) continue;
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true }); fs.writeFileSync(path.join(tree, rel), body);
  }
  const out = path.join(dir, 'app.asar');
  await asar.createPackage(tree, out);
  return { out, dir };
}
const withAsar = async (overrides, removed, body) => { const { out, dir } = await pack(overrides, removed); try { return await body(out); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

test('a complete app is clean; comments, node: modules, electron and try/catch loads are not problems', () => withAsar({}, [], (out) => {
  const r = checkAsar(out);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.optional.map((p) => p.request), ['./optional.cjs']);
}));

test('a required desktop file missing from the asar is reported with the file that requires it', () => withAsar({}, ['desktop/sub/leaf.cjs'], (out) => {
  const r = checkAsar(out);
  assert.deepEqual(r.problems.map((p) => [p.file, p.request]), [['desktop/helper.cjs', './sub/leaf.cjs']]);
}));

test('the r22 case: a require that climbs out of desktop/ into a folder the package lacks is reported', () => withAsar({ 'desktop/helper.cjs': "module.exports = require('../src/ui/internalPages.json');" }, [], (out) => {
  const r = checkAsar(out);
  assert.deepEqual(r.problems.map((p) => p.request), ['../src/ui/internalPages.json']);
}));

test('a missing JSON file, a missing literal path.join(__dirname, ...) file and a missing package are all reported', () => withAsar({}, ['desktop/data.json', 'desktop/page.html', 'node_modules/left-pad/index.js', 'node_modules/left-pad/package.json'], (out) => {
  const r = checkAsar(out);
  assert.deepEqual(r.problems.map((p) => p.request).sort(), ['./data.json', 'left-pad', 'page.html']);
}));

test('a missing package.json main entry is reported', () => withAsar({ 'package.json': JSON.stringify({ name: 'mini', main: 'desktop/gone.cjs' }) }, [], (out) => {
  assert.ok(checkAsar(out).problems.some((p) => p.file === 'package.json'));
}));

test('selfTest breaks a copy of the asar and sees it; it says not-ok when nothing can be broken', async () => {
  await withAsar({}, [], async (out) => {
    const r = await selfTest(out);
    assert.equal(r.ok, true, r.detail);
    assert.equal(r.victim, 'desktop/sub/leaf.cjs');
  });
  await withAsar({ 'desktop/main.cjs': 'module.exports = 1;', 'desktop/helper.cjs': 'module.exports = 1;' }, [], async (out) => {
    assert.equal((await selfTest(out)).ok, false);
  });
});
