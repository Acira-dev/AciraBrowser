// A merge must never ship with conflict markers. Many files are plain JS, CSS or JSON that only fail when loaded, so
// scan the source trees for marker lines directly.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'dist', 'release', '.qa-profiles', 'tor-engine']);
const textFile = /\.(c?js|mjs|tsx?|css|json|html)$/;
const marker = /^(<{7}|>{7}) |^={7}$/m;

function walk(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (textFile.test(entry.name) && marker.test(fs.readFileSync(full, 'utf8'))) found.push(path.relative(root, full));
  }
  return found;
}

test('no merge conflict markers in src, desktop, scripts or tests', () => {
  const found = ['src', 'desktop', 'scripts', 'tests'].flatMap(dir => walk(path.join(root, dir), []));
  assert.deepStrictEqual(found.filter(file => file !== path.join('tests', 'no-conflict-markers.test.cjs')), []);
});
