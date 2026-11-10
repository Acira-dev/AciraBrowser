'use strict';
// Windows, Sidebar mode: the caption buttons' notch (desktop/caption-notch.cjs) shows only while the pointer is along the top of the window.
// The rules are Seamless's top edge (tests/edge-reveal.test.cjs pins those), here on a fake clock with what is new: when it is on, where the pointer shows it,
// that it hides again, the corner, and the poller's plumbing (main's caption overlay hears about it; the interface hears nothing).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createCaptionNotch, NOTCH, CORNER } = require('../desktop/caption-notch.cjs');
const { watchChromeEdges, EDGE, GRACE, MIN_VISIBLE } = require('../desktop/edge-reveal.cjs');

const STEP = 16;
const win = { x: 100, y: 50, width: 1200, height: 800 };
const at = (x, y) => ({ x: win.x + x, y: win.y + y });
const away = at(600, 400);
const on = { focused: true, suspended: false, active: true, hidden: true, speed: 'premium', pressed: false, bounds: win };

function rig(extra = {}) {
  const clock = { t: 10_000 }, notch = createCaptionNotch({ now: () => clock.t });
  let shown = false, hidden = true;
  /** Samples every STEP ms for `ms`; `hidden` follows what the notch answered, as main's caption state does. */
  const hold = (point, ms, over = {}) => {
    for (let elapsed = 0; elapsed <= ms; elapsed += STEP) {
      shown = notch.sample({ ...on, ...extra, hidden, ...over, point });
      hidden = !shown;
      if (elapsed + STEP <= ms) clock.t += STEP;
    }
    clock.t += STEP;
    return shown;
  };
  const until = (point, limit, over = {}) => { for (let elapsed = 0; elapsed <= limit; elapsed += STEP) { if (hold(point, 0, over)) return elapsed; } return null; };
  return { hold, until, clock, notch };
}

test('the notch is the three caption buttons: 138 x 34, and its corner is a little larger', () => {
  assert.deepEqual(NOTCH, { width: 138, height: 34 });
  assert.ok(CORNER.width > NOTCH.width && CORNER.height >= NOTCH.height);
  const ui = fs.readFileSync(path.join(__dirname, '../src/ui/addressInSidebar.ts'), 'utf8');
  assert.match(ui, /export const NOTCH_HEIGHT = 34;/, 'the interface asks the window for the same height');
});

test('hidden while the pointer is in the page; shown while it rests along the top edge, anywhere along it', () => {
  for (const x of [20, 300, 600, 1100]) {
    const r = rig();
    assert.equal(r.hold(away, 600), false, 'pointer in the page');
    const when = r.until(at(x, 3), 600);
    assert.ok(when !== null && when <= 160, `x ${x}: shows after a rest at the top edge (${when} ms)`);
  }
});

test('a pointer that only passes along the top does not show it; one that rests in the 8 px zone does', () => {
  const r = rig();
  assert.equal(r.hold(t => at(50 + t * 1.2, 4), 700), false, 'sweeping along the top is a pass');
  assert.equal(r.hold(at(500, EDGE.top), 400), true, 'a rest at the zone\'s lower edge shows it');
  const lower = rig();
  assert.equal(lower.hold(at(500, EDGE.top + 4), 600), false, 'just below the zone: nothing');
});

test('it stays while the pointer is on the notch\'s band, and goes after the pointer has been away for the grace', () => {
  const r = rig();
  r.hold(at(1000, 3), 300);
  assert.equal(r.hold(at(1150, NOTCH.height - 4), 800), true, 'on the buttons: it stays');
  assert.equal(r.hold(at(600, NOTCH.height + 8), 800), true, 'the controller\'s leeway around it still counts as on it');
  assert.equal(r.hold(away, 200), true, 'leaving starts the grace');
  r.hold(away, Math.max(GRACE.top, MIN_VISIBLE) + 200);
  assert.equal(r.hold(away, 0), false, 'gone once the grace is over');
});

test('the corner where the hidden buttons are shows the notch at once, so they are never clicked invisible', () => {
  const r = rig();
  const before = r.hold(away, 200);
  assert.equal(before, false);
  const t0 = r.clock.t;
  assert.equal(r.hold(at(win.width - 20, 20), 0), true, 'one sample in the corner: shown');
  assert.equal(r.clock.t - t0 <= STEP, true);
  const near = rig();
  assert.equal(near.hold(at(win.width - CORNER.width - 20, 20), 300), false, 'beside the corner (not on the top edge): nothing');
});

test('nothing shows when the window is not in Sidebar mode on Windows (active off), not focused, minimised or fullscreen, or while a button is held', () => {
  for (const over of [{ active: false }, { focused: false }, { suspended: true }, { pressed: true }]) {
    const r = rig();
    assert.equal(r.hold(at(500, 2), 600, over), false, JSON.stringify(over));
  }
});

