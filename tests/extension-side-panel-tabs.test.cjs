'use strict';
// 13.8 (Windows laptop): the extension side panel was ONE panel per window that followed the last press: open it on tab 1, switch to tab 2 and the panel stayed (still tab 1's page), a press on tab 2 re-navigated the SAME
// contents to tab 2's page, and back on tab 1 it showed tab 2's. In Chromium a panel set with per-tab options (sidePanel.setOptions({tabId, path})) belongs to that tab (its SidePanelRegistry): another tab does not show it, switching
// back shows it again, still alive; the panel from the extension-wide options is the window's, shown on every tab that has none of its own. And a panel the host only REMEMBERED (its views not in the window) made every later press a
// no-op for good ("already open"): Chromium's SidePanelCoordinator::Show looks at the entry that is really shown, and Show on one that is not opens it. No Electron: the views are fakes (the rig of extension-side-panel-self-close).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSidePanelHost} = require('../desktop/browser-services/extension-side-panel.cjs');

const EXT = 'a'.repeat(32), EXT2 = 'b'.repeat(32);
const url = (id, tab) => `chrome-extension://${id}/sidepanel.html?tabId=${tab}`;
const PAGE = {x: 0, y: 0, width: 1200, height: 800};

function rig({motion = 0, width = 1200} = {}) {
  const views = [], children = [];
  class FakeView {
    constructor() {
      const contents = new EventEmitter();
      Object.assign(contents, {
        destroyed: false, sent: [], loaded: [],
        isDestroyed() { return this.destroyed; },
        close() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } },
        send(channel, payload) { this.sent.push([channel, payload]); },
        loadFile() { return Promise.resolve(); }, loadURL(target) { this.loaded.push(target); return Promise.resolve(); },
        setWindowOpenHandler() {}, ipc: {on: () => {}}
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
  const host = createSidePanelHost({WebContentsView: FakeView, getWindow: () => window, pageBounds: () => ({...PAGE, width}), relayout: () => { relayouts++; }, motionScale: () => motion});
  const closed = [];
  const open = (extensionId, tabKey, tab, extra = {}) => host.open({extensionId, name: 'Ext', url: url(extensionId, tab), session: {}, tabKey, tabId: tab, onClosed: details => closed.push([tabKey, details.extensionId]), ...extra});
  const pairOf = key => { const info = host.find({tabKey: key}); return info && views.find(v => v.webContents === info.webContents); };
  const sync = (active, ...tabs) => host.sync({activeKey: active, keys: new Set(tabs.map(t => 'tab:' + t))});
  return {host, views, children, closed, open, sync, pairOf, relayouts: () => relayouts};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const reserved = (r, bounds = PAGE) => r.host.trim(bounds, PAGE).width < bounds.width;

test('a panel opened on tab 1 is not shown on tab 2 and comes back, the same live page, when tab 1 is in front again', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2);
  assert.deepEqual(await r.open(EXT, 'tab:1', 1), {opened: true});
  const [frame1, view1] = r.views;
  assert.deepEqual(r.children, [frame1, view1]);
  assert.ok(reserved(r), 'tab 1 gives the panel its width');
  const loads = view1.webContents.loaded.length;
  r.sync('tab:2', 1, 2);
  assert.deepEqual(r.children, [], 'tab 2 has no panel: the card and the page are out of the window');
  assert.equal(r.host.current(), null, 'nothing is in front');
  assert.ok(!reserved(r), 'the page area is whole on tab 2');
  assert.equal(view1.webContents.destroyed, false, 'tab 1\'s page is kept alive');
  assert.equal(r.host.list(EXT).length, 1, 'the host still lists it (runtime.getContexts finds it)');
  r.sync('tab:1', 1, 2);
  assert.deepEqual(r.children, [frame1, view1], 'back on tab 1 the same card and page are in front');
  assert.equal(r.views.length, 2, 'no new panel was made');
  assert.equal(view1.webContents.loaded.length, loads, 'and the page was not reloaded');
  assert.ok(reserved(r));
});

test('a press on tab 2 makes tab 2 its own panel; tab 1\'s keeps its page; each tab shows its own', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2); await r.open(EXT, 'tab:1', 1);
  const [frame1, view1] = r.views;
  r.sync('tab:2', 1, 2);
  assert.deepEqual(await r.open(EXT, 'tab:2', 2), {opened: true}, 'a new panel, not a re-navigation of tab 1\'s');
  const [frame2, view2] = r.views.slice(2);
  assert.deepEqual(r.children, [frame2, view2]);
  assert.deepEqual(view1.webContents.loaded, [url(EXT, 1)], 'tab 1\'s page was never sent to tab 2\'s address');
  assert.deepEqual(view2.webContents.loaded, [url(EXT, 2)]);
  assert.equal(r.host.current().webContents, view2.webContents);
  r.sync('tab:1', 1, 2);
  assert.deepEqual(r.children, [frame1, view1], 'back on tab 1: tab 1\'s panel, still ?tabId=1');
  assert.equal(r.host.current().url, url(EXT, 1));
  assert.equal(r.host.list(EXT).length, 2, 'both are alive');
});

