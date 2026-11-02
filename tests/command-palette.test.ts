import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyMatch } from '../src/ui/fuzzy';
import { flatItems, paletteSections, type PaletteInput } from '../src/ui/paletteResults';

const input: PaletteInput = {
  query: '', activeTabId: 't1', recent: ['private-window'],
  commands: [
    { id: 'new-tab', label: 'New tab', category: 'Tabs', shortcut: 'Ctrl T' },
    { id: 'new-window', label: 'New window', category: 'Windows', shortcut: 'Ctrl N' },
    { id: 'private-window', label: 'New private window', category: 'Windows', shortcut: 'Ctrl Shift N' },
    { id: 'reopen-tab', label: 'Reopen closed tab', category: 'Tabs', shortcut: 'Ctrl Shift T' },
    { id: 'fullscreen', label: 'Full screen', category: 'Windows', shortcut: 'F11' },
  ],
  tabs: [{ id: 't1', title: 'Current', url: 'https://current.test/' }, { id: 't2', title: 'GitHub pull requests', url: 'https://github.com/pulls' }, { id: 't3', title: 'Weather', url: 'https://weather.test/' }],
  history: [{ title: 'Rust book', url: 'https://doc.rust-lang.org/book/' }, { title: 'GitHub pull requests', url: 'https://github.com/pulls' }],
  pages: [{ title: 'Settings', url: 'acira://settings' }, { title: 'History', url: 'acira://history' }],
};

test('fuzzy prefers contiguous, then word starts, and rejects scattered noise', () => {
  assert.ok(fuzzyMatch('new', 'New tab')!.score > fuzzyMatch('new', 'Reopen new')!.score);
  assert.deepEqual(fuzzyMatch('nw', 'New window')!.indices, [0, 4]);
  assert.equal(fuzzyMatch('xyz', 'New window'), null);
});

test('empty query shows recently used tabs (not the current one), then recent commands', () => {
  const sections = paletteSections(input);
  assert.deepEqual(sections.map(section => section.label), ['Open tabs · 2', 'Commands']);
  assert.equal(sections[0].label, `Open tabs · ${sections[0].items.length}`, 'the label counts the rows it heads (the current tab is not listed)');
  assert.deepEqual(sections[0].items.map(item => item.key), ['tab:t2', 'tab:t3']);
  assert.equal(sections[1].items[0].title, 'New private window');
});

test('> lists only commands, recent first, and matches fuzzily with shortcuts shown', () => {
  assert.deepEqual(paletteSections({ ...input, query: '>' }).map(section => section.label), ['Recent', 'Commands']);
  const items = flatItems(paletteSections({ ...input, recent: [], query: '> nw' }));
  assert.ok(items.every(item => item.kind === 'command'));
  assert.equal(items[0].title, 'New window');
  assert.equal(items[0].meta, 'Ctrl N');
  // A recently used command wins a near tie.
  assert.equal(flatItems(paletteSections({ ...input, query: '> nw' }))[0].title, 'New private window');
});

test('rows that open a page read as verbs, and an Acira page a command already opens is not listed twice (C23)', () => {
  const commands = [...input.commands, { id: 'history', label: 'History', category: 'Library', shortcut: 'Ctrl H' }, { id: 'routines', label: 'Tab sets', category: 'Library' }];
  const titles = flatItems(paletteSections({ ...input, commands, query: 'open' })).map(item => item.title);
  assert.ok(titles.includes('Open History') && titles.includes('Open Tab sets') && titles.includes('Open Settings'));
  assert.equal(titles.filter(title => title === 'Open History').length, 1);
  assert.ok(!titles.some(title => title === 'History' || title === 'Settings'));
});

test('a mixed query ranks sections by their best match and ends with a web search', () => {
  const sections = paletteSections({ ...input, query: 'github' });
  assert.equal(sections[0].label, `Open tabs · ${sections[0].items.length}`);
  assert.equal(sections.at(-1)!.key, 'web');
  // History already open in a tab is not repeated.
  assert.ok(!sections.some(section => section.key === 'history'));
  assert.equal(paletteSections({ ...input, query: 'example.com' })[0].items[0].title, 'Open example.com');
});
