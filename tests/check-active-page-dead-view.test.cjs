'use strict';
// checkActivePage (main.cjs) runs 300 ms after a layout change to make sure the tab on screen is shown, attached and sized. It read
// `entry.view.webContents.isDestroyed()`, but a view whose contents are gone has no webContents at all (the shape reapDeadPages guards:
// `const wc=entry.view?.webContents;if(wc&&!wc.isDestroyed())continue;`), so the timer threw an uncaught TypeError (seen in the 13.8 focus-return
// rig after a crash and a sign-in tab closing itself; process-errors.cjs caught it; 13.7 had the same line). A page with no contents is left
// to reapDeadPages, which drops it and closes its tab.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const start = main.indexOf('function checkActivePage(reason,tries=0){');
const source = main.slice(start, main.indexOf('\n}', start) + 2);

/** The real function, run against stand-ins for main's state: an active tab whose page entry has a view with `contents` (null = gone). */
function run(contents) {
  const touched = [];
  const view = {webContents: contents, getVisible: () => { touched.push('getVisible'); return true; }, setVisible() { touched.push('setVisible'); }, getBounds: () => ({x: 0, y: 0, width: 10, height: 10})};
  const env = {
    mainWindow: {isDestroyed: () => false, isMinimized: () => false, isVisible: () => true, contentView: {children: [view]}},
    windowClosing: false, state: {activeTabId: 't1', tabs: [{id: 't1', contentKind: 'web'}]}, pages: new Map([['t1', {view}]]),
    pageFullscreen: {isActive: () => false}, authActive: false, layout: {visible: true, views: [{tabId: 't1'}]}, pageStill: {}, newTabStill: {},
    activePageRetry: null, woken: null, equalBounds: () => true, attachPageView() {}, chromeFloat: {floated: false}, chromeView: {}, viewLog: null,
  };
  const make = new Function(...Object.keys(env), `${source}\nreturn checkActivePage;`);
  const check = make(...Object.values(env));
  check('test');
  return touched;
}

test('a page whose contents are gone (no webContents on its view) is skipped, not a TypeError from the timer', () => {
  assert.ok(start > 0, 'checkActivePage is in main.cjs');
  assert.doesNotThrow(() => run(undefined), 'no contents at all');
  assert.deepEqual(run(undefined), [], 'nothing else is read or changed: reapDeadPages takes the entry');
  assert.doesNotThrow(() => run(null));
  assert.deepEqual(run({isDestroyed: () => true}), [], 'destroyed contents: skipped as before');
});

test('a live page is still checked as before', () => {
  assert.ok(run({isDestroyed: () => false, invalidate() {}}).includes('getVisible'), 'the live page on screen is looked at');
});

test('the guard is the shape reapDeadPages uses', () => {
  assert.ok(source.includes('!entry.view?.webContents||entry.view.webContents.isDestroyed()'));
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/check-active-page-dead-view.test.cjs'));
});