test('the window\'s panel (extension-wide options) shows on every tab without one of its own, and a tab\'s own panel comes before it', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2, 3);
  await r.open(EXT, 'window', undefined, {url: `chrome-extension://${EXT}/panel.html`});
  const [windowFrame, windowView] = r.views;
  r.sync('tab:2', 1, 2, 3);
  assert.deepEqual(r.children, [windowFrame, windowView], 'tab 2 has none of its own: the window\'s panel stays');
  await r.open(EXT, 'tab:2', 2);
  const own = r.views.slice(2);
  assert.deepEqual(r.children, own, 'tab 2\'s own panel takes the front on tab 2');
  r.sync('tab:3', 1, 2, 3);
  assert.deepEqual(r.children, [windowFrame, windowView], 'tab 3: the window\'s again');
  assert.equal(r.views.length, 4, 'nothing was rebuilt on the way');
});

test('a closed tab takes its panel with it (once, the extension is told), and the window panel never goes with a tab', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2); await r.open(EXT, 'tab:1', 1);
  await r.open(EXT, 'window', undefined, {url: `chrome-extension://${EXT}/panel.html`});
  const [frame1, view1] = r.views;
  r.sync('tab:2', 1, 2);
  const before = r.relayouts();
  r.sync('tab:2', 2);                       // tab 1 is closed
  await settle();
  assert.equal(view1.webContents.destroyed, true, 'tab 1\'s page is closed');
  assert.equal(frame1.webContents.destroyed, true);
  assert.deepEqual(r.closed, [['tab:1', EXT]], 'onClosed once');
  assert.equal(r.host.list(EXT).length, 1, 'the window\'s panel is still there');
  assert.ok(r.relayouts() >= before);
});

test('open() on a panel that is hidden (another tab in front) does not pull it forward, and it is not a new panel', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2); await r.open(EXT, 'tab:1', 1);
  r.sync('tab:2', 1, 2);
  assert.deepEqual(await r.open(EXT, 'tab:1', 1), {reused: true});
  assert.deepEqual(r.children, [], 'tab 2 is in front: nothing shows');
  assert.equal(r.views.length, 2);
});

test('a press while the panel is really shown does nothing: no new views, no reload, the answer is {reused}; five presses', async () => {
  const r = rig();
  r.sync('tab:1', 1); await r.open(EXT, 'tab:1', 1);
  const loads = r.views[1].webContents.loaded.length;
  for (let press = 2; press <= 6; press++) assert.deepEqual(await r.open(EXT, 'tab:1', 1), {reused: true}, `press ${press}`);
  assert.equal(r.views.length, 2);
  assert.equal(r.views[1].webContents.loaded.length, loads);
  assert.equal(r.host.reallyShown({tabKey: 'tab:1'}), true);
});

