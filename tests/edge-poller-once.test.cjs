'use strict';
// edge-reveal.cjs's watchChromeEdges is "one timer for the whole app, however many windows", but main.cjs used to build it inside the function that opens
// a window: every window opened added a poller that ticked every window (several times a tick), listened to every window's move and resize, and kept
// going after its window closed. Its pin and dismiss reached only the poller that made them, so a second poller could undo a pinned edge.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');

test('main builds the edge poller once for the whole app, not once per window', () => {
  assert.equal([...main.matchAll(/watchChromeEdges\(/g)].length, 1, 'one call site');
  assert.match(main, /edgePoller=sharedEdgePoller\?\?=require\('\.\/edge-reveal\.cjs'\)\.watchChromeEdges\(/);
  assert.match(main, /nativeThemeOwner=null,sharedEdgePoller=null;/, 'the shared poller lives beside the other app-wide state, outside the window function');
});
