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

// 13.5 (hunt-e 11): Enter on a workspace's own name ran "Close other tabs"; a command that closes things without a question is never what Enter does by default.
const closers = [
  { id: 'close-tab', label: 'Close tab', category: 'Tabs', shortcut: 'Ctrl W' },
  { id: 'close-other-tabs', label: 'Close other tabs', category: 'Tabs' },
  { id: 'close-tabs-right', label: 'Close tabs to the right', category: 'Tabs' },
  { id: 'close-window', label: 'Close window', category: 'Windows', shortcut: 'Ctrl Shift W' },
  { id: 'quit', label: 'Close Acira', category: 'Windows', shortcut: 'Ctrl Shift Q' },
  { id: 'clear-data', label: 'Clear browsing data', category: 'Library', shortcut: 'Ctrl Shift Delete' },
  { id: 'new-tab', label: 'New tab', category: 'Tabs', shortcut: 'Ctrl T' },
];
const spaces = [{ id: 'workspace:w2', label: 'Switch to Other', category: 'Workspaces', shortcut: 'Ctrl 2', name: 'Other' }, { id: 'workspace:w3', label: 'Switch to Work', category: 'Workspaces', shortcut: 'Ctrl 3', name: 'Work' }];
const first = (query: string, extra: Partial<PaletteInput> = {}) => flatItems(paletteSections({ ...input, recent: [], commands: [...closers, ...spaces], query, ...extra }))[0];

test('typing a workspace\'s own name puts its row first, whatever else the name matches', () => {
  assert.equal(first('Other').key, 'command:workspace:w2');
  assert.equal(first('other').key, 'command:workspace:w2');
  assert.equal(first('  OTHER ').key, 'command:workspace:w2');
  assert.equal(first('Work').key, 'command:workspace:w3');
  // Only the whole name earns the lead: a part of it is the plain match (the bonus is the 100 points between the two).
  const score = (query: string) => flatItems(paletteSections({ ...input, recent: [], commands: [...closers, ...spaces], query })).find(item => item.key === 'command:workspace:w2')!.score;
  assert.ok(score('Other') - score('Othe') > 90 && score('Othe') - score('Oth') < 20);
  // The same in the commands-only list.
  assert.equal(first('> other').key, 'command:workspace:w2');
});

test('a destructive command is not what Enter does unless the query clearly names it', () => {
  const guarded = ['close-other-tabs', 'close-tabs-right', 'close-window', 'quit', 'clear-data'];
  for (const query of ['other', 'right', 'window', 'acira', 'browsing', 'data', 'tabs', 'close', 'clo', 'clear', 'cl', 'q', 'qu', 'quit', 'quit a', 'close ', 'xclose other', '> other', '> right', '> close']) {
    const lead = first(query, { commands: closers });
    // In the commands-only list there is no web row to fall back on: a held-back row may lead there, flagged, and the bar's Enter skips it (CommandPalette).
    assert.ok(!(lead.kind === 'command' && guarded.includes(lead.command.id)) || query.startsWith('>') && lead.guard === true, `"${query}" must not lead with ${lead.key}`);
  }
  // Nothing else matches "other": Enter searches the web, the closing commands stay listed below it.
  const keys = flatItems(paletteSections({ ...input, recent: [], commands: closers, query: 'other' })).map(item => item.key);
  assert.equal(keys[0], 'web');
  assert.ok(keys.includes('command:close-other-tabs'));
});

test('naming a destructive command clearly still puts it first', () => {
  const lead = (query: string) => first(query, { commands: closers });
  assert.equal(lead('close other').key, 'command:close-other-tabs');
  assert.equal(lead('Close other tabs').key, 'command:close-other-tabs');
  assert.equal(lead('close tabs to').key, 'command:close-tabs-right');
  assert.equal(lead('close w').key, 'command:close-window');
  assert.equal(lead('close acira').key, 'command:quit');
  assert.equal(lead('close a').key, 'command:quit');
  assert.equal(lead('clear browsing').key, 'command:clear-data');
  assert.equal(lead('> close other').key, 'command:close-other-tabs');
  // The harmless one keeps working as before.
  assert.equal(lead('close tab').key, 'command:close-tab');
});

test('a recently used destructive command is listed after the others, not first', () => {
  const sections = paletteSections({ ...input, tabs: [input.tabs[0]], commands: closers, recent: ['close-other-tabs', 'new-tab'], query: '>' });
  assert.equal(sections[0].items[0].key, 'command:new-tab');
  assert.equal(sections[0].items[1].key, 'command:close-other-tabs');
});

test('rows held back from Enter say so, others do not', () => {
  const items = flatItems(paletteSections({ ...input, recent: [], commands: closers, query: 'close' }));
  assert.equal(items.find(item => item.key === 'command:close-other-tabs')!.guard, true);
  assert.equal(items.find(item => item.key === 'command:close-tab')!.guard, undefined);
});
