'use strict';
// A website link in an extension's own page (an options page, OneTab's list, Floccus' Donate) opened another bare window with no address bar and no
// way to browse. The extension windows main.cjs makes (extensionCreateTab) now send websites to a tab of the browser, as the popups do (extension-popup-window.cjs).
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const start = main.indexOf('async function extensionCreateTab(');
const body = main.slice(start, main.indexOf('async function extensionRemove(', start));

test('a website opened from an extension window goes to a tab of the extension\'s profile, in front', () => {
  assert.ok(start > 0 && body.length > 500);
  const handler = body.slice(body.indexOf('setWindowOpenHandler('));
  assert.match(handler, /^setWindowOpenHandler\(details=>\{[^]*?\/\^https\?:\\\/\\\/\/i\.test\(details\.url\)&&parseExternalURLs\(\[details\.url\]\)\[0\]\)\{void extensionCreateTab\(\{url:details\.url,active:true,profileId:ownProfileId\}\)\.catch\(\(\)=>\{\}\);return \{action:'deny'\};\}/);
});

test('the extension\'s own pages still open as extension windows, and anything else is refused', () => {
  const handler = body.slice(body.indexOf('setWindowOpenHandler('), body.indexOf("child.webContents.on('did-create-window'"));
  assert.match(handler, /return \{action:allowed\(details\.url\)\?'allow':'deny',overrideBrowserWindowOptions:/);
});

// 13.5: the same for a plain link or a location change. will-navigate let any http(s) address through, so a link in an extension's window
// navigated THAT window to the website: a bare website window with no address bar and no way back. The page stays; the website opens as a tab.
test('a plain link or location change to a website in an extension window opens a tab and leaves the window on its page; the extension\'s own pages and everything else are as before', () => {
  const from = body.indexOf("child.webContents.on('will-navigate',(event,value)=>{"), to = body.indexOf('child.webContents.setWindowOpenHandler(', from);
  assert.ok(from > 0 && to > from);
  const handlerSource = body.slice(from, to);
  const {parseExternalURLs} = require('../desktop/accounts/external-links.cjs');
  const id = 'fnaicdffflnofjppbagibeoednhnbjhg', ownOrigin = 'chrome-extension://' + id + '/';
  const allowed = value => value === 'about:blank' || !!parseExternalURLs([value])[0] || value.startsWith(ownOrigin);
  const opened = [];
  let navigate;
  const child = {webContents: {on: (name, fn) => { if (name === 'will-navigate') navigate = fn; }}};
  const extensionCreateTab = details => { opened.push(details); return Promise.resolve([]); };
  // the real handler text, run against a fake window and the real address parser
  new Function('child', 'allowed', 'parseExternalURLs', 'extensionCreateTab', 'ownProfileId', handlerSource)(child, allowed, parseExternalURLs, extensionCreateTab, 'profile-1');
  assert.equal(typeof navigate, 'function');
  const run = value => { const event = {prevented: false, preventDefault() { this.prevented = true; }}; navigate(event, value); return event.prevented; };

  assert.equal(run('https://floccus.org/donate'), true, 'the window does not navigate away from the extension page');
  assert.equal(run('http://example.net/page?a=1#b'), true);
  assert.deepEqual(opened, [{url: 'https://floccus.org/donate', active: true, profileId: 'profile-1'}, {url: 'http://example.net/page?a=1#b', active: true, profileId: 'profile-1'}], 'each is a tab of the extension\'s profile, in front');

  const before = opened.length;
  assert.equal(run(ownOrigin + 'dist/html/options.html#/new'), false, 'the extension\'s own page navigates in place');
  assert.equal(run('about:blank'), false);
  assert.equal(run('chrome-extension://' + 'a'.repeat(32) + '/page.html'), true, 'another extension\'s page is still refused');
  assert.equal(run('javascript:alert(1)'), true);
  assert.equal(run('file:///etc/passwd'), true);
  assert.equal(run('https://user:secret@example.com/'), true, 'an address with credentials is refused, not opened');
  assert.equal(opened.length, before, 'none of those opened a tab');

  // a refused tab (the profile is closing) does not throw out of the handler
  const failing = new Function('child', 'allowed', 'parseExternalURLs', 'extensionCreateTab', 'ownProfileId', handlerSource);
  let go; failing({webContents: {on: (name, fn) => { go = fn; }}}, allowed, parseExternalURLs, () => Promise.reject(new Error('closing')), 'profile-1');
  assert.doesNotThrow(() => go({preventDefault() {}}, 'https://example.org/'));
});
