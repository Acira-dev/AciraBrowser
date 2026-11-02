'use strict';
// Where a page's new window lands: Chromium's disposition plus the window.open() features (HTML "popup window is requested").
const test = require('node:test');
const assert = require('node:assert/strict');
const {tokenizeFeatures, readFeatures, decideWindowOpen, createOpenedViews} = require('../desktop/window-open-policy.cjs');

const decide = (disposition, features = '', link = false) => decideWindowOpen({disposition, features}, {link});
const shape = verdict => `${verdict.kind}${verdict.kind === 'tab' ? (verdict.background ? ':background' : ':foreground') : ''}${verdict.noopener ? ':noopener' : ''}`;

test('the Gmail Sign in click (target=_blank, rel=noopener noreferrer, empty features) is a foreground tab', () => {
  assert.equal(shape(decide('foreground-tab', '')), 'tab:foreground');
  assert.equal(shape(decide('foreground-tab', '', true)), 'tab:foreground');
});

test('Ctrl+click and middle click are background tabs', () => {
  assert.equal(shape(decide('background-tab', '', true)), 'tab:background');
  assert.equal(shape(decide('background-tab', '')), 'tab:background');
});

test('window.open without features, or with only noopener / noreferrer, is a tab; noopener is reported', () => {
  assert.equal(shape(decide('foreground-tab', '')), 'tab:foreground');
  assert.equal(shape(decide('foreground-tab', 'noopener')), 'tab:foreground:noopener');
  assert.equal(shape(decide('foreground-tab', 'noopener,noreferrer')), 'tab:foreground:noopener');
  assert.equal(shape(decide('foreground-tab', 'noreferrer')), 'tab:foreground:noopener');
  assert.equal(shape(decide('foreground-tab', 'noopener=0')), 'tab:foreground');
  // even if the disposition said new-window, a features string of only noopener asks for no pop-up
  assert.equal(shape(decide('new-window', 'noopener')), 'tab:foreground:noopener');
});

test('a size, a position or popup=1 makes a pop-up window (OAuth pop-ups), and the opener is kept unless noopener says otherwise', () => {
  for (const features of ['width=500,height=600', 'width=500', 'height=600', 'left=10,top=20', 'screenX=10,screenY=20', 'innerWidth=400,innerHeight=300', 'popup', 'popup=1', 'popup=yes', 'popup=true', 'popup=yes,width=640,height=760',
    'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes', 'toolbar=0', 'location=no', 'width = 500 , height = 600', 'WIDTH=500'])
    assert.equal(shape(decide('new-window', features)), 'popup', features);
  assert.equal(shape(decide('new-window', 'noopener,width=500,height=600')), 'popup:noopener');
});

test('popup=0 / popup=no keep it a tab, and so does a feature list that asks for the full browser UI', () => {
  assert.equal(shape(decide('foreground-tab', 'popup=0')), 'tab:foreground');
  assert.equal(shape(decide('new-window', 'popup=0')), 'tab:foreground');
  assert.equal(shape(decide('new-window', 'popup=no,width=500')), 'tab:foreground');
  assert.equal(shape(decide('new-window', 'location=yes,toolbar=yes,menubar=yes,resizable=yes,scrollbars=yes,status=yes')), 'tab:foreground');
  // any one of them off is a pop-up again
  assert.equal(shape(decide('new-window', 'location=yes,toolbar=yes,menubar=yes,resizable=yes,scrollbars=yes,status=no')), 'popup');
});

test('Chromium\'s tab disposition wins over the feature string (Ctrl+click on a button that opens a pop-up is a background tab)', () => {
  assert.equal(shape(decide('background-tab', 'width=500,height=600')), 'tab:background');
  assert.equal(shape(decide('foreground-tab', 'popup=0,width=500')), 'tab:foreground');
});

test('new-window with no pop-up features is a tab in a tabbed browser, except a Shift+click on a link, which is a browser window', () => {
  assert.equal(shape(decide('new-window', '')), 'tab:foreground');
  assert.equal(shape(decide('new-window', '', true)), 'window:noopener');
  assert.equal(shape(decide('other', '')), 'tab:foreground');
  assert.equal(shape(decide('other', 'width=500')), 'popup');
  assert.equal(shape(decide('default', '')), 'tab:foreground');
  assert.equal(shape(decide('new-window', 'width=500', true)), 'popup');
});

