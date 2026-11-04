import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Back and Forward with no history are disabled (half opacity) but still lit up under the pointer: the generic icon-button hover
// rules in frost-preview.css had no :disabled guard (the navigation group's own rule in selection.css has one). The guard sits in
// :where() so no enabled button's rule changes weight against the .active and other rules after it.
const css = fs.readFileSync(new URL('../src/frost-preview.css', import.meta.url), 'utf8');

test('no generic icon-button hover rule reaches a disabled button', () => {
  const selectors = [...css.matchAll(/([^{}]*)\{[^}]*\}/g)].flatMap(match => match[1].split(',')).map(text => text.trim()).filter(text => /\.icon-button:hover/.test(text));
  assert.ok(selectors.length >= 3, 'the three hover rules are there');
  for (const selector of selectors) assert.match(selector, /\.icon-button:hover:where\(:not\(:disabled\)\)/, selector);
});
