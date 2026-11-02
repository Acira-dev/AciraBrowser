'use strict';
// The messages for a bookmark file over its size or count limit, and a hidden-sources list over 100 domains, had no space before the
// number ("more than50000", "the16MB", "up to100"): the person reads them in Settings when an import or a list is refused.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { parseBookmarkHTML } = require('../desktop/browser-services/bookmark-exchange.cjs');
const { normalizeDomains } = require('../desktop/browser-services/optional-filtering.cjs');

test('refusals name their limits with a space before the number', () => {
  assert.throws(() => parseBookmarkHTML('x'.repeat(16 * 1024 * 1024 + 1)), /exceeds the 16MB import limit/);
  const links = '<DL>' + '<DT><A HREF="https://example.com/">a</A>'.repeat(50001) + '</DL>';
  assert.throws(() => parseBookmarkHTML(links), /more than 50000 entries/);
  assert.throws(() => normalizeDomains(Array.from({ length: 101 }, (_, i) => `d${i}.example`)), /up to 100 source domains/);
  const importer = fs.readFileSync('desktop/imports.cjs', 'utf8');
  assert.match(importer, /more than 50000 bookmark entries/);
  assert.match(importer, /exceeds the 16MB import limit/);
  assert.doesNotMatch(importer, /(?:than|the|to)\d{2,}/);
});
