import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

/** Ctrl+Shift+T (tab.restore) reopens exactly ONE tab: the newest close of any kind in this window. A batch comes back whole only from its Undo toast / Rewind (tab.restore.batch). */
const run = (s: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, s);
const open = (s: BrowserSnapshot, url: string, privacy?: 'private' | 'tor') => {
  const before = new Set(s.tabs.map(t => t.id)), next = run(s, { type: 'tab.new', url, ...(privacy ? { privacy } : {}) });
  return { s: next, tab: next.tabs.find(t => !before.has(t.id))! };
};
const ids = (s: BrowserSnapshot) => s.tabs.map(t => t.id);

test('closing three tabs at once: each Ctrl+Shift+T brings back one, newest first; the Undo toast still restores the rest as a batch', () => {
  let s = createInitialState(); const a = open(s, 'https://a.test/'); s = a.s; const b = open(s, 'https://b.test/'); s = b.s; const c = open(s, 'https://c.test/'); s = c.s;
  s = run(s, { type: 'tab.close', id: a.tab.id }, { type: 'tab.close', id: b.tab.id }, { type: 'tab.close', id: c.tab.id });
  assert.equal(s.closedTabs.length, 3); const batch = s.closedTabs[0].closedBatch!; assert.ok(s.closedTabs.every(t => t.closedBatch === batch), 'one batch');
  s = run(s, { type: 'tab.restore' });
  assert.deepEqual(s.tabs.filter(t => [a.tab.id, b.tab.id, c.tab.id].includes(t.id)).map(t => t.id), [c.tab.id], 'c, closed last, is the only one back');
  assert.equal(s.activeTabId, c.tab.id); assert.equal(s.closedTabs.length, 2);
  assert.match(s.toast!.text, /2/, 'the toast counts what is still closed');
  s = run(s, { type: 'tab.restore' });
  assert.ok(s.tabs.some(t => t.id === b.tab.id) && !s.tabs.some(t => t.id === a.tab.id), 'then b'); assert.equal(s.activeTabId, b.tab.id); assert.equal(s.toast?.text, 'Tab closed');
  s = run(s, { type: 'tab.restore' });
  assert.ok([a, b, c].every(x => s.tabs.some(t => t.id === x.tab.id))); assert.equal(s.activeTabId, a.tab.id); assert.equal(s.closedTabs.length, 0); assert.equal(s.toast, null, 'nothing left to undo');
  const quiet = run(s, { type: 'tab.restore' }); assert.deepEqual(ids(quiet), ids(s), 'a fourth press has nothing to reopen');
  // The toast's Undo (and so Rewind's restore) is still the whole batch.
  let again = createInitialState(); const x = open(again, 'https://x.test/'); again = x.s; const y = open(again, 'https://y.test/'); again = y.s;
  again = run(again, { type: 'tab.close', id: x.tab.id }, { type: 'tab.close', id: y.tab.id });
  again = run(again, again.toast!.action!.command as BrowserAction);
  assert.ok(again.tabs.some(t => t.id === x.tab.id) && again.tabs.some(t => t.id === y.tab.id), 'Undo brings both back'); assert.equal(again.closedTabs.length, 0);
});

test('a closed split pane comes back alone into its split at its slot', () => {
  let s = createInitialState(); const home = s.activeTabId; const b = open(s, 'https://b.test/'); s = b.s; const d = open(s, 'https://d.test/'); s = d.s;
  s = run(s, { type: 'split.open', tabIds: [home, d.tab.id] });
  assert.deepEqual(s.windowUi.split?.tabIds, [home, d.tab.id]);
  s = run(s, { type: 'tab.close', id: b.tab.id }, { type: 'tab.close', id: d.tab.id });
  assert.ok(!s.windowUi.split || !s.windowUi.split.tabIds.includes(d.tab.id));
  s = run(s, { type: 'tab.restore' });
  assert.ok(s.tabs.some(t => t.id === d.tab.id) && !s.tabs.some(t => t.id === b.tab.id), 'only the pane, not the other tab of the batch');
  assert.deepEqual(s.windowUi.splitGroups?.find(g => g.tabIds.includes(d.tab.id))?.tabIds, [home, d.tab.id], 'back in its split at its slot');
});

