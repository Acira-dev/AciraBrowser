import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// 13.6, bug B of the Linux report (9 Nov 2026): a pinned extension was drawn only in the toolbar row, which Sidebar + address folds behind a thin line and Seamless and
// "Hide the toolbar" hide, so a user looked for it "in the sidebar" and found nothing. We picked B2 (Zen/Arc style): the same buttons as a row at the top of the
// sidebar (src/components/sidebar/SidebarExtensions.tsx). These tests hold what the row is, in both layouts' markup, and what it must not do.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= { acira: { platform: 'darwin' } };
const { SidebarExtensions, keepTarget } = await import('../src/components/sidebar/SidebarExtensions');
const root = path.join(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('the row exists, is a labelled group, and is hidden (no padding, no empty box) while there is nothing pinned to show', () => {
  const html = renderToStaticMarkup(createElement(SidebarExtensions, { tab: null }));
  assert.match(html, /<div class="sb-ext-row" role="group" aria-label="[^"]+" hidden="">/);
  assert.doesNotMatch(html, /<button/);
});

test('the sidebar draws the row first in its content, above the workspace title and the tab list, and not while it is being customized', () => {
  const source = read('src/components/sidebar/AciraSidebar.tsx');
  assert.match(source, /import \{ SidebarExtensions \} from '\.\/SidebarExtensions';/);
  assert.match(source, /<div className="sb-sections-wrap">\{!customizing&&<SidebarExtensions tab=\{current\}\/>\}\{!customizing&&<WorkspaceTitle state=\{state\}(?: count=\{[^}]+\})?\/>\}/);
});

test('it is the toolbar\'s own list: the same hook (the profile\'s pinned ids in the toolbar\'s order, private windows through their own session), 12 buttons at most, and the toolbar keeps its copy', () => {
  const row = read('src/components/sidebar/SidebarExtensions.tsx');
  assert.match(row, /useExtensionToolbar\(tab\)/);
  assert.match(row, /<BrowserExtensionActions target=\{target\} limit=\{12\} handlesPopupEvents=\{false\}\/>/);
  const toolbar = read('src/App.tsx');
  assert.match(toolbar, /<BrowserExtensionActions target=\{extensionTarget\}\/>/, 'the toolbar still draws its pinned buttons');
  const hook = read('src/ui/useExtensionToolbar.ts');
  assert.match(hook, /extensions\.toolbar-target/);
  const buttons = read('src/components/BrowserExtensionActions.tsx');
  assert.match(buttons, /rank=new Map\(target\.pinnedIds\.map\(/, 'one rule for the order, in the one component both use');
});

test('only the toolbar\'s copy answers action.openPopup() and an extension\'s shortcut, so one request opens one popup (a second copy would press its button too and close the popup again)', () => {
  const buttons = read('src/components/BrowserExtensionActions.tsx');
  assert.match(buttons, /handlesPopupEvents=true/, 'the toolbar\'s default');
  assert.match(buttons, /if\(limit>12\|\|!handlesPopupEvents\|\|!target\?\.supported\|\|!target\.partition\)return;/);
  assert.match(buttons, /\[target\?\.partition,target\?\.webContentsId,target\?\.supported,limit,handlesPopupEvents\]/);
});

test('the row\'s styles use no physical left or right (the sidebar on the right and right-to-left languages lay it out as the left one), wrap instead of scrolling, and hide with the row', () => {
  const css = read('src/components/sidebar/sidebar.css');
  const rules = css.split('\n').filter(line => line.includes('.sb-ext-row'));
  assert.ok(rules.length >= 4, 'the row has its rules');
  for (const rule of rules) assert.doesNotMatch(rule, /(^|[^-a-z])(left|right)\s*:|margin-(left|right)|padding-(left|right)|text-align:\s*(left|right)/, rule);
  assert.ok(rules.some(rule => /\[hidden\]\{display:none\}/.test(rule)));
  assert.ok(rules.some(rule => /flex-wrap:wrap/.test(rule)));
  assert.doesNotMatch(read('src/styles/sidebar-right.css'), /sb-ext-row/, 'nothing to mirror: the row sits like every other row of the sidebar');
});

const target = (profileId: string | null, ids: string[]) => ({ supported: true, profileId, partition: 'persist:p', webContentsId: 3, pinnedIds: ids, actionIds: ids });

test('while the toolbar\'s hook asks again (it answers null at every tab switch and address change) the row keeps the last answer of the same profile, so the tab list below never jumps by the row\'s height', () => {
  const tab = { browserProfileId: 'home', error: null };
  const had = target('home', ['a', 'b']);
  assert.equal(keepTarget(had, null, tab), had, 'the same profile: kept while asking');
  assert.equal(keepTarget(had, target('home', ['c']), tab)?.pinnedIds[0], 'c', 'a new answer replaces it');
  assert.equal(keepTarget(had, { ...had, supported: false, pinnedIds: [] }, tab)?.supported, false, 'an answer that says nothing is pinned is honoured at once');
  assert.equal(keepTarget(had, null, { browserProfileId: 'work', error: null }), null, 'another profile never shows this one\'s pins, not even for a moment');
  assert.equal(keepTarget(had, null, { browserProfileId: 'home', error: 'ERR_NAME_NOT_RESOLVED' }), null, 'an error page has no extension buttons (the toolbar\'s rule)');
  assert.equal(keepTarget(had, null, null), null, 'no tab');
  assert.equal(keepTarget(null, null, tab), null, 'nothing to keep yet');
});
