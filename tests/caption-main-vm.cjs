'use strict';
// Test helper (not a test): main.cjs's OWN caption code, cut out of the source text and run in a vm against a fake Windows window, a fake screen and a fake clock, so
// the tests judge the real order of calls and the real wiring, not a copy of them. Used by caption-reveal-one-step.test.cjs and caption-never-vanishes.test.cjs.
//   realMainCaption({ source, layout, flags, guardModule }) -> { api, window, state, layout, clock, screen, advance }
// `source` defaults to desktop/main.cjs; the 13.1 excerpt (tests/fixtures/caption-13-1.txt) runs the same way through `legacy: true`.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { updateCaption } = require('../desktop/platform.cjs');

const NOTCH_HEIGHT = 34;
const alpha = color => {
  const rgba = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)$/.exec(color);
  if (rgba) return Number(rgba[1]);
  const hex = /^#([\da-f]{8})$/i.exec(color);
  return hex ? parseInt(hex[1].slice(6), 16) / 255 : 1;
};

/** A BrowserWindow that remembers every call that matters to the caption, in order, and the state each call left behind. `dropOverlay()` is what Windows does when it
 * loses what the overlay drew: the buttons are gone from the screen, and nothing tells the app. */
function fakeWindow({ minimizable = true, maximizable = true, maximized = false } = {}) {
  const state = { minimizable, maximizable, maximized, overlay: null, drawn: null, overlays: [], calls: [], states: [], failOverlay: 0, visible: true, minimized: false, fullscreen: false, bounds: { x: 100, y: 50, width: 1200, height: 800 } };
  const note = call => { state.calls.push(call); state.states.push({ call, minimizable: state.minimizable, maximizable: state.maximizable, overlay: state.drawn && { ...state.drawn } }); };
  const window = {
    isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => state.minimized, isFullScreen: () => state.fullscreen, isFocused: () => true,
    getContentBounds: () => ({ ...state.bounds }),
    isMinimizable: () => state.minimizable, isMaximizable: () => state.maximizable, isMaximized: () => state.maximized,
    setMinimizable(on) { state.minimizable = on; note('setMinimizable(' + on + ')'); },
    setMaximizable(on) { state.maximizable = on; note('setMaximizable(' + on + ')'); },
    setTitleBarOverlay(overlay) { if (state.failOverlay > 0) { state.failOverlay--; throw new Error('the overlay could not be set'); } state.overlay = { ...overlay }; state.drawn = { ...overlay }; state.overlays.push({ ...overlay }); note(alpha(overlay.symbolColor) === 0 ? 'overlay(transparent)' : 'overlay(visible)'); },
    setBackgroundColor(color) { note('background(' + color + ')'); },
  };
  /** Windows drops what the overlay drew: the person sees no buttons until the overlay is sent again. main's own bookkeeping is untouched. */
  state.dropOverlay = () => { state.drawn = null; };
  return { window, state };
}

/** What a person would see after a call: nothing (transparent or dropped), or the box with the buttons Windows draws for the flags at that moment. */
const seen = s => !s.overlay || (alpha(s.overlay.color) === 0 && alpha(s.overlay.symbolColor) === 0) ? null : { buttons: 1 + (s.minimizable ? 1 : 0) + (s.maximizable ? 1 : 0) };

