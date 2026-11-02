import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const run = (s: BrowserSnapshot, action: BrowserAction) => reduceBrowser(s, action);
const on = (url: string) => run(createInitialState(), {type: 'tab.new', url});
const undoOf = (s: BrowserSnapshot) => s.toast?.action;
const urls = (s: BrowserSnapshot) => s.bookmarkNodes.filter(b => b.url).map(b => b.url);

test('removing a bookmark with the star offers Undo, and Undo brings back the same bookmark', () => {
  let s = on('https://a.test/page');
  s = run(s, {type: 'bookmark.toggle', url: 'https://a.test/page'});
  assert.equal(s.toast?.text, 'Bookmark added');
  assert.equal(undoOf(s), undefined, 'adding needs no Undo');
  const saved = s.bookmarkNodes.find(b => b.url === 'https://a.test/page')!;
  s = run(s, {type: 'bookmark.toggle', url: 'https://a.test/page'});
  assert.deepEqual(urls(s), []);
  assert.equal(s.toast?.text, 'Bookmark removed');
  assert.equal(undoOf(s)?.label, 'Undo');
  s = run(s, undoOf(s)!.command);
  assert.deepEqual(urls(s), ['https://a.test/page']);
  const back = s.bookmarkNodes.find(b => b.url === 'https://a.test/page')!;
  assert.equal(back.id, saved.id);
  assert.equal(back.title, saved.title);
  s = run(s, {type: 'bookmark.restore', nodes: [back]});
  assert.equal(urls(s).length, 1, 'pressing Undo twice does not make a second bookmark');
});

test('Undo of a removal works from the bookmark editor, menus and shortcut alike: they all toggle', () => {
  let s = on('https://b.test/');
  s = run(s, {type: 'bookmark.add', url: 'https://b.test/', title: 'B', parentId: null, index: 0});
  s = run(s, {type: 'bookmark.toggle', url: 'https://b.test/'});
  assert.equal(undoOf(s)?.command.type, 'bookmark.restore');
  const command = undoOf(s)!.command;
  assert.ok(command.type === 'bookmark.restore' && command.nodes[0].title === 'B', 'the Undo carries the bookmark as it was, with its title');
});

test('the Bookmarks page owns its own Undo notice: removing by id raises no second toast without Undo', () => {
  let s = on('https://c.test/');
  s = run(s, {type: 'bookmark.folder', parentId: null, title: 'Reading'});
  const folder = s.bookmarkNodes.find(b => !b.url && b.title === 'Reading')!;
  s = run(s, {type: 'bookmark.add', url: 'https://c.test/one', title: 'One', parentId: folder.id, index: 0});
  const gone = s.bookmarkNodes.filter(b => b.id === folder.id || b.parentId === folder.id).map(b => ({...b}));
  s = {...s, toast: null};
  s = run(s, {type: 'bookmark.remove', id: folder.id});
  assert.deepEqual(urls(s), []);
  assert.equal(s.toast, null, 'no "Bookmark removed" toast competing with the page notice');
  s = run(s, {type: 'bookmark.restore', nodes: gone});
  assert.deepEqual(urls(s), ['https://c.test/one'], 'the page notice restores the folder and what was in it');
  assert.ok(s.bookmarkNodes.some(b => b.id === folder.id));
});

test('Undo puts a removed bookmark or folder back at the position it had, not after its neighbours', () => {
  let s = on('https://d.test/');
  for (const name of ['a', 'b', 'c']) s = run(s, {type: 'bookmark.add', url: `https://d.test/${name}`, title: name.toUpperCase(), parentId: null, index: 99});
  s = run(s, {type: 'bookmark.folder', parentId: null, title: 'Folder'});
  const folder = s.bookmarkNodes.find(b => !b.url)!;
  for (const name of ['x', 'y', 'z']) s = run(s, {type: 'bookmark.add', url: `https://d.test/${name}`, title: name.toUpperCase(), parentId: folder.id, index: 99});
  const order = (parent: string | null) => s.bookmarkNodes.filter(b => (b.parentId ?? null) === parent).sort((p, q) => p.position - q.position).map(b => b.title).join('');
  assert.equal(order(null), 'ABCFolder');
  for (const title of ['A', 'B', 'C']) {
    const node = s.bookmarkNodes.find(b => b.title === title)!, snapshot = {...node};
    s = run(s, {type: 'bookmark.remove', id: node.id});
    s = run(s, {type: 'bookmark.restore', nodes: [snapshot]});
    assert.equal(order(null), 'ABCFolder', `Undo of ${title}`);
  }
  const gone = s.bookmarkNodes.filter(b => b.id === folder.id || b.parentId === folder.id).map(b => ({...b}));
  s = run(s, {type: 'bookmark.remove', id: folder.id});
  s = run(s, {type: 'bookmark.restore', nodes: gone});
  assert.equal(order(null), 'ABCFolder');
  assert.equal(order(folder.id), 'XYZ');
  const middle = s.bookmarkNodes.find(b => b.title === 'Y')!, kept = {...middle};
  s = run(s, {type: 'bookmark.remove', id: middle.id});
  s = run(s, {type: 'bookmark.restore', nodes: [kept]});
  assert.equal(order(folder.id), 'XYZ', 'a bookmark in the middle of a folder returns to the middle');
  const inside = s.bookmarkNodes.filter(b => b.parentId === folder.id).map(b => ({...b}));
  s = run(s, {type: 'bookmark.clear', id: folder.id});
  s = run(s, {type: 'bookmark.restore', nodes: inside});
  assert.equal(order(folder.id), 'XYZ', 'Undo of clearing a folder keeps its order');
});