test('missing details do not throw and mean a foreground tab', () => {
  assert.equal(shape(decideWindowOpen(undefined)), 'tab:foreground');
  assert.equal(shape(decideWindowOpen({})), 'tab:foreground');
  assert.deepEqual([...tokenizeFeatures(undefined)], []);
  assert.deepEqual([...tokenizeFeatures(null)], []);
});

test('feature strings are tokenized like the standard (separators, case, aliases, last one wins)', () => {
  assert.deepEqual([...tokenizeFeatures(' Width = 500 ,\tHEIGHT=600;')], [['width', '500'], ['height', '600;']]);
  assert.deepEqual([...tokenizeFeatures('screenX=1,innerHeight=2')], [['left', '1'], ['height', '2']]);
  assert.deepEqual([...tokenizeFeatures('popup=0,popup=1')], [['popup', '1']]);
  assert.deepEqual(readFeatures('noopener'), {popup: false, noopener: true});
  assert.deepEqual(readFeatures(''), {popup: false, noopener: false});
  assert.deepEqual(readFeatures('popup=1abc'), {popup: true, noopener: false});
  assert.deepEqual(readFeatures('popup=abc'), {popup: false, noopener: false});
});

test('opened views: a page built right after the offer takes the view, and a later page for the tab takes it by id', () => {
  const alive = () => ({webContents: {isDestroyed: () => false}});
  const views = createOpenedViews();
  const first = {view: alive()};
  views.offer(first);
  assert.equal(views.settle(first, 'tab-7'), true);
  assert.equal(views.adopt('tab-8'), null);
  assert.equal(views.adopt('tab-7'), first.view);
  assert.equal(views.adopt('tab-7'), null, 'only once');
  // the page was built inside the dispatch: it took the claim through "next", and settling leaves nothing behind
  const second = {view: alive()};
  views.offer(second);
  assert.equal(views.adopt('tab-9'), second.view);
  assert.equal(views.settle(second, 'tab-9'), true);
  assert.equal(views.has('tab-9'), false);
  // no tab appeared: the claim is dropped
  const third = {view: alive()};
  views.offer(third);
  assert.equal(views.settle(third, undefined), false);
  assert.equal(views.adopt('tab-10'), null);
  // a destroyed view is never handed out
  const dead = {view: {webContents: {isDestroyed: () => true}}};
  views.offer(dead); views.settle(dead, 'tab-11');
  assert.equal(views.adopt('tab-11'), null);
});

// ---- routeWindowOpen: the one answer main.cjs carries out ----
const {routeWindowOpen} = require('../desktop/window-open-policy.cjs');
const route = (disposition, features = '', ctx = {}, url = 'https://accounts.google.com/AccountChooser') => {
  const answer = routeWindowOpen({url, disposition, features}, ctx);
  return answer.route + (answer.background ? ':background' : '') + (answer.privateTab ? ':private' : '');
};

test('route: links (target=_blank, rel=noopener, Ctrl, middle) are tabs without an opener, background for Ctrl and middle click', () => {
  assert.equal(route('foreground-tab', '', {link: true}), 'tab');
  assert.equal(route('foreground-tab', '', {link: false}), 'tab-with-opener', 'a link whose address the page rewrote (the Gmail Sign in button) is judged by its disposition, not by the pointer');
  assert.equal(route('background-tab', '', {link: true}), 'tab:background');
  assert.equal(route('foreground-tab', 'noopener', {link: false}), 'tab');
});

test('route: window.open without features keeps its opener in a tab; noopener does not', () => {
  assert.equal(route('foreground-tab', ''), 'tab-with-opener');
  assert.equal(route('foreground-tab', 'popup=0'), 'tab-with-opener');
  assert.equal(route('foreground-tab', 'noopener'), 'tab');
  assert.equal(route('foreground-tab', 'noopener,noreferrer'), 'tab');
  assert.equal(route('background-tab', ''), 'tab-with-opener:background');
});