test('private and Tor tabs reopen as the same kind, interleaved with normal tabs, newest first', () => {
  let s = createInitialState(); const n = open(s, 'https://news.example/'); s = n.s; const p = open(s, 'https://private.example/', 'private'); s = p.s; const t = open(s, 'https://torsite.example/', 'tor'); s = t.s; const m = open(s, 'https://more.example/'); s = m.s;
  assert.equal(p.tab.privacy, 'private'); assert.equal(t.tab.privacy, 'tor');
  s = run(s, { type: 'tab.close', id: n.tab.id }, { type: 'tab.close', id: t.tab.id }, { type: 'tab.close', id: m.tab.id }, { type: 'tab.close', id: p.tab.id });
  assert.equal(s.closedTabs.length, 2, 'only the ordinary tabs are in the saved closed list'); assert.ok(s.closedTabs.every(c => !c.privacy));
  assert.ok(!JSON.stringify(s.closedTabs).includes('private.example') && !JSON.stringify(s.closedTabs).includes('torsite.example'));
  const order: Array<[string, 'private' | 'tor' | undefined]> = [[p.tab.id, 'private'], [m.tab.id, undefined], [t.tab.id, 'tor'], [n.tab.id, undefined]];
  for (const [id, privacy] of order) {
    const before = ids(s); s = run(s, { type: 'tab.restore' });
    const back = s.tabs.find(x => !before.includes(x.id))!;
    assert.equal(back.id, id); assert.equal(back.privacy, privacy, `${id} comes back as its own kind`); assert.equal(s.activeTabId, id);
    assert.equal(s.tabs.length, before.length + 1, 'exactly one tab');
  }
  assert.equal(s.closedPrivateTabs, undefined, 'nothing private is left in memory'); assert.equal(s.closedTabs.length, 0);
  assert.deepEqual(ids(run(s, { type: 'tab.restore' })), ids(s), 'a further press does nothing');
});

test('closing a private or Tor tab offers no Undo toast and writes nothing into saved state', () => {
  let s = createInitialState(); const p = open(s, 'https://secret-private.example/', 'private'); s = p.s; const t = open(s, 'https://secret-tor.example/', 'tor'); s = t.s;
  s = run(s, { type: 'tab.close', id: p.tab.id }, { type: 'tab.close', id: t.tab.id });
  assert.equal(s.toast, null); assert.equal(s.closedTabs.length, 0); assert.equal(s.closedPrivateTabs?.length, 2, 'kept in the window\'s memory');
  const saved = persistedSnapshot(s), text = JSON.stringify(saved);
  assert.ok(!('closedPrivateTabs' in saved) && !text.includes('secret-private') && !text.includes('secret-tor'), 'persistedSnapshot never carries them');
  const hand = JSON.parse(text); hand.closedPrivateTabs = s.closedPrivateTabs;
  const loaded = restoreSnapshot(hand);
  assert.equal(loaded.closedPrivateTabs, undefined, 'even a hand-edited file cannot bring one back'); assert.ok(!JSON.stringify(loaded).includes('secret-'));
  assert.deepEqual(ids(run(loaded, { type: 'tab.restore' })), ids(loaded), 'a restarted window has nothing private to reopen');
});

test('a private window\'s tabs are kept in that window\'s memory only; a normal window never sees them', () => {
  let priv = createInitialState(); priv.browserProfiles[0].private = true; priv.browserProfiles[0].partition = 'acira-private-window';
  const t = open(priv, 'https://incognito.example/'); priv = run(t.s, { type: 'tab.close', id: t.tab.id });
  assert.equal(priv.closedTabs.length, 0); assert.equal(priv.closedPrivateTabs?.length, 1);
  const normal = createInitialState(), normalAfter = run(normal, { type: 'tab.restore' });
  assert.deepEqual(ids(normalAfter), ids(normal), 'another window has its own state: nothing to reopen there');
  assert.ok(!JSON.stringify(normalAfter).includes('incognito.example'));
  const back = run(priv, { type: 'tab.restore' });
  assert.ok(back.tabs.some(x => x.id === t.tab.id && x.url === 'https://incognito.example/' && x.browserProfileId === t.tab.browserProfileId), 'back in the same private session');
  assert.ok(!('closedPrivateTabs' in persistedSnapshot(priv)));
});

test('a secured workspace\'s tab is not kept (it stays as before: its sealed session owns it)', () => {
  let s = createInitialState(); const x = open(s, 'https://vault.example/'); s = x.s;
  s = { ...s, tabs: s.tabs.map(t => t.id === x.tab.id ? { ...t, privacy: 'secured' as never } : t) };
  s = run(s, { type: 'tab.close', id: x.tab.id });
  assert.equal(s.closedTabs.length, 0); assert.equal(s.closedPrivateTabs, undefined);
});

test('a private tab whose profile was removed is not reopened', () => {
  let s = createInitialState(); const p = open(s, 'https://gone.example/', 'private'); s = run(p.s, { type: 'tab.close', id: p.tab.id });
  s.closedPrivateTabs![0].browserProfileId = 'profile-missing';
  const after = run(s, { type: 'tab.restore' });
  assert.ok(!after.tabs.some(t => t.id === p.tab.id)); assert.equal(after.closedPrivateTabs, undefined);
});
