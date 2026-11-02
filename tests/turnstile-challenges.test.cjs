'use strict';
// Cloudflare Turnstile / "Verify you are human" must work. Nothing in the content blocker may touch challenges.cloudflare.com's challenge traffic:
// not the bundled lists (EasyList, EasyPrivacy, uBO), not the speculative-request rule (quietRequest), not the sign-in exceptions. The real-app proof is
// qa/turnstile-check.mjs (Cloudflare's documented test site keys in a normal tab, a private tab and a pop-up: 9/9 ok, 0 requests blocked, 28 Oct 2026).
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {ElectronBlocker} = require('@ghostery/adblocker-electron'), {Request} = require('@ghostery/adblocker');
const {SOURCES} = require('../desktop/browser-services/filter-updates.cjs'), {isSignInPrefetch} = require('../desktop/browser-services/sign-in-beacons.cjs');

const C = 'https://challenges.cloudflare.com';
const CHALLENGE_REQUESTS = [
  [C + '/turnstile/v0/api.js?onload=onloadTurnstile&render=explicit', 'script'],
  [C + '/turnstile/v0/api.js', 'script'],
  [C + '/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv/abcd/1x00000000000000000000AA/auto/fbE/new/normal/auto/', 'sub_frame'],
  [C + '/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abcd/3x00000000000000000000FF/light/fbE/new/normal/auto/', 'sub_frame'],
  [C + '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_api/v1?ray=9f1a2b3c4d5e6f70', 'script'],
  [C + '/cdn-cgi/challenge-platform/h/g/orchestrate/captcha/v1?ray=9f1a2b3c4d5e6f70', 'script'],
  [C + '/cdn-cgi/challenge-platform/h/g/flow/ov1/123456789:1698500000:abcdefg/9f1a2b3c4d5e6f70/token', 'xhr'],
  [C + '/cdn-cgi/challenge-platform/h/g/pat/9f1a2b3c4d5e6f70/light/1/2/3', 'xhr'],
  [C + '/cdn-cgi/challenge-platform/h/g/cmg/1', 'xhr'],
  [C + '/cdn-cgi/challenge-platform/h/b/rc/9f1a2b3c4d5e6f70', 'xhr'],
  [C + '/cdn-cgi/challenge-platform/scripts/jsd/main.js', 'script']
];
// pages that embed the widget: a local test page, a login form, a site with its own sub-domain, Bing's check page
const PAGES = ['http://127.0.0.1:8080/ts', 'https://example.com/login', 'https://www.bing.com/search?q=acira', 'https://discord.com/register', 'https://accounts.example.org/signup'];

test('no bundled list blocks Cloudflare challenge traffic, from any embedding page', () => {
  const text = SOURCES.map(source => fs.readFileSync(path.join(__dirname, '..', 'resources', 'filters', source.id), 'utf8')).join('\n');
  const engine = ElectronBlocker.parse(text, {loadNetworkFilters: true, loadCosmeticFilters: false});
  const blocked = [];
  for (const page of PAGES) for (const [url, type] of CHALLENGE_REQUESTS) if (engine.match(Request.fromRawDetails({url, sourceUrl: page, type})).match) blocked.push(`${type} ${url} on ${page}`);
  assert.deepEqual(blocked, []);
});

test('a site\'s own /cdn-cgi/challenge-platform/ requests (the full-page "Verify you are human" check) pass; Cloudflare analytics beacons stay blocked', () => {
  const text = SOURCES.map(source => fs.readFileSync(path.join(__dirname, '..', 'resources', 'filters', source.id), 'utf8')).join('\n');
  const engine = ElectronBlocker.parse(text, {loadNetworkFilters: true, loadCosmeticFilters: false});
  const own = [['/cdn-cgi/challenge-platform/h/g/orchestrate/chl_api/v1?ray=1', 'script'], ['/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1', 'script'], ['/cdn-cgi/challenge-platform/scripts/jsd/main.js', 'script'],
    ['/cdn-cgi/challenge-platform/h/g/jsd/oneshot/abc/def', 'xhr'], ['/cdn-cgi/challenge-platform/h/b/jsd/r/abc/def', 'xhr'], ['/cdn-cgi/challenge-platform/h/g/flow/ov1/1/2/3', 'xhr'],
    ['/cdn-cgi/challenge-platform/h/g/i/a51c6e651ea6652c/XV4tcihkc', 'xhr'], ['/cdn-cgi/challenge-platform/h/g/cv/result/9f1a', 'xhr']];
  const blocked = [];
  for (const host of ['example.com', 'www.bing.com', 'discord.com', 'nowsecure.nl']) for (const [p, type] of own) if (engine.match(Request.fromRawDetails({url: 'https://' + host + p, sourceUrl: 'https://' + host + '/', type})).match) blocked.push(host + p);
  assert.deepEqual(blocked, []);
  // not challenge traffic: Cloudflare Web Analytics and the Zaraz tag manager are trackers and stay blocked
  assert.equal(engine.match(Request.fromRawDetails({url: 'https://example.com/cdn-cgi/rum?', sourceUrl: 'https://example.com/', type: 'ping'})).match, true);
  assert.equal(engine.match(Request.fromRawDetails({url: 'https://example.com/cdn-cgi/zaraz/s.js', sourceUrl: 'https://example.com/', type: 'script'})).match, true);
});

test('the speculative-request rule never touches a challenge request that is not a prefetch or a prerender', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  const line = source.split(/\r?\n/).find(text => text.startsWith('const quietRequest='));
  assert.ok(line);
  const quiet = new Function('isSignInPrefetch', line + '\nreturn quietRequest;')(isSignInPrefetch);
  // what Turnstile's own requests carry: ordinary fetch/XHR/script/frame headers, never Sec-Purpose or Ping-To
  const headers = {'Accept': '*/*', 'Origin': 'http://127.0.0.1:8080', 'Referer': 'http://127.0.0.1:8080/', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain;charset=UTF-8'};
  for (const [url] of CHALLENGE_REQUESTS) assert.deepEqual(quiet({url, requestHeaders: headers}), {}, url);
});

test('the real-app check exists and uses the documented test keys', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'qa', 'turnstile-check.mjs'), 'utf8');
  for (const key of ['1x00000000000000000000AA', '1x00000000000000000000BB', '3x00000000000000000000FF']) assert.ok(script.includes(key), key);
  assert.match(script, /'private'/);
  assert.match(script, /window\.open/);
});
