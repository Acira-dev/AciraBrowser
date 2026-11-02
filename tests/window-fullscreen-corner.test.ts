import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyWindowState, isWindowFullscreen, subscribeWindowFullscreen } from '../src/ui/windowFullscreen';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Fullscreen corner: the root is marked while main says the window is fullscreen, and unmarked when it leaves', () => {
  const root = { dataset: {} as DOMStringMap };
  applyWindowState(root, { type: 'window-state', fullscreen: true });
  assert.equal(root.dataset.windowFullscreen, '');
  applyWindowState(root, { type: 'overlay-dismissed' });
  assert.equal(root.dataset.windowFullscreen, '', 'another event leaves the mark alone');
  applyWindowState(root, { type: 'window-state', fullscreen: false });
  assert.equal('windowFullscreen' in root.dataset, false);
  applyWindowState(root, { type: 'window-state', fullscreen: false });
  assert.equal('windowFullscreen' in root.dataset, false, 'leaving twice is harmless');
});

test('Fullscreen corner: the Mac rows keep the traffic lights\' 86px only out of fullscreen (Compact, Focus, sidebar tabs and the tab row)', () => {
  const css = read('src/styles/platform.css');
  const rule = css.match(/([^}]*)\{padding-left:var\(--mac-caption-space,86px\)\}/);
  assert.ok(rule, 'the corner rule is still there');
  const selectors = rule![1].replace(/\/\*[\s\S]*?\*\//g, '').split(/,\s*\n/).map(part => part.trim()).filter(Boolean);
  assert.equal(selectors.length, 3);
  for (const layout of ['.acira-tab-row', '.side-tabs .browser-shell.acira-shell .acira-persistent-toolbar', ':is([data-layout=compact],[data-layout=focus]) .acira-persistent-toolbar'])
    assert.ok(selectors.some(selector => selector.endsWith(layout)), `the corner is kept for ${layout}`);
  for (const selector of selectors) assert.match(selector, /^:root:root:root\[data-platform=darwin\]:not\(\[data-window-fullscreen\]\) /, selector);
  assert.equal(css.match(/--mac-caption-space/g)?.length, 1, 'no other rule reserves the corner past fullscreen');
  // The sidebar-out rules (padding-left:0) must still win over the corner rule outside fullscreen: one :has(> .a.b) beats one :not([attr]).
  assert.match(css, /:root:root:root\[data-platform=darwin\] \.app\.style-acira:has\(> \.ed-rail\.is-expanded\) \.browser-shell\.acira-shell:is\(\[data-layout=compact\],\[data-layout=focus\]\) \.acira-persistent-toolbar\{padding-left:0\}/);
});

test('Fullscreen corner: main says so with the window\'s new size (the start of macOS\'s animation), fills in on enter and leave, and says it again when the interface loads in a fullscreen window; the listener is in place before then', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /let sentFullscreen=mainWindow\.isFullScreen\(\);const sendFullscreen=\(\)=>\{if\(!mainWindow\|\|mainWindow\.isDestroyed\(\)\)return;const fullscreen=mainWindow\.isFullScreen\(\);if\(fullscreen===sentFullscreen\)return;sentFullscreen=fullscreen;emitBrowser\(\{type:'window-state',fullscreen\}\);\};/, 'said once per change');
  assert.match(main, /mainWindow\.on\('resize',\(\)=>\{sendFullscreen\(\);resize\(\);queueWindowSave\(\);\}\);/, 'on the first resize of the transition (measured: ~60ms in, the end event ~0.75s later)');
  assert.match(main, /for\(const name of \['enter-full-screen','leave-full-screen'\]\)mainWindow\.on\(name,sendFullscreen\);/, 'the end of the animation only fills in');
  assert.match(main, /chromeView\.webContents\.on\('dom-ready',\(\)=>\{if\(mainWindow&&!mainWindow\.isDestroyed\(\)&&mainWindow\.isFullScreen\(\)\)\{sentFullscreen=true;emitBrowser\(\{type:'window-state',fullscreen:true\}\);\}\}\)/);
  const entry = read('src/main.tsx');
  const installed = entry.indexOf('installWindowFullscreen();'), app = entry.indexOf("import('./App')");
  assert.ok(installed > 0 && installed < app, 'installed by the entry script itself, not by the lazily loaded App (dom-ready can come first)');
});

test('Fullscreen band: the sidebar keeps its 32px band for the traffic lights only out of fullscreen, docked or peeking (founder, 2 Nov)', () => {
  const css = read('src/styles/platform.css');
  const band = css.indexOf("html[data-platform=darwin] .app.style-acira>.ed-rail.acira-sidebar.is-expanded::before{"), off = css.indexOf('html[data-platform=darwin][data-window-fullscreen] .app.style-acira>.ed-rail.acira-sidebar.is-expanded::before{flex-basis:0}');
  assert.ok(band >= 0 && off > band, 'the fullscreen rule follows the band (and outranks it by one attribute)');
  assert.match(css.slice(band, off), /flex:0 0 var\(--mac-caption-top,32px\);/);
});

test('Fullscreen Seamless: the store follows main and tells a layout once per change; the page card has no margin, radius or ring in fullscreen', () => {
  const root = { dataset: {} as DOMStringMap };
  let told = 0;
  const stop = subscribeWindowFullscreen(() => { told++; });
  assert.equal(isWindowFullscreen(), false);
  applyWindowState(root, { type: 'window-state', fullscreen: true });
  applyWindowState(root, { type: 'window-state', fullscreen: true });
  assert.equal(isWindowFullscreen(), true);
  assert.equal(told, 1, 'a repeat of the same state is not a change');
  applyWindowState(root, { type: 'window-state', fullscreen: false });
  assert.equal(isWindowFullscreen(), false);
  assert.equal(told, 2);
  stop();
  applyWindowState(root, { type: 'window-state', fullscreen: true });
  assert.equal(told, 2, 'unsubscribed');
  applyWindowState(root, { type: 'window-state', fullscreen: false });
  const css = read('src/styles/seamless.css'), app = read('src/App.tsx');
  assert.match(css, /:root\[data-window-fullscreen\]:root:root \.app:has\(\.browser-shell\[data-seamless\]\) \.browser-root \.browser-body > \.page-area \{ margin: 0; border-radius: 0; box-shadow: none; \}/);
  assert.match(app, /seamless && windowFullscreen \? 0 :/, 'the native page card takes radius 0 too');
  assert.match(app, /\[profileFrameTint,currentWindowFinish,windowFullscreen,/, 'the layout runs again when fullscreen flips');
});
