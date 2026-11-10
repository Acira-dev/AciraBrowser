'use strict';
// 13.5, real Electron: with the app's real page-start preloads a frame asks the main process ONE synchronous question (frame-boot), not one per preload, and the page still gets every
// script those questions produce. Before 13.5 the main frame asked six questions and every iframe three; each is a blocked round trip before the page's first script.
const {test} = require('node:test'), assert = require('node:assert/strict'), {spawnSync} = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
const root = path.join(__dirname, '..'), built = path.join(root, 'desktop', 'browser-services', 'autoconsent-preload.cjs');
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
let result = null, problem = null;
if (electron) {
  if (!fs.existsSync(built)) spawnSync(process.execPath, [path.join(root, 'scripts', 'build-ui-preload.mjs')], {cwd: root, encoding: 'utf8'});
  const env = {...process.env, ELECTRON_ENABLE_LOGGING: '0'}; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electron, [path.join(__dirname, 'fixtures', 'frame-boot', 'run.cjs')], {encoding: 'utf8', timeout: 90000, env});
  const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
  if (line) result = JSON.parse(line.slice(7)); else problem = ((run.stdout || '') + (run.stderr || '')).split(/\r?\n/).filter(text => !/^\[\d+:/.test(text)).join('\n').slice(0, 600) || 'electron gave no result';
}
const skip = !electron ? 'electron binary not available' : false;
test('the fixture run finished', {skip}, () => { assert.ok(result, problem); });
test('every frame, the main one and both cross-site iframes, asks the main process exactly one synchronous question', {skip}, () => {
  assert.equal(result.syncs.length, 3, 'three frames reported');
  for (const report of result.syncs) assert.deepEqual(report.names, ['acira:frame-boot'], (report.main ? 'main frame' : 'iframe ' + report.href) + ' asked: ' + report.names.join(', '));
});
test('the page gets exactly the scripts each question produced: the main frame all four, an iframe only identity and farbling', {skip}, () => {
  const main = result.frames.find(frame => frame.main), subs = result.frames.filter(frame => !frame.main);
  assert.equal(subs.length, 2);
  assert.deepEqual(main.flags, {ident: true, farble: true, scriptlet: true, risk: true});
  for (const frame of subs) assert.deepEqual(frame.flags, {ident: true, farble: true, scriptlet: false, risk: false}, frame.url);
});
