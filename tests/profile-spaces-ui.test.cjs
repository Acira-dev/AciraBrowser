'use strict';
// Profiles as spaces in the interface (plan-profile-spaces v3 §2): with "Switch between: Profiles as spaces" the switcher shows the
// profiles and the workspace controls step aside; with workspaces (the default) every surface is as before. These pin the gates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the switcher row: profiles by avatar and name, "+" adds a profile, no workspace menu', () => {
  const switcher = src('src/features/workspaces/WorkspaceSwitcher.tsx');
  assert.match(switcher, /export const nameIn = \(state: BrowserSnapshot, workspace: Workspace\): string => spaceProfile\(state, workspace\)\?\.name \?\? shownName\(workspace\);/);
  assert.match(switcher, /return profile \? <ProfileAvatar name=\{profile\.name\} color=\{profile\.color\} avatar=\{profile\.avatar\} picture=\{profile\.picture\} size=\{16\} \/> : <WorkspaceGlyph icon=\{workspaceIcon\(workspace\)\} \/>;/);
  assert.match(switcher, /onClick=\{\(\) => openSettings\(state, dispatch, \{ section: 'Profiles', intent: 'add-profile' \}\)\}/, '"+" opens the add-profile form');
  assert.match(switcher, /if \(!spaces\) openWorkspacePopup\(state, 'workspace-context', event, \{ mode: 'context', workspaceId: workspace\.id \}\);/, 'no workspace menu on a space');
  assert.match(switcher, /if \(list\.length < 2 \|\| !open \|\| profilesAsSpaces\(state\)\) return null;/, 'no title line: the footer names the profile');
});