test('route: the OAuth pop-up (size / position / popup=1 / minimal UI) stays a pop-up window and keeps its opener', () => {
  for (const features of ['width=500,height=600', 'popup=1', 'popup=yes,width=640,height=760', 'left=100,top=100', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'])
    assert.equal(route('new-window', features), 'popup', features);
  // sign-in provider windows opened from private or Tor tabs stay pop-ups too
  assert.equal(route('new-window', 'width=500,height=600', {privateTab: true, tor: true, sameSession: false}), 'popup:private');
});

test('route: Shift+click on a link is a browser window, and a private tab\'s one stays private', () => {
  assert.equal(route('new-window', '', {link: true}), 'window');
  assert.equal(route('new-window', '', {link: true, privateTab: true}), 'window:private');
});

test('route: private and Tor tabs stay their kind (never a normal tab, never an opener-less leak into another session)', () => {
  // links and noopener opens: a tab that carries the private flag (main.cjs gives it the opener's privacy: private, Tor, secured)
  assert.equal(route('foreground-tab', '', {link: true, privateTab: true, tor: true}), 'tab:private');
  assert.equal(route('background-tab', '', {link: true, privateTab: true}), 'tab:background:private');
  assert.equal(route('foreground-tab', 'noopener', {privateTab: true, tor: true}), 'tab:private');
  // a script's window.open that wants its opener keeps the pop-up window it always was for these (a tab of another session cannot be linked)
  assert.equal(route('foreground-tab', '', {privateTab: true}), 'popup:private');
  assert.equal(route('foreground-tab', '', {tor: true}), 'popup');
  assert.equal(route('foreground-tab', '', {privateTab: true, tor: true}), 'popup:private');
  // a normal tab whose page session differs from its opener's is not adopted either
  assert.equal(route('foreground-tab', '', {sameSession: false}), 'popup');
});

test('route: only web addresses open; about:blank is a pop-up with its opener, anything else is refused', () => {
  assert.equal(route('foreground-tab', '', {}, 'about:blank'), 'popup');
  assert.equal(route('foreground-tab', 'width=500', {}, 'about:blank'), 'popup');
  for (const url of ['javascript:alert(1)', 'file:///C:/x.txt', 'data:text/html,hi', 'chrome://settings', 'acira://settings', 'intent://x', ''])
    assert.equal(route('foreground-tab', '', {link: true}, url), 'deny', url);
});

// ---- 29 Oct: "Acira can't be closed" after a sign-in tab. main.cjs cannot be loaded outside Electron, so the two guards are held by the source;
// qa/close-after-window-open.mjs proves them live (window.open tabs, a page closing its own tab with window.close(), then the window closes and the process exits).
test('a tab a page opened outlives that page and leaves no dead entry behind when its contents are destroyed', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(main.includes("return {action:'allow',outlivesOpener:true,overrideBrowserWindowOptions:{webPreferences:pageViewPreferences(profile,tab)},createWindow:"), 'Electron must not destroy the tab when its opener goes away');
  const at = main.indexOf("if(fromPage)view.webContents.once('destroyed',");
  assert.ok(at > 0, 'a tab a page opened watches for its contents being destroyed (window.close())');
  const handler = main.slice(at, main.indexOf('mainWindow.contentView.addChildView(view,1);', at));
  // a view whose contents are gone has no webContents: the entry must leave `pages` at once, before anything walks them (closing the window does)
  assert.ok(handler.includes('removePageView(entry);pages.delete(tab.id);'), 'the page entry is dropped when its contents are destroyed');
  assert.ok(handler.includes("dispatch({type:'tab.close',id:tab.id})"), 'and the tab leaves the strip');
  assert.ok(handler.includes('entry.closing'), 'a close the browser itself is running is left to closePage');
});

// A pop-up opened with window.open(url, name, 'width=500,height=420') used to be 640×760 whatever it asked (the browser's options won).
test('a pop-up opens at the size it asked for, as its page area, kept on the opener\'s screen', () => {
  const {popupBounds} = require('../desktop/window-open-policy.cjs');
  const screen = {x: 0, y: 25, width: 1512, height: 920};
  assert.deepEqual(popupBounds('width=500,height=420', screen), {width: 500, height: 420, useContentSize: true});
  assert.deepEqual(popupBounds('innerWidth=300, innerHeight = 200', screen), {width: 300, height: 200, useContentSize: true}, 'aliases and spaces');
  assert.deepEqual(popupBounds('width=5000,height=4000', screen), {width: 1512, height: 892, useContentSize: true}, 'never larger than the screen (less the title bar)');
  assert.deepEqual(popupBounds('width=50,height=20', screen), {width: 100, height: 100, useContentSize: true}, 'Chromium\'s 100 floor');
  assert.deepEqual(popupBounds('width=500,height=420,left=2000,top=-50', screen), {width: 500, height: 420, useContentSize: true, x: 1012, y: 25}, 'a position off the screen is pulled back onto it');
  assert.deepEqual(popupBounds('popup', screen), {width: 640, height: 760, useContentSize: false}, 'no size asked: the old default window');
  assert.deepEqual(popupBounds('width=500', null), {width: 500, height: 760, useContentSize: true}, 'no display known: unclamped');
});
