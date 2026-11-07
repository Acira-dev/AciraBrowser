import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../src/i18n/locales';
import { raiseSettingsIntent, settingsIntentSection, settingsView, takeSettingsIntent } from '../src/ui/settingsView';

// Founder (29 Oct): the profile menu gets an "Add profile…" row under the profile list that opens Settings with the
// add-profile form already open and its name field focused, and the Workspaces heading starts on the icon edge.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const catalog = (code: string) => JSON.parse(read(`../src/i18n/${code}.json`)) as Record<string, string>;

test('the profile menu has an Add profile… row under the profile list, before Workspaces, hidden in a private window', () => {
  const source = read('../src/features/accounts/ProfileSwitcher.tsx');
  const row = source.indexOf('data-profile-add');
  assert.ok(row > source.indexOf('profiles.map('), 'the row follows the profile rows');
  assert.ok(row < source.indexOf('workspaces.length > 0'), 'the row comes before the Workspaces section');
  const block = source.slice(source.lastIndexOf('{!privateHere', row), source.indexOf('</button>', row));
  assert.match(block, /^\{!privateHere/, 'private windows do not show it');
  assert.match(block, /className="acira-menu-row"/);
  assert.match(block, /<Plus className="acira-menu-icon" size=\{16\} \/>/, 'the same plus glyph as New workspace…');
  assert.match(block, /t\("profiles\.add"\)/);
  assert.match(block, /openSettings\(state, dispatch, \{ section: "Profiles", intent: "add-profile" \}\)/);
});

test('profiles.add exists in all 13 catalogs, ends with the ellipsis like Manage profiles…, and is not left in English', () => {
  assert.equal(LOCALES.length, 13);
  const en = catalog('en');
  assert.equal(en['profiles.add'], 'Add profile…');
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    assert.ok(messages['profiles.add'], `${code} has profiles.add`);
    assert.ok(messages['profiles.add'].endsWith('…'), `${code}: ${messages['profiles.add']} ends with …`);
    if (code !== 'en') assert.notEqual(messages['profiles.add'], en['profiles.add'], `${code} is translated`);
  }
});

test('the add-profile intent is taken once by the form, in the Profiles section, and opens it with the name field focused', () => {
  assert.equal(settingsIntentSection['add-profile'], 'Profiles');
  const key = 'profile-0/tab-intent';
  assert.equal(takeSettingsIntent(key, 'add-profile'), false, 'nothing raised, nothing taken');
  let woken = 0;
  raiseSettingsIntent(key, 'add-profile');
  assert.equal(settingsView(key).intent, 'add-profile');
  assert.equal(takeSettingsIntent(key, 'add-profile'), true, 'taken once');
  assert.equal(takeSettingsIntent(key, 'add-profile'), false, 'and only once');
  void woken;

  const manager = read('../src/features/accounts/ProfileManager.tsx');
  assert.match(manager, /takeSettingsIntent\(intentKey, "add-profile"\)/);
  assert.match(manager, /setOpen\(true\);\s*setAsked\(/, 'the form opens in place');
  assert.match(manager, /if \(open\) requestAnimationFrame\(\(\) => input\.current\?\.focus\(\)\);\s*\}, \[open, asked\]\);/, 'and the name field takes focus every time it is asked');
  const settings = read('../src/features/BrowserSettings.tsx');
  assert.match(settings, /if \(target\.intent\) \{[^}]*setSection\(settingsIntentSection\[target\.intent\]\);\s*raiseSettingsIntent\(settingsViewKey\(tab\), target\.intent\);/);
});

test('an intent raised on a Settings tab only reaches that tab', () => {
  raiseSettingsIntent('profile-0/tab-a', 'add-profile');
  assert.equal(takeSettingsIntent('profile-0/tab-b', 'add-profile'), false);
  assert.equal(takeSettingsIntent('profile-0/tab-a', 'add-profile'), true);
});

test('popups: the profile menu estimate holds the Add profile… row outside a private window only', async () => {
  const popup = read('../src/ui/popup.ts');
  assert.match(popup, /\*44\+\(own&&!own\.private\?30:0\)\+\(between\?79:0\)\+\(n\?/, 'Open profiles (79: a divider and its 70px block) joins the rows once there are two profiles');
});

test('the Workspaces heading and its sentence start on the rows\' icon edge, not the text column', () => {
  const css = read('../src/styles/workspaces.css');
  const head = css.match(/\.ws-menu-head \{[^}]*\}/)?.[0] ?? '';
  assert.match(head, /padding: 6px 8px;/);
  assert.doesNotMatch(head, /32px/);
});
