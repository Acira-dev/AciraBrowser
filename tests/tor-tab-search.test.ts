import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { searchFor } from '../src/runtime/navigation';
import type { BrowserSnapshot, TabSession } from '../src/runtime/types';
import { rankAddressSuggestions } from '../src/ui/addressSuggestions';

// A search typed in a Tor tab (also one opened inside an ordinary window) goes to DuckDuckGo, like Tor Browser and Acira's Tor windows,
// whatever the profile's default engine or custom providers. Ordinary tabs keep the person's engine.

const tab = (id: string, url: string, privacy?: TabSession['privacy']): TabSession => ({ ...makeTab(id, '', url, 'profile-personal'), ...(privacy ? { privacy } : {}) });
function window(active: string): BrowserSnapshot {
  const state = createInitialState();
  return { ...state, settings: { ...state.settings, searchEngine: 'google' }, tabs: [tab('normal', 'https://start.test/'), tab('tor', 'https://check.torproject.org/', 'tor')], activeTabId: active };
}

test('searchFor: a Tor tab always uses DuckDuckGo and no custom providers', () => {
  assert.deepEqual(searchFor({ searchEngine: 'google', searchProviders: { defaultId: 'google', custom: [] } as never }, 'tor'), ['duckduckgo', undefined]);
  assert.deepEqual(searchFor({ searchEngine: 'bing' }, undefined), ['bing', undefined]);
  assert.deepEqual(searchFor({ searchEngine: 'google' }, 'private'), ['google', undefined]);
});

test('typing a search in a Tor tab in an ordinary window navigates to DuckDuckGo', () => {
  const after = reduceBrowser(window('tor'), { type: 'tab.navigate', tabId: 'tor', url: 'secret tea' } as never);
  const url = new URL(after.tabs.find(item => item.id === 'tor')!.url);
  assert.equal(url.hostname, 'duckduckgo.com');
  assert.equal(url.searchParams.get('q'), 'secret tea');
});

test('the same search in an ordinary tab keeps the default engine', () => {
  const after = reduceBrowser(window('normal'), { type: 'tab.navigate', tabId: 'normal', url: 'tea' } as never);
  assert.equal(new URL(after.tabs.find(item => item.id === 'normal')!.url).hostname, 'www.google.com');
});

test('the typed-search row in a Tor tab names and targets DuckDuckGo', () => {
  const [row] = rankAddressSuggestions('secret tea', window('tor'));
  assert.equal(row.kind, 'search');
  assert.equal(new URL(row.url).hostname, 'duckduckgo.com');
  assert.match(row.detail, /DuckDuckGo/);
});
