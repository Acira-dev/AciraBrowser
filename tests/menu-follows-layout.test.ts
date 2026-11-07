import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// The Acira menu holds its own Tabs switch (Top | Sidebar) and stays open through the change, but kept the place it was opened at:
// with tabs on top the toolbar moves down 36px and the menu then covered the toolbar row, its own button included. The address
// suggestions likewise stayed where the field was when the sidebar closed under them. Both now follow their control.
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('the open Acira menu re-hangs from its button once a layout change has settled', () => {
  const start = app.indexOf('const [menuAnchorMoved, setMenuAnchorMoved] = useState(0);');
  assert.ok(start > 0);
  const effect = app.slice(start, app.indexOf('}, [s.verticalTabs, workspaceOpen, effectiveMode]);', start));
  assert.match(effect, /kind !== 'menu' && kind !== 'more-tools'/, 'only the Acira menu and More tools, which outlive a layout change');
  assert.match(effect, /steady >= 3/, 'read once the button has stopped moving (the new row arrives by a transform)');
  assert.match(effect, /popupAnchorRef\.current = \{ \.\.\.held, bounds: now \}; setMenuAnchorMoved/);
  assert.match(app, /ratingHidden, menuAnchorMoved\]\);/, 'and the popup is placed again');
});

test('the address suggestions follow the field when the tab layout or the sidebar changes', () => {
  assert.match(app, /\}, \[overlay, effectiveMode, size\.width, style, s\.showHome, s\.verticalTabs, workspaceOpen, addrBlock\]\);/);
});