test('turning the mode off hides it at once', () => {
  const r = rig();
  assert.equal(r.hold(at(500, 2), 400), true);
  assert.equal(r.hold(at(500, 2), 0, { active: false }), false);
  assert.equal(r.notch.active(), false, 'and the poller can go back to its slow look-around');
});

test('a window that moved or resized does not show it from the pointer that was already at the top', () => {
  const r = rig();
  assert.equal(r.hold(at(500, 2), 40), false, 'the dwell has begun');
  assert.equal(r.hold(at(500, 2), 400, { bounds: { ...win, width: 1000 } }), false, 'grabbing the border to resize is not a rest at the edge');
});

// ---- the poller -------------------------------------------------------------------------------------------------------------------
test('the poller shows and hides the notch through item.notchShown, sends the interface nothing, and stays on its fast cadence only while there is work', () => {
  const calls = [], emitted = [], delays = [];
  let timeout = null, mode = { active: true, hidden: true };
  const clock = { t: 5000 };
  const screen = { point: { x: 600, y: 400 }, getCursorScreenPoint() { return this.point; } };
  const bounds = { x: 0, y: 0, width: 1200, height: 800 };
  const w = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => bounds, on() {} };
  // Sidebar mode on Windows is not Seamless: the controller's own edges are those of the Full view with the sidebar open, which has none.
  const item = { window: w, state: { settings: { verticalTabs: true } }, emit: event => emitted.push(event), size: () => ({ topHeight: 6, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: false, side: true }), docked: () => true, suspended: () => false,
    notch: () => mode, notchShown: shown => { calls.push(shown); mode = { active: true, hidden: !shown }; } };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => 'full', now: () => clock.t, schedule: (fn, delay) => { delays.push(delay); timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  return Promise.resolve().then(() => {
    timeout();
    run(160);
    assert.deepEqual(calls, [], 'pointer in the page: nothing');
    assert.equal(delays.at(-1), 16, 'a focused window in the mode is watched at 16 ms');
    screen.point = { x: 400, y: 2 };
    run(240);
    assert.deepEqual(calls, [true], 'the pointer rests at the top: shown, once');
    screen.point = { x: 600, y: 400 };
    run(1400);
    assert.deepEqual(calls, [true, false], 'the pointer went to the page: hidden, once');
    assert.deepEqual(emitted.filter(event => event.type === 'chrome-edge' && (event.top || event.pinned.top)), [], 'the interface is told nothing about the top');
    mode = null;
    run(64);
    assert.equal(delays.at(-1), 250, 'off the mode, with nothing else to watch, the poller idles again');
    mode = { active: false, hidden: false };
    screen.point = { x: 400, y: 2 };
    run(400);
    assert.deepEqual(calls, [true, false], 'inactive: never shown');
  });
});

test('main\'s caption overlay is the notch: floating over the page, opaque in the frame colour, hidden (transparent, buttons guarded) while the pointer is away, and the interface asks for it only on Windows in Sidebar mode', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const main = read('desktop/main.cjs'), app = read('src/App.tsx'), validation = read('desktop/validation.cjs'), ui = read('src/ui/addressInSidebar.ts');
  assert.match(main, /const notch=process\.platform==='win32'&&layout\.captionNotch===true;if\(!notch&&captionNotchShown\)captionNotchShown=false;/);
  assert.match(main, /floating=layout\.captionFloat===true\|\|notch,hidden=process\.platform==='win32'&&\(notch\?!captionNotchShown:layout\.captionHidden===true\)/, 'hidden unless the watcher shows it; Seamless\'s own hidden state is untouched');
  assert.match(main, /captionBacking\(tone,notch\?1:\.88\)/, 'the notch is opaque, Seamless\'s floating caption keeps its .88');
  assert.match(main, /notch:\(\)=>process\.platform==='win32'\?\{active:layout\.captionNotch===true,hidden:captionHiddenNow\}:null,notchIsShown:\(\)=>captionNotchShown,notchShown:/);
  assert.match(validation, /'captionHidden','captionNotch','pageDragging'/);
  assert.match(validation, /boolean\(value\.captionNotch,'Caption notch'\)/);
  assert.match(app, /captionNotchWanted\(document\.documentElement\.dataset\.platform \|\| 'darwin', addrWanted, windowFullscreen, addrSide, seamless\)/, '13.5: the setting, not the Full header: Seamless has the notch too (tests/caption-seamless-sidebar-mode.test.ts)');
  assert.match(app, /\.\.\.\(captionNotch \? \{ captionNotch: true, captionHeight: NOTCH_HEIGHT \} : \{\}\)/, 'the notch\'s height replaces the strip\'s, after the ordinary one');
  assert.match(ui, /captionNotchWanted = \(platform: string, sidebarMode: boolean, fullscreen: boolean, side: 'left' \| 'right' = 'left', seamless = false\): boolean => platform === 'win32' && sidebarMode && !fullscreen && \(side === 'left' \|\| seamless\);/);
});
