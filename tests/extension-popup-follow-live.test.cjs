'use strict';
// 13.8 item 9, the half the fakes cannot prove: the page probe of extension-popup-follow.cjs, run in a real Electron page on the popup-follow fixture
// (tests/fixtures/ext-popup-follow, the same page the real-app rig uses). The window is 600 x 600, as tall as a popup may be, and the page's
// content is a few hundred pixels: for every layout the probe must read the CONTENT'S height (what Chromium's auto-size measures), not the window's, wherever the
// page's height follows the viewport (html { height: 100% }, a 100vh block, min-height: 100vh); it must keep the page's own size where the page fixed it (Proton
// Pass's 430 px var, a body with a px height); and it must NEVER read less than the content (a probe that under-reads would shrink a popup past its page).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {spawnSync} = require('node:child_process');

const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const skip = !electron ? 'electron binary not available' : false;
const MODES = [
  'natural:click:300x200,360x340', 'vh:click:300x200,360x340', 'vh100:click:300x200,360x340', 'minvh:click:300x200,360x340', 'fluid:click:300x200,360x340',
  'winvars:click:600x430,600x240', 'bodyh:click:360x340,300x120', 'abs:click:360x340,300x120', 'flex:click:360x340,300x120', 'fixed:click:360x340,300x120',
];
let rows = null, problem = '';
if (electron) {
  const run = spawnSync(electron, ['--use-mock-keychain', '--mute-audio', path.join(__dirname, 'fixtures', 'ext-popup-follow', 'probe-host.cjs')], {
    encoding: 'utf8', timeout: 110000, killSignal: 'SIGKILL', env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '0', FOLLOW_MODES: JSON.stringify(MODES)},
  });
  const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
  if (line) rows = JSON.parse(line.slice(7)); else problem = ((run.stdout || '') + (run.stderr || '')).slice(0, 800) || 'no result';
}
const row = mode => rows.find(item => item.mode.startsWith(mode + ':'));
const state = (mode, which) => { const r = row(mode)[which]; return {eh: r.probe.eh, content: r.dom.buttonBottom, ch: r.probe.ch}; };

test('the probe ran in a real page', {skip}, () => { assert.ok(rows, problem); assert.equal(rows.length, MODES.length); });

test('a page whose height comes from its content: the probe reads the content, in both states', {skip}, () => {
  for (const mode of ['natural', 'fluid']) for (const which of ['a', 'b']) { const {eh, content} = state(mode, which); assert.ok(Math.abs(eh - content) <= 1.5, `${mode} ${which}: read ${eh}, content ${content}`); }
});

test('a page whose root follows the viewport (height: 100%, 100vh, min-height: 100vh): the content, not the 600 px window the popup had', {skip}, () => {
  for (const mode of ['vh', 'vh100', 'minvh']) for (const which of ['a', 'b']) {
    const {eh, content, ch} = state(mode, which);
    assert.equal(ch, 600, 'the window is as tall as a popup gets');
    assert.ok(Math.abs(eh - content) <= 1.5, `${mode} ${which}: read ${eh}, content ${content}`);
  }
});

test('a page that fixed its own size keeps it, as Chromium does: Proton Pass\'s 430 px (var) and a body with a px height, shorter content or not', {skip}, () => {
  assert.ok(Math.abs(state('winvars', 'a').eh - state('winvars', 'a').content) <= 1.5, 'content past the 430 px is the page\'s size');
  assert.equal(state('winvars', 'b').eh, 430, 'content of 261 in a 430 px page: 430');
  assert.equal(state('bodyh', 'b').eh, 340, 'content of 141 in a 340 px body: 340');
  { const want = state('bodyh', 'a').content > 340 ? state('bodyh', 'a').content : 340; assert.ok(Math.abs(state('bodyh', 'a').eh - want) <= 0.01, `bodyh a: ${state('bodyh', 'a').eh} vs ${want}`); } // a fractional display scale (Windows 150 %) reads one side in single precision
});

test('a bar fixed to the bottom of the window is part of the page: nothing is brought down over it', {skip}, () => {
  for (const which of ['a', 'b']) assert.ok(state('fixed', which).eh >= 599, `fixed ${which}: read ${state('fixed', which).eh}`);
});

test('absolutely positioned content counts: it overflows its 40 px parent and is the page\'s height', {skip}, () => {
  assert.equal(state('abs', 'a').eh, 340);
  assert.equal(state('abs', 'b').eh, 120);
});

test('never less than the content, in any layout and state (a probe that under-read would shrink a popup past its page); a flex column that fills the window is left as it is', {skip}, () => {
  for (const item of rows) for (const which of ['a', 'b']) {
    const eh = item[which].probe.eh, content = item[which].dom.innerBottom;   // the content block's bottom edge
    assert.ok(eh >= content - 1.5, `${item.mode} ${which}: read ${eh}, content ends at ${content}`);
  }
  assert.ok(state('flex', 'b').eh >= 599, 'flex: not understood, so not shrunk');
});
