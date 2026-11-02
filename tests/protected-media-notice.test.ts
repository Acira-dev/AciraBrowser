import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { dismissible, pushToast } from '../src/ui/toastQueue';

test('a notice toast keeps its tone and its action; an unknown tone is dropped', () => {
  const action = { label: 'Learn more', command: { type: 'tab.new' as const, url: 'acira://settings#known-limits' } };
  const shown = reduceBrowser(createInitialState(), { type: 'toast', text: "This site's protected video isn't supported in Acira yet.", tone: 'info', action });
  assert.equal(shown.toast?.tone, 'info');
  assert.deepEqual(shown.toast?.action, action);
  assert.equal(reduceBrowser(createInitialState(), { type: 'toast', text: 'x', tone: 'loud' as never }).toast?.tone, undefined);
  assert.equal(reduceBrowser(createInitialState(), { type: 'toast', text: 'x', tone: 'error' }).toast?.tone, 'error');
});

test('notices and errors can be dismissed; plain confirmations cannot', () => {
  assert.equal(dismissible('info'), true);
  assert.equal(dismissible('error'), true);
  assert.equal(dismissible(undefined), false);
  const queue = pushToast([], { id: 1, text: 'Protected video', tone: 'info', action: { label: 'Learn more', command: { type: 'tab.new', url: 'acira://settings#known-limits' } } });
  assert.equal(queue.list[0].tone, 'info');
});

test('a toast action can name the Settings control to land on', () => {
  const action = { label: 'Learn more', settings: 'known-limits', command: { type: 'tab.new' as const, url: 'acira://settings' } };
  const shown = reduceBrowser(createInitialState(), { type: 'toast', text: 'x', tone: 'info', action });
  assert.equal(shown.toast?.action?.settings, 'known-limits');
});
