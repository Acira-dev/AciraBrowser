import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {suggestHistory} from '../src/features/libraryModel';
import type {BrowserAction} from '../src/runtime/types';
import {readFileSync} from 'node:fs';

/** A tab on a page, and a way to feed it the same state events the native side sends. */
function tabOn(url: string) {
  let s = reduceBrowser(createInitialState(), {type: 'tab.new', url});
  const id = s.activeTabId;
  const send = (update: object) => { s = reduceBrowser(s, {type: 'browser.event', event: {type: 'state', tabId: id, ...update}} as BrowserAction); };
  const urls = () => s.browsingHistory.map(v => v.url);
  const tab = () => s.tabs.find(t => t.id === id)!;
  return {send, urls, tab, state: () => s};
}

test('a page that fails to load is not a visit: not in History, not offered as a bookmark', () => {
  const t = tabOn('https://a.test/');
  t.send({url: 'https://a.test/', title: 'A', error: null});
  // Native did-fail-load for a DNS failure: the address with the error, before and after the error page has a title.
  t.send({url: 'https://nonexistent.invalid/', title: 'nonexistent.invalid', error: 'ERR_NAME_NOT_RESOLVED (-105)', loading: false});
  t.send({url: 'https://nonexistent.invalid/', title: 'nonexistent.invalid'});
  t.send({url: 'https://nonexistent.invalid/', title: 'nonexistent.invalid', loading: false});
  assert.deepEqual(t.urls(), ['https://a.test/'], 'only the page that loaded is a visit');
  assert.equal(t.tab().url, 'https://nonexistent.invalid/', 'the tab still shows the address it could not open');
  assert.match(t.tab().error ?? '', /ERR_NAME_NOT_RESOLVED/);
  const offered = suggestHistory(t.state().browsingHistory, [], {}).map(item => item.url);
  assert.ok(!offered.includes('https://nonexistent.invalid/'), 'a failed page is never suggested');
});

test('a certificate failure is a failed load too', () => {
  const t = tabOn('https://a.test/');
  t.send({url: 'https://expired.badssl.test/', title: 'expired.badssl.test', error: 'ERR_CERT_DATE_INVALID (-201)', loading: false});
  t.send({url: 'https://expired.badssl.test/', title: 'Privacy error'});
  assert.ok(!t.urls().includes('https://expired.badssl.test/'));
});

test('the next page that does load is recorded, and the failed address works once it loads', () => {
  const t = tabOn('https://a.test/');
  t.send({url: 'https://down.test/', title: 'down.test', error: 'ERR_CONNECTION_REFUSED (-102)', loading: false});
  t.send({url: 'https://b.test/', title: 'B', error: null});
  assert.deepEqual(t.urls(), ['https://b.test/'], 'loading another page clears the failure and records that page');
  t.send({url: 'https://down.test/', title: 'down.test', error: 'ERR_CONNECTION_REFUSED (-102)', loading: false});
  t.send({url: 'https://down.test/', title: 'Back up', error: null});
  assert.equal(t.urls()[0], 'https://down.test/', 'the same address loading later is a visit');
});

test('a page that already loaded keeps its visit when a later reload fails, without a second one', () => {
  const t = tabOn('https://a.test/');
  t.send({url: 'https://a.test/', title: 'A', error: null});
  t.send({url: 'https://a.test/', title: 'A', error: 'ERR_INTERNET_DISCONNECTED (-106)', loading: false});
  assert.deepEqual(t.urls(), ['https://a.test/']);
});

test('Back or Forward onto a page that cannot load: the tab shows that address, not the title of the page it came from', () => {
  const t = tabOn('https://a.test/');
  t.send({url: 'https://a.test/', title: 'A', error: null});
  t.send({url: 'https://down.test/path', title: 'down.test', error: 'ERR_CONNECTION_REFUSED (-102)', loading: false});
  t.send({url: 'https://a.test/', title: 'A', error: null});
  // Native did-fail-load for a history navigation carries the error but no title.
  t.send({url: 'https://down.test/path', error: 'ERR_CONNECTION_REFUSED (-102)', loading: false});
  assert.equal(t.tab().title, 'down.test', 'the failed address names the tab');
  // A crash is not a failed address: the page keeps its title.
  t.send({url: 'https://a.test/', title: 'A', error: null});
  t.send({error: 'The page stopped responding: crashed', loading: false});
  assert.equal(t.tab().title, 'A');
});

test('main settles a navigation that never commits on the page that stayed (Stop, a download, a 204)', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const stopped = main.slice(main.indexOf("wc.on('did-stop-loading'"));
  assert.match(stopped, /waitingForCommit\(wc\.getURL\(\)\)\|\|entry\.navigation\.phase==='loading'&&entry\.navigation\.failure\)\{[^]*?pageState\(tab\.id,false,\{restored:true,error:/, 'the tab is re-described from the page that stayed (also a stopped reload of an error page), without recording a visit');
  assert.match(main, /entry\.navigation\.failure=\{url,error:/, 'a page that stayed on its error page keeps that error');
  assert.match(main, /entry\.navigation\.failure=\{url,error:[^]*?wc\.setZoomFactor\(preferredZoom\(current,url\)\)/, 'a failed address gets its own zoom, not the previous page\'s');
});

// The error page and the certificate chip ask main for the certificate / threat status of their tab. When the tab closes or turns into an
// Acira page while the question is in flight, the answer is "nothing to describe", not an Error that Electron prints for every such handler
// (found by qa-tabs: "Open a website tab first" in the log). The write-side requests still refuse.
test('certificate and threat status questions for a tab that is gone are answered empty, not thrown', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /case 'certificates\.status':[^]*?\{(?:\/\*[^]*?\*\/)?if\(request\.type==='certificates\.status'\)return \{\};throw new Error\('Open a website tab first'\);\}/);
  assert.match(main, /case 'threats\.status':[^]*?\{if\(request\.type==='threats\.status'\)return \{\};throw new Error\('Open a website tab first'\);\}/);
});
