'use strict';
// 13.10 (Discord, several Windows users: "I move the mouse to the left to make the sidebar appear, many times it does not, I have to click the window somewhere
// first"): the edge reveal used to stand down for any window that did not hold the keyboard (edge-reveal.cjs: `focused = win.isFocused()`), however plainly the
// pointer was on it. A window beside another app (a second monitor, a snapped pair, after a popup, the taskbar, a toast) is visible and under the pointer but not
// "active". Now the reveal also works there when the window's own views are the ones receiving the pointer (desktop/pointer-point.cjs createPointerWitness), and
// still not when another window covers it (no pointer events reach this window then).
const test = require('node:test'), assert = require('node:assert/strict');
const { watchChromeEdges, EDGE } = require('../desktop/edge-reveal.cjs');
const { createPointerWitness } = require('../desktop/pointer-point.cjs');

const BOX = { x: 100, y: 50, width: 1200, height: 800 };
const at = (x, y) => ({ x: BOX.x + x, y: BOX.y + y });

/** One window in the poller on a fake clock. `witness(point)` says whether this window's own views have the pointer. */
function rig({ focused = false, witness = () => true, view = 'seamless', edges = { top: true, side: true }, peek } = {}) {
  const emitted = [], delays = [];
  let timeout = null;
  const clock = { t: 5000 };
  const screen = { point: at(600, 400), getCursorScreenPoint() { return this.point; } };
  const win = { focused, destroyed: false, isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; }, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => ({ ...BOX }), on() {} };
  const state = { settings: { verticalTabs: true } };
  const asked = [];
  const item = {
    window: win, state, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => edges, docked: () => false, suspended: () => false,
    pointerOver: (point, box) => { asked.push({ point, box }); return witness(point); },
  };
  if (peek) item.peek = () => peek;
  const app = { whenReady: () => Promise.resolve(), on() {} };
  const poller = watchChromeEdges({ app, windows: () => [item], screen, view: () => view, now: () => clock.t, schedule: (fn, delay) => { delays.push(delay); timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; if (fn) fn(); } };
  const edgeEvents = () => emitted.filter(event => event.type === 'chrome-edge');
  return { win, screen, emitted, delays, poller, run, edgeEvents, asked, item, clock, start: () => { timeout(); } };
}

test('a window beside another app (visible, under the pointer, not the keyboard\'s) shows its sidebar when the pointer rests at its edge', () => {
  const r = rig({ focused: false });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(600, 400); r.run(64);
    assert.deepEqual(r.edgeEvents(), [], 'nothing while the pointer is in the page');
    r.screen.point = at(3, 400); r.run(200);
    assert.deepEqual(r.edgeEvents().at(-1), { type: 'chrome-edge', top: false, side: true, pinned: { top: false, side: false } }, 'the sidebar comes although the window is not the active one');
    r.screen.point = at(600, 400); r.run(1500);
    assert.equal(r.edgeEvents().at(-1).side, false, 'and goes again when the pointer leaves');
  });
});

test('a window another app covers (its views get no pointer) never reveals, whatever the cursor position says', () => {
  const r = rig({ focused: false, witness: () => false });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(3, 400); r.run(400);
    assert.deepEqual(r.edgeEvents(), []);
  });
});

test('the top edge works the same way in an unfocused window under the pointer', () => {
  const r = rig({ focused: false });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(400, 2); r.run(200);
    assert.equal(r.edgeEvents().at(-1)?.top, true);
  });
});

test('an unfocused window is looked at slowly while the pointer is far from its edges and at 16 ms as it comes near (no per-frame work for a window nobody is touching)', () => {
  const r = rig({ focused: false });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(700, 400); r.run(32);
    assert.ok(r.delays.at(-1) >= 30 && r.delays.at(-1) < 250, 'far from every edge: a sparse look (the distance to the nearest edge / 10 ms), got ' + r.delays.at(-1));
    r.screen.point = { x: BOX.x + 6000, y: BOX.y + 400 }; r.run(32);
    assert.equal(r.delays.at(-1), 250, 'far outside the window: the idle look');
    r.screen.point = at(40, 400); r.run(32);
    assert.equal(r.delays.at(-1), 16, 'close to the edge zone: every frame');
  });
});

test('a window that holds the keyboard is polled every frame, as before', () => {
  const r = rig({ focused: true });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(700, 400); r.run(64);
    assert.equal(r.delays.at(-1), 16);
    assert.equal(r.asked.length, 0, 'the witness is not asked while the keyboard is the window\'s');
  });
});

