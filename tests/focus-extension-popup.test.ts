import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { popupAnchor } from '../src/ui/extensionPopupAnchor';

// 13.7, glitch 11: Focus view with the Top bar layout draws no extension buttons (App.tsx: `parts.exitFocus ? layoutToggle : optionalActions`), and the toolbar's buttons were the
// only listener for chrome.action.openPopup() and an extension's own shortcut (BrowserExtensionActions answers the browser event `extension-popup`): in that view both did nothing at
// all (the popup only opened from Acira menu > More tools > Extensions). A silent copy of the component now stands in the Focus branch: no buttons, only the answer, with the popup hung
// from the Acira menu button.
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../src/components/BrowserExtensionActions.tsx', import.meta.url), 'utf8');

test('the popup hangs from the Acira menu button when there is one, and from the right end of the extension buttons otherwise (as before)', () => {
  const menu = { x: 834, y: 2, width: 28, height: 28 };
  assert.deepEqual(popupAnchor({ menu, edge: { right: 892, top: 39, height: 30 }, viewportWidth: 1000 }), menu);
  assert.deepEqual(popupAnchor({ menu: null, edge: { right: 892, top: 39, height: 30 }, viewportWidth: 1000 }), { x: 862, y: 39, width: 30, height: 30 });
  assert.deepEqual(popupAnchor({ edge: { right: 10, top: 5, height: 0 }, viewportWidth: 1000 }), { x: 0, y: 5, width: 30, height: 30 }, 'never left of the window; a zero height is 30');
  assert.deepEqual(popupAnchor({ edge: null, viewportWidth: 1000 }), { x: 970, y: 0, width: 30, height: 30 }, 'no buttons at all: the right end of the window');
  assert.deepEqual(popupAnchor({ menu: { x: 0, y: 0, width: 0, height: 0 }, edge: null, viewportWidth: 1000 }), { x: 970, y: 0, width: 30, height: 30 }, 'a menu button that is not drawn is no anchor');
});

test('Focus view keeps a silent listener for action.openPopup() and an extension shortcut: no buttons built, hidden, hung from the Acira menu button', () => {
  assert.match(app, /\{parts\.exitFocus \? <>\{layoutToggle\}<BrowserExtensionActions target=\{extensionTarget\} silent\/><\/> : optionalActions\}/);
  assert.doesNotMatch(app, /\{parts\.exitFocus \? layoutToggle : optionalActions\}/);
  assert.match(actions, /silent\?:boolean/);
  // Switching to Focus re-renders the toolbar's copy as the silent one (the same instance: both sit at the same place of the same row): its effect has to run again, or the buttons it built
  // before stay in the hidden strip and the event presses one of them, in a box of 0 x 0 (a popup in the window's top-left corner, seen in the real app with a pinned extension).
  assert.match(actions, /list\?\.remove\(\);\};\n \},\[signature,silent\]\);/);
  assert.match(actions, /if\(silent\|\|!host\|\|/, 'a silent copy builds no buttons');
  assert.match(actions, /hidden=\{silent\|\|!target\?\.supported/, 'and is hidden');
  // the first Acira menu button that is drawn (a copy that is not drawn has no box); a silent copy has no button strip of its own, so without one the popup hangs from the window's right end
  assert.match(actions, /edge=silent\?null:root\.current\?\.getBoundingClientRect\(\),menu=silent\?\[\.\.\.document\.querySelectorAll\('\.toolbar-menu-control'\)\]\.map\(node=>node\.getBoundingClientRect\(\)\)\.find\(box=>box\.width>0&&box\.height>0\):null/);
  assert.match(actions, /anchorRect:popupAnchor\(\{menu:menu&&\{x:menu\.x,y:menu\.y,width:menu\.width,height:menu\.height\},edge,viewportWidth:window\.innerWidth\}\)/);
  assert.match(app, /className="toolbar-menu-control"/, 'the Acira menu button the popup hangs from keeps its class');
});
