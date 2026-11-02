// R4-27: Settings search tolerates typos ("seemless", "compackt", "phising") when nothing matches as typed, and says what it searched for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SettingsContext, SettingsEntry } from '../src/features/settings/model';
import { correctQuery, editDistance, searchSettings, searchSettingsDetailed } from '../src/features/settings/search';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryDir = path.join(root, 'src/features/settings/entries');
const all: SettingsEntry[] = [];
for (const file of fs.readdirSync(entryDir).filter((name) => name.endsWith('.ts')).sort()) {
  all.push(...((await import(pathToFileURL(path.join(entryDir, file)).href)).default as SettingsEntry[]));
}
const context: SettingsContext = { customGlassColors: true, privateProfile: false, desktop: true, websiteOpen: true, appearanceChanged: true, toolbarChanged: true, newTabChanged: true, stockSearch: true };
const run = (query: string) => searchSettingsDetailed(all, query, context);
const ids = (query: string) => run(query).hits.map((hit) => hit.entry.id);

test('edit distance counts an insert, a delete, a substitution and a neighbour swap as one', () => {
  assert.equal(editDistance('seamless', 'seamless'), 0);
  assert.equal(editDistance('seemless', 'seamless'), 1);
  assert.equal(editDistance('compackt', 'compact'), 1);
  assert.equal(editDistance('focus', 'focuss'), 1);
  assert.equal(editDistance('window', 'windwo'), 1);
  assert.equal(editDistance('phising', 'phishing'), 1);
  assert.equal(editDistance('cookies', 'coockies'), 1);
  assert.ok(editDistance('seamless', 'tracker') > 2);
});

const misspellings: [typed: string, corrected: string, expectId: RegExp][] = [
  ['seemless', 'seamless', /^(window-view|seamless-edge)/],
  ['seamkess', 'seamless', /^(window-view|seamless-edge)/],
  ['compackt', 'compact', /^(window-view|compact|shortcut-compact-toolbar)/],
  ['worspace', 'workspace', /workspace/],
  ['phising', 'phishing', /^phishing/],
  ['coockies', 'cookies', /cookies/],
  ['windwo veiw', 'window view', /^window-view/],
];
for (const [typed, corrected, expectId] of misspellings) {
  test(`"${typed}" finds ${corrected}`, () => {
    const result = run(typed);
    assert.ok(result.corrected, `${typed} should be corrected`);
    assert.ok(result.corrected!.split(' ').some((word) => corrected.split(' ').includes(word)), `${typed} -> ${result.corrected}`);
    assert.ok(result.hits.length >= 1 && result.hits.length <= 3, `1 to 3 results, got ${result.hits.length}`);
    assert.ok(result.hits.some((hit) => expectId.test(hit.entry.id)), `${typed} -> ${ids(typed).join(', ')}`);
  });
}

test('"focuss" already finds Focus (a plural s), without a correction line', () => {
  const result = run('focuss');
  assert.ok(result.hits.some((hit) => /^(window-view|shortcut-focus)/.test(hit.entry.id)), ids('focuss').join(', '));
  assert.equal(result.corrected, undefined);
  const swapped = run('focsu');
  assert.equal(swapped.corrected, 'focus', 'a swapped "focsu" is corrected');
  assert.deepEqual(swapped.hits.map((hit) => hit.entry.id), ids('focus').slice(0, 3), 'and shows the closest three of the plain search');
});

test('a correction is used only when nothing matches as typed, and says nothing otherwise', () => {
  for (const exact of ['seamless', 'focus', 'cookies', 'compact', 'window view', 'workspace']) {
    const result = run(exact);
    assert.ok(result.hits.length > 0, exact);
    assert.equal(result.corrected, undefined, exact);
  }
  // Same hits as before for an exact word: the plain search is the detailed search.
  assert.deepEqual(searchSettings(all, 'cookies', context).map((hit) => hit.entry.id), ids('cookies'));
});

test('a correction shows the closest one to three, best first', () => {
  const result = run('seemless');
  assert.ok(result.hits.length <= 3);
  for (let i = 1; i < result.hits.length; i++) assert.ok(result.hits[i - 1].score >= result.hits[i].score);
});

test('short words are never guessed, and nonsense finds nothing', () => {
  assert.equal(correctQuery(all, 'cok'), undefined);
  assert.deepEqual(ids('cok'), []);
  assert.deepEqual(ids('qqzzxxvv'), []);
  assert.equal(run('qqzzxxvv').corrected, undefined);
});

test('a word of five letters or fewer gets one edit, a longer word two', () => {
  assert.ok(run('focsu').corrected, 'one swap in a five-letter word');
  assert.equal(correctQuery(all, 'fxcsu'), undefined, 'two edits in a five-letter word is too far');
  assert.ok(run('seamlses').corrected, 'one edit in a long word');
  assert.ok(correctQuery(all, 'saemlses'), 'two edits in a long word');
  assert.equal(correctQuery(all, 'sxemlxxs'), undefined, 'four edits is too far');
});

test('only the misspelled word of several is replaced', () => {
  assert.equal(correctQuery(all, 'window veiw'), 'window view');
});