test('a shown sidebar stays while the pointer is still on the window after the keyboard goes elsewhere, and goes when the pointer is not (covered)', () => {
  let over = true;
  const r = rig({ focused: true, witness: () => over });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(3, 400); r.run(200);
    assert.equal(r.edgeEvents().at(-1)?.side, true);
    r.win.focused = false;                                          // Alt+Tab to another app; the pointer has not moved
    r.run(800);
    assert.equal(r.edgeEvents().at(-1)?.side, true, 'still on the window: it stays');
    over = false;                                                   // the other app's window now covers the pointer
    r.run(160);
    assert.equal(r.edgeEvents().at(-1)?.side, true, 'a moment is given (the push out across the edge is still followed, EXIT_WINDOW)');
    r.run(1600);
    assert.equal(r.edgeEvents().at(-1)?.side, false, 'covered: it hides');
  });
});

// 13.10 (laptop, 15 Nov, 5 of 5 tries: "unfocused TOP edge, the toolbar comes down in one frame and goes away at ~0.75 s while the pointer is still on it"): the toolbar's blank part is a window drag region,
// Windows sends no pointer events from one, and the witness (which is the only thing that says the pointer is on an unfocused window) went quiet: EXIT_WINDOW (700 ms) ran out and the poller hid the bar.
test('an unfocused top bar stays while the pointer rests on it, although its drag region sends no pointer events (the witness goes quiet)', () => {
  let quiet = false;
  const r = rig({ focused: false, witness: p => !(quiet && p.y < BOX.y + 72) });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(400, 2); r.run(200);
    assert.equal(r.edgeEvents().at(-1)?.top, true, 'the pointer was witnessed as it arrived: the bar comes');
    quiet = true;                                                   // the pointer is now over the toolbar's drag region
    r.run(3000);
    assert.equal(r.edgeEvents().at(-1)?.top, true, 'still there 3 s later: the pointer has not moved');
    assert.equal(r.edgeEvents().filter(e => e.top === false).length, 0, 'it never went away and came back');
    r.screen.point = at(400, 400); r.run(1500);
    assert.equal(r.edgeEvents().at(-1)?.top, false, 'it goes when the pointer leaves, as before');
  });
});

test('an unfocused top bar still goes when the pointer leaves the window altogether, and the sidebar still goes when another window covers it', () => {
  let quiet = false;
  const r = rig({ focused: false, witness: p => !(quiet && p.y < BOX.y + 72) });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(400, 2); r.run(200);
    quiet = true; r.run(800);
    r.screen.point = { x: BOX.x + 400, y: BOX.y - 40 }; r.run(2000);            // up onto the monitor above: outside the window box
    assert.equal(r.edgeEvents().at(-1)?.top, false, 'off the window: EXIT_WINDOW runs out');
  });
});

test('a window another app covers never reveals its top bar either, and a top bar that was never witnessed is not held by position alone', () => {
  const r = rig({ focused: false, witness: () => false });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(400, 2); r.run(600);
    assert.deepEqual(r.edgeEvents(), []);
  });
});

test('a window whose item has no witness (older callers, Wayland) behaves exactly as before: idle while unfocused', () => {
  const r = rig({ focused: false });
  delete r.item.pointerOver;
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(3, 400); r.run(400);
    assert.deepEqual(r.edgeEvents(), []);
    assert.equal(r.delays.at(-1), 250);
  });
});

test('Seamless with both switches off and Full with a docked sidebar stay idle even when unfocused and witnessed (no edge to reveal, no cursor reads)', () => {
  const r = rig({ focused: false, view: 'full', edges: { top: false, side: false }, peek: { full: false, compact: false, focus: false } });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(3, 400); r.run(400);
    assert.deepEqual(r.edgeEvents(), []);
    assert.equal(r.delays.at(-1), 250);
  });
});

test('a push out across the left edge (onto the neighbouring monitor, where no event of this window follows) still reveals in an unfocused window, as it does in the window in front', () => {
  // the witness answers only for places inside the window: past its edge another window has the pointer
  const r = rig({ focused: false, witness: point => point.x >= BOX.x });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(60, 400); r.run(48);
    r.screen.point = at(2, 400); r.run(16);
    r.screen.point = at(-30, 400); r.run(400);                      // flicked past the edge and stopped there
    assert.equal(r.edgeEvents().at(-1)?.side, true, 'the stop just past the edge is a reveal');
  });
});

