'use strict';
// The regression guard's c7 judge (qa/regression-guard/lib/caption.mjs) on hand-made layouts, no Electron: what it accepts, and (negative controls) what it must catch.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const HAVE = fs.existsSync(path.join(__dirname, '..', 'qa', 'regression-guard', 'lib', 'caption.mjs')); // the public source leaves the guard rig out
const load = () => import('../qa/regression-guard/lib/caption.mjs');
const only = { skip: HAVE ? false : 'the regression guard is not in this tree' };
const layoutOf = extra => ({ appearance: 'light', captionHeight: 40, captionColor: '#eef0f2', captionForeground: '#26282b', ...extra });

test('c7 judge: every layout of the matrix, at rest and in every window state, ends with the buttons where the layout wants them', only, async () => {
  const { CONFIGS, judgeCaption } = await load();
  assert.deepEqual(CONFIGS.map(c => c.name), ['full', 'compact', 'focus', 'seamless', 'sidebar-mode', 'hide-the-toolbar']);
  const published = { full: layoutOf({}), compact: layoutOf({}), focus: layoutOf({}), seamless: layoutOf({ captionFloat: true, captionHidden: true }), 'sidebar-mode': layoutOf({ captionNotch: true, captionHeight: 34 }), 'hide-the-toolbar': layoutOf({ captionFloat: true, captionHidden: true }) };
  const states = [{}, { maximized: true }, { fullscreen: true }, { minimized: true }, { maximized: true, minimized: true }];
  for (const cfg of CONFIGS) for (const win of states) assert.deepEqual(judgeCaption({ layout: published[cfg.name], win, expect: cfg.expect }), [], `${cfg.name} ${JSON.stringify(win)}`);
});

test('c7 judge, negative controls: a caption stuck hidden or shown, a notch that should not be there, and nothing published are all reported', only, async () => {
  const { CONFIGS, judgeCaption } = await load();
  const by = name => CONFIGS.find(c => c.name === name).expect;
  const stuckHidden = judgeCaption({ layout: layoutOf({ captionHidden: true, captionFloat: true }), expect: by('full') });
  assert.ok(stuckHidden.some(p => /captionHidden true, the layout wants false/.test(p)), stuckHidden.join('|'));
  const stuckShown = judgeCaption({ layout: layoutOf({}), expect: by('seamless') });
  assert.ok(stuckShown.some(p => /captionHidden false, the layout wants true/.test(p)), stuckShown.join('|'));
  const strayNotch = judgeCaption({ layout: layoutOf({ captionNotch: true, captionHeight: 34 }), expect: by('full') });
  assert.ok(strayNotch.some(p => /captionNotch true, the layout wants false/.test(p)));
  assert.deepEqual(judgeCaption({ layout: null, expect: by('full') }), ['no layout was published']);
});

test('c7 judge, negative control on the code under test: beta.13.1\'s caption code fails the corner and the flags rows (it needs the poller and never repairs flags)', only, async () => {
  const { judgeCaption } = await load();
  // The judge runs main.cjs's text from the repo it is given. Point it at a tree whose helper reads the 13.1 fixture instead: here, a copy of the helper with the fixture as its source.
  const helper = require('./caption-main-vm.cjs');
  const legacy = helper.realMainCaption({ source: path.join(__dirname, 'fixtures', 'caption-13-1.txt'), legacy: true, layout: { captionNotch: true, captionHeight: 34 } });
  legacy.api.setCaption();
  legacy.screen.point = { x: legacy.state.bounds.x + legacy.state.bounds.width - 20, y: legacy.state.bounds.y + 10 };
  legacy.poll(5000);
  assert.equal(helper.seen(legacy.state.states.at(-1)), null, '13.1: the pointer stayed in the corner for 5 s and the buttons are still gone');
  assert.deepEqual(judgeCaption({ layout: layoutOf({ captionNotch: true, captionHeight: 34 }), expect: { notch: true, hidden: false } }), [], 'the fix: they come back');
});

test('c7 is registered in the guard, needs --win, and skips without it', only, () => {
  const guard = fs.readFileSync(path.join(__dirname, '..', 'qa', 'regression-guard', 'guard.mjs'), 'utf8'), check = fs.readFileSync(path.join(__dirname, '..', 'qa', 'regression-guard', 'checks', 'c7-caption.mjs'), 'utf8');
  assert.match(guard, /c7: 'c7-caption\.mjs'/);
  assert.match(guard, /opt\('checks', 'c1,c2,c3,c4,c5,c6,c7'\)/);
  assert.match(check, /if \(!ctx\.win\) return \{pass: true, skipped: true/);
  for (const word of ['maximise', 'un-maximise', 'resize', 'appearance switch', 'interface reload', 'full screen in', 'full screen out', 'minimise', 'restore']) assert.ok(check.includes(`'${word}'`), word);
  for (const view of ['full', 'compact', 'focus', 'seamless']) assert.ok(fs.readFileSync(path.join(__dirname, '..', 'qa', 'regression-guard', 'lib', 'caption.mjs'), 'utf8').includes(`view: '${view}'`), view);
});
