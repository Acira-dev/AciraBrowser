import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// R3-B08 (bug hunt): popupAnchor() finds a popup's trigger when the caller passes no rectangle. Its selectors named the
// controls by their English aria-label, so in every other language nothing matched and the popup opened at the default
// top-right spot instead of under its button (menu, page information, find, split, downloads, protection, appearance,
// extensions, bookmarks). Every anchored kind now has a language-independent class or data hook first.
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const table = source.match(/const selectors: Record<string, string> = \{([^}]*)\};/)?.[1] ?? '';
const entries = [...table.matchAll(/'?([a-z-]+)'?:\s*'([^']*)'/g)].map(m => ({ kind: m[1], selector: m[2] }));
const byKind = new Map(entries.map(e => [e.kind, e.selector]));
const hooks = /(^|,)(\.[a-z][\w-]*|\[data-[\w-]+(="[^"]*")?\])/;

test('every popup kind that is anchored to a labelled button names it by a class or data attribute, not only by its English label', () => {
  for (const kind of ['protection', 'menu', 'appearance', 'security', 'find', 'split', 'downloads', 'bookmarks', 'extensions', 'tabs']) {
    const selector = byKind.get(kind);
    assert.ok(selector, `${kind} has a selector`);
    assert.ok(selector.split(',').some(part => hooks.test(part.trim())), `${kind}: ${selector} needs a language-independent hook`);
  }
});

test('the fallback trigger is the menu button class, not its English label alone', () => {
  assert.match(source, /selectors\[kind\] \|\| '\.toolbar-menu-control,/);
});

test('the hooks exist on the buttons', () => {
  assert.match(source, /toolbar-menu-control/);
  assert.match(source, /className="[^"]*address-security/);
  assert.match(source, /data-toolbar-item=\{id\}/);
});
