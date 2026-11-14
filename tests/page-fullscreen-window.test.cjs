'use strict';
// A video's fullscreen hides Acira's interface, so it must never strand it (reported 14 Nov: macOS fullscreen + a video's fullscreen button left a video and nothing else, and the app
// could not be reached or closed). The window is put back only as the page found it; the window leaving fullscreen ends the page's fullscreen; a quit or a close lets go first;
// a watchdog gives the interface back if the page no longer has a fullscreen element. No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createPageFullscreen} = require('../desktop/page-fullscreen.cjs');

function rig({fullscreen = false} = {}) {
  const calls = [], timers = [], onces = [];
  let isFullscreen = fullscreen, hasElement = true;
  const window = {
    isDestroyed: () => false, isFullScreen: () => isFullscreen,
    setFullScreen: value => { calls.push(['window.setFullScreen', value]); isFullscreen = value; },
    once: (event, fn) => { onces.push({event, fn}); }, getContentSize: () => [1200, 800], contentView: {addChildView: view => calls.push(['raise', view.name])}
  };
  const chrome = {webContents: {isDestroyed: () => false}, setVisible: value => calls.push(['chrome.setVisible', value])};
  const view = name => ({name, getVisible: () => true, setVisible: value => calls.push(['view.setVisible', name, value]), setBorderRadius: () => {},
    webContents: {isDestroyed: () => false, getURL: () => 'https://video.example/watch', executeJavaScript: async code => { if (/^Boolean\(document\.fullscreenElement\)/.test(code)) return hasElement; calls.push(['js', /exitFullscreen/.test(code) ? 'exitFullscreen' : code]); }}});
  const entries = {a: {view: view('a')}, b: {view: view('b')}};
  const pages = new Map(Object.entries(entries));
  const state = {activeTabId: 'a', tabs: [{id: 'a', contentKind: 'web'}, {id: 'b', contentKind: 'web'}]};
  const pf = createPageFullscreen({getWindow: () => window, getChrome: () => chrome, getState: () => state, pages, render: () => calls.push(['render']),
    hideFloating: () => calls.push(['hideFloating']), placeBounds: (entry, bounds) => calls.push(['placeBounds', bounds]), focus: () => calls.push(['focus']),
    screenSize: () => ({width: 1728, height: 1117}),
    every: (fn, ms) => { const timer = {fn, ms, live: true, unref() {}}; timers.push(timer); return timer; }, stopEvery: timer => { timer.live = false; }});
  const watchOnce = async () => { for (const timer of timers.filter(t => t.live)) timer.fn(); for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
  return {pf, calls, entries, state, window, chrome, timers, watchOnce, windowEntered: () => { for (const once of onces.splice(0)) if (once.event === 'enter-full-screen') once.fn(); },
    setElement: value => { hasElement = value; }, setWindowFullscreen: value => { isFullscreen = value; }, names: () => calls.map(call => call[0]),
    setFullCalls: () => calls.filter(call => call[0] === 'window.setFullScreen')};
}

test('a window that was fullscreen (macOS fullscreen) before the video asked is left as it is: nothing asked of it at enter, nothing at leave', () => {
  const r = rig({fullscreen: true});
  assert.equal(r.pf.enter('a', r.entries.a), true);
  assert.deepEqual(r.setFullCalls(), []);
  r.pf.leave(r.entries.a);
  assert.deepEqual(r.setFullCalls(), [], 'it used to be set fullscreen again here');
  assert.ok(r.names().includes('chrome.setVisible'));
});

test('leaving never turns fullscreen ON: the person left macOS fullscreen while the video showed, then pressed Esc, and the window stays where they put it', () => {
  const r = rig({fullscreen: true});
  r.pf.enter('a', r.entries.a);
  r.setWindowFullscreen(false);   // the green button
  r.calls.length = 0;
  r.pf.leave(r.entries.a);
  assert.deepEqual(r.setFullCalls(), [], 'the window jumped back into fullscreen here (the reported "glitched out")');
});

test('a window the video took to fullscreen is taken out of it when the video leaves, if it still is there; if the person got there first nothing is asked', () => {
  const r = rig();
  r.pf.enter('a', r.entries.a);
  assert.deepEqual(r.setFullCalls(), [['window.setFullScreen', true]]);
  r.calls.length = 0;
  r.pf.leave(r.entries.a);
  assert.deepEqual(r.setFullCalls(), [['window.setFullScreen', false]]);
  const early = rig();
  early.pf.enter('a', early.entries.a);
  early.setWindowFullscreen(false);
  early.calls.length = 0;
  early.pf.leave(early.entries.a);
  assert.deepEqual(early.setFullCalls(), []);
});

test('the person taking the window out of fullscreen while the video shows ends the video\'s fullscreen with it: the interface is back, the window is not asked to do anything', () => {
  for (const fullscreen of [true, false]) {
    const r = rig({fullscreen});
    r.pf.enter('a', r.entries.a);
    r.windowEntered();
    r.setWindowFullscreen(false);
    r.calls.length = 0;
    assert.equal(r.pf.windowLeftFullScreen(), true, 'fullscreen before: ' + fullscreen);
    assert.equal(r.pf.any(), false);
    assert.deepEqual(r.setFullCalls(), []);
    assert.ok(r.calls.some(call => call[0] === 'js' && call[1] === 'exitFullscreen'), 'the page is taken out of its fullscreen');
    assert.ok(r.names().includes('chrome.setVisible'));
  }
  assert.equal(rig().pf.windowLeftFullScreen(), false, 'nothing shows: nothing to do');
});

test('a quit or a window close lets go first: the interface is back and the window is not touched; with nothing showing it does nothing', () => {
  const r = rig();
  r.pf.enter('a', r.entries.a);
  r.calls.length = 0;
  assert.equal(r.pf.release(), true);
  assert.equal(r.pf.any(), false);
  assert.ok(r.names().includes('chrome.setVisible'));
  assert.deepEqual(r.setFullCalls(), []);
  assert.equal(r.timers.every(timer => !timer.live), true, 'the watchdog is stopped');
  assert.equal(rig().pf.release(), false);
});

test('the watchdog: the page is asked once a second whether it still has a fullscreen element; two "no" in a row give the interface back', async () => {
  const r = rig({fullscreen: true});
  r.pf.enter('a', r.entries.a);
  assert.equal(r.timers.filter(timer => timer.live).length, 1);
  assert.equal(r.timers.find(timer => timer.live).ms, 1000);
  await r.watchOnce();
  assert.equal(r.pf.any(), true);
  r.setElement(false); await r.watchOnce();
  assert.equal(r.pf.any(), true, 'one "no" is not enough');
  r.setElement(true); await r.watchOnce();
  r.setElement(false); await r.watchOnce();
  assert.equal(r.pf.any(), true, 'a "yes" in between starts the count again');
  await r.watchOnce();
  assert.equal(r.pf.any(), false);
  assert.ok(r.names().includes('chrome.setVisible'));
  const gone = rig({fullscreen: true});
  gone.pf.enter('a', gone.entries.a);
  gone.state.activeTabId = 'b';
  await gone.watchOnce();
  assert.equal(gone.pf.any(), false, 'the tab is no longer the one on screen');
});

test('main.cjs: the window leaving fullscreen, a close, a quit and Esc all reach the module', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.ok(source.includes("mainWindow.on('leave-full-screen',()=>pageFullscreen.windowLeftFullScreen());"));
  assert.ok(source.includes("mainWindow.on('close',event=>{pageFullscreen.release();"));
  assert.ok(source.includes('releasePageFullscreen:()=>pageFullscreen.release()') && /async function requestQuit\(\)\{if\(quitAsking\|\|quitting\)return;for\(const controller of controllers\)try\{controller\.releasePageFullscreen\?\.\(\);\}catch\{\}/.test(source));
  assert.ok(source.includes("wc.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'&&pageFullscreen.isActive(entry))pageFullscreen.leave(entry,true);});"));
});
