'use strict';
// 13.8 (Windows laptop, glitch 6): press an extension side panel's OWN close button (it calls window.close()) and then the extension's toolbar button: the panel never came back and an empty 384 px
// column stayed. Electron destroys a page's contents when it calls window.close() and takes its view out of the window; the host (extension-side-panel.cjs) never noticed, so the panel stayed
// "open" (open() answered {reused:true} for it for good) and Acira's card stayed as an empty column. Chromium: ExtensionHost::CloseContents -> Close() runs the close handler the side panel
// coordinator set (ExtensionSidePanelCoordinator::HandleCloseExtensionSidePanel): the panel is closed, the state is reset, onClosed is dispatched. No Electron: the views are fakes.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSidePanelHost} = require('../desktop/browser-services/extension-side-panel.cjs');

const EXT = 'a'.repeat(32), URL_A = `chrome-extension://${EXT}/panel.html`;

function rig({motion = 0} = {}) {
  const views = [], children = [];
  class FakeView {
    constructor() {
      const contents = new EventEmitter();
      Object.assign(contents, {
        destroyed: false, sent: [], ipcHandlers: {}, loaded: [],
        isDestroyed() { return this.destroyed; },
        close() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } },
        send(channel, payload) { this.sent.push([channel, payload]); },
        loadFile() { return Promise.resolve(); }, loadURL(url) { this.loaded.push(url); return Promise.resolve(); },
        setWindowOpenHandler() {},
        ipc: {on: (channel, fn) => { contents.ipcHandlers[channel] = fn; }}
      });
      this.webContents = contents; this.bounds = null; this.visible = false;
      views.push(this);
    }
    setBackgroundColor() {} setBounds(bounds) { this.bounds = bounds; } setVisible(value) { this.visible = value; } setBorderRadius() {}
  }
  const window = {isDestroyed: () => false, contentView: {get children() { return children; },
    addChildView(view, at) { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); if (at === undefined) children.push(view); else children.splice(at, 0, view); },
    removeChildView(view) { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); }}};
  let relayouts = 0;
  const host = createSidePanelHost({WebContentsView: FakeView, getWindow: () => window, pageBounds: () => ({x: 0, y: 0, width: 1200, height: 800}), relayout: () => { relayouts++; }, motionScale: () => motion});
  return {host, views, children, relayouts: () => relayouts};
}
/** What the extension's page does when it calls window.close(): Electron destroys its contents and the view leaves the window. */
const pageClosesItself = (r, panelView) => { r.children.splice(r.children.indexOf(panelView), 1); panelView.webContents.close(); };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a panel page that closes itself (window.close()) ends the panel like Close does: the host is empty, Acira\'s card is taken down, the page area is given back, onClosed is told once', async () => {
  const r = rig(), closed = [];
  await r.host.open({extensionId: EXT, name: 'Image Downloader', url: URL_A, session: {}, onClosed: details => closed.push(details)});
  const [frame, view] = r.views;
  assert.equal(r.host.current().extensionId, EXT);
  assert.deepEqual(r.children, [frame, view], 'the card and the page are in the window');
  const before = r.relayouts();
  pageClosesItself(r, view);
  await settle();
  assert.equal(r.host.current(), null, 'the panel is no longer "open"');
  assert.deepEqual(r.children, [], 'Acira\'s card (the empty 384 px column) is taken out of the window too');
  assert.ok(r.relayouts() > before, 'the page views get their width back');
  assert.deepEqual(closed, [{extensionId: EXT, url: URL_A}], 'onClosed goes to the extension, once');
  assert.equal(frame.webContents.destroyed, true, 'the card\'s contents are closed');
  // the page area is no longer reserved
  assert.deepEqual(r.host.trim({x: 0, y: 0, width: 1200, height: 800}, {x: 0, y: 0, width: 1200, height: 800}), {x: 0, y: 0, width: 1200, height: 800});
});

