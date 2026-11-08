'use strict';
// A tab restored from the last session has two numbers: the id chrome.tabs gave the extension (2000000002 until the tab has a page) and its page's id once it
// wakes. Every place that tells an extension about a tab must say the first (surfaces/tab-ids.cjs ofPage); every place that takes an id from an extension and hands it
// to Electron or the toolbar must use the page's (pageOf). The closures below are not reachable from a unit test, so the call sites are pinned in the source.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'desktop', file), 'utf8');

test('events and payloads that name a tab say the id the extension knows it by', () => {
  assert.match(read('browser-services/ext-api/web-navigation.cjs'), /tabId:tabIdOf\(wc\)/);
  assert.doesNotMatch(read('browser-services/ext-api/web-navigation.cjs'), /tabId:wc\.id/, 'no webNavigation event carries the page\'s own id');
  assert.match(read('browser-services/ext-api/web-request.cjs'), /tabId=tabIds\.ofPage\(session,wc\)/);
  assert.match(read('browser-services/ext-api/cookies.cjs'), /tabIdBridge\.ofPage\(session,tab\)/);
  assert.match(read('content-blocking.cjs'), /tabId=tabIdBridge\.ofPage\(session,wc\)/, 'declarativeNetRequest sees the same tab id as the extension (tabIds in session rules, getMatchedRules, onRuleMatchedDebug)');
  const apis = read('browser-services/extension-apis.cjs');
  assert.match(apis, /tabId:extTabId\(item\.source\.tabId\)/, 'tabCapture.onStatusChanged');
  assert.match(apis, /tabId:extTabId\(item\.tabId\)/, 'tabCapture.getCapturedTabs');
  assert.match(apis, /id:tabIds\.ofPage\(session,sender\)/, 'the tab of a user script message');
});

test('ids that come from an extension are turned into the page\'s before Electron or the toolbar sees them', () => {
  const apis = read('browser-services/extension-apis.cjs');
  assert.match(apis, /webContents\.fromId\(tabIds\.pageOf\(session,tabId\)\)/, 'userScripts.execute');
  assert.match(apis, /pageOf:tabId=>tabIds\.pageOf\(session,tabId\)/, 'the side panel keeps its per-tab options under the page id');
  assert.match(read('browser-services/ext-api/action.cjs'), /acira\.tabs\.pageId/, 'chrome.action keeps its per-tab values under the page id');
  assert.match(read('browser-services/ext-api/scripting-renderer.cjs'), /acira\.tabs\.pageId/, 'Chromium\'s own executeScript / insertCSS');
});

test('the tab object of a toolbar click, a key press and a menu click is chrome.tabs\' own, not the engine\'s cached details', () => {
  const tabs = read('browser-services/ext-api/tabs.cjs');
  assert.match(tabs, /name === 'browserAction\.onClicked'/);
  assert.match(tabs, /name === 'webNavigation\.onCreatedNavigationTarget'/, 'the engine\'s own navigation-target event names the tab by its page');
  assert.match(read('browser-services/ext-api/commands.cjs'), /api\.handler\('tabs\.get'\)\?\.\(\{type:'frame',sender:webContents,extension:null\},webContents\.id\):undefined;tab=asked&&!asked\.__acira_error\?asked:api\.store\(\)\?\.tabDetailsCache/);
  const menus = read('browser-services/ext-api/context-menus.cjs');
  assert.ok(menus.indexOf("api.handler('tabs.get')") < menus.indexOf('tabDetailsCache'), 'tabs.get is asked first, the engine\'s cache is the fallback');
});
