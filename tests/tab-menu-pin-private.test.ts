import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import type { BrowserAction } from '../src/runtime/types';
import { createInitialState, reduceBrowser } from '../src/runtime/core';

// Hunt (tabs): the tab menu's "Pin tab" row was offered on a private or Tor tab, where choosing it changed nothing (the reducer pins no such tab).
test('the tab menu offers Pin only to tabs the reducer can pin', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('!context.privacy && row(context.pinned ?'), 'a private, Tor or secured tab gets no pin row');
  let state = reduceBrowser(createInitialState(), { type: 'tab.new', url: 'https://a.test/', privacy: 'private' } as BrowserAction);
  const privateTab = state.tabs.at(-1)!;
  state = reduceBrowser(state, { type: 'tab.pin', id: privateTab.id } as BrowserAction);
  assert.equal(state.tabs.find(tab => tab.id === privateTab.id)!.pinned, false, 'the reducer refuses the pin, so the row could never work');
  state = reduceBrowser(createInitialState(), { type: 'tab.new', url: 'https://b.test/' } as BrowserAction);
  const plain = state.tabs.at(-1)!;
  state = reduceBrowser(state, { type: 'tab.pin', id: plain.id } as BrowserAction);
  assert.equal(state.tabs.find(tab => tab.id === plain.id)!.pinned, true, 'an ordinary tab still pins');
});
