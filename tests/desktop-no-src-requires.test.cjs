'use strict';
// 31 Oct: a desktop file loaded ../src/ui/internalPages.json. The installed app ships no src/, so it never opened, and every check run from the repo passed.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const desktop = path.join(__dirname, '..', 'desktop');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name === 'chromium-api' || entry.name === 'node_modules' ? [] : entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.cjs') ? [path.join(dir, entry.name)] : []);
test('nothing in desktop/ loads a file from src/, which the installed app does not ship', () => {
  const bad = [];
  for (const file of files(desktop)) {
    if (path.basename(file) === 'runtime.cjs' || path.basename(file) === 'i18n.cjs') continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!match[1].startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), match[1]);
      if (target.startsWith(path.join(__dirname, '..', 'src') + path.sep)) bad.push(path.relative(desktop, file) + ' -> ' + match[1]);
    }
  }
  assert.deepEqual(bad, []);
});
