import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Settings folds its nav to a 52px icon rail in a narrow pane (settings.css, container width up to 620px) and hides each label
// (`.bs-back > span`). "Back to browser" was a bare text node, so from 541 to 620px (200% page zoom in a large window, a half-screen
// window) it wrapped into the rail as "Zurüc / zum / Brows", cut at the bottom; only below 540px a font-size:0 rule hid it.
const source = fs.readFileSync(new URL('../src/features/BrowserSettings.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/features/settings/settings.css', import.meta.url), 'utf8');

test('the back label is a span the rail hides, and the button keeps its name', () => {
  const button = source.slice(source.indexOf('className="bs-back"'), source.indexOf('</button>', source.indexOf('className="bs-back"')));
  assert.match(button, /aria-label=\{tr\("browsersettings\.backToBrowser"\)\}/);
  assert.match(button, /<span>\{tr\("browsersettings\.backToBrowser"\)\}<\/span>/);
  assert.match(css, /\.bs-sidebar :is\(\.bs-brand > span:last-child, nav > button > span:not\(\.bs-nav-icon, \.brand-logo\), \.bs-back > span\) \{ position: absolute; width: 1px;/);
});
