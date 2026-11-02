'use strict';
// Google's sign-in page fires https://accounts.google.com/generate_204?<token> as an image for itself. EasyPrivacy matches it ("/generate_204?$image"), so a
// plain list-driven blocker fails the page's own connectivity beacon, which Chrome never does. Only that exact host and path is let through.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {isSignInBeacon} = require('../desktop/browser-services/sign-in-beacons.cjs');

test('the Google sign-in beacon passes; the same path elsewhere, other Google hosts and look-alikes do not', () => {
  assert.equal(isSignInBeacon('https://accounts.google.com/generate_204?a1b2c3'), true);
  assert.equal(isSignInBeacon('https://accounts.google.com/generate_204'), true);
  assert.equal(isSignInBeacon('https://tracker.example/generate_204?x'), false, 'another host keeps being filtered');
  assert.equal(isSignInBeacon('https://www.google.com/generate_204?x'), false, 'only the sign-in host');
  assert.equal(isSignInBeacon('https://accounts.google.com.evil.test/generate_204?x'), false, 'no suffix tricks');
  assert.equal(isSignInBeacon('http://accounts.google.com/generate_204?x'), false, 'secure origin only');
  assert.equal(isSignInBeacon('https://accounts.google.com/generate_204x'), false);
  assert.equal(isSignInBeacon(undefined), false);
});
test('it is applied before the tracker engine judges a request, inside the per-site protection switch, and is bundled', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  const guard = source.indexOf('if(isSignInBeacon(details.url))return {};'), engine = source.indexOf('updates.getEngine().onBeforeRequest(sourced(details,wc)');
  assert.ok(guard > 0 && engine > guard, 'the exception runs before the engine');
  assert.ok(source.lastIndexOf('if(!enabled(session,wc,wc.getURL()))return {};', guard) > guard - 80, 'it sits right behind the protection switch');
  assert.match(source, /require\('\.\/browser-services\/sign-in-beacons\.cjs'\)/);
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'desktop-bundle.mjs'), 'utf8').includes('sign-in-beacons.cjs'));
});
const {isSignInPrefetch, PREFETCHES} = require('../desktop/browser-services/sign-in-beacons.cjs');
test('the Microsoft sign-in state frame and Bing\'s own result-view stylesheets pass as prefetches; nothing else does', () => {
  // login.microsoftonline.com declares <link rel="prefetch" href="https://login.live.com/Me.htm?v=3"> and Bing's results page prefetches four r.bing.com/rp/<hash>.br.css files.
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3', 'prefetch'), true);
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm', 'prefetch'), true);
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3', 'Prefetch'), true);
  assert.equal(isSignInPrefetch('https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', 'prefetch'), true);
  assert.equal(isSignInPrefetch('https://r.bing.com/rp/9MEei-JPgzIAHg4N0SQuIReNvLQ.br.css', 'prefetch'), true);
  // a prerender, a different purpose or a missing one is still cancelled
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3', 'prefetch;prerender'), false);
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3', 'prerender'), false);
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3', ''), false);
  assert.equal(isSignInPrefetch('https://login.live.com/Me.htm?v=3'), false);
  // other paths and hosts keep being cancelled: no suffix tricks, no secure-origin downgrade, no extra path or query, no other Bing or live.com files
  for (const url of ['https://login.live.com/Me.htm?v=3&x=1', 'https://login.live.com/Me.html', 'https://login.live.com/', 'https://login.live.com/oauth20_authorize.srf', 'http://login.live.com/Me.htm?v=3',
    'https://login.live.com.evil.test/Me.htm?v=3', 'https://evil-login.live.com/Me.htm?v=3', 'https://login.microsoftonline.com/Me.htm?v=3', 'https://account.live.com/Me.htm?v=3',
    'https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.js', 'https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.css', 'https://r.bing.com/rp/short.br.css', 'https://r.bing.com/rp/a/b.br.css',
    'https://r.bing.com/th?id=OIP.x', 'https://www.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', 'https://r.bing.com.evil.test/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css',
    'http://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', 'https://tracker.example/Me.htm?v=3', 'https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css?x=1'])
    assert.equal(isSignInPrefetch(url, 'prefetch'), false, url);
  assert.equal(isSignInPrefetch(undefined, 'prefetch'), false);
  assert.equal(PREFETCHES.length, 2);
});
test('telemetry stays blocked: the Microsoft and Bing collectors are not in the prefetch exceptions', () => {
  for (const url of ['https://browser.events.data.microsoft.com/OneCollector/1.0/?cors=true', 'https://eu-mobile.events.data.microsoft.com/OneCollector/1.0/', 'https://www.bing.com/fd/ls/l?IG=1', 'https://www.bing.com/web/xlsc.aspx?dl=1&f=8',
    'https://login.microsoftonline.com/common/instrumentation/reportbssotelemetry', 'https://play.google.com/log?format=json', 'https://collector.github.com/github/collect', 'https://xp.apple.com/config/1/report/x', 'https://improving.duckduckgo.com/t/si'])
    for (const purpose of ['prefetch', 'prerender', '']) assert.equal(isSignInPrefetch(url, purpose), false, url);
});
test('quietRequest cancels prefetch and prerender except the exact exceptions, and always cancels hyperlink auditing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  assert.match(source, /const \{isSignInBeacon,isSignInPrefetch\}=require\('\.\/browser-services\/sign-in-beacons\.cjs'\)/);
  const line = source.split(/\r?\n/).find(text => text.startsWith('const quietRequest='));
  assert.ok(line, 'quietRequest is present');
  // Evaluate the real handler with the real exception function, so the wiring (not just the pattern list) is what is tested.
  const quiet = new Function('isSignInPrefetch', line + '\nreturn quietRequest;')(isSignInPrefetch);
  const headers = (url, extra) => quiet({url, requestHeaders: extra});
  assert.deepEqual(headers('https://login.live.com/Me.htm?v=3', {'Sec-Purpose': 'prefetch', Purpose: 'prefetch'}), {}, 'the sign-in state frame prefetch passes');
  assert.deepEqual(headers('https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', {'Sec-Purpose': 'prefetch'}), {}, 'a Bing stylesheet prefetch passes');
  assert.deepEqual(headers('https://login.live.com/Me.htm?v=3', {'Sec-Purpose': 'prefetch;prerender'}), {cancel: true}, 'a prerender of it is cancelled');
  assert.deepEqual(headers('https://login.live.com/Me.htm?v=3', {'Sec-Purpose': 'prefetch', 'Ping-To': 'https://login.live.com/Me.htm'}), {cancel: true}, 'hyperlink auditing is cancelled even for these URLs');
  assert.deepEqual(headers('https://tracker.example/x.js', {'Sec-Purpose': 'prefetch'}), {cancel: true}, 'any other prefetch is cancelled');
  assert.deepEqual(headers('https://www.bing.com/search?q=x', {Purpose: 'prefetch'}), {cancel: true});
  assert.deepEqual(headers('https://example.com/next', {'Sec-Purpose': 'prefetch;prerender'}), {cancel: true});
  assert.deepEqual(headers('https://example.com/a', {'Ping-From': 'https://example.com/'}), {cancel: true});
  assert.deepEqual(headers('https://login.live.com/Me.htm?v=3', {}), {}, 'an ordinary load of it is untouched');
  assert.deepEqual(headers('https://example.com/a', undefined), {});
});
test('the bundled lists never blocked those two (the prefetch rule did), and still block the telemetry next to them', () => {
  const {ElectronBlocker} = require('@ghostery/adblocker-electron'), {Request} = require('@ghostery/adblocker'), {SOURCES} = require('../desktop/browser-services/filter-updates.cjs');
  const text = SOURCES.map(source => fs.readFileSync(path.join(__dirname, '..', 'resources', 'filters', source.id), 'utf8')).join('\n');
  const engine = ElectronBlocker.parse(text, {loadNetworkFilters: true, loadCosmeticFilters: false});
  const blocked = (url, sourceUrl, type) => engine.match(Request.fromRawDetails({url, sourceUrl, type})).match;
  assert.equal(blocked('https://login.live.com/Me.htm?v=3', 'https://login.microsoftonline.com/', 'other'), false);
  assert.equal(blocked('https://login.live.com/Me.htm?v=3', 'https://login.microsoftonline.com/', 'sub_frame'), false);
  assert.equal(blocked('https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', 'https://www.bing.com/search?q=acira+browser', 'other'), false);
  assert.equal(blocked('https://r.bing.com/rp/6fF_TB8uVMIn4cROqOaTFnnOrDg.br.css', 'https://www.bing.com/search?q=acira+browser', 'stylesheet'), false);
  assert.equal(blocked('https://browser.events.data.microsoft.com/OneCollector/1.0/?cors=true', 'https://login.live.com/', 'xhr'), true, 'OneCollector telemetry');
  assert.equal(blocked('https://eu-mobile.events.data.microsoft.com/OneCollector/1.0/?cors=true', 'https://login.microsoftonline.com/', 'xhr'), true, 'OneCollector telemetry (EU)');
  assert.equal(blocked('https://collector.github.com/github/collect', 'https://github.com/login', 'ping'), true);
  assert.equal(blocked('https://improving.duckduckgo.com/t/si?1', 'https://duckduckgo.com/', 'ping'), true);
});
test('the bundled filter lists really do match that beacon (the reason the exception exists)', () => {
  const easyprivacy = fs.readFileSync(path.join(__dirname, '..', 'resources', 'filters', 'easyprivacy.txt'), 'utf8');
  assert.match(easyprivacy, /^\/generate_204\?\$image$/m);
});
