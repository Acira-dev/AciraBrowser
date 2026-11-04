import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// The new tab's last shortcut tile ("All history" or "All bookmarks") has a 72px label (56px at 150% in a small window). Measured in
// the app on 3 Nov: English "All bookmarks" (75px) and the German, Spanish, French, Italian, Turkish, Russian and Korean labels, and
// Arabic "All bookmarks", ended in an ellipsis ("Gesamter V…", "Todo el hist…"). Those now use the word the language's own menu uses
// for the same page, as Portuguese, Japanese and Chinese already did; the labels that fitted are unchanged.
const catalog = (code: string) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;

test('a tile label that did not fit uses the menu word for the same page', () => {
  const history = ['es', 'fr', 'de', 'it', 'tr', 'ru', 'ko'], bookmarks = ['en', 'es', 'fr', 'de', 'it', 'ar', 'tr', 'ru'];
  for (const code of history) assert.equal(catalog(code)['nt.allHistory'], catalog(code)['browsermenu.history'], `${code}: history tile`);
  for (const code of bookmarks) assert.equal(catalog(code)['nt.allBookmarks'], catalog(code)['browsermenu.bookmarks'], `${code}: bookmarks tile`);
});

test('the labels that fitted are left as they were', () => {
  assert.equal(catalog('en')['nt.allHistory'], 'All history');
  assert.equal(catalog('hi')['nt.allHistory'], 'पूरा इतिहास');
  assert.equal(catalog('ko')['nt.allBookmarks'], '모든 북마크');
});
