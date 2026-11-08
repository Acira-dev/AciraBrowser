'use strict';
// Live pull requests (item 31): the rows a source hands over and which of them the folder shows.
const test = require('node:test'), assert = require('node:assert/strict');
const model = require('../desktop/live-prs/model.cjs');

const NOW = Date.parse('2026-11-07T12:00:00Z');
const row = (number, extra = {}) => ({ url: `https://github.com/acme/app/pull/${number}`, title: 'PR ' + number, state: 'open', updatedAt: NOW - number * 60e3, relations: ['author'], ...extra });
const view = (rows, filters = {}, options = {}) => model.visibleRows(model.mergeRows([rows]), model.normalizeFilters(filters), { now: NOW, ...options }).map((item) => item.number);

test('a new folder starts with created, review, assigned and drafts on, mentioned and recent off, every repository', () => {
  assert.deepEqual(model.defaultFilters(), { author: true, review: true, assigned: true, mentioned: false, drafts: true, recent: false, repos: null });
});

test('filters from storage or the interface: unknown keys and wrong types fall back, repositories are checked and capped', () => {
  const filters = model.normalizeFilters({ author: 'yes', mentioned: true, drafts: false, nope: 1, repos: ['acme/app', 'acme/app', 'bad repo', '../x', 'a/b/c', 7, 'o/r.js'] });
  assert.equal(filters.author, true, 'a string is not a switch');
  assert.equal(filters.mentioned, true); assert.equal(filters.drafts, false);
  assert.equal('nope' in filters, false);
  assert.deepEqual(filters.repos, ['acme/app', 'o/r.js']);
  assert.equal(model.normalizeFilters({ repos: Array.from({ length: 80 }, (_, i) => `o/r${i}`) }).repos.length, 40);
  assert.equal(model.normalizeFilters(null).repos, null);
  assert.equal(model.normalizeFilters([]).author, true);
});

test('the relations a source is asked for are the switched-on ones', () => {
  assert.deepEqual(model.relationsWanted(model.defaultFilters()), ['author', 'review', 'assigned']);
  assert.deepEqual(model.relationsWanted(model.normalizeFilters({ author: false, review: false, assigned: false })), []);
});

test('only github.com pull request addresses are rows; the address is rebuilt, never passed on as given', () => {
  assert.equal(model.pullUrl('https://github.com/acme/app/pull/12'), 'https://github.com/acme/app/pull/12');
  assert.equal(model.pullUrl('https://github.com/acme/app/pull/12/files?x=1#y'), null, 'a sub-page is not the pull request');
  assert.equal(model.pullUrl('https://github.com/acme/app/pull/12/'), 'https://github.com/acme/app/pull/12');
  for (const bad of ['http://github.com/a/b/pull/1', 'https://evil.example/a/b/pull/1', 'https://github.com.evil.example/a/b/pull/1', 'https://user@github.com/a/b/pull/1', 'https://github.com/a/b/issues/1', 'javascript:alert(1)', 'https://github.com/a/b/pull/x', '', null, undefined, 5])
    assert.equal(model.pullUrl(bad), null, String(bad));
  assert.equal(model.normalizeRow({ url: 'https://evil.example/a/b/pull/1', title: 'x' }), null);
  assert.equal(model.normalizeRow(null), null);
});

test('a row: id, repo and number come from the address; state, draft and review are only true when the pull request is open', () => {
  const merged = model.normalizeRow({ url: 'https://github.com/acme/app/pull/9', title: 'Done', state: 'closed', merged: true, draft: true, reviewRequested: true, updatedAt: 5 });
  assert.equal(merged.id, 'acme/app#9'); assert.equal(merged.repo, 'acme/app'); assert.equal(merged.number, 9);
  assert.equal(merged.state, 'merged'); assert.equal(merged.draft, false); assert.equal(merged.reviewRequested, false);
  const open = model.normalizeRow({ url: 'https://github.com/acme/app/pull/10', title: 'T', draft: true, reviewRequested: true, relations: ['review', 'review', 'bogus', 'recent'] });
  assert.equal(open.state, 'open'); assert.equal(open.draft, true); assert.equal(open.reviewRequested, true);
  assert.deepEqual(open.relations, ['review', 'recent']);
  assert.equal(open.updatedAt, 0, 'unknown time stays 0');
});

test('titles are one plain line: highlight tags and entities removed, newlines and control characters flattened, long ones cut', () => {
  assert.equal(model.plainTitle('Fix <em>sidebar</em> &amp; tabs &lt;b&gt;'), 'Fix sidebar & tabs <b>');
  assert.equal(model.plainTitle('a\nb\u0007c d'), 'a b c d');
  assert.equal(model.plainTitle('x'.repeat(500)).length, 200);
  assert.equal(model.normalizeRow({ url: 'https://github.com/a/b/pull/1', title: '  ' }).title, 'a/b#1', 'an empty title shows the pull request itself');
});

test('a pull request found by two queries is one row with both reasons, review-requested if either copy was, and the newer copy\'s facts', () => {
  const merged = model.mergeRows([[row(1, { relations: ['author'], updatedAt: 100, title: 'Old' })], [row(1, { relations: ['review'], reviewRequested: true, updatedAt: 300, title: 'New', draft: true })], [row(2)]]);
  assert.equal(merged.length, 2);
  const one = merged.find((item) => item.number === 1);
  assert.deepEqual(one.relations, ['author', 'review']); assert.equal(one.reviewRequested, true); assert.equal(one.title, 'New'); assert.equal(one.updatedAt, 300); assert.equal(one.draft, true);
});

