import assert from 'node:assert/strict';
import test from 'node:test';
import { otherSpaceToasts, pushToast, spentToasts, toastHostRefused, toastKeysSaying, toastRoom, toastStackHeight, type QueuedToast } from '../src/ui/toastQueue';

const undo = (id: number, text: string, batch: string) => ({ id, text, action: { label: 'Undo', command: { type: 'tab.restore.batch' as const, id: batch } } });

test('toasts stack newest last, at most three', () => {
  let list: QueuedToast[] = [];
  const dropped: number[] = [];
  for (const id of [1, 2, 3, 4]) { const next = pushToast(list, { id, text: `Saved ${id}` }); list = next.list; dropped.push(...next.dropped); }
  assert.deepEqual(list.map(row => row.id), [2, 3, 4]);
  assert.deepEqual(dropped, [1]);
});

test('the same undo batch updates its row in place and keeps its timer key', () => {
  let list = pushToast([], undo(10, 'Tab closed', 'b1')).list;
  list = pushToast(list, { id: 11, text: 'Link copied' }).list;
  const next = pushToast(list, undo(12, '2 tabs closed', 'b1'));
  assert.equal(next.key, 10);
  assert.deepEqual(next.list.map(row => [row.key, row.text]), [[10, '2 tabs closed'], [11, 'Link copied']]);
});

test('repeated plain text refreshes instead of stacking; a different batch stacks', () => {
  let list = pushToast([], { id: 1, text: 'Link copied' }).list;
  list = pushToast(list, { id: 2, text: 'Link copied' }).list;
  list = pushToast(list, undo(3, 'Tab closed', 'b1')).list;
  list = pushToast(list, undo(4, 'Tab closed', 'b2')).list;
  assert.deepEqual(list.map(row => row.key), [1, 3, 4]);
});

test('an undo row is spent once its batch leaves closed tabs', () => {
  const list = [undo(1, 'Tab closed', 'b1'), undo(2, 'Tab closed', 'b2'), { id: 3, text: 'Saved' }].reduce<QueuedToast[]>((rows, toast) => pushToast(rows, toast).list, []);
  const closed = [{ id: 't2', closedBatch: 'b2' }] as unknown as Parameters<typeof spentToasts>[1];
  assert.deepEqual(spentToasts(list, closed), [1]);
});

test('profiles as spaces: another profile on screen takes the last space\'s toasts away, never one that came with the switch (QA #8)', () => {
  let list = pushToast([], undo(1, 'Tab closed', 'b1'), 'personal').list;
  list = pushToast(list, { id: 2, text: 'Link copied' }, 'personal').list;
  list = pushToast(list, { id: 3, text: 'Another window is still open.' }, 'work').list;
  assert.deepEqual(otherSpaceToasts(list, 'work'), [1, 2], 'Personal\'s Undo leaves Work\'s space');
  assert.deepEqual(otherSpaceToasts(list, 'personal'), [3]);
  assert.equal(pushToast([], { id: 4, text: 'Saved' }).list[0].profileId, undefined, 'a row with no profile');
  assert.deepEqual(otherSpaceToasts(pushToast([], { id: 4, text: 'Saved' }).list, 'work'), [], 'stays');
  assert.deepEqual(otherSpaceToasts(list, ''), [1, 2, 3], 'turned off: the spaces\' toasts go ("Open in Client" would open Client\'s tab in this profile\'s window)');
  assert.equal(pushToast([], { id: 6, text: 'Saved' }, '').list[0].profileId, undefined, 'with workspaces a row has no profile');
  // The same batch growing in its own space keeps its key and its profile.
  assert.equal(pushToast(list, undo(5, '2 tabs closed', 'b1'), 'personal').list[0].profileId, 'personal');
});

test('stack height counts one rule between rows', () => {
  assert.equal(toastStackHeight(1), 44);
  assert.equal(toastStackHeight(3), 134);
});

test('an error keeps its tone through the queue', () => {
  const list = pushToast([], { id: 7, text: 'Choose two different open tabs for split view.', tone: 'error' }).list;
  assert.equal(list[0].tone, 'error');
  assert.equal(pushToast(list, { id: 8, text: 'Saved' }).list[1].tone, undefined);
});

test('the host keeps room for a new toast in the render that adds it, and for a leaving one until its exit has played', () => {
  assert.deepEqual(toastRoom(['a'], []), ['a'], 'a new toast has room at once');
  assert.deepEqual(toastRoom(['a', 'b'], ['a']), ['a', 'b']);
  assert.deepEqual(toastRoom(['b'], ['a', 'b']), ['a', 'b'], 'a leaving toast keeps its room');
  assert.deepEqual(toastRoom([], ['a']), ['a']);
  assert.deepEqual(toastRoom([], []), []);
});

test('a toast host over a website lets go when main closes its overlay or a newer one (a resize, a blur, a click, a popup opened over it)', () => {
  assert.equal(toastHostRefused(true, 5, 5), true, 'its own id');
  assert.equal(toastHostRefused(true, 5, 6), true, 'a popup opened over it and closed');
  assert.equal(toastHostRefused(true, 7, 6), false, 'a toast minted after that popup is accepted');
});

test('a toast shown in an Acira page is not main\'s to refuse', () => {
  assert.equal(toastHostRefused(false, 5, 6), false);
  assert.equal(toastHostRefused(true, undefined, 6), false);
  assert.equal(toastHostRefused(true, 5, undefined), false);
});

test('a notice tied to a state is found by its text and leaves alone the toasts around it', () => {
  let list = pushToast([], { id: 1, text: 'Link copied' }).list;
  list = pushToast(list, { id: 2, text: 'Seamless is on.', tone: 'info' }).list;
  list = pushToast(list, { id: 3, text: 'Download failed', tone: 'error' }).list;
  assert.deepEqual(toastKeysSaying(list, 'Seamless is on.'), [2]);
  assert.deepEqual(toastKeysSaying(list, 'Seamless'), [], 'the whole line, not a part of it');
});
