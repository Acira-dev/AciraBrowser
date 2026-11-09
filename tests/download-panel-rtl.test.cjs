'use strict';
// 13.3 (9 Nov 2026). In a right-to-left interface (Arabic) the downloads popup's row is a grid whose last column (room for the action buttons) is on the LEFT, but the buttons were placed
// with `right: 8px`, so they sat over the file icon and the start of the name (measured in the real app: 16 px over the icon, 28 px over the name of a running download, 56 px of a finished one on hover).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../src/features/downloads-panel.css'), 'utf8');
const rule = selector => { const at = css.indexOf(selector + ' {'); assert.ok(at >= 0, selector); return css.slice(at, css.indexOf('}', at)); };

test('the action buttons are placed at the row\'s end, whichever way the interface reads', () => {
  const acts = rule('.dl-panel-acts');
  assert.match(acts, /inset-inline-end:\s*8px/);
  assert.doesNotMatch(acts, /(^|[\s;{])(left|right)\s*:/, 'no physical side: the reserved column moves with the direction');
});

test('the note under the list is indented from the row\'s start, not from the left', () => {
  const note = rule('.download-panel-note');
  assert.match(note, /margin-inline-start:\s*36px/);
});

// panels.css sets `text-align: left` on every menu row, and the update question's note was `text-align: left` with a physical 36px left padding. In Arabic the mark is on the right, so the
// title and the note started at the left edge, far from the mark, and the note's indent sat on the wrong side. Measured in the real app (Arabic): title text 759-834 beside a mark at 1071-1087; after: 988-1063.
const update = fs.readFileSync(path.join(__dirname, '../src/features/updates/update-pill.css'), 'utf8');
const updateRule = selector => { const at = update.indexOf(selector + ' {'); assert.ok(at >= 0, selector); return update.slice(at, update.indexOf('}', at)); };

test('the update question\'s note and notes start at the title\'s text edge in either direction', () => {
  const at = update.indexOf('.update-pop-note,');
  const block = update.slice(at, update.indexOf('}', at));
  assert.match(block, /padding-inline-start:\s*36px/);
  assert.match(block, /text-align:\s*start/);
  assert.doesNotMatch(block, /padding:\s*2px 12px 8px 36px/, 'the physical left padding is gone');
});

test('the update and downloads panels\' rows start their text at the interface\'s start edge', () => {
  assert.match(updateRule('.update-popover .acira-menu-row'), /text-align:\s*start/);
  assert.match(rule('.download-panel .acira-menu-row'), /text-align:\s*start/);
});
