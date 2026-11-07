import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../src/i18n/locales';

// Profiles and workspaces, made obvious (6 Nov): no question when a profile is added. One segmented control, "Open profiles: In this window ·
// In separate windows", is the existing "Switch between" setting (`settings.spaces`), in the profile menu, at the top of Settings › Profiles and in
// the add-profile form while there is one profile. New workspace… also sits in the sidebar's right-click menu, on a workspace icon's menu and in
// the tab strip's + menu. These tests render the real components and pin the wiring that a render cannot show.
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const catalog = (code: string) => JSON.parse(read(`../src/i18n/${code}.json`)) as Record<string, string>;

// The components import their stylesheets; Node has no CSS loader, so a .css import loads empty here.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
// The workspace popups read their target from localStorage (ui/workspaceTargetStore.ts); this is the one the tests leave a target in.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) },
  window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } },
});
const { OpenProfilesControl, openProfilesAction, openProfilesValue } = await import('../src/features/accounts/profileModel');
const { ProfileSwitcher } = await import('../src/features/accounts/ProfileSwitcher');
const { ProfileManager } = await import('../src/features/accounts/ProfileManager');
const { WorkspaceMenu } = await import('../src/features/workspaces/WorkspaceMenu');
const { setWorkspaceTarget, peekWorkspaceTarget, takeWorkspaceTarget } = await import('../src/ui/workspaceTargetStore');
const { popupNaturalHeight } = await import('../src/ui/popup');
const { createInitialState } = await import('../src/runtime/core');
import type { BrowserSnapshot } from '../src/runtime/types';

const profile = (id: string, name: string, extra: object = {}) => ({ id, name, color: '#888888', partition: `persist:acira-${id}`, ...extra });
/** A window of one profile (or several), with `workspaceCount` workspaces for the first. */
function windowOf(options: { profiles?: number; workspaceCount?: number; spaces?: 'profiles' | 'workspaces'; privateWindow?: boolean } = {}): BrowserSnapshot {
  const { profiles = 1, workspaceCount = 1, spaces, privateWindow = false } = options;
  const state = createInitialState();
  state.browserProfiles = [profile('profile-personal', 'Personal'), ...Array.from({ length: profiles - 1 }, (_, i) => profile(`profile-${i}`, `Other ${i + 1}`))];
  if (privateWindow) state.browserProfiles.push(profile('profile-private', 'Private', { private: true }));
  state.workspaces = [
    ...Array.from({ length: workspaceCount }, (_, i) => ({ id: i ? `workspace-${i}` : 'workspace-default', name: i ? `Space ${i}` : '', browserProfileId: 'profile-personal' })),
    ...state.browserProfiles.slice(1).filter(item => !item.private).map(item => ({ id: `workspace-of-${item.id}`, name: '', browserProfileId: item.id })),
  ];
  state.activeWorkspaceId = 'workspace-default';
  state.activeBrowserProfileId = privateWindow ? 'profile-private' : 'profile-personal';
  if (spaces) state.settings.spaces = spaces;
  return state;
}
const noop = () => undefined;
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);
const checked = (markup: string) => [...markup.matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*>([^<]*)<\/button>/g)].map(m => [m[2], m[1]]);

test('Open profiles shows the setting as In this window / In separate windows, and a setting never chosen is a window for each profile', () => {
  const never = html(createElement(OpenProfilesControl, { state: windowOf(), dispatch: noop }));
  assert.match(never, /role="radiogroup"[^>]*aria-label="Open profiles"/);
  assert.deepEqual(checked(never), [['In this window', 'false'], ['In separate windows', 'true']]);
  const spaces = html(createElement(OpenProfilesControl, { state: windowOf({ spaces: 'profiles' }), dispatch: noop }));
  assert.deepEqual(checked(spaces), [['In this window', 'true'], ['In separate windows', 'false']]);
  const chosen = html(createElement(OpenProfilesControl, { state: windowOf({ spaces: 'workspaces' }), dispatch: noop }));
  assert.deepEqual(checked(chosen), [['In this window', 'false'], ['In separate windows', 'true']]);
});

