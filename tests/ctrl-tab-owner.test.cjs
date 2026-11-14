'use strict';
// A key typed into a page acts on THAT page's tab (a split pane that is not the active one): shortcut() selects the owner of the key first. Ctrl+Tab is the exception: it moves on from the window's current tab.
// A key still in flight to the page the last press had just left (focus follows a switch a moment late) used to put that tab back first and the step was taken from it (real app, hidden, keys sent to the start tab's
// page: the second press ended on the wrong tab 30 times in 30, and the selection showed the old tab for a frame).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('the owner of a key is selected first for every command but Ctrl+Tab', () => {
  assert.ok(main.includes("if(owner&&owner!==state.activeTabId&&command.action!=='tab-switcher')dispatch({type:'tab.select',id:owner});"));
  assert.equal(main.split("dispatch({type:'tab.select',id:owner});").length - 1, 1, 'one place selects the owner');
});

test('the Ctrl+Tab command is still the tab-switcher action, so the exception reaches it', () => {
  assert.match(main, /case 'tab-switcher':\{/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'shortcuts.cjs'), 'utf8'), /tab-switcher/, 'the shortcut table names the action');
});
