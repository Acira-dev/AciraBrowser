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