test('a pointer that left the window long ago (another monitor, another app) is no longer its pointer: nothing is looked at every frame', () => {
  const r = rig({ focused: false, witness: point => point.x >= BOX.x });
  return Promise.resolve().then(() => {
    r.start();
    r.screen.point = at(60, 400); r.run(48);
    r.screen.point = at(-400, 400); r.run(1500);                    // far beyond the push-out reach: it went to the other monitor
    assert.deepEqual(r.edgeEvents().filter(e => e.side), [], 'no reveal for a pointer that is somewhere else');
    r.screen.point = { x: BOX.x - 3000, y: BOX.y + 400 }; r.run(64);
    assert.equal(r.delays.at(-1), 250, 'and the window is back to the idle look');
  });
});

test('two windows: the pointer reveals the edge of the one it is over only, whichever holds the keyboard', () => {
  const emitted = { a: [], b: [] }, clock = { t: 5000 };
  let timeout = null;
  const boxA = { x: 0, y: 0, width: 900, height: 700 }, boxB = { x: 1000, y: 0, width: 900, height: 700 };   // side by side on two monitors
  const screen = { point: { x: 500, y: 350 }, getCursorScreenPoint() { return this.point; } };
  const mk = (box, name, focused, over) => {
    const win = { isDestroyed: () => false, isFocused: () => focused, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => ({ ...box }), on() {} };
    return { window: win, state: { settings: { verticalTabs: true } }, emit: e => emitted[name].push(e), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false,
      pointerOver: p => over(p, box) };
  };
  const inside = (p, box) => p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height;
  const A = mk(boxA, 'a', true, inside), B = mk(boxB, 'b', false, inside);   // A holds the keyboard, B is under the pointer
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [A, B], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  return Promise.resolve().then(() => {
    timeout();
    screen.point = { x: 1003, y: 350 }; run(300);                  // B's left edge, B is not the active window
    assert.equal(emitted.b.filter(e => e.type === 'chrome-edge').at(-1)?.side, true, 'the window under the pointer reveals');
    assert.deepEqual(emitted.a.filter(e => e.type === 'chrome-edge'), [], 'the one that holds the keyboard, elsewhere, does not');
    screen.point = { x: 3, y: 350 }; run(1500);                    // now A's left edge
    assert.equal(emitted.a.filter(e => e.type === 'chrome-edge').at(-1)?.side, true);
    assert.equal(emitted.b.filter(e => e.type === 'chrome-edge').at(-1)?.side, false, 'B let go when the pointer left it');
  });
});

// ---- the witness ----------------------------------------------------------------------------------------------------------------
test('the witness: the window\'s own pointer events place the pointer; it matches the screen point of the same place and nothing else', () => {
  let t = 1000;
  const w = createPointerWitness({ now: () => t });
  const page = {}, ui = {};
  assert.equal(w.over(at(3, 400), BOX), false, 'no event yet');
  w.note(page, { type: 'mouseMove', x: 3, y: 400 }, { x: 0, y: 0 });
  assert.equal(w.over(at(3, 400), BOX), true);
  assert.equal(w.over(at(3, 410), BOX), true, 'a fresh event: the cursor may be a little ahead of it');
  t += 500;
  assert.equal(w.over(at(3, 400), BOX), true, 'a resting pointer stays witnessed');
  assert.equal(w.over(at(3, 410), BOX), false, 'an old event and a cursor that has since moved away: not this window');
  assert.equal(w.over(at(300, 400), BOX), false);
  assert.equal(w.over(null, BOX), false);
});

test('the witness: a view\'s origin is added, mouseLeave from the owner clears it, a leave from another view does not', () => {
  let t = 1000;
  const w = createPointerWitness({ now: () => t });
  const page = {}, ui = {};
  w.note(page, { type: 'mouseMove', x: 4, y: 100 }, { x: 6, y: 6 });     // the page starts 6 px in (Seamless)
  assert.equal(w.over(at(10, 106), BOX), true);
  w.note(ui, { type: 'mouseMove', x: 3, y: 106 }, { x: 0, y: 0 });         // the pointer moved onto the interface's border strip
  assert.equal(w.over(at(3, 106), BOX), true);
  w.note(page, { type: 'mouseLeave' }, { x: 6, y: 6 });                    // the page reports its leave late: the interface keeps it
  t += 300;
  assert.equal(w.over(at(3, 106), BOX), true);
  w.note(ui, { type: 'mouseLeave' }, { x: 0, y: 0 });
  assert.equal(w.over(at(3, 106), BOX), false, 'left the window (another app\'s window now has it)');
});

test('the witness: a view that goes away while it had the pointer', () => {
  const w = createPointerWitness({ now: () => 1000 });
  const page = {};
  w.note(page, { type: 'mouseMove', x: 3, y: 100 }, { x: 0, y: 0 });
  w.forget(page);
  assert.equal(w.over(at(3, 100), BOX), false);
});

