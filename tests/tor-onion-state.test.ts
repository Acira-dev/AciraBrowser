import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import type { BrowserSnapshot, TabSession } from '../src/runtime/types';

// Onion-Location: main tells the interface which onion address a Tor tab's site offered; the reducer keeps only a v3 .onion address and drops it with an empty value.
const ONION = 'http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/';
const tab = (id: string): TabSession => ({ ...makeTab(id, '', 'https://www.torproject.org/', 'profile-personal'), privacy: 'tor' });
const start = (): BrowserSnapshot => ({ ...createInitialState(), tabs: [tab('t1')], activeTabId: 't1' });
const event = (state: BrowserSnapshot, patch: Record<string, unknown>) => reduceBrowser(state, { type: 'browser.event', event: { type: 'state', tabId: 't1', ...patch } } as never);

test('a v3 onion address is kept on the tab, and an empty value takes it away again', () => {
  const offered = event(start(), { onionLocation: ONION });
  assert.equal(offered.tabs[0].onionLocation, ONION);
  assert.equal(event(offered, { title: 'Tor Project' }).tabs[0].onionLocation, ONION, 'other updates leave it alone');
  assert.equal(event(offered, { onionLocation: '' }).tabs[0].onionLocation, undefined);
});

test('an onion address is never labelled "Not secure" (Tor encrypts it end to end); a plain http site still is', async () => {
  const { urlDisplay } = await import('../src/ui/urlDisplay');
  assert.equal(urlDisplay(ONION + 'index.html')?.insecure, false);
  assert.equal(urlDisplay('http://www.example.com/')?.insecure, true);
  assert.equal(urlDisplay('https://www.example.com/')?.insecure, false);
});

test('anything that is not a v3 .onion address in an http(s) URL is refused', () => {
  for (const bad of ['http://example.com/', 'https://evil.example/.onion', 'javascript:alert(1)', 'http://abc.onion/', 'http://short.onion/', 'ftp://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/', '//2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/'])
    assert.equal(event(start(), { onionLocation: bad }).tabs[0].onionLocation, undefined, bad);
  assert.equal(event(start(), { onionLocation: ONION + 'x'.repeat(3000) }).tabs[0].onionLocation, undefined, 'over 2048 characters');
});
