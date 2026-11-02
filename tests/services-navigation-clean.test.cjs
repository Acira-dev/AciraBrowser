'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createNavigationCleaner, stripTracking, parseRules } = require('../desktop/browser-services/navigation-clean.cjs');
const { createDebouncer } = require('../desktop/browser-services/debounce.cjs');

const rulesText = fs.readFileSync(path.join(__dirname, '..', 'resources', 'filters', 'query-filter.json'), 'utf8');
const rules = parseRules(rulesText);
const strip = href => stripTracking(href, rules);

test('the shipped query-filter rules parse', () => {
  assert.ok(rules.length >= 4);
  assert.ok(rules[0].params.includes('fbclid'));
});

test('tracking parameters are removed and everything else is kept byte for byte', () => {
  assert.deepEqual(strip('https://news.example/story?id=7&fbclid=AbC&q=a%20b+c#top'), { url: 'https://news.example/story?id=7&q=a%20b+c#top', removed: ['fbclid'] });
  assert.equal(strip('https://shop.example/p?gclid=1&utm_source=mail&utm_campaign=x').url, 'https://shop.example/p');
  assert.equal(strip('https://shop.example/p?UTM_Source=mail&a=1').url, 'https://shop.example/p?a=1');
  assert.equal(strip('https://shop.example/p?a=1&b=2'), null);
  assert.equal(strip('https://shop.example/p'), null);
});

test('per-site rules apply only on their sites', () => {
  assert.equal(strip('https://www.instagram.com/p/x/?igshid=abc&hl=en').url, 'https://www.instagram.com/p/x/?hl=en');
  assert.equal(strip('https://blog.example/?igshid=abc'), null);
  assert.equal(strip('https://youtu.be/abc?si=xyz&t=10').url, 'https://youtu.be/abc?t=10');
});

test('like Brave: empty values, conditional parameters and exempt hosts are left alone', () => {
  assert.equal(strip('https://a.example/?fbclid=&x=1'), null);
  assert.equal(strip('https://a.example/unsubscribe?ck_subscriber_id=9'), null);
  assert.equal(strip('https://a.example/news?ck_subscriber_id=9').url, 'https://a.example/news');
  assert.equal(strip('https://urldefense.com/v3/__https://x.example__;?fbclid=1'), null);
});

test('signed and authentication links are never rewritten', () => {
  assert.equal(strip('https://bucket.example/file?X-Amz-Signature=abc&utm_source=x'), null);
  assert.equal(strip('https://id.example/oauth/authorize?state=1&fbclid=2'), null);
  assert.equal(strip('https://user:pw@a.example/?fbclid=1'), null);
  assert.equal(strip('ftp://a.example/?fbclid=1'), null);
});

function cleaner(overrides = {}) {
  const state = { settings: { stripTrackingParams: true, deAmp: true }, enabled: true, page: 'https://search.example/results', time: 1000 };
  Object.assign(state, overrides);
  const wc = { id: 1, session: {}, getURL: () => state.page };
  const instance = createNavigationCleaner({ text: rulesText, settings: () => state.settings, enabled: () => state.enabled, contents: () => wc, allow: ['broken.example'], now: () => state.time });
  return { instance, state, wc };
}
const nav = (url, extra = {}) => ({ resourceType: 'mainFrame', method: 'GET', url, ...extra });

test('main-frame GET navigations to another site are cleaned', () => {
  const { instance } = cleaner();
  assert.deepEqual(instance.before(nav('https://news.example/a?fbclid=1&id=2')), { redirectURL: 'https://news.example/a?id=2' });
  assert.equal(instance.stats().stripped, 1);
});

test('same-site, non-GET, subresource, switched-off, protection-off and allowlisted requests are left alone', () => {
  assert.deepEqual(cleaner({ page: 'https://www.news.example/home' }).instance.before(nav('https://news.example/a?fbclid=1')), {});
  assert.deepEqual(cleaner().instance.before(nav('https://news.example/a?fbclid=1', { method: 'POST' })), {});
  assert.deepEqual(cleaner().instance.before(nav('https://news.example/a?fbclid=1', { resourceType: 'image' })), {});
  assert.deepEqual(cleaner({ settings: { stripTrackingParams: false } }).instance.before(nav('https://news.example/a?fbclid=1')), {});
  assert.deepEqual(cleaner({ enabled: false }).instance.before(nav('https://news.example/a?fbclid=1')), {});
  assert.deepEqual(cleaner().instance.before(nav('https://shop.broken.example/a?fbclid=1')), {});
});

test('a new tab or typed address is cleaned too', () => {
  assert.deepEqual(cleaner({ page: '' }).instance.before(nav('https://news.example/a?gclid=1')), { redirectURL: 'https://news.example/a' });
});

test('de-AMP: an AMP page is replaced by its canonical page, cleaned', () => {
  const { instance, wc } = cleaner();
  assert.equal(instance.deAmpTarget(wc, 'https://news.example/amp/story', 'https://news.example/story?utm_source=amp'), 'https://news.example/story');
  assert.equal(instance.deAmpTarget(wc, 'https://b.example/amp/x', '/x'), 'https://b.example/x');
});

test('de-AMP refuses bad targets, its switch, protection-off pages and loops', () => {
  const { instance, wc, state } = cleaner();
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/amp', 'https://a.example/amp'), null);
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/amp', 'javascript:alert(1)'), null);
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/amp', 'data:text/html,hi'), null);
  // A -> B, then B (claiming to be AMP) pointing back to A: refused.
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/amp', 'https://a.example/page'), 'https://a.example/page');
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/page', 'https://a.example/amp'), null);
  state.time += 20000;
  assert.equal(instance.deAmpTarget(wc, 'https://a.example/page', 'https://a.example/amp'), 'https://a.example/amp');
  state.settings = { deAmp: false };
  assert.equal(instance.deAmpTarget(wc, 'https://c.example/amp', 'https://c.example/'), null);
  state.settings = { deAmp: true }; state.enabled = false;
  assert.equal(instance.deAmpTarget(wc, 'https://c.example/amp', 'https://c.example/'), null);
  assert.equal(cleaner().instance.deAmpTarget(cleaner().wc, 'https://broken.example/amp', 'https://broken.example/'), null);
});

test('de-AMP cache links (Brave debounce rules) run only with the de-AMP switch', () => {
  const debouncer = createDebouncer({ filePath: path.join(__dirname, '..', 'resources', 'filters', 'debounce.json') });
  assert.equal(debouncer.destination('https://www.google.com/amp/s/www.example.com/news/1.amp'), null);
  assert.equal(debouncer.destination('https://www.google.com/amp/s/www.example.com/news/1.amp', { deAmp: true }), 'https://www.example.com/news/1.amp');
  assert.equal(debouncer.destination('https://www-example-com.cdn.ampproject.org/c/s/www.example.com/a', { deAmp: true }), 'https://www.example.com/a');
});
