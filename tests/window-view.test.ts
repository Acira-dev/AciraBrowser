import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { effectiveView, migrateAutoHide, seamlessEdgesOf, toggleView, viewForFocus, windowViewOf, windowViewPatch, windowViews, type WindowView } from '../src/runtime/windowView';
import type { BrowserSnapshot, Settings } from '../src/runtime/types';

// R3-68 / R3-65: one Window view dial (Full, Compact, Focus, Seamless), per-window override, migration of the old settings.
const base = () => createInitialState();
const settingsWith = (patch: Record<string, unknown>) => ({ ...base().settings, ...patch }) as Settings;
const asLegacy = (patch: Record<string, unknown>) => patch as unknown as Partial<Settings>;

test('the default is Full, and the four views are in order of how much chrome is on screen', () => {
  assert.deepEqual([...windowViews], ['full', 'compact', 'focus', 'seamless']);
  assert.equal(windowViewOf(base().settings), 'full');
  assert.equal(effectiveView(base().settings, base().windowUi), 'full');
  assert.deepEqual(seamlessEdgesOf(base().settings), { top: true, side: true });
});

test('migration: the old Toolbar "automatic" and the older automaticCompact flag are Compact; everything else Full', () => {
  assert.equal(windowViewOf(asLegacy({ toolbarLayout: 'automatic' })), 'compact');
  assert.equal(windowViewOf(asLegacy({ automaticCompact: true })), 'compact');
  assert.equal(windowViewOf(asLegacy({ automaticCompact: true, pinExpanded: true })), 'full');
  assert.equal(windowViewOf(asLegacy({ toolbarLayout: 'expanded' })), 'full');
  assert.equal(windowViewOf(asLegacy({ windowView: 'seamless', toolbarLayout: 'automatic' })), 'seamless', 'the dial wins once it exists');
  assert.equal(windowViewOf(asLegacy({ windowView: 'nonsense' })), 'full');
  assert.equal(windowViewOf(null), 'full');
});

test('migration on restore: a saved session with Compact or Focus keeps both, and the mirror stays in step', () => {
  const saved = persistedSnapshot(base()) as unknown as Record<string, unknown>;
  const old = structuredClone(saved) as { settings: Record<string, unknown>; windowUi: Record<string, unknown> };
  delete old.settings.windowView;
  old.settings.toolbarLayout = 'automatic';
  old.windowUi.focusMode = true;
  const restored = restoreSnapshot(old);
  assert.equal(restored.settings.windowView, 'compact');
  assert.equal(restored.settings.toolbarLayout, 'automatic');
  assert.equal(restored.windowUi.view, 'focus');
  assert.equal(restored.windowUi.focusMode, true);
  assert.equal(effectiveView(restored.settings, restored.windowUi), 'focus');
  const plain = restoreSnapshot({ ...(saved as object), settings: { ...(saved.settings as object), windowView: undefined, toolbarLayout: 'expanded' } });
  assert.equal(plain.settings.windowView, 'full');
});

test('Seamless as the default survives a save and a restart, and so does a window\'s own view', () => {
  let s: BrowserSnapshot = base();
  s = reduceBrowser(s, { type: 'settings.update', patch: { windowView: 'seamless', seamlessEdges: { top: true, side: false } } });
  s = reduceBrowser(s, { type: 'ui.update', patch: { view: 'focus' } });
  const back = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
  assert.equal(back.settings.windowView, 'seamless');
  assert.deepEqual(back.settings.seamlessEdges, { top: true, side: false });
  assert.equal(back.windowUi.view, 'focus');
  assert.equal(back.windowUi.focusMode, true);
  const cleared = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(reduceBrowser(s, { type: 'ui.update', patch: { view: null } })))));
  assert.equal(cleared.windowUi.view, undefined, 'null clears the window\'s own choice');
  assert.equal(cleared.windowUi.focusMode, false);
  assert.equal(effectiveView(cleared.settings, cleared.windowUi), 'seamless');
});

test('toggle: the mode in force goes back to the default (or Full when the default is that mode); another mode replaces it', () => {
  const def = (windowView: WindowView) => settingsWith({ windowView });
  assert.equal(toggleView(def('full'), {}, 'focus'), 'focus', 'Full -> Focus');
  assert.equal(toggleView(def('full'), { view: 'focus' }, 'focus'), null, 'Focus -> the default (Full)');
  assert.equal(toggleView(def('compact'), { view: 'focus' }, 'focus'), null, 'Focus -> the default (Compact)');
  assert.equal(toggleView(def('seamless'), {}, 'seamless'), 'full', 'Seamless is the default: toggling it goes to Full for this window');
  assert.equal(toggleView(def('seamless'), { view: 'full' }, 'seamless'), 'seamless', '... and back');
  assert.equal(toggleView(def('full'), { view: 'focus' }, 'seamless'), 'seamless', 'Seamless replaces Focus, no stacking');
  assert.equal(toggleView(def('full'), { view: 'seamless' }, 'focus'), 'focus', 'Focus replaces Seamless');
  assert.equal(toggleView(def('focus'), {}, 'focus'), 'full', 'Focus is the default: toggling it goes to Full');
});

