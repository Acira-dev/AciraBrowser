import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Founder (28 Oct): the workspace title's tab count lines up with the New tab row's count — same type, same right edge
// (measured 0 px apart by qa/ws-count-align.mjs) — and the ⋯ button sits in the count's place instead of reserving its own.
test('the workspace count matches the New tab count and the more button overlays it', () => {
  const css = readFileSync(new URL('../src/styles/workspaces.css', import.meta.url), 'utf8');
  const count = css.match(/\.sb-ws-title-count \{[^}]*\}/)?.[0] ?? '';
  assert.match(count, /font: 450 var\(--text-12, 12px\)\/16px/);
  assert.match(count, /color: rgb\(var\(--ink\) \/ \.44\)/);
  assert.match(css, /\.sb-ws-title-more \{ position: absolute;/);
  assert.match(css, /\.sb-ws-title:is\(:hover, :focus-within\) \.sb-ws-title-count[^{]*\{ opacity: 0; \}/);
});