test('workspace-only controls step aside while profiles are spaces', () => {
  assert.match(src('src/features/accounts/ProfileSwitcher.tsx'), /const workspaces = privateHere \|\| profilesAsSpaces\(state\) \? \[\] : windowWorkspaces\(state\);/, 'the profile panel lists no workspaces');
  assert.match(src('src/components/TabGroupControls.tsx'), /own\.length>0&&!tab\.privacy&&!profilesAsSpaces\(state\)&&item\(t\('workspaces\.moveTo'\)/, 'no Move to workspace');
  assert.match(src('src/components/CommandPalette.tsx'), /own\.length < MAX_WORKSPACES && !profilesAsSpaces\(state\) \? \[\{ id: 'workspace:new'/, 'no New workspace command');
  assert.match(src('src/App.tsx'), /kind === 'workspace-edit' && \(profilesAsSpaces\(state\) \? <NewSpace /, 'New workspace… opens Add profile');
  const menu = src('src/features/workspaces/WorkspaceMenu.tsx');
  assert.match(menu, /\{!spaces && !locked && <>/);
  assert.match(menu, /\{spaces \|\| locked \? null : confirming && subject/);
});

test('the tab layout stays what it is when another profile comes on screen in the same window', () => {
  const sidebar = src('src/components/sidebar/AciraSidebar.tsx');
  // The profile's own "sidebar tabs" switch follows the native setting; it never rewrites it (before, switching to a profile whose switch
  // was off turned every window's tabs to the strip).
  assert.match(sidebar, /if\(profileId!==seen\.profileId\)\{seenLayout\.current=\{native:vertical,profile:vertical,profileId\};if\(prefs\.tabs!==vertical\)setRailPrefs\(\{tabs:vertical\},profileId,privateMode\);return;\}/);
});

test('Settings › Profiles offers the choice with two or more profiles, and always while profiles are spaces', () => {
  const manager = src('src/features/accounts/ProfileManager.tsx');
  assert.match(manager, /if \(count < 2 && value === "workspaces"\) return null;/);
  assert.match(manager, /onChange=\{\(next\) => dispatch\(\{ type: "settings\.update", patch: \{ spaces: next \} \}\)\}/);
  const en = JSON.parse(src('src/i18n/en.json'));
  for (const id of ['profiles.switchBetween', 'profiles.switchWorkspaces', 'profiles.switchWorkspacesDetail', 'profiles.switchSpaces', 'profiles.switchSpacesDetail', 'profiles.switchSecured']) assert.ok(en[id], id);
  assert.ok(en['profiles.switchSpacesDetail'].includes('{key}'));
});

test('Settings › Profiles: with profiles as spaces another profile says Switch and switches here; otherwise Open, in its own window', () => {
  const manager = src('src/features/accounts/ProfileManager.tsx');
  assert.match(manager, /spaces \? \(\s*<button type="button" className="st-button" onClick=\{\(\) => dispatch\(\{ type: "browser\.profile\.select", id: profile\.id, here: true \}\)\}>\s*\{t\("profiles\.switch"\)\}/);
  assert.match(manager, /<button type="button" className="st-button" onClick=\{\(\) => selectProfile\(dispatch, profile\.id\)\}>\s*\{t\("profiles\.open"\)\}/, 'Open stays as it is with workspaces');
  assert.match(manager, /spaces=\{state\.settings\.spaces === "profiles"\}/);
});

test('profiles as spaces: a profile added in Settings opens its space in this window, after its colour is applied', () => {
  // QA #11: adding "Dana" left the space on screen where it was.
  const manager = src('src/features/accounts/ProfileManager.tsx');
  assert.match(manager, /if \(created\.color\.toLowerCase\(\) !== wait\.color\.toLowerCase\(\)\) setProfileColor\(dispatch, created\.id, wait\.color\);\s*\/\/[^\n]*\n\s*if \(spaces\) dispatch\(\{ type: "browser\.profile\.select", id: created\.id, here: true \}\);/);
  assert.match(manager, /<CreateProfile profiles=\{profiles\} dispatch=\{dispatch\} intentKey=\{tab \? settingsViewKey\(tab\) : ""\} spaces=\{state\.settings\.spaces === "profiles"\} \/>/);
});

test('profiles as spaces: another profile on screen takes the last space\'s toasts with it, before the newest toast is added (QA #8)', () => {
  const app = src('src/App.tsx');
  assert.match(app, /const toastSpace = profilesAsSpaces\(state\) \? state\.activeBrowserProfileId : '';\s*const toastState = useToasts\(state\.toast, state\.closedTabs, toastSpace\)/, 'with workspaces no row has a profile: nothing changes');
  assert.match(app, /useEffect\(\(\) => setToastAnnouncement\(''\), \[toastSpace\]\);/, 'nor does the screen-reader line keep the last space\'s toast (QA final pass)');
  const drop = app.indexOf('useEffect(() => { const gone = otherSpaceToasts(current.current, space); if (!gone.length) return; dismiss(...gone); current.current = current.current.filter(row => !gone.includes(row.key)); }, [space]);');
  assert.ok(drop > 0, 'the drop');
  assert.ok(drop < app.indexOf('const next = pushToast(current.current, toast, space);'), 'runs before the push, so a toast that came with the switch stays');
});

test('profiles as spaces, the founder\'s words (3 Nov): the chip, the HUD, the new tab heading and the cycle commands name spaces; workspaces keep theirs', () => {
  const switcher = src('src/features/workspaces/WorkspaceSwitcher.tsx');
  assert.match(switcher, /aria-label=\{t\(spaces \? 'workspaces\.spaceChip' : 'workspaces\.chip', \{ name \}\)\} title=\{withCycle\(t\(spaces \? 'workspaces\.spaceChipTip' : 'workspaces\.chipTip', \{ name \}\), spaces\)\}/);
  assert.match(switcher, /\$\{commandLabel\(id, english, spaces\)\} · \$\{key\}/, 'the tooltip\'s Next / Previous lines');
  assert.match(src('src/features/workspaces/WorkspaceHud.tsx'), /t\(profilesAsSpaces\(state\) \? 'workspaces\.spaceHud' : 'workspaces\.hud', \{ name: nameIn\(state, open\), count: state\.tabs\.length \}\)/);
  assert.match(src('src/features/newtab/NewTabPage.tsx'), /<h1><bdi>\{profilesAsSpaces\(state\) && profile \? profile\.name : workspace \? workspaceName\(workspace, t\('workspaces\.main'\)\) : t\('workspaces\.main'\)\}<\/bdi><\/h1>/, 'the profile\'s name, not "Main"');
  const label = src('src/ui/shortcutKeys.ts');
  assert.match(label, /if \(workspace\) return t\(spaces \? 'workspaces\.goToSpace' : 'shortcutCmd\.switch-workspace', \{ n: workspace\[1\] \}\);/);
  assert.match(label, /if \(spaces && \(id === 'next-workspace' \|\| id === 'prev-workspace'\)\) return t\(id === 'next-workspace' \? 'workspaces\.nextSpace' : 'workspaces\.prevSpace'\);/);
  assert.match(src('src/features/workspaces/WorkspaceMenu.tsx'), /label = commandLabel\(id, english, spaces\);/, 'the chip\'s menu');
  assert.match(src('src/components/CommandPalette.tsx'), /label: commandLabel\(entry\.id, entry\.label, profilesAsSpaces\(state\)\)/, 'the command bar');
  const shortcuts = src('src/features/settings/panels/shortcuts.tsx');
  assert.match(shortcuts, /function Shortcuts\(\{ state: browser \}: SettingsPanelProps\) \{\s*const spaces = profilesAsSpaces\(browser\);/, 'Settings › Shortcuts');
  assert.match(shortcuts, /label: commandLabel\(command\.id, command\.label, spaces\) \}\)\)\), \(failure\) => setError\(readable\(failure\)\)\);\s*\}, \[spaces\]\);/);
  // A toast's action label can carry parameters ("Open in {name}"); they never reach the toast layer over a website, whose rows main
  // checks key by key (it refused the whole layer, and the toast never showed over a page).
  const app = src('src/App.tsx');
  assert.match(app, /const shownAction = \(\{ labelParams, \.\.\.action \}: ToastActionData, translate: ReturnType<typeof useT>\): ToastActionData => \(\{ \.\.\.action, label: translate\(action\.labelId as MessageId, labelParams\) \}\);/);
  assert.match(app, /\.\.\.\(rawToast\.action\?\.labelId \? \{ action: shownAction\(rawToast\.action, translate\) \} : \{\}\)/);
  assert.match(src('desktop/validation.cjs'), /object\(row\.action,\['label','labelId','command','settings'\],'Toast action',\['label','command'\]\)/, 'the rows main hosts');
});

test('profiles as spaces: a space switch is spoken, and shown when nothing on screen names the space (QA final pass)', () => {
  // The switch note returned early whenever the profile on screen changed, and with profiles as spaces every switch changes it: Focus
  // view showed no "Client, 4 tabs" and screen readers heard nothing.
  assert.match(src('src/features/workspaces/WorkspaceHud.tsx'), /last\.current = now;\s*if \(!switchSpoken\(state, before, now\)\) return;/, 'the decision: switchSpoken (profile-spaces.test.ts)');
});