test('choosing a segment is the existing Switch between update, and the choice already in force does nothing', () => {
  assert.equal(openProfilesValue({}), 'workspaces');
  assert.equal(openProfilesValue({ spaces: 'profiles' }), 'profiles');
  assert.deepEqual(openProfilesAction({}, 'profiles'), { type: 'settings.update', patch: { spaces: 'profiles' } });
  assert.deepEqual(openProfilesAction({ spaces: 'profiles' }, 'workspaces'), { type: 'settings.update', patch: { spaces: 'workspaces' } });
  assert.equal(openProfilesAction({}, 'workspaces'), null, 'a setting never chosen already behaves as separate windows: nothing is written');
  assert.equal(openProfilesAction({ spaces: 'profiles' }, 'profiles'), null);
});

test('the profile menu shows Open profiles with two or more profiles, and while profiles are spaces so it can be undone', () => {
  const menu = (state: BrowserSnapshot) => html(createElement(ProfileSwitcher, { state, profileId: state.activeBrowserProfileId, dispatch: noop, close: noop }));
  assert.doesNotMatch(menu(windowOf({ profiles: 1 })), /Open profiles/, 'one profile: nothing to choose yet (the add form carries the choice)');
  const two = menu(windowOf({ profiles: 2 }));
  assert.match(two, /pf-open/);
  assert.match(two, /Open profiles/);
  assert.deepEqual(checked(two.slice(two.indexOf('pf-open'))).slice(0, 2), [['In this window', 'false'], ['In separate windows', 'true']]);
  assert.ok(two.indexOf('Add profile…') < two.indexOf('Open profiles'), 'it sits under Add profile…');
  assert.ok(two.indexOf('Open profiles') < two.indexOf('Workspaces'), 'and above the Workspaces section');
  const spaces = menu(windowOf({ profiles: 1, spaces: 'profiles' }));
  assert.match(spaces, /Open profiles/);
  assert.deepEqual(checked(spaces.slice(spaces.indexOf('pf-open'))).slice(0, 2), [['In this window', 'true'], ['In separate windows', 'false']]);
  assert.doesNotMatch(html(createElement(ProfileSwitcher, { state: windowOf({ profiles: 3, privateWindow: true }), profileId: 'profile-private', dispatch: noop, close: noop })), /Open profiles/, 'a private window holds only its own profile');
});

test('Settings › Profiles has Open profiles at the top, above Your profiles, with two or more profiles or while they are spaces', () => {
  const page = (state: BrowserSnapshot) => html(createElement(ProfileManager, { state, dispatch: noop }));
  const two = page(windowOf({ profiles: 2 }));
  assert.ok(two.includes('data-setting="profile-spaces"'), 'the row keeps its settings id');
  assert.ok(two.indexOf('Open profiles') > -1 && two.indexOf('Open profiles') < two.indexOf('Your profiles'), 'the row comes before the profile list');
  assert.match(two, /Each profile has its own window, with workspaces inside it\./);
  const spaces = page(windowOf({ profiles: 1, spaces: 'profiles' }));
  assert.match(spaces, /Open profiles/);
  assert.match(spaces, /All profiles in one window\./);
  assert.doesNotMatch(page(windowOf({ profiles: 1 })), /Open profiles/, 'one profile: the row waits for a second (the form carries the choice)');
  assert.doesNotMatch(two, /Switch between/, 'the old name is gone from the page');
});

