'use strict';
// The interface listens to the browser's single event channel from many components. Node warns at more than 10 listeners
// on one emitter, so every window printed "MaxListenersExceededWarning" in its console on start. The count stays bounded
// (17 or 18 in steady use), so the preload raises the cap above that instead of leaving the warning in every window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the window preload raises the ipc listener cap above the interface\'s subscriber count', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.cjs'), 'utf8');
  const cap = /ipcRenderer\.setMaxListeners\((\d+)\)/.exec(source);
  assert.ok(cap, 'preload.cjs sets the ipcRenderer listener cap');
  assert.ok(Number(cap[1]) >= 40, 'the cap leaves room above the 17-18 subscribers measured in use');
  assert.ok(source.indexOf('setMaxListeners') < source.indexOf('subscribeBrowser'), 'the cap is set before any subscription is made');
});
