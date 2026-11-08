'use strict';
// 13.2 safety net: a fresh tab's ordinary page or image that turns into a download nobody asked for is loaded as a page instead, once
// (desktop/browser-services/navigation-rescue.cjs, wired into the download engine's will-download).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createNavigationRescue, RENDERABLE } = require('../desktop/browser-services/navigation-rescue.cjs');

const root = path.join(__dirname, '..');
const fresh = { tabUrl: 'acira-browser-ui://new-tab/', wcId: 7 };

test('a fresh tab: an html page and a webp image that became downloads are rescued once, then let through, and both are logged', () => {
  const lines = [], rescue = createNavigationRescue({ record: (kind, error) => lines.push(kind + ': ' + error.message) });
  for (const [url, mime] of [['https://example.com/', 'text/html; charset=utf-8'], ['https://cdn.example.com/a.webp', 'image/webp']]) {
    assert.equal(rescue.shouldRescue({ ...fresh, url, mime, disposition: '' }), true, url + ' is rescued the first time');
    assert.equal(rescue.shouldRescue({ ...fresh, url, mime, disposition: '' }), false, url + ' is a download the second time (no loop)');
  }
  assert.equal(lines.length, 4);
  assert.ok(lines.every(line => line.startsWith('Navigation saved as a download: ')));
  assert.ok(lines.every(line => !/https?:|example\.com/.test(line)), 'main.log never holds the address');
  assert.equal(rescue.shouldRescue({ url: 'https://example.com/', mime: 'text/html', tabUrl: 'about:blank', wcId: 8 }), true, 'another tab gets its own one try');
});

test('everything that is a real download stays one', () => {
  const rescue = createNavigationRescue();
  const base = { ...fresh, url: 'https://example.com/file', mime: 'text/html' };
  assert.equal(rescue.shouldRescue({ ...base, disposition: 'attachment; filename="a.html"' }), false, 'the server said attachment');
  assert.equal(rescue.shouldRescue({ ...base, mime: 'application/pdf' }), false, 'a PDF is not rescued');
  assert.equal(rescue.shouldRescue({ ...base, mime: 'application/octet-stream' }), false, 'a binary is not rescued');
  assert.equal(rescue.shouldRescue({ ...base, mime: '' }), false, 'an unknown type is not rescued');
  assert.equal(rescue.shouldRescue({ ...base, tabUrl: 'https://site.example/page' }), false, 'a tab already on a web page keeps its downloads');
  assert.equal(rescue.shouldRescue({ ...base, wcId: undefined }), false, 'a download no tab started (an extension, a retry)');
  assert.equal(rescue.shouldRescue({ ...base, url: 'blob:https://example.com/1' }), false, 'only web addresses');
  rescue.expectSave('https://example.com/saved.html');
  assert.equal(rescue.shouldRescue({ ...base, url: 'https://example.com/saved.html' }), false, 'Save link as / Save image as stay saves');
});

test('an announced save expires, so it never shields a later navigation', () => {
  let clock = 0; const rescue = createNavigationRescue({ now: () => clock });
  rescue.expectSave('https://example.com/');
  clock = 31000;
  assert.equal(rescue.shouldRescue({ ...fresh, url: 'https://example.com/', mime: 'text/html' }), true);
});

test('the renderable types are pages and common images only', () => {
  for (const mime of ['text/html', 'TEXT/HTML; charset=UTF-8', 'application/xhtml+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml']) assert.match(mime, RENDERABLE);
  for (const mime of ['text/plain', 'application/pdf', 'image/tiff', 'application/zip', 'text/html-sandboxed']) assert.doesNotMatch(mime, RENDERABLE);
});

test('wired in: the download engine asks before anything else, the Save commands announce themselves, main.log receives it, crashes are logged', () => {
  const engine = fs.readFileSync(path.join(root, 'desktop/browser-services/download-engine.cjs'), 'utf8');
  const start = engine.indexOf("session.on('will-download',async(event,item,wc)=>{");
  assert.ok(start > 0);
  const head = engine.slice(start, start + 900);
  assert.match(head, /rescue\.shouldRescue\(\{url,mime:read\(item,'getMimeType',''\),disposition:read\(item,'getContentDisposition',''\),tabUrl,wcId:wc\.id\}\)\)\{event\.preventDefault\(\);/);
  assert.match(engine, /rescue=require\('\.\/navigation-rescue\.cjs'\)\.shared/);
  const commands = fs.readFileSync(path.join(root, 'desktop/browser-services/context-commands.cjs'), 'utf8');
  assert.match(commands, /const download=url=>\{require\('\.\/navigation-rescue\.cjs'\)\.shared\.expectSave\(url\);if\(typeof owner\.downloadURL==='function'\)owner\.downloadURL\(url\);else wc\.downloadURL\(url\);\};/);
  const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  assert.match(main, /navigation-rescue\.cjs'\)\.shared\.setRecorder\(\(kind,error\)=>processErrors\.record\(kind,error\)\)/);
  assert.match(main, /shared\.expectSave\(url\);wc\.downloadURL\(url\);/, "the link preview's Download is a save too");
  assert.match(main, /processErrors\.record\('Page stopped'/);
  assert.match(main, /app\.on\('child-process-gone'/);
});