test('the add-profile form carries the same control while there is one profile, and there is no question window anywhere', () => {
  const manager = read('../src/features/accounts/ProfileManager.tsx');
  const form = manager.slice(manager.indexOf('function CreateProfile'));
  assert.match(form, /profiles\.length === 1 && \(\s*<div className="pm-field pm-open"[^>]*>\s*<span>\{t\("profiles\.openProfiles"\)\}<\/span>\s*<OpenProfilesControl state=\{state\} dispatch=\{dispatch\} \/>/, 'inside the form, only while there is one profile');
  assert.ok(form.indexOf('<Swatches') < form.indexOf('OpenProfilesControl') && form.indexOf('OpenProfilesControl') < form.indexOf('className="pm-actions"'), 'after the colours, before the buttons');
  assert.match(form, /createProfile\(dispatch, name\.trim\(\)\);\s*dismiss\(\);/, 'Create is the same one step as before: no question');
  assert.doesNotMatch(manager, /askOpening|profile-opening|showMessageBox/);
  for (const path of ['../desktop/main.cjs', '../desktop/validation.cjs', '../src/runtime/types.ts', '../src/features/accounts/profileModel.tsx', '../src/features/accounts/ProfileSwitcher.tsx']) {
    assert.doesNotMatch(read(path), /profile-opening|askOpening|askProfileOpening|profiles\.opening/, `${path} has no trace of the question window`);
  }
  assert.throws(() => read('../desktop/profile-opening.cjs'), /ENOENT/, 'the question module is gone');
});

test('the three new strings are in all 13 catalogs, translated, and short enough for two segments in the 296px menu', () => {
  assert.match(read('../src/components/Segmented.css'), /html\[dir='rtl'\] \.acira-seg-thumb \{ left: auto; right: 2px; transform: translateX\(calc\(var\(--seg-index, 0\) \* -100%\)\); \}/, 'right to left: the thumb starts at the right edge (it sat under the wrong segment in Arabic)');
  const ids = ['profiles.openProfiles', 'profiles.inThisWindow', 'profiles.inSeparateWindows'] as const;
  const en = catalog('en');
  assert.deepEqual(ids.map(id => en[id]), ['Open profiles', 'In this window', 'In separate windows']);
  assert.equal(LOCALES.length, 13);
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    for (const id of ids) {
      assert.ok(messages[id], `${code} has ${id}`);
      if (code !== 'en') assert.notEqual(messages[id], en[id], `${code}: ${id} is translated`);
    }
    // Two equal 146px columns in the 296px menu, 12px of padding a side: measured live in all 13 languages (6 Nov), the widest label, English
    // "In separate windows", is 119px of the 122px a column holds. Longer than 21 letters (11 in Japanese, Chinese or Korean) would not fit.
    for (const id of ['profiles.inThisWindow', 'profiles.inSeparateWindows'] as const) {
      const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(messages[id]);
      assert.ok([...messages[id]].length <= (cjk ? 11 : 21), `${code}: "${messages[id]}" is too long for half the menu`);
    }
  }
  assert.match(catalog('ko')['profiles.inSeparateWindows'], /별도 창/, 'Korean says 별도 창 for a profile\'s own window, as its Settings do');
});

test('the target store carries the sidebar menu, once, and forgets it after two minutes', () => {
  store.clear();
  setWorkspaceTarget({ mode: 'sidebar' });
  assert.deepEqual(peekWorkspaceTarget(), { mode: 'sidebar' });
  assert.deepEqual(takeWorkspaceTarget(), { mode: 'sidebar' });
  assert.equal(takeWorkspaceTarget(), null, 'read once');
  store.set('acira-workspace-target', JSON.stringify({ mode: 'sidebar', at: Date.now() - 3 * 60_000 }));
  assert.equal(peekWorkspaceTarget(), null, 'a stale target is not used');
  store.set('acira-workspace-target', JSON.stringify({ mode: 'nonsense', at: Date.now() }));
  assert.equal(peekWorkspaceTarget(), null);
});

test('the sidebar menu is New workspace… and Customize sidebar, Add profile… with profiles in one window, and Customize alone with no room or no workspaces', () => {
  const menu = (state: BrowserSnapshot) => { store.clear(); setWorkspaceTarget({ mode: 'sidebar' }); return html(createElement(WorkspaceMenu, { state, dispatch: noop, close: noop, mode: 'context' })); };
  const normal = menu(windowOf({ workspaceCount: 2 }));
  assert.ok(normal.indexOf('New workspace…') > -1 && normal.indexOf('New workspace…') < normal.indexOf('Customize sidebar'), 'New workspace… first');
  assert.doesNotMatch(normal, /Rename…|Delete workspace|Lock this workspace/, 'it is about no workspace in particular');
  const spaces = menu(windowOf({ profiles: 2, spaces: 'profiles' }));
  assert.match(spaces, /Add profile…/);
  assert.doesNotMatch(spaces, /New workspace…/);
  const full = menu(windowOf({ workspaceCount: 8 }));
  assert.doesNotMatch(full, /New workspace…/, 'at eight workspaces there is no room');
  assert.match(full, /Customize sidebar/);
  const noWorkspaces = menu(windowOf({ privateWindow: true, workspaceCount: 1 }));
  assert.match(noWorkspaces, /Customize sidebar/);
});

test('a workspace icon\'s menu starts with New workspace…, then Rename…, Icon and color… and Delete', () => {
  const menu = (state: BrowserSnapshot, id: string) => { store.clear(); setWorkspaceTarget({ mode: 'context', workspaceId: id }); return html(createElement(WorkspaceMenu, { state, dispatch: noop, close: noop, mode: 'context' })); };
  const state = windowOf({ workspaceCount: 3 });
  const second = menu(state, 'workspace-1');
  const order = ['New workspace…', 'Rename…', 'Icon and color…', 'Delete workspace'].map(text => second.indexOf(text));
  assert.ok(order.every(at => at > -1) && order.every((at, i) => !i || at > order[i - 1]), `rows in order: ${order}`);
  assert.doesNotMatch(menu(windowOf({ workspaceCount: 8 }), 'workspace-1'), /New workspace…/, 'no room at eight');
  assert.doesNotMatch(menu(windowOf({ profiles: 2, spaces: 'profiles' }), 'workspace-default'), /New workspace…/, 'in one window profiles are the spaces: no workspace to make');
});