test('relations that are switched off drop their rows; a row that has several reasons stays while one is on', () => {
  const rows = [row(1, { relations: ['author'] }), row(2, { relations: ['review'], reviewRequested: true }), row(3, { relations: ['assigned'] }), row(4, { relations: ['mentioned'] }), row(5, { relations: ['author', 'mentioned'] })];
  assert.deepEqual(view(rows).sort(), [1, 2, 3, 5], 'mentioned is off by default');
  assert.deepEqual(view(rows, { mentioned: true }).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(view(rows, { author: false }).sort(), [2, 3], 'five is author and mentioned: with both off nothing is left to show it');
  assert.deepEqual(view(rows, { author: false, mentioned: true }).sort(), [2, 3, 4, 5]);
  assert.deepEqual(view(rows, { review: false, assigned: false }).sort(), [1, 5]);
});

test('a row with no known reason (a source that cannot tell) is shown', () => {
  assert.deepEqual(view([row(1, { relations: [] })], { author: false, review: false, assigned: false }), [1]);
});

test('drafts can be left out, and the repository list limits the folder to those repositories', () => {
  const rows = [row(1, { draft: true }), row(2), row(3, { url: 'https://github.com/other/lib/pull/3' })];
  assert.deepEqual(view(rows, { drafts: false }), [2, 3]);
  assert.deepEqual(view(rows, { repos: ['acme/app'] }), [1, 2]);
  assert.deepEqual(view(rows, { repos: [] }), [], 'an empty list shows nothing; null shows every repository');
  assert.deepEqual(view(rows, { repos: null }).sort(), [1, 2, 3]);
});

test('merged and closed ones appear only with "Recently merged or closed", and only for a day; open ones come first', () => {
  const day = 24 * 3600 * 1000;
  const rows = [row(1, { state: 'merged', relations: ['recent'], updatedAt: NOW - 1000 }), row(2, { state: 'closed', relations: ['recent'], updatedAt: NOW - day - 1000 }), row(3, { updatedAt: NOW - 3 * day }), row(4, { state: 'merged', relations: ['recent'], updatedAt: 0 })];
  assert.deepEqual(view(rows), [3], 'off: only the open one');
  assert.deepEqual(view(rows, { recent: true }), [3, 1, 4], 'on: open first, then the ones from the last day (a time we do not know counts as lately)');
});

test('a row the person hid stays hidden until it changes (a new update or a new state), and only the listed ones are pruned away', () => {
  const rows = [row(1, { updatedAt: 100 }), row(2, { updatedAt: 100 })];
  const hidden = { 'acme/app#1': { updatedAt: 100, state: 'open' } };
  assert.deepEqual(view(rows, {}, { hidden }), [2]);
  assert.deepEqual(view([row(1, { updatedAt: 101 }), row(2)], {}, { hidden }).sort(), [1, 2], 'it was updated');
  const hiddenNow = { 'acme/app#1': { updatedAt: NOW, state: 'open' } };
  assert.deepEqual(view([row(1, { updatedAt: NOW }), row(2)], {}, { hidden: hiddenNow }), [2]);
  assert.deepEqual(view([row(1, { updatedAt: NOW, state: 'merged' }), row(2)], { recent: true }, { hidden: hiddenNow }).sort(), [1, 2], 'its state changed');
  assert.deepEqual(Object.keys(model.pruneHidden({ ...hidden, 'acme/app#9': { updatedAt: 1, state: 'open' } }, model.mergeRows([rows]))), ['acme/app#1']);
});

test('the list is newest first and capped; ties are stable', () => {
  const rows = Array.from({ length: 70 }, (_, i) => row(i + 1, { updatedAt: NOW - i * 1000 }));
  const shown = model.visibleRows(model.mergeRows([rows]), model.defaultFilters(), { now: NOW });
  assert.equal(shown.length, 60); assert.equal(shown[0].number, 1); assert.equal(shown[1].number, 2);
});

test('the Repositories list holds every repository seen, plus chosen ones nothing matches today, sorted', () => {
  const rows = model.mergeRows([[row(1), row(2, { url: 'https://github.com/zed/z/pull/2' })]]);
  assert.deepEqual(model.repositoriesOf(rows, model.normalizeFilters({ repos: ['acme/old'] })), ['acme/app', 'acme/old', 'zed/z']);
});

test('the folder name is one trimmed line and falls back to Pull requests', () => {
  assert.equal(model.folderName('  Reviews\nnow '), 'Reviews now'); assert.equal(model.folderName(''), 'Pull requests'); assert.equal(model.folderName(null), 'Pull requests');
  assert.equal(model.folderName('x'.repeat(100)).length, 64);
});

test('a change from the interface: right-typed keys apply, a wrong type or an unknown key leaves the value as it is', () => {
  const before = model.normalizeFilters({ drafts: false, repos: ['acme/app'] });
  const next = model.patchFilters(before, { mentioned: true, drafts: 'yes', nope: 1, author: null });
  assert.equal(next.mentioned, true); assert.equal(next.drafts, false); assert.equal(next.author, true); assert.deepEqual(next.repos, ['acme/app']);
  assert.equal(model.patchFilters(before, { repos: null }).repos, null); assert.deepEqual(model.patchFilters(before, { repos: ['x/y', 'bad'] }).repos, ['x/y']);
  assert.deepEqual(model.patchFilters(before, 'nothing'), before); assert.deepEqual(model.patchFilters(before, [1]), before);
});