test('the old Focus switch is the dial\'s Focus: on is Focus, off leaves other views alone', () => {
  const s = settingsWith({ windowView: 'compact' });
  assert.equal(viewForFocus(s, {}, true), 'focus');
  assert.equal(viewForFocus(s, { view: 'focus' }, false), null);
  assert.equal(viewForFocus(settingsWith({ windowView: 'focus' }), {}, false), 'full');
  assert.equal(viewForFocus(s, { view: 'seamless' }, false), 'seamless', 'turning Focus off does not end Seamless');
  assert.equal(viewForFocus(s, {}, false), null);
});

test('window A\'s toggle does not touch window B, and the default is shared', () => {
  const a = reduceBrowser(base(), { type: 'ui.update', patch: { view: 'seamless' } });
  const b = base();
  assert.equal(effectiveView(a.settings, a.windowUi), 'seamless');
  assert.equal(effectiveView(b.settings, b.windowUi), 'full');
  const shared = reduceBrowser(b, { type: 'settings.update', patch: { windowView: 'compact' } });
  assert.equal(effectiveView(shared.settings, shared.windowUi), 'compact');
});

test('reducer: ui.update focusMode (routines, shortcuts, QA scripts) still works and keeps view and flag together', () => {
  let s: BrowserSnapshot = base();
  s = reduceBrowser(s, { type: 'ui.update', patch: { focusMode: true } });
  assert.equal(s.windowUi.focusMode, true);
  assert.equal(s.windowUi.view, 'focus');
  s = reduceBrowser(s, { type: 'ui.update', patch: { focusMode: false } });
  assert.equal(s.windowUi.focusMode, false);
  assert.equal(s.windowUi.view, undefined);
  s = reduceBrowser(s, { type: 'ui.update', patch: { view: 'seamless' } });
  assert.equal(s.windowUi.focusMode, false);
  s = reduceBrowser(s, { type: 'ui.update', patch: { focusMode: false } });
  assert.equal(s.windowUi.view, 'seamless', 'Focus off does not end Seamless');
  s = reduceBrowser(s, { type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } });
  assert.equal(s.windowUi.view, 'seamless', 'an unrelated window patch keeps the view');
});

test('reducer: choosing a default view applies to this window now (its own choice steps aside)', () => {
  let s: BrowserSnapshot = reduceBrowser(base(), { type: 'ui.update', patch: { view: 'focus' } });
  s = reduceBrowser(s, { type: 'settings.update', patch: { windowView: 'full' } });
  assert.equal(s.windowUi.view, undefined, 'even when the default does not change, the card the person picked is what shows');
  assert.equal(s.windowUi.focusMode, false);
  assert.equal(effectiveView(s.settings, s.windowUi), 'full');
  s = reduceBrowser(s, { type: 'ui.update', patch: { view: 'seamless' } });
  s = reduceBrowser(s, { type: 'settings.update', patch: { compactTabTitles: false } });
  assert.equal(s.windowUi.view, 'seamless', 'other settings leave a window\'s view alone');
});

test('legacy writers of the Toolbar setting move Compact on and off and leave Focus and Seamless as they were', () => {
  let s: BrowserSnapshot = reduceBrowser(base(), { type: 'settings.update', patch: { toolbarLayout: 'automatic' } });
  assert.equal(s.settings.windowView, 'compact');
  assert.equal(s.settings.toolbarLayout, 'automatic');
  s = reduceBrowser(s, { type: 'settings.update', patch: { toolbarLayout: 'expanded' } });
  assert.equal(s.settings.windowView, 'full');
  assert.equal(s.settings.toolbarLayout, 'expanded');
  s = reduceBrowser(s, { type: 'settings.update', patch: { windowView: 'seamless' } });
  assert.equal(s.settings.toolbarLayout, 'expanded', 'the mirror says Compact only for Compact');
  s = reduceBrowser(s, { type: 'settings.update', patch: { toolbarLayout: 'expanded' } });
  assert.equal(s.settings.windowView, 'seamless', 'an old "expanded" does not end Seamless');
  const patch = windowViewPatch(settingsWith({}), { showHome: true });
  assert.deepEqual(patch, { showHome: true }, 'patches that name neither pass through');
});

test('Hide until needed becomes Seamless once, with a notice; nothing else does', () => {
  assert.deepEqual(migrateAutoHide(base().settings, false), { patch: null, notify: false });
  assert.deepEqual(migrateAutoHide(base().settings, true), { patch: { windowView: 'seamless' }, notify: true });
  assert.deepEqual(migrateAutoHide(settingsWith({ windowView: 'compact' }), true), { patch: { windowView: 'seamless' }, notify: true });
  assert.deepEqual(migrateAutoHide(settingsWith({ windowView: 'seamless' }), true), { patch: null, notify: false }, 'already Seamless: the flag is only cleared');
});

test('the edge switches default to on and keep what was saved', () => {
  assert.deepEqual(seamlessEdgesOf({ seamlessEdges: { top: false, side: true } }), { top: false, side: true });
  assert.deepEqual(seamlessEdgesOf({ seamlessEdges: { top: true, side: false } }), { top: true, side: false });
  const s = reduceBrowser(base(), { type: 'settings.update', patch: { seamlessEdges: { top: false, side: true } } });
  assert.deepEqual(s.settings.seamlessEdges, { top: false, side: true });
});
