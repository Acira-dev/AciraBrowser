import assert from 'node:assert/strict';
import test from 'node:test';
import { pushToast, spentToasts, toastRoom, toastStackHeight, type QueuedToast } from '../src/ui/toastQueue';

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