test('and the extension\'s button opens it again: open() makes a NEW panel, not {reused:true} for the dead one (3 presses, 2 rounds)', async () => {
  const r = rig();
  for (let round = 0; round < 2; round++) {
    for (let press = 0; press < 3; press++) {
      const result = await r.host.open({extensionId: EXT, name: 'Image Downloader', url: URL_A, session: {}});
      if (press === 0) assert.deepEqual(result, {opened: true}, `round ${round}: the first press opens the panel`);
      else assert.deepEqual(result, {reused: true}, `round ${round}: a press while it is open does nothing`);
      assert.ok(r.host.current(), 'the panel is open');
    }
    const [view] = r.views.slice(-1);
    pageClosesItself(r, view);
    await settle();
    assert.equal(r.host.current(), null, `round ${round}: closed by its own button`);
    assert.deepEqual(r.children, [], 'no column left');
  }
  assert.equal(r.views.length, 4, 'two rounds, each a new card and a new page');
});

test('belt and braces: a panel whose page is already gone when open() is asked (no event was heard) is closed and replaced, not "reused"', async () => {
  const r = rig();
  await r.host.open({extensionId: EXT, name: 'Image Downloader', url: URL_A, session: {}});
  const [, view] = r.views;
  view.webContents.destroyed = true;                       // gone without the event reaching the host
  r.children.splice(r.children.indexOf(view), 1);
  const result = await r.host.open({extensionId: EXT, name: 'Image Downloader', url: URL_A, session: {}});
  assert.deepEqual(result, {opened: true});
  assert.equal(r.views.length, 4);
  assert.equal(r.views[3].webContents.destroyed, false, 'the new page is alive');
  assert.equal(r.children.length, 2);
});

test('closing from Acira\'s side (the card\'s Close, host.close(), host.destroy()) still ends once: onClosed is told once, and the destroyed contents do not close it a second time', async () => {
  const r = rig(), closed = [];
  await r.host.open({extensionId: EXT, name: 'x', url: URL_A, session: {}, onClosed: details => closed.push(details)});
  const [frame] = r.views;
  frame.webContents.ipcHandlers['acira:side-panel-frame']({}, 'close');   // Acira's own X
  await settle();
  assert.equal(r.host.current(), null);
  assert.deepEqual(r.children, []);
  assert.equal(closed.length, 1, 'once, not once for the click and once for the contents going away');
  await r.host.open({extensionId: EXT, name: 'x', url: URL_A, session: {}, onClosed: details => closed.push(details)});
  r.host.destroy();
  await settle();
  assert.equal(closed.length, 1, 'destroy() (the window closing) tells nobody');
  assert.equal(r.host.current(), null);
});

test('with motion on, a panel that closed itself is taken down after the card\'s exit (or the timer), and open() waits for it', async () => {
  const r = rig({motion: 1}), closed = [];
  await r.host.open({extensionId: EXT, name: 'x', url: URL_A, session: {}, onClosed: details => closed.push(details)});
  const [frame, view] = r.views;
  pageClosesItself(r, view);
  assert.equal(r.host.current(), null, 'the host forgets the panel at once');
  assert.ok(frame.webContents.sent.some(([channel, payload]) => channel === 'acira:side-panel-frame-state' && payload.phase === 'out'), 'the card plays its exit');
  frame.webContents.ipcHandlers['acira:side-panel-frame']({}, 'gone');      // the card says its exit is over
  await settle();
  assert.deepEqual(r.children, []);
  assert.equal(closed.length, 1);
  const again = await r.host.open({extensionId: EXT, name: 'x', url: URL_A, session: {}});
  assert.deepEqual(again, {opened: true});
  r.host.destroy();
});

test('another extension\'s panel replacing this one, and the window closing, are unchanged', async () => {
  const r = rig(), OTHER = 'b'.repeat(32);
  await r.host.open({extensionId: EXT, name: 'one', url: URL_A, session: {}});
  await r.host.open({extensionId: OTHER, name: 'two', url: `chrome-extension://${OTHER}/p.html`, session: {}});
  assert.equal(r.host.current().extensionId, OTHER);
  assert.equal(r.children.length, 2, 'one card and one page: the first panel was taken down');
  r.host.destroy();
  assert.deepEqual(r.children, []);
});
