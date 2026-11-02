import test from 'node:test';
import assert from 'node:assert/strict';
import { droppedLink, hasLink } from '../src/ui/linkDrop';

const transfer = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (type: string) => data[type] ?? '' });

test('a dragged link is found in any of the formats browsers use', () => {
  assert.deepEqual(droppedLink(transfer({ 'text/uri-list': '# from a page\r\nhttps://a.example/x\r\nhttps://b.example/' })), { url: 'https://a.example/x' });
  assert.deepEqual(droppedLink(transfer({ 'text/x-moz-url': 'https://a.example/\nAlpha site' })), { url: 'https://a.example/', title: 'Alpha site' });
  assert.deepEqual(droppedLink(transfer({ 'text/plain': ' http://localhost:5173/app ' })), { url: 'http://localhost:5173/app' });
});

test('only web addresses are accepted', () => {
  for (const data of <Record<string, string>[]>[{ 'text/plain': 'javascript:alert(1)' }, { 'text/uri-list': 'file:///c:/secret.txt' }, { 'text/plain': 'a sentence with https://a.example inside' }, { 'text/plain': 'bookmark-12' }, {}])
    assert.equal(droppedLink(transfer(data)), null, JSON.stringify(data));
  assert.equal(droppedLink(null), null);
  assert.equal(droppedLink({ types: ['text/plain'], getData: () => { throw new Error('protected'); } }), null);
});

test('a drag is worth a drop target while it only reveals what kind of data it carries', () => {
  assert.equal(hasLink({ types: ['text/uri-list', 'text/plain'] }), true);
  assert.equal(hasLink({ types: ['Files'] }), false);
  assert.equal(hasLink(null), false);
});