test('STUCK: a panel the host remembers but that is not in the window (its views were taken out) is shown again by the next press, not "reused" for good', async () => {
  const r = rig();
  r.sync('tab:1', 1); await r.open(EXT, 'tab:1', 1);
  const [frame, view] = r.views;
  r.children.splice(0, r.children.length);                  // out of the window by something else (a reparent, a window that was rebuilt)
  assert.equal(r.host.reallyShown({tabKey: 'tab:1'}), false, 'the host sees it is not on screen');
  assert.deepEqual(await r.open(EXT, 'tab:1', 1), {reused: true});
  assert.deepEqual(r.children, [frame, view], 'the press put the card and the page back');
  assert.equal(r.host.reallyShown({tabKey: 'tab:1'}), true);
  assert.equal(r.views.length, 2, 'the same panel, not a new one');
});

test('STUCK: a panel whose card page is gone (its contents closed) is made new by the next press, silently, and the extension is not told it closed', async () => {
  const r = rig();
  r.sync('tab:1', 1); await r.open(EXT, 'tab:1', 1);
  const [frame] = r.views;
  frame.webContents.close();                                // the card's contents are lost
  assert.deepEqual(await r.open(EXT, 'tab:1', 1), {opened: true}, 'a new panel');
  await settle();
  assert.equal(r.views.length, 4);
  assert.ok(r.children.includes(r.views[3]) && r.children.includes(r.views[2]));
  assert.deepEqual(r.closed, [], 'a rebuild is not a close');
});

test('STUCK: a panel whose page closed itself while another tab was in front is gone for good; the press on its tab makes a new one', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2); await r.open(EXT, 'tab:1', 1);
  const [, view] = r.views;
  r.sync('tab:2', 1, 2);
  view.webContents.close();                                 // window.close() from the hidden panel
  await settle();
  assert.deepEqual(r.closed, [['tab:1', EXT]], 'the extension heard onClosed');
  assert.equal(r.host.list(EXT).length, 0, 'nothing is remembered for tab 1');
  r.sync('tab:1', 1, 2);
  assert.deepEqual(await r.open(EXT, 'tab:1', 1), {opened: true});
  assert.equal(r.views.length, 4);
});

test('another extension\'s panel on the same tab replaces the first (which is told), one panel per tab; closing by tab and by extension', async () => {
  const r = rig();
  r.sync('tab:1', 1); await r.open(EXT, 'tab:1', 1);
  await r.open(EXT2, 'tab:1', 1);
  assert.deepEqual(r.closed, [['tab:1', EXT]]);
  assert.equal(r.host.current().extensionId, EXT2);
  await r.open(EXT2, 'window', undefined, {url: `chrome-extension://${EXT2}/panel.html`});
  assert.equal(r.host.list(EXT2).length, 2);
  await r.host.close({extensionId: EXT2, tabKey: 'tab:1'});
  assert.equal(r.host.list(EXT2).length, 1, 'only that tab\'s went');
  assert.equal(r.host.current().url, `chrome-extension://${EXT2}/panel.html`, 'the window\'s panel is in front now');
  await r.host.close({extensionId: EXT2, all: true});
  assert.equal(r.host.list().length, 0);
  assert.deepEqual(r.children, []);
});

test('closing the panel in front reveals the window\'s underneath after the close, and a close with animation still ends with nothing stuck', async () => {
  const r = rig({motion: 1});
  r.sync('tab:1', 1); await r.open(EXT, 'window', undefined, {url: `chrome-extension://${EXT}/panel.html`});
  await r.open(EXT, 'tab:1', 1);
  const closing = r.host.close({tabKey: 'tab:1'});
  // the card's own animation tells the host it is gone; the fake frame does not, so the host's own timer ends it
  await closing;
  assert.equal(r.host.current().tabKey, 'window', 'tab 1\'s panel closed, the window\'s one is in front');
  assert.equal(r.host.reallyShown({tabKey: 'window'}), true);
});

test('destroy() takes every panel away, kept ones too; trim gives the page area back', async () => {
  const r = rig();
  r.sync('tab:1', 1, 2); await r.open(EXT, 'tab:1', 1); r.sync('tab:2', 1, 2); await r.open(EXT, 'tab:2', 2);
  r.host.destroy();
  assert.ok(r.views.every(v => v.webContents.destroyed));
  assert.deepEqual(r.children, []);
  assert.ok(!reserved(r));
});