function realMainCaption({ source, layout: layoutInit, flags, legacy = false, edge = null } = {}) {
  const text = fs.readFileSync(source || path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const between = (a, b) => { const from = text.indexOf(a), to = text.indexOf(b, from); assert.ok(from >= 0 && to > from, 'the source still has ' + a + ' .. ' + b); return text.slice(from, to); };
  const decls = /let captionKey='',captionHiddenNow=false[^\n]*\n/.exec(text)[0];
  const guardSource = legacy ? between('/** Windows: while the caption is hidden', 'function nativeTokens()') : /const captionGuard=require\('\.\/caption-guard\.cjs'\)[^\n]*\n/.exec(text)[0];
  const watchSource = legacy ? '' : /\/\*\* Windows safety nets[^\n]*\n(?:\/\*[^\n]*\*\/\n)?const captionWatch=require\('\.\/caption-watch\.cjs'\)[^\n]*\n/.exec(text)[0];
  const setCaptionSource = between('const captionBacking=', 'const uiCrashTimes=[];');
  const handler = /notchShown:(shown=>\{if\(captionNotchShown===shown\)return;captionNotchShown=shown;setCaption\(\);\})/.exec(text)?.[1] || 'shown=>{if(captionNotchShown===shown)return;captionNotchShown=shown;setCaption();}';

  const isShown = /notchIsShown:(\(\)=>captionNotchShown)/.exec(text)?.[1] || '()=>captionNotchShown';
  const { window, state } = fakeWindow(flags);
  const layout = { appearance: 'light', viewport: { width: 1200, height: 800 }, captionHeight: NOTCH_HEIGHT, captionNotch: true, ...layoutInit };
  const clock = { t: 100000, timers: [] };
  const screen = { point: { x: 700, y: 500 }, getCursorScreenPoint() { return { ...this.point }; } };
  const timer = (fn, ms) => { const entry = { fn, at: clock.t + ms, unref() {} }; clock.timers.push(entry); return entry; };
  const untimer = entry => { const at = clock.timers.indexOf(entry); if (at >= 0) clock.timers.splice(at, 1); };
  const watchModule = require('../desktop/caption-watch.cjs'), logged = [];
  const sandbox = {
    process: { platform: 'win32' }, mainWindow: window, layout, screen, Date: { now: () => clock.t }, processErrors: { record: (kind, detail) => logged.push(kind + ': ' + detail) },
    updateCaption: (w, caption) => updateCaption(w, caption, 'win32'), // main passes no platform: platform.cjs reads process.platform, which here is the Mac's
    currentMaterial: () => 'acrylic', nativeTokens: () => ({ '--frame': '#eef0f2' }),
    setTimeout: timer, clearTimeout: untimer,
    require: id => {
      if (id === './caption-guard.cjs') return require('../desktop/caption-guard.cjs');
      if (id === './caption-watch.cjs') return { ...watchModule, createCaptionWatch: options => watchModule.createCaptionWatch({ ...options, now: () => clock.t, schedule: timer, cancel: untimer }) };
      throw new Error('unexpected require ' + id);
    },
  };
  vm.createContext(sandbox);
  const expose = `;globalThis.__caption={setCaption,notchShown:${handler},hiddenNow:()=>captionHiddenNow,notchIsShown:${isShown},shownAt:()=>captionShownAt,forcedNow:()=>typeof captionForced==='undefined'?false:captionForced,watch:typeof captionWatch==='undefined'?null:captionWatch,setInterfaceDown:value=>{if(typeof interfaceDown!=='undefined')interfaceDown=value;},guard:typeof captionGuard==='undefined'?null:captionGuard};`;
  vm.runInContext(decls + guardSource + watchSource + setCaptionSource + expose, sandbox);
  // `edge: { state }` (13.5): main's OWN edgeItem (what the edge poller asks of this window: which edges exist, the caption corner, the notch, the corner fallback's tick) is cut out of the source
  // too and run in the same sandbox, wired to this fake window, so a test can run the real poller (desktop/edge-reveal.cjs) over it. Everything else it reads is a stub the test controls.
  if (edge) {
    const line = /const edgeHolds=\{top:false,side:false\},edgeKeys=[^\n]*\n/.exec(text);
    assert.ok(line, 'the source still has the edge item');
    const runtime = require('../desktop/runtime.cjs');
    Object.assign(sandbox, { state: edge.state, pointerHeld: { held: false }, edgeIntent: { busy: false, engaged: false, hover: false, cursor: 'default' }, pageFullscreen: { any: () => false }, wakeInterface: () => {}, emitBrowser: () => {},
      effectiveView: runtime.effectiveView, hideToolbarOn: runtime.hideToolbarOn, seamlessEdgesOf: runtime.seamlessEdgesOf, sidebarPeekOf: runtime.sidebarPeekOf, workspaceIsOpen: runtime.workspaceIsOpen });
    vm.runInContext(line[0] + ';globalThis.__caption.edgeItem=edgeItem;', sandbox);
  }
  /** Run the fake clock forward, firing timers in order (the legacy 200 ms release, the watcher's 50 ms look, the refresh, a settle). */
  const advance = ms => {
    const end = clock.t + ms;
    for (;;) {
      clock.timers.sort((a, b) => a.at - b.at);
      const next = clock.timers[0];
      if (!next || next.at > end) break;
      clock.t = next.at; clock.timers.shift(); next.fn();
    }
    clock.t = end;
  };
  /** What the edge poller does for this window: every `step` ms (16 while an edge is active, 250 idle) it calls the item's captionTick. */
  const poll = (ms, step = 50) => { for (let left = ms; left > 0; left -= step) { advance(Math.min(step, left)); sandbox.__caption.watch?.tick(); } };
  return { api: sandbox.__caption, window, state, layout, clock, screen, advance, poll, logged };
}

module.exports = { realMainCaption, fakeWindow, seen, alpha, NOTCH_HEIGHT };
