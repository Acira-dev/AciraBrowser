'use strict';
// The sidebar's workspace pill is sized to the open workspace's cell. Renaming it changed the cell (its name is shown beside the icon)
// but neither the row the ResizeObserver watches nor the effect's dependencies, so the pill stayed at its old width behind a longer name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'workspaces', 'WorkspaceSwitcher.tsx'), 'utf8');

test('the pill placement restarts when a workspace is renamed or gets another icon', () => {
  // nameIn: the name shown in this window (with profiles as spaces, the profile's, so renaming a profile restarts it too).
  assert.match(source, /const names = list\.map\(item => `\$\{item\.id\}:\$\{(?:shownName\(item\)|nameIn\(state, item\))\}:\$\{workspaceIcon\(item\)\}`\)\.join\('\|'\);/);
  assert.match(source, /\}, \[active, list\.length, several, names\]\);/);
});
