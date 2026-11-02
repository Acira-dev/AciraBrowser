'use strict';
// Letterboxing and uniform screen values for Tor pages: Tor Browser's stepping (RFPHelper), views centred in their room, the screen/pixel-ratio script, and that main.cjs and the
// interface apply them to Tor pages only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {steppedSize, letterboxBounds, UNIFORM_SCREEN_SOURCE} = require('../desktop/browser-services/tor-window.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('stepping follows Tor Browser: 50 up to 500, then 200 wide by 100 high up to 1600, then 200; 50 and below untouched', () => {
  const cases = [[30, 30, 30], [50, 50, 50], [51, 50, 50], [99, 50, 50], [100, 100, 100], [499, 450, 450], [500, 500, 500], [501, 400, 500], [799, 600, 700], [800, 800, 800], [1199, 1000, 1100], [1440, 1400, 1400], [1600, 1600, 1600], [1601, 1600, 1600], [1919, 1800, 1800], [2560, 2400, 2400]];
  for (const [size, width, height] of cases) { assert.equal(steppedSize(size, true), width, `width ${size}`); assert.equal(steppedSize(size, false), height, `height ${size}`); }
});

test('a view is made letterbox-sized and centred in the room it had; a view that fits is left alone', () => {
  assert.deepEqual(letterboxBounds({x: 10, y: 20, width: 1439, height: 850}), {x: 29, y: 45, width: 1400, height: 800});
  assert.deepEqual(letterboxBounds({x: 0, y: 0, width: 1400, height: 800}), {x: 0, y: 0, width: 1400, height: 800});
  for (const [width, height] of [[1317, 743], [1920, 1017], [777, 555], [3001, 1700]]) {
    const placed = letterboxBounds({x: 5, y: 7, width, height});
    assert.deepEqual(letterboxBounds(placed), placed, 'rounding twice changes nothing');
    assert.ok(placed.x >= 5 && placed.y >= 7 && placed.x + placed.width <= 5 + width && placed.y + placed.height <= 7 + height, 'inside its room');
    assert.ok(Number.isInteger(placed.x) && Number.isInteger(placed.y), 'whole pixels');
  }
});

function page({innerWidth = 1400, innerHeight = 800, crossOriginTop = false} = {}) {
  class Screen { get width() { return 1707; } get height() { return 960; } get availWidth() { return 1707; } get availHeight() { return 920; } get colorDepth() { return 30; } get pixelDepth() { return 30; } get availLeft() { return -1920; } get availTop() { return 0; } }
  const context = {Screen, screen: new Screen(), innerWidth, innerHeight, outerWidth: 1722, outerHeight: 1010, screenX: -1920, screenY: 12, screenLeft: -1920, screenTop: 12, devicePixelRatio: 1.5};
  context.window = context;
  context.top = crossOriginTop ? new Proxy({}, {get() { throw new Error('SecurityError'); }}) : context;
  vm.createContext(context);vm.runInContext(UNIFORM_SCREEN_SOURCE, context);
  return context;
}

test('the screen script reports the letterboxed window as the screen, a pixel ratio of 1 and no position', () => {
  const w = page({innerWidth: 1400, innerHeight: 800});
  assert.deepEqual([w.screen.width, w.screen.height, w.screen.availWidth, w.screen.availHeight], [1400, 800, 1400, 800]);
  assert.deepEqual([w.outerWidth, w.outerHeight], [1400, 800]);
  assert.deepEqual([w.screenX, w.screenY, w.screenLeft, w.screenTop, w.screen.availLeft, w.screen.availTop], [0, 0, 0, 0, 0, 0]);
  assert.equal(w.devicePixelRatio, 1);assert.equal(w.screen.colorDepth, 24);assert.equal(w.screen.pixelDepth, 24);
  w.innerWidth = 1000;w.innerHeight = 700;assert.deepEqual([w.screen.width, w.screen.height], [1000, 700], 'it follows the window');
});

test('inside a frame whose top page is another origin the frame\'s own size is used instead of throwing', () => {
  const w = page({innerWidth: 600, innerHeight: 300, crossOriginTop: true});
  assert.deepEqual([w.screen.width, w.screen.height, w.devicePixelRatio], [600, 300, 1]);
});

test('the emulation hands the script to every Tor page and frame, and a Tor page gets the same room and border as any other page (no letterbox margin)', () => {
  const torWindow = read('desktop/browser-services/tor-window.cjs'), main = read('desktop/main.cjs'), app = read('src/App.tsx'), css = read('src/features/tor/tor.css');
  assert.match(torWindow, /Page\.addScriptToEvaluateOnNewDocument',\{source:UNIFORM_SCREEN_SOURCE,runImmediately:true/);
  assert.match(main, /const letterboxed=\(entry,bounds\)=>bounds;/);
  assert.match(main, /bounds=letterboxed\(entry,fitted\)/);
  assert.doesNotMatch(app, /data-letterbox/);
  assert.doesNotMatch(css, /data-letterbox/);
});
