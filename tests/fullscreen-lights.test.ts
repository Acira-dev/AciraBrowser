import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

// macOS fullscreen has no title strip any more (it is kept invisible so it never covers the tab row), so the window has no close and no way out of fullscreen
// unless Acira draws its own lights where the real ones stand in a window. Founder, 2 Nov.

test('Fullscreen lights: a red close button, a dimmed minimise that is not a button, and a green button that leaves fullscreen; drawn on a Mac in a fullscreen window only', async () => {
  const { Lights } = await import('../src/ui/FullscreenLights');
  const html = renderToStaticMarkup(createElement(Lights, { tabId: 'a' }));
  assert.match(html, /^<div class="fs-lights">/);
  assert.match(html, /<button[^>]*fs-light-close[^>]*tabindex="-1"[^>]*aria-label="Close window"/);
  assert.match(html, /<span class="fs-light fs-light-min" aria-hidden="true">/, 'the yellow one is not a button: macOS dims it in fullscreen');
  assert.match(html, /<button[^>]*fs-light-zoom[^>]*tabindex="-1"[^>]*aria-label="Full screen"/);
  assert.equal((html.match(/<button/g) || []).length, 2);
  const source = read('src/ui/FullscreenLights.tsx');
  assert.match(source, /return fullscreen && isMac\(\) \? <Lights tabId=\{tabId\}\/> : null;/, 'only in a fullscreen window, only on a Mac (Windows has its own caption buttons)');
  assert.match(source, /type: 'window-control', tabId, action/);
});

test('Fullscreen lights: placed as the real ones are (14pt, 9pt apart, 12pt from the left, centred in the 36 or 32 row), in points whatever the interface scale, and gone with Seamless\'s top bar', () => {
  const css = read('src/styles/fullscreen-lights.css');
  assert.match(css, /--pt: calc\(1px \/ var\(--interface-scale, 1\)\);/);
  assert.match(css, /left: calc\(12 \* var\(--pt\)\); top: calc\(\(var\(--lights-row\) - 14 \* var\(--pt\)\) \/ 2\);/);
  assert.match(css, /gap: calc\(9 \* var\(--pt\)\);/);
  assert.match(css, /width: calc\(14 \* var\(--pt\)\); height: calc\(14 \* var\(--pt\)\);/);
  assert.match(css, /--lights-row: 36px;/);
  assert.match(css, /\.app:has\(\.browser-shell:is\(\[data-layout=compact\], \[data-layout=focus\]\)\) > \.fs-lights \{ --lights-row: 32px; \}/);
  assert.match(css, /\.app:has\(\.browser-shell\[data-seamless=hidden\]\) > \.fs-lights \{ display: none; \}/);
  assert.match(css, /html\[data-platform=darwin\] \.fs-lights \{ display: flex; \}/);
  assert.match(css, /\.fs-lights:hover \.fs-light svg \{ opacity: 1; \}/, 'all the glyphs show while the pointer is over the group, as macOS does');
  assert.match(css, /html\[data-window-active=false\][^{]*\.fs-lights:not\(:hover\)/, 'grey while the window is not the active one');
  assert.match(read('src/allStyles.ts'), /import '\.\/styles\/fullscreen-lights\.css';/);
  const root = read('desktop/platform.cjs');
  assert.match(root, /trafficLightPosition:\{x:12,y:12\}/, 'the real lights\' corner, which these copy');
  assert.match(root, /setWindowButtonPosition\(\{x:12,y:Math\.max\(4,Math\.round\(\(caption\.height-14\)\/2\)\)\}\)/, '14pt frames centred in the row');
});

test('Fullscreen lights: mounted by the main browser view only, with the active tab, and the command is validated and done by main', () => {
  const app = read('src/App.tsx');
  assert.match(app, /\{view!=='overlay'&&<FullscreenLights tabId=\{state\.activeTabId\}\/>\}/);
  const { validateCommand } = require('../desktop/validation.cjs');
  assert.deepEqual(validateCommand({ type: 'window-control', tabId: 'a', action: 'close' }, null), { type: 'window-control', tabId: 'a', action: 'close' });
  assert.deepEqual(validateCommand({ type: 'window-control', tabId: 'a', action: 'exit-fullscreen' }, null), { type: 'window-control', tabId: 'a', action: 'exit-fullscreen' });
  assert.throws(() => validateCommand({ type: 'window-control', tabId: 'a', action: 'minimize' }, null));
  assert.throws(() => validateCommand({ type: 'window-control', tabId: 'a', action: 'close', extra: 1 }, null));
  assert.throws(() => validateCommand({ type: 'window-control', action: 'close' }, null), 'a command names a tab like every other');
  const main = read('desktop/main.cjs');
  assert.match(main, /if\(c\.type==='window-control'\)\{[^}]*if\(!mainWindow\|\|mainWindow\.isDestroyed\(\)\)return;if\(c\.action==='close'\)mainWindow\.close\(\);else if\(c\.action==='exit-fullscreen'&&mainWindow\.isFullScreen\(\)\)mainWindow\.setFullScreen\(false\);return;\}/);
});
