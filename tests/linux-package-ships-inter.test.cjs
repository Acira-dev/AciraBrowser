'use strict';
// 13.5 · Linux report: the profile letter looked off-centre. Before blaming the font's metrics, the first question is whether Inter is in
// the AppImage and reachable at all. Everything the interface draws is served from <app.asar>/dist by the acira-browser-ui protocol,
// and Inter is declared once with an absolute URL, so what has to hold is: electron-builder's file list for Linux includes the font
// and its licence and nothing excludes them, the font stays inside the asar (only native modules are unpacked), the source of the
// copy exists, and the protocol handler resolves /fonts/... to dist/fonts/... and lets the page load fonts from itself.
// (On a Linux machine the packaged app can also be asked directly; see the Linux laptop step in the 13.5 notes.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { minimatch } = require('minimatch');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const config = require('../packaging/electron-builder-linux.cjs');

const SHIPPED = ['dist/fonts/InterVariable.woff2', 'dist/fonts/inter-LICENSE.txt', 'dist/index.html'];

test('the Linux package includes Inter and its licence, and no exclusion catches them', () => {
  const patterns = config.files;
  assert.ok(Array.isArray(patterns) && patterns.length, 'the Linux build has a file list');
  const includes = patterns.filter(pattern => !pattern.startsWith('!')), excludes = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
  for (const file of SHIPPED) {
    assert.ok(includes.some(pattern => minimatch(file, pattern, { dot: true })), `${file} is included by ${includes.join(' | ')}`);
    const caught = excludes.filter(pattern => minimatch(file, pattern, { dot: true }));
    assert.deepEqual(caught, [], `${file} is not excluded`);
  }
});

test('the font stays inside the asar: only native modules are unpacked', () => {
  assert.equal(config.asar, true);
  assert.deepEqual(config.asarUnpack, ['**/*.node']);
  assert.ok(!minimatch('dist/fonts/InterVariable.woff2', '**/*.node', { dot: true }));
});

test('the font exists in the source that the build copies into dist, and the build copies it', () => {
  assert.ok(fs.statSync(path.join(root, 'public/fonts/InterVariable.woff2')).size > 100000, 'public/fonts/InterVariable.woff2 is the real file');
  assert.doesNotMatch(read('vite.config.ts'), /publicDir\s*:\s*false|copyPublicDir\s*:\s*false/, 'vite copies public/ into dist/');
});

test('the interface asks for /fonts/InterVariable.woff2 and the protocol handler serves it from dist, to a page whose CSP allows fonts from itself', () => {
  assert.match(read('src/fonts.css'), /@font-face\{font-family:'Inter';[^}]*src:url\('\/fonts\/InterVariable\.woff2'\) format\('woff2'\)/);
  const main = read('desktop/main.cjs');
  assert.ok(main.includes("protocol.handle('acira-browser-ui'"), 'the handler exists');
  assert.ok(main.includes("path.resolve(dist,'.'+decodeURIComponent(url.pathname))"), '/fonts/x resolves to dist/fonts/x');
  assert.ok(main.includes("font-src 'self'"), "fonts load from the page's own origin");
});
