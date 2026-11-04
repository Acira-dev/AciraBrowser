import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Round 1 (chrome-hunt): the toolbar drew the profile button at the left end of its actions (CSS order:-1) while the DOM had it
// after Extensions and the Focus button, so Tab went Extensions → Focus → back left to the profile → Acira menu.
// Round 2 (compact-ui): the actions are drawn in the order Customize toolbar keeps, so the profile button can be moved; nothing
// reorders them in CSS, so Tab still follows the row as drawn, wherever the profile button is.
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles/toolbar-controls.css', import.meta.url), 'utf8');

test('no CSS order moves a toolbar action away from its place in the DOM', () => {
  assert.doesNotMatch(css, /\.toolbar-actions[^{}]*\{[^}]*\border:/, 'an order on the actions row would make Tab jump');
});

test('the actions are built in the saved order, the profile button among them, the pinned extensions after a leading profile', () => {
  const row = app.slice(app.indexOf('const shownItems = toolbarItems.filter(item => item.visible)'));
  assert.match(row, /lead = shownItems\[0\]\?\.id === 'profile' \? 1 : 0;/);
  assert.match(row, /\{shownItems\.slice\(0, lead\)\.map\(item => toolbarAction\(item\.id\)\)\}<BrowserExtensionActions target=\{extensionTarget\}\/>\{shownItems\.slice\(lead\)\.map\(item => toolbarAction\(item\.id\)\)\}/);
  assert.match(app, /\{parts\.exitFocus \? layoutToggle : optionalActions\}/);
  assert.doesNotMatch(app, /profileAction/, 'the profile button is not placed on its own any more');
});
