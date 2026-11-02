// Two test paths glued together ("a.test.cjstests/b.test.cjs") silently drop both files from the run: every path in
// package.json "testSuites" must name a file that exists, once, in one suite.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('every test file named in the test suites exists (no glued names, no duplicates)', () => {
  assert.deepStrictEqual(Object.keys(pkg.testSuites).sort(), ['node', 'serial', 'tsx'], 'the suites scripts/run-tests.mjs runs');
  const all = Object.values(pkg.testSuites).flat();
  const named = all.filter((token) => !token.includes('*'));
  const glued = named.filter((token) => /\.(?:cjs|mjs|ts)tests\//.test(token) || /\s/.test(token));
  const missing = named.filter((token) => !fs.existsSync(path.join(root, token)));
  const twice = named.filter((token, i) => named.indexOf(token) !== i);
  assert.deepStrictEqual(glued, [], 'glued test paths');
  assert.deepStrictEqual(missing, [], 'test paths that do not exist');
  assert.deepStrictEqual(twice, [], 'test paths listed twice');
  // .ts tests import without extensions, which only tsx resolves.
  assert.deepStrictEqual([...pkg.testSuites.node, ...pkg.testSuites.serial].filter((f) => f.endsWith('.ts')), [], '.ts tests belong in the tsx suite');
});
