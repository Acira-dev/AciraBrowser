import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// The new tab's artwork caption is English. In an Arabic interface the line inherited right-to-left, so when it did not fit (200%
// page zoom, a small window) the ellipsis took its start: "…t Field with Cypresses". Each line now takes its direction from its own
// words and stays on the interface's side.
const page = fs.readFileSync(new URL('../src/features/newtab/NewTabPage.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles/new-tab-page.css', import.meta.url), 'utf8');

test('the caption lines take their direction from their words and their side from the interface', () => {
  assert.match(page, /<span className="nt-credit-title" dir="auto"><bdi>\{title\}<\/bdi><\/span>/);
  assert.match(page, /<span className="nt-credit-meta" dir="auto">/);
  assert.match(css, /html\[dir='rtl'\] :is\(\.nt-credit-title, \.nt-credit-meta\) \{ text-align: right; \}/);
});