// ---- the joins (source level, no Electron): each is one short hook, and a merge that drops one leaves the panel per window again ----
const fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main tells the host which tab is in front on every state change and which tabs exist, and opens panels by tab', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /function broadcast\(key\)\{for\(const listener of extensionTabListeners\)try\{listener\(\);\}catch\{\}noteExtensionPopupContext\(\);try\{extensionPanel\.sync\(\{activeKey:'tab:'\+state\.activeTabId,keys:new Set\(state\.tabs\.map\(t=>'tab:'\+t\.id\)\)\}\);\}catch\{\}/);
  assert.match(main, /async open\(\{extensionId,name,url,windowId,tabId,pageId,perTab,sender,onClosed\}\)/);
  assert.match(main, /tabKey=found\?\.controller===controller&&found\.entry\?'tab:'\+found\.entry\[0\]:'window'/, 'a tab with options of its own is keyed by its Acira tab, the rest by the window');
  assert.doesNotMatch(main, /for\(const other of available\(\)\)if\(other!==controller&&other\.extensionPanel\?\.current\(\)\?\.extensionId===extensionId\)/, 'a panel in another window is not closed: each window keeps its own');
  assert.match(main, /list\(extensionId\)\{return available\(\)\.flatMap\(c=>\(c\.extensionPanel\?\.list\(extensionId\)\|\|\[\]\)/);
});

test('runtime.getContexts lists every panel the extension has alive (the AI assistant extension\'s worker finds the front tab\'s by the tabId in its URL), and an unloaded extension loses all of them', () => {
  const apis = read('desktop/browser-services/extension-apis.cjs');
  assert.match(apis, /typeof sidePanelHost\?\.list==='function'\)return sidePanelHost\.list\(id\)/);
  assert.match(apis, /for\(const panel of panels\)out\.push\(\{contextType:'SIDE_PANEL'/);
  assert.match(apis, /sidePanelHost\.close\(\{extensionId:extension\.id,all:true\}\)/);
});

test('STUCK: a panel that fails while it is being brought up leaves nothing behind (the second view cannot be made; the card cannot load): the next press starts clean', async () => {
  const children = [];
  const window = {isDestroyed: () => false, contentView: {get children() { return children; }, addChildView(v) { children.push(v); }, removeChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); }}};
  const make = ({failSecond = false, cardLoadThrows = false} = {}) => {
    const views = []; let made = 0;
    class View {
      constructor(options) {
        made++; if (failSecond && made === 2) throw new Error('no more views');
        const c = new EventEmitter(); const isCard = Boolean(options.webPreferences.preload);
        Object.assign(c, {destroyed: false, isDestroyed() { return this.destroyed; }, close() { this.destroyed = true; this.emit('destroyed'); }, send() {}, loadURL() { return Promise.resolve(); }, setWindowOpenHandler() {}, ipc: {on() {}},
          loadFile() { if (cardLoadThrows && isCard) throw new Error('load failed'); return Promise.resolve(); }});
        this.webContents = c; views.push(this);
      }
      setBackgroundColor() {} setBounds() {} setVisible() {} setBorderRadius() {}
    }
    return {views, host: createSidePanelHost({WebContentsView: View, getWindow: () => window, pageBounds: () => PAGE})};
  };
  const details = {extensionId: EXT, name: 'x', url: url(EXT, 1), session: {}, tabKey: 'tab:1'};
  const a = make({failSecond: true});
  await assert.rejects(a.host.open(details), /no more views/);
  assert.equal(a.views[0].webContents.destroyed, true, 'the card made first was closed');
  assert.equal(a.host.list().length, 0, 'nothing is remembered');
  assert.deepEqual(children, []);
  const b = make({cardLoadThrows: true});
  await assert.rejects(b.host.open(details), /load failed/);
  assert.equal(b.host.list().length, 0, 'a card that cannot load leaves no panel behind');
  assert.deepEqual(children, [], 'and nothing in the window');
  assert.equal(b.views.every(v => v.webContents.destroyed), true);
  const c = make();
  assert.deepEqual(await c.host.open(details), {opened: true}, 'a normal press works');
});
