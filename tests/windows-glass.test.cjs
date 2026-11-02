'use strict';
// Windows overlay look (R6): the sidebar and toolbar float as one veil over the window's material only while the acrylic backdrop is live.
const test = require('node:test'), assert = require('node:assert/strict');
const {glassScript} = require('../desktop/composition.cjs');
const run = dataset => { new Function('document', glassScript)({documentElement: {dataset}}); return dataset.desktopMaterial; };

test('Windows reports the desktop material ready only with live acrylic, an active window and system transparency on', () => {
  if (process.platform !== 'win32') { assert.equal(glassScript, 'void 0', 'other platforms leave their own material path alone'); return; }
  assert.equal(run({material: 'acrylic', windowActive: 'true', systemTransparency: 'on'}), 'ready');
  assert.equal(run({material: 'acrylic', windowActive: 'true'}), 'ready', 'transparency not reported yet counts as on');
  assert.equal(run({material: 'acrylic', windowActive: 'false', systemTransparency: 'on'}), 'unavailable', 'DWM paints its solid fallback while inactive');
  assert.equal(run({material: 'acrylic', windowActive: 'true', systemTransparency: 'off'}), 'unavailable', 'Energy saver drops the acrylic');
  assert.equal(run({material: 'none', windowActive: 'true', systemTransparency: 'on'}), 'unavailable');
});
