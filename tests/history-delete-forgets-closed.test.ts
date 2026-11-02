import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, forgetDeletedPages, reduceBrowser } from '../src/runtime/core';
import { HISTORY_LIMIT } from '../src/runtime/sessionState';
import type { BrowserAction, BrowserSnapshot, HistoryVisit } from '../src/runtime/types';

/** Founder (29 Oct): a page deleted from history must not come back through Ctrl+Shift+T. */
const run = (s: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, s);
const open = (s: BrowserSnapshot, url: string, privacy?: 'private' | 'tor') => {
  const before = new Set(s.tabs.map(t => t.id)), next = run(s, { type: 'tab.new', url, ...(privacy ? { privacy } : {}) });
  return { s: next, tab: next.tabs.find(t => !before.has(t.id))! };
};
const visit = (s: BrowserSnapshot, id: string, url: string, time: string): HistoryVisit => ({ id, url, title: url, time, profileId: s.activeProfileId, browserProfileId: s.activeBrowserProfileId });
const withHistory = (s: BrowserSnapshot, ...visits: HistoryVisit[]) => ({ ...s, browsingHistory: visits });

test('removing a page from history (address bar ×, History page) drops its closed tab; other closed tabs still reopen', () => {
  let s = createInitialState(); const a = open(s, 'https://a.test/'); s = a.s; const b = open(s, 'https://b.test/'); s = b.s;
  s = withHistory(s, visit(s, 'v-b', 'https://b.test/', '2026-10-29T10:01:00.000Z'), visit(s, 'v-a', 'https://a.test/', '2026-10-29T10:00:00.000Z'));
  s = run(s, { type: 'tab.close', id: a.tab.id }, { type: 'tab.close', id: b.tab.id });
  assert.equal(s.closedTabs.length, 2);
  s = run(s, { type: 'history.remove', id: 'v-b' });
  assert.deepEqual(s.closedTabs.map(t => t.url), ['https://a.test/'], 'b is gone from the closed tabs');
  assert.equal(s.toast?.text, 'Tab closed', 'the Undo toast counts only what is left');
  s = run(s, { type: 'tab.restore' });
  assert.ok(s.tabs.some(t => t.id === a.tab.id) && !s.tabs.some(t => t.id === b.tab.id), 'Ctrl+Shift+T reopens a, never b');
  // History page delete (by ids) does the same.
  let h = createInitialState(); const c = open(h, 'https://c.test/'); h = c.s;
  h = withHistory(h, visit(h, 'v-c', 'https://c.test/', '2026-10-29T10:00:00.000Z'));
  h = run(h, { type: 'tab.close', id: c.tab.id }, { type: 'history.delete', ids: ['v-c'] });
  assert.equal(h.closedTabs.length, 0); assert.equal(h.toast, null, 'nothing left to undo');
  assert.ok(!run(h, { type: 'tab.restore' }).tabs.some(t => t.url === 'https://c.test/'));
});

test('clearing all history forgets every closed tab of the profile; a ranged clear forgets only the pages it removed', () => {
  let s = createInitialState(); const a = open(s, 'https://a.test/'); s = a.s; const p = open(s, 'https://p.test/', 'private'); s = p.s;
  s = run(s, { type: 'tab.close', id: a.tab.id }, { type: 'tab.close', id: p.tab.id });
  assert.equal(s.closedTabs.length, 1); assert.equal(s.closedPrivateTabs?.length, 1);
  const cleared = run(s, { type: 'history.clear' });
  assert.equal(cleared.closedTabs.length, 0); assert.equal(cleared.closedPrivateTabs, undefined, 'private closed tabs of the profile go too');
  let r = createInitialState(); const old = open(r, 'https://old.test/'); r = old.s; const fresh = open(r, 'https://fresh.test/'); r = fresh.s;
  const now = Date.now();
  r = withHistory(r, visit(r, 'v-new', 'https://fresh.test/', new Date(now - 60_000).toISOString()), visit(r, 'v-old', 'https://old.test/', new Date(now - 3 * 86_400_000).toISOString()));
  r = run(r, { type: 'tab.close', id: old.tab.id }, { type: 'tab.close', id: fresh.tab.id }, { type: 'history.clear', since: now - 3_600_000 });
  assert.deepEqual(r.closedTabs.map(t => t.url), ['https://old.test/'], 'last hour cleared: only the page visited in it is forgotten');
});

test('a full history trimming its oldest visits (another window syncing) forgets nothing', () => {
  let s = createInitialState(); const a = open(s, 'https://a.test/'); s = a.s; s = run(s, { type: 'tab.close', id: a.tab.id });
  const base = Date.parse('2026-10-29T00:00:00.000Z');
  const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => visit(s, `v${i}`, `https://n${i}.test/`, new Date(base - i * 1000).toISOString()));
  const oldest = visit(s, 'v-a', 'https://a.test/', new Date(base - HISTORY_LIMIT * 1000).toISOString());
  const before = [...full.slice(1), oldest], next = { ...structuredClone(s), browsingHistory: full };
  assert.equal(forgetDeletedPages(next, before), false); assert.deepEqual(next.closedTabs.map(t => t.url), ['https://a.test/']);
  // A real deletion synced from another window does forget.
  const deleted = { ...structuredClone(s), browsingHistory: [] as HistoryVisit[] };
  assert.equal(forgetDeletedPages(deleted, [visit(s, 'v-a', 'https://a.test/', new Date(base).toISOString())]), true); assert.equal(deleted.closedTabs.length, 0);
});
