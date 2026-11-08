import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Founder (28 Oct): the workspace title's tab count sat in the same type and place as the New tab row's count, and the ⋯ button sits in the count's place
// instead of reserving its own. The New tab row's count is gone in beta.14 (see below); the workspace count keeps its type.
test('the workspace count keeps its own quiet ink, the New tab row shows no count, and the more button overlays the workspace count', () => {
  const css = readFileSync(new URL('../src/styles/workspaces.css', import.meta.url), 'utf8');
  const count = css.match(/\.sb-ws-title-count \{[^}]*\}/)?.[0] ?? '';
  assert.match(count, /font: 450 var\(--text-12, 12px\)\/16px/);
  // beta.10 (contrast-2): both counts take the sidebar's quiet ink, one token, so they stay one colour (52% on light finishes, 44% on dark).
  assert.match(count, /color: var\(--sb-quiet, rgb\(var\(--ink\) \/ \.44\)\)/);
  // beta.14 (founder, 8 Nov): the New tab row no longer carries a count at rest (it read as a stray number); the row's label still says how many are open.
  const sidebar = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  const tsx = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(sidebar, /\.sb-new-end>small/);
  assert.doesNotMatch(tsx, /<span className="sb-new-end"[^>]*><small>/);
  assert.match(tsx, /<span className="sb-new-end" aria-hidden="true"><kbd>\{formatShortcut\('Ctrl T'\)\}<\/kbd>/, 'only the shortcut, shown on hover and keyboard focus');
  assert.match(tsx, /className="sb-new-tab"[\s\S]{0,400}?aria-label=\{t\("acirasidebar\.newTabCountOpen", \{ count: tabs\.length \}\)\}/, 'the count stays in the screen-reader label');
  assert.match(sidebar, /\.sb-new-tab:is\(:hover,:focus-visible\) \.sb-new-end>kbd\{opacity:1\}/);
  assert.match(css, /\.sb-ws-title-more \{ position: absolute;/);
  assert.match(css, /\.sb-ws-title:is\(:hover, :focus-within\) \.sb-ws-title-count[^{]*\{ opacity: 0; \}/);
});