test('menu heights hold the new rows: the sidebar menu (81 measured), the workspace icon menu, the tab strip menu and the profile menu', () => {
  const height = (kind: string, state: BrowserSnapshot, target?: object) => { store.clear(); if (target) store.set('acira-workspace-target', JSON.stringify({ ...target, at: Date.now() })); return popupNaturalHeight(kind, state, {}); };
  // measured in the real app on 6 Nov, three profiles and three workspaces (the rig in the shared notes folder)
  const rig = windowOf({ profiles: 3, workspaceCount: 3 });
  assert.equal(height('workspace-context', rig, { mode: 'sidebar' }), 81, 'New workspace…, a divider and Customize sidebar');
  assert.equal(height('workspace-context', windowOf({ workspaceCount: 8 }), { mode: 'sidebar' }), 42, 'Customize sidebar alone');
  assert.equal(height('workspace-context', rig, { mode: 'context', workspaceId: 'workspace-default' }) - height('workspace-context', windowOf({ workspaceCount: 8 }), { mode: 'context', workspaceId: 'workspace-default' }), 39, 'New workspace… and its divider on top, until eight');
  assert.equal(height('profile', rig), 497, 'Open profiles adds a divider and its 70px block (measured 497)');
  assert.equal(height('profile', windowOf({ profiles: 1, workspaceCount: 3 })), 497 - 79 - 2 * 44, 'one profile: no Open profiles block');
  const strip = (state: BrowserSnapshot) => height('strip-context', state);
  assert.equal(strip(windowOf({ workspaceCount: 1 })) - strip(windowOf({ workspaceCount: 8 })), 39, 'New workspace… and its divider, until eight');
});

test('the tab strip\'s + menu ends with New workspace… (Add profile… with profiles in one window), and the sidebar and row open the sidebar menu', () => {
  const app = read('../src/App.tsx');
  const strip = app.slice(app.indexOf("kind === 'strip-context' &&"), app.indexOf("kind === 'strip-context' &&") + 2600);
  assert.match(strip, /tr\("browsermenu\.reopenClosedTab"\)[\s\S]*<hr\/>\{row\(tr\(profilesAsSpaces\(state\) \? 'profiles\.add' : 'workspaces\.new'\), Plus,/, 'after Reopen closed tab, behind a divider');
  assert.match(strip, /windowWorkspaces\(state\)\.length < MAX_WORKSPACES/, 'until eight');
  const sidebar = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /openWorkspacePopup\(state,'workspace-context',event,\{mode:'sidebar'\}\);else setCustomizing\(true\)/, 'empty space opens the menu; a window with no workspaces keeps going straight to Customize');
  const row = read('../src/features/workspaces/WorkspaceSwitcher.tsx');
  assert.match(row, /closest\('\.sb-ws:not\(\.sb-ws-add\)'\)\) return; event\.preventDefault\(\); openWorkspacePopup\(state, 'workspace-context', event, \{ mode: 'sidebar' \}\)/, 'the row\'s empty part and its + open it; an icon keeps its own menu');
  assert.match(app, /event\.action === 'customize-sidebar'[\s\S]{0,120}openSidebarCustomize\(\)/, 'the menu\'s Customize sidebar row reaches the sidebar through the chrome');
});

test('the Customize sidebar request from the menu passes the bridge, and nothing else new does', () => {
  const { validateNativeCommand } = require('../desktop/validation.cjs');
  const state = createInitialState();
  const command = { type: 'ui', tabId: state.activeTabId, action: 'customize-sidebar' };
  assert.deepEqual(validateNativeCommand(command, state), command);
  assert.throws(() => validateNativeCommand({ ...command, action: 'customize-everything' }, state));
  assert.throws(() => validateNativeCommand({ type: 'profile-opening', tabId: state.activeTabId, name: 'Dana' }, state), 'the removed question command is not accepted');
  assert.throws(() => validateNativeCommand({ ...command, kind: 'workspace-context', name: 'x' }, state), 'no stray fields');
});