test('the witness ignores events that carry no position and non-finite numbers', () => {
  const w = createPointerWitness({ now: () => 1000 });
  const page = {};
  w.note(page, { type: 'keyDown' }, { x: 0, y: 0 });
  w.note(page, { type: 'mouseMove', x: NaN, y: 1 }, { x: 0, y: 0 });
  w.note(page, { type: 'mouseMove', x: 1, y: 1 }, null);
  assert.equal(w.over(at(1, 1), BOX), false);
  assert.ok(EDGE.side > 0);
});

// ---- main wires it ----------------------------------------------------------------------------------------------------------------
test('main feeds the witness from the same pointer hooks as the "button held" rule and hands the edge item its pointerOver', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.ok(main.includes("require('./pointer-point.cjs').createPointerWitness()"), 'one witness per window');
  assert.match(main, /pointerWitness\.note\(owner,mouse,origin\)/, 'every page and the interface report to it (notePointer)');
  assert.match(main, /notePointer\(wc,mouse,entry\.view\)/, 'the pages');
  assert.match(main, /notePointer\(chromeView\.webContents,mouse,chromeView\)/, 'the interface');
  assert.match(main, /pointerOver:\(point,box\)=>pointerWitness\.over\(point,box\)/, 'the poller asks it');
  assert.match(main, /pointerWitness\.forget\(wc\)/, 'a closed page gives the pointer back');
});

// ---- how far a pointer is from an edge's reach (the sparse look of a window nobody holds the keyboard of) ----------------------------
test('edgeDistance: zero in the zone, the inward distance beyond it, mirrored for a right sidebar, only for the enabled edges, and far for a pointer far outside', () => {
  const { edgeDistance, cornerLook } = require('../desktop/edge-reveal.cjs');
  const b = { x: 100, y: 50, width: 1200, height: 800 }, both = { top: true, side: true }, side = { top: false, side: true };
  assert.equal(edgeDistance({ x: 106, y: 450 }, b, side, 'left'), 0);
  assert.equal(edgeDistance({ x: 100 + 112, y: 450 }, b, side, 'left'), 100, 'zone 10 + 2 slack: 100 DIPs further in');
  assert.equal(edgeDistance({ x: 100 + 1200 - 1 - 6, y: 450 }, b, side, 'right'), 0, 'the right sidebar\'s edge is the window\'s right edge');
  assert.equal(edgeDistance({ x: 106, y: 450 }, b, { top: false, side: false }, 'left'), Infinity, 'no edge enabled, nothing to come near');
  assert.ok(edgeDistance({ x: 700, y: 450 }, b, side, 'left') >= edgeDistance({ x: 700, y: 450 }, b, both, 'left'), 'more enabled edges can only be nearer');
  assert.equal(edgeDistance({ x: 700, y: 52 }, b, { top: true, side: false }, 'left'), 0, 'the top zone');
  assert.equal(edgeDistance(null, b, both, 'left'), Infinity);
  assert.equal(cornerLook(edgeDistance({ x: 5000, y: 450 }, b, side, 'left')), 250, 'far outside: the idle look');
  assert.equal(cornerLook(edgeDistance({ x: 140, y: 450 }, b, side, 'left')), 16, 'near: every frame');
});

// 13.10 second round (laptop 15 Nov, and a Linux user's video on 13.9: "the panel appears in one frame, its rows slide in afterwards"): the two rules that let the page's picture stand under the sliding sidebar
// (the page area transparent, overflow visible, for the length of the transition) were written for the live-glass state only. Windows with the window inactive or transparency off, and Linux (no window material at all), run the
// state `desktopMaterial !== ready`: it needs the same two rules, or the page area clips the picture at the sidebar's new edge and the sidebar's column is one dark flat in the first frame.
test('the page area lets the picture stand under the sliding sidebar in every material state, the live one and the others (Windows inactive, transparency off, Linux)', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/styles/sidebar-overlay.css'), 'utf8');
  const rules = css.split('\n').filter(line => /^:root/.test(line));
  for (const declaration of [/\.app \.page-area \{[^}]*transparent!important;\s*\}$/, /:is\(\.page-area,\.browser-body,\.browser-root\) \{ overflow:visible; \}$/]) {
    const carrying = rules.filter(line => declaration.test(line));
    assert.ok(carrying.some(line => line.startsWith(':root[data-desktop-material=ready]')), 'the live state keeps its rule: ' + declaration);
    assert.ok(carrying.some(line => line.startsWith(':root:not([data-desktop-material=ready])')), 'and every other state has the same rule, for any material (Linux is data-material=none): ' + declaration);
  }
});
