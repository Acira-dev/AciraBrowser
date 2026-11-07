'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseStartWindows } = require('../desktop/startup-windows.cjs');

// beta.12 item 24: Settings > Tabs > When Acira starts.
const database = records => ({ readWindow: id => { if (!(id in records)) return null; if (records[id] instanceof Error) throw records[id]; return records[id]; } });

test('Continue where you left off (and a profile that never chose) opens every saved window', () => {
  const ids = ['main', 'window-b', 'window-c'];
  assert.deepEqual(chooseStartWindows(ids, database({ main: { settings: { onStartup: 'continue' } } })), { ids, dropped: [], fresh: false });
  assert.deepEqual(chooseStartWindows(ids, database({ main: { settings: {} } })), { ids, dropped: [], fresh: false });
  assert.deepEqual(chooseStartWindows(ids, database({ main: { tabs: [] } })), { ids, dropped: [], fresh: false });
  assert.deepEqual(chooseStartWindows(ids, database({})), { ids, dropped: [], fresh: false }, 'nothing saved');
});

test('Open a New Tab opens the first saved window alone; the others are named so main can hand them to Rewind', () => {
  const ids = ['main', 'window-b', 'window-c'];
  assert.deepEqual(chooseStartWindows(ids, database({ main: { settings: { onStartup: 'newtab' } }, 'window-b': { settings: { onStartup: 'continue' } } })), { ids: ['main'], dropped: ['window-b', 'window-c'], fresh: true });
  assert.deepEqual(chooseStartWindows(['main'], database({ main: { settings: { onStartup: 'newtab' } } })), { ids: ['main'], dropped: [], fresh: true });
});

test('the choice is the first saved window\'s; another window\'s setting does not decide', () => {
  const ids = ['main', 'window-b'];
  assert.equal(chooseStartWindows(ids, database({ main: { settings: { onStartup: 'continue' } }, 'window-b': { settings: { onStartup: 'newtab' } } })).fresh, false);
});

test('a record that cannot be read is not an answer: all windows open and the window asks, as before', () => {
  const ids = ['main', 'window-b'];
  assert.deepEqual(chooseStartWindows(ids, database({ main: new Error('damaged') })), { ids, dropped: [], fresh: false });
  assert.deepEqual(chooseStartWindows([], database({})), { ids: [], dropped: [], fresh: false });
  assert.deepEqual(chooseStartWindows(ids, { readWindow() { throw new Error('closed'); } }), { ids, dropped: [], fresh: false });
});
