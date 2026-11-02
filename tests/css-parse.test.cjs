// Every stylesheet must parse. Vite only warns on an unclosed block, which silently nests every later rule into one
// selector (panels.css after a merge, 25 Oct), so the suite fails instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const root = path.join(__dirname, '..');
const sheets = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.css')) sheets.push(full);
  }
})(path.join(root, 'src'));

test('every stylesheet under src parses', () => {
  assert.ok(sheets.length > 10, 'found the stylesheets');
  const broken = [];
  for (const file of sheets) {
    try { postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }); }
    catch (error) { broken.push(`${path.relative(root, file)}: ${error.reason || error.message} (line ${error.line})`); }
  }
  assert.deepStrictEqual(broken, []);
});
