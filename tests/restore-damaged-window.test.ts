import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { resolveLocale } from '../src/i18n/locales';

// 13.5 (hunt-e 5): a saved window with a null or wrong-typed entry in a list, or a tab whose address is not text, threw while it was read
// ("Cannot read properties of null", "input.trim is not a function") and Acira showed "A saved window could not be read" and quit. Such
// entries are dropped or coerced and every good tab is kept. Tabs that share an id (a buggy writer) are all kept too, each with its own id.
const good = () => {
  let s = createInitialState();
  for (const url of ['https://a.test/', 'https://b.test/', 'https://c.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  return JSON.parse(JSON.stringify(persistedSnapshot(s)));
};
const urls = (value: unknown) => restoreSnapshot(value).tabs.map(tab => tab.url);
const SITES = ['https://a.test/', 'https://b.test/', 'https://c.test/'];
const kept = (value: unknown) => { const list = urls(value); assert.ok(SITES.every(url => list.includes(url)), `every good tab is kept: ${list.join(' ')}`); return restoreSnapshot(value); };

test('a null or non-object entry inside any saved list is dropped, and every good tab is kept', () => {
  for (const list of ['tabs', 'tabGroups', 'bookmarkNodes', 'closedTabs']) for (const junk of [null, 7, 'x', true, [], undefined]) {
    const saved = good(); saved[list] = [junk, ...(saved[list] ?? []), junk];
    const restored = kept(saved);
    assert.ok(restored.tabs.every(tab => tab && typeof tab === 'object'), `${list} with ${String(junk)}`);
    assert.ok((restored.tabGroups ?? []).every(Boolean) && (restored.bookmarkNodes ?? []).every(Boolean) && restored.closedTabs.every(Boolean), `${list} cleaned`);
  }
});

test('a list that is null reads as empty, and the other tabs survive; a list of some other shape stays unreadable (the person is asked, nothing is dropped silently)', () => {
  for (const list of ['tabGroups', 'bookmarkNodes', 'closedTabs']) {
    const saved = good(); saved[list] = null;
    const restored = kept(saved);
    assert.ok(Array.isArray(restored[list as 'tabGroups']), `${list} is a list again`);
    for (const junk of [{}, 'x', 7]) { const odd = good(); odd[list] = junk; assert.throws(() => restoreSnapshot(odd), /is not a list/, `${list} as ${JSON.stringify(junk)}`); }
  }
  const saved = good(); saved.tabs = null; assert.deepEqual(urls(saved), ['acira://new']);
  const object = good(); object.tabs = {}; assert.throws(() => restoreSnapshot(object), /tabs is not a list/);
});

test('a tab whose address is not text keeps its place as a New tab', () => {
  for (const junk of [7, null, {}, [], true]) {
    const saved = good(); saved.tabs[2].url = junk;
    const list = urls(saved);
    assert.equal(list.length, 4, `the tab is kept (${String(junk)})`);
    assert.ok(list.includes('https://a.test/') && list.includes('https://c.test/'));
    assert.ok(list.filter(url => url === 'acira://new').length >= 2, 'the damaged tab shows the New tab page');
  }
});

test('a tab with a wrong-typed id, title or history is made usable', () => {
  const saved = good(); Object.assign(saved.tabs[1], { id: 7, title: 12, history: 'x', historyIndex: 'y' });
  const restored = kept(saved);
  const tab = restored.tabs.find(item => item.url === 'https://a.test/')!;
  assert.equal(typeof tab.id, 'string'); assert.equal(typeof tab.title, 'string'); assert.ok(Array.isArray(tab.history) && tab.history.every(item => typeof item === 'string'));
  assert.ok(Number.isInteger(tab.historyIndex) && tab.historyIndex >= 0 && tab.historyIndex < tab.history.length);
  // And the window works afterwards: the next navigation does not throw.
  assert.doesNotThrow(() => reduceBrowser(restored, { type: 'tab.navigate', url: 'https://d.test/', tabId: tab.id }));
});

test('tabs that share one id are all kept, each with an id of its own', () => {
  const saved = good(); for (const tab of saved.tabs) tab.id = saved.tabs[0].id;
  const restored = restoreSnapshot(saved);
  assert.equal(restored.tabs.length, 4);
  assert.deepEqual(restored.tabs.map(tab => tab.url), saved.tabs.map((tab: { url: string }) => tab.url));
  assert.equal(new Set(restored.tabs.map(tab => tab.id)).size, 4);
  assert.equal(restored.tabs.find(tab => tab.id === restored.activeTabId)?.url, saved.tabs.find((tab: { id: string }) => tab.id === saved.activeTabId)?.url ?? restored.tabs[0].url);
  // Two that clash: the first keeps the id, the second is renamed and stays.
  const pair = good(); pair.tabs[3].id = pair.tabs[2].id;
  const kept2 = restoreSnapshot(pair);
  assert.equal(kept2.tabs.length, 4); assert.equal(kept2.tabs[2].id, pair.tabs[2].id); assert.notEqual(kept2.tabs[3].id, pair.tabs[2].id);
});

test('a settings language that is not text, or a settings value that is not an object, does not stop the start', () => {
  const saved = good(); saved.settings.language = 7;
  assert.notEqual(typeof restoreSnapshot(saved).settings.language, 'number');
  for (const junk of [7, null, {}, [], true]) assert.equal(resolveLocale(junk as never, 'en'), 'en');
  assert.equal(resolveLocale('ar'), 'ar'); assert.equal(resolveLocale('system', 'pt-PT'), 'pt-BR');
  for (const junk of [null, 'x', 7, []]) { const odd = good(); odd.settings = junk; kept(odd); }
});

test('a window of good data comes back exactly as before', () => {
  const saved = good();
  const once = restoreSnapshot(saved), twice = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(once))));
  assert.deepEqual(twice.tabs.map(tab => [tab.id, tab.url]), once.tabs.map(tab => [tab.id, tab.url]));
  assert.deepEqual(once.tabs.map(tab => tab.id), saved.tabs.map((tab: { id: string }) => tab.id));
});
