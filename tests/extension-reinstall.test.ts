import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const { ExtensionReinstall } = await import('../src/features/import-export/ExtensionReinstall');

// The checklist after an import: only current-format extensions are offered, nothing starts chosen, the button stays off until the person picks one.
const found = [
  { id: 'a'.repeat(32), name: 'Panel Tool', version: '1.0', manifestVersion: 3 },
  { id: 'b'.repeat(32), name: 'Old Tool', version: '2.0', manifestVersion: 2 },
];

test('offers current-format extensions unchecked, with the add button disabled, and says older ones are not offered', () => {
  const html = renderToStaticMarkup(createElement(ExtensionReinstall, { profileId: 'p', found }));
  assert.match(html, /Panel Tool/);
  assert.doesNotMatch(html, /Old Tool/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Add extension<\/button>/);
  assert.match(html, /1 older-format extension is not offered/);
  assert.match(html, /review each one|You review each one/);
});

test('shows nothing but the older-format note when no current extension remains', () => {
  const html = renderToStaticMarkup(createElement(ExtensionReinstall, { profileId: 'p', found: [found[1]] }));
  assert.doesNotMatch(html, /checkbox/);
  assert.match(html, /older format/);
  assert.equal(renderToStaticMarkup(createElement(ExtensionReinstall, { profileId: 'p', found: [] })), '');
});
