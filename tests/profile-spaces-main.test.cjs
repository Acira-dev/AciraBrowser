'use strict';
// Profiles as spaces, groundwork in the main process (plan-profile-spaces v3, leak audit group b): what an extension does acts in the
// extension's own profile, not in the profile on screen. In a window of one profile (every window today) the two are the same profile;
// in a window holding several they are not, so these lines pin the profile that is passed along.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const body = (start, end) => { const at = main.indexOf(start); assert.ok(at >= 0, `${start} is in main.cjs`); return main.slice(at, main.indexOf(end, at) + end.length); };

test('an extension\'s windows are its profile\'s own and any window holding its tabs; each lists that profile\'s tabs', () => {
  const browser = body('function extensionBrowser(profile){', 'tabModel:{');
  assert.match(browser, /const available=\(\)=>\[\.\.\.controllers\]\.filter\(c=>!c\.privateMode&&!c\.closing&&\(c\.profileId===profile\.id\|\|\(c\.state\?\.tabs\|\|\[\]\)\.some\(t=>t\.browserProfileId===profile\.id&&!t\.privacy\)\)\)/);
  const model = body('tabModel:{', 'onChange(listener)');
  assert.match(model, /profileId:profile\.id,/, 'the tabs model lists the extension\'s profile, not the one on screen');
});

test('a tab an extension opens or selects is its own profile\'s', () => {
  const browser = body('function extensionBrowser(profile){', 'tabModel:{');
  assert.match(browser, /return controller\.extensionCreateTab\(\{\.\.\.details,profileId:profile\.id\}\);/);
  assert.match(browser, /controller\.extensionCreateTab\(\{url:target\.url,active:true,profileId:profile\.id\}\)/, 'chrome.search too');
  assert.match(browser, /found\.controller\.extensionSelect\(found\.entry\[0\],profile\.id\)/);
  const create = body('async function extensionCreateTab(details={}){', 'extensionOrigin=');
  assert.match(create, /const ownProfileId=typeof details\.profileId==='string'&&state\.browserProfiles\.some\(p=>p\.id===details\.profileId&&!p\.private\)\?details\.profileId:state\.activeBrowserProfileId;/);
  assert.match(create, /type:'tab\.new',url,background:details\.active===false,browserProfileId:ownProfileId\}/);
  assert.match(create, /const profile=state\.browserProfiles\.find\(p=>p\.id===ownProfileId\)/, 'and its extension pages are checked against its own session');
  const select = body('function extensionSelect(id,profileId=state.activeBrowserProfileId){', "throw new Error('The extension tab is not in this profile.');");
  assert.match(select, /tab\.privacy\|\|tab\.browserProfileId!==profileId/);
});

test('profiles as spaces: picking a profile opens its space in this window; other windows count whatever profile they show', () => {
  const intercept = body("if(action.type==='browser.profile.select'&&action.id!==state.activeBrowserProfileId&&!privateMode){", 'switchProfileHere(action.id);return state;}');
  assert.match(intercept, /const space=state\.settings\.spaces==='profiles'\?state\.workspaces\.find\(w=>w\.browserProfileId===action\.id\):null;if\(space\)return dispatch\(\{type:'workspace\.select',id:space\.id\}\);switchProfileHere\(action\.id\);/, 'in place; today\'s window swap otherwise');
  const owner = body("if(action.type==='workspace.select'&&!privateMode&&!windowHoldsWorkspace(state,action.id)){", 'owner=');
  assert.match(owner, /\(state\.settings\.spaces==='profiles'\|\|c\.profileId===state\.activeBrowserProfileId\)/);
  const holders = body('function workspaceWindowsFor(){', 'if(mine.length<2)return undefined;');
  assert.match(holders, /\(state\.settings\.spaces==='profiles'\|\|c\.profileId===state\.activeBrowserProfileId\)/);
});

test('profiles as spaces: a window closed on purpose is forgotten, as with one profile; with workspaces, today\'s per-profile memory', () => {
  assert.match(main, /if\(!quitting&&!openWindows\.quitting\(\)\)\{if\(state\.settings\.spaces==='profiles'\)profileWindows\.forget\(windowId\);else profileWindows\.closed\(controller\);\}/);
});

test('profiles as spaces: changing "Switch between" asks once when pages would lose something, then the windows follow', () => {
  assert.match(main, /if\(action\.type==='settings\.update'&&action\.patch&&Object\.hasOwn\(action\.patch,'spaces'\)&&!privateMode&&!webApp&&\(action\.patch\.spaces==='profiles'\)!==\(state\.settings\.spaces==='profiles'\)\)\{/);
  assert.match(main, /void confirmSpacesChange\(controller,next\)\.then\(ok=>\{if\(!ok\|\|windowClosing\)return;[^]*?database\.transaction\(\(\)=>\{commitAction\(action\);settleProfileWindows\(controller\);/, 'Cancel keeps the old choice');
  assert.match(main, /const confirmSpacesChange=\(from,next\)=>confirmMoves\(from,spacesMoves\(from,next\),/);
  const ask = body('async function confirmMoves(from,moves,button){', 'return answer?.response===1;');
  assert.match(ask, /marked\.has\(tab\.id\)\|\|tab\.audible\|\|tab\.capturing\?\.length/, 'unsaved changes, sound, a call or a shared screen');
});

test('profiles as spaces: turning it on brings hidden and saved profile windows in; turning it off gives each profile its own window back', () => {
  const settle = body('function settleProfileWindows(from){', "\n}\n");
  assert.match(settle, /if\(c!==from&&c\.switchedAway\)\{const parts=c\.peekProfiles\(profilesIn\(c\.state\)\);from\.adoptParts\(parts\);c\.takeProfiles\(parts\.map\(part=>part\.profileId\)\);c\.closeEmpty\(\);\}/, 'written where it goes before it leaves');
  assert.match(settle, /for\(const id of Object\.values\(profileWindows\.read\(\)\)\)/, 'saved profile windows too');
  assert.match(settle, /for\(const part of c\.peekProfiles\(others\)\)\{[^}]*if\(open\)open\.adoptParts\(\[part\]\);else writeProfileWindow\(from,part\);\}\s*c\.takeProfiles\(others\);/);
  const write = body('function writeProfileWindow(from,part){', 'profileWindows.remember(part.profileId,id);');
  assert.match(write, /for\(const key of sharedFields\)record\[key\]=/, 'saving a window writes the shared records, so they are today\'s, never a stale copy');
});

test('profiles as spaces: what an import adds settles at once (Arc Spaces show as groups), with workspaces nothing changes', () => {
  assert.match(main, /commit:next=>\{(?:\/\*[^*]*\*\/)?if\(next\.settings\?\.spaces==='profiles'\)normalizeWorkspaces\(next\);state=next;save\(\);publishShared\(\);broadcast\(\);\}/);
});

test('a download from a page\'s own pop-up window goes to the profile whose session the pop-up shares', () => {
  const owner = body('getOwner:wc=>{for(const c of controllers){', 'return null;}});');
  assert.match(owner, /const own=c\.state\.browserProfiles\.find\(p=>!p\.private&&require\('electron'\)\.session\.fromPartition\(p\.partition\)===wc\.session\)\?\.id,profileId=own\|\|c\.profileId/);
  assert.match(owner, /\.\.\.\(shown\?\.browserProfileId===profileId\?\{tabId:c\.state\.activeTabId\}:\{\}\)/, 'the tab on screen only when it is that profile\'s');
});

test('leak audit, group a: the pages the person is looking at ask for the profile on screen at each call', () => {
  // With profiles as spaces the profile on screen changes inside one window (it follows the tab on screen, core.ts syncProfiles), so
  // these services must read it live, never a profile captured when the window opened (createBrowserWindow's profileId).
  const service = main.slice(main.indexOf("bridge.handle('acira:service'"));
  for (const name of ['cleanup.set', 'site.permission-reset', 'https.status', 'https.set', 'website-language.status', 'website-language.set', 'proxy.route', 'data.status', 'protection.status', 'filters.profile-set', 'downloads.list', 'downloads.command', 'favicons.list']) {
    const at = service.indexOf(`case '${name}'`);
    assert.ok(at >= 0, `${name} is a service`);
    const next = service.slice(at + 10).search(/\}\s*case '/), handler = service.slice(at, next < 0 ? at + 1200 : at + 10 + next);
    assert.ok(handler.includes('state.activeBrowserProfileId'), `${name} reads the profile on screen`);
  }
  assert.match(main, /bridge\.handle\('acira:passwords',[\s\S]{0,300}profileId:state\.activeBrowserProfileId/, 'the passwords page too');
});

test('profiles as spaces: a window on screen when it is turned on stays, and one toast offers to bring it here', () => {
  const settle = body('function settleProfileWindows(from){', "\n}\n");
  assert.match(settle, /const shown=shownWindows\(from\)\.length;\n\s*if\(shown\)from\.dispatchAction\(\{type:'toast',text:tm\('profiles\.spacesOtherWindows',\{count:shown\}\),i18n:\{id:'profiles\.spacesOtherWindows',params:\{count:shown\}\},tone:'info',action:\{label:tm\('profiles\.bringHere'\),labelId:'profiles\.bringHere',command:\{type:'spaces\.bring'\}\}\}\);/);
  assert.match(main, /actionNames\.add\('spaces\.bring'\)/, 'the toast\'s button may send it');
  assert.match(main, /if\(action\.type==='spaces\.bring'\)\{[^}]*if\(!privateMode&&!webApp&&state\.settings\.spaces==='profiles'\)void bringWindowsHere\(controller\)/, 'only while profiles are spaces');
  const bring = body('async function bringWindowsHere(from){', 'from.show();');
  assert.match(bring, /confirmMoves\(from,others\.map\(c=>\(\{controller:c,ids:c\.state\.tabs\.map\(t=>t\.id\)\}\)\),tm\('profiles\.bringHere'\)\)/, 'the same question first');
  assert.match(bring, /const parts=c\.peekProfiles\(profilesIn\(c\.state\)\);from\.adoptParts\(parts\);c\.takeProfiles\(parts\.map\(part=>part\.profileId\)\);c\.closeEmpty\(\);/, 'written here before it leaves there');
  const { validateAction } = require('../desktop/validation.cjs');
  const runtime = require('../desktop/runtime.cjs');
  assert.deepEqual(validateAction({ type: 'spaces.bring' }, runtime.createInitialState()), { type: 'spaces.bring' });
  assert.throws(() => validateAction({ type: 'spaces.bring', id: 'x' }, runtime.createInitialState()));
});

test('profiles as spaces: the choice, the window moves and every window\'s record change in one transaction', () => {
  // QA batch 1, #1: the moves were saved at once but the choice reached other windows' records only through their debounced saves, so
  // a crash in between came back in the old mode with the windows in the new layout.
  assert.match(main, /database\.transaction\(\(\)=>\{commitAction\(action\);settleProfileWindows\(controller\);for\(const c of ordinaryWindows\(\)\)c\.save\(\);\}\);/);
});

test('profiles as spaces: a restored window is settled to the choice at start, both ways', () => {
  assert.match(main, /\}else if\(sharedState\)\{applyShared\(sharedState\);\}if\(restoredWindow&&!privateMode&&!webApp\)settleRestoredSpaces\(\);/, 'after the shared choice is known, before the window shows');
  const settle = body('function settleRestoredSpaces(){', "\n}\n");
  assert.match(settle, /if\(saved\)\{const record=restoreSnapshot\(saved\);for\(const profile of profilesIn\(record\)\)addPart\(state,takePart\(record,profile\)\);\}profileWindows\.forget\(id\);try\{database\.deleteWindow\(id\);\}catch\{\}/, 'profiles as spaces: saved profile windows come in');
  assert.match(settle, /for\(const profile of profilesIn\(state\)\.filter\(id=>id!==keep\)\)writeProfileWindow\(\{state\},takePart\(state,profile\)\);/, 'workspaces: another profile\'s tabs go to its saved window, never dropped');
});

test('profiles as spaces: a joined window\'s record is deleted, not left behind with its copy of history', () => {
  assert.match(main, /from\.adoptParts\(profilesIn\(record\)\.map\(profile=>takePart\(record,profile\)\)\);\}profileWindows\.forget\(id\);try\{database\.deleteWindow\(id\);\}catch\{\}/);
  assert.match(main, /function closeEmpty\(\)\{if\(!mainWindow\|\|mainWindow\.isDestroyed\(\)\)return;closeGate\.passed=true;discardRecord=true;mainWindow\.close\(\);\}/);
  assert.match(main, /mainWindow\.on\('closed',\(\)=>\{pageDissolve\.destroy\(\);if\(discardRecord\)try\{database\.deleteWindow\(windowId\);\}catch\{\}/);
  const { BrowserDatabase } = require('../desktop/database.cjs');
  const runtime = require('../desktop/runtime.cjs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'acira-spaces-db-')), db = new BrowserDatabase(path.join(dir, 'browser.sqlite'));
  try {
    db.saveWindow('window-joined', runtime.createInitialState());
    assert.ok(db.readWindow('window-joined'));
    db.deleteWindow('window-joined');
    assert.equal(db.readWindow('window-joined'), null);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('profiles as spaces: a background profile\'s download and blocked pop-up never toast in another profile\'s space', () => {
  // QA batch 1, #3 and #5: "Downloading … · Show", "… downloaded · Open" and "Pop-up blocked · Open" from Personal's page showed in Work's space.
  assert.match(main, /const spaceToast=\(c,profileId\)=>\(\.\.\.args\)=>\{if\(!profileId\|\|c\.state\?\.activeBrowserProfileId===profileId\)return c\.toast\(\.\.\.args\);\};/);
  const owner = body('getOwner:wc=>{for(const c of controllers){', 'return null;}});');
  assert.match(owner, /record:c\.record\}?,?\S*toast:spaceToast\(c,held\.tabProfileId\)\};\}|toast:spaceToast\(c,held\.tabProfileId\)/, 'a page\'s download: its tab\'s profile');
  assert.match(owner, /toast:spaceToast\(c,profileId\)\};\}/, 'a pop-up window\'s download: the pop-up\'s profile');
  assert.match(main, /onBlocked:\(wc,details\)=>\{[^]*?if\(found\[1\]\.tabProfileId&&found\[1\]\.tabProfileId!==c\.state\.activeBrowserProfileId\)return;const open=blockedPopupOpen/, 'a blocked pop-up of a background profile is blocked quietly');
});

test('profiles as spaces: a secured workspace still open is sealed and locked before the choice changes', () => {
  // QA batch 2: the lock was sent after the choice had changed, and its follow-up (workspace.secured-lock) was dropped, so Bank stayed
  // unlocked with its page on screen. Now lockAll seals and locks it synchronously first; if it can't be sealed, nothing changes.
  assert.match(main, /if\(!ok\|\|windowClosing\)return;(?:\/\*[^*]*\*\/)?if\(next==='profiles'&&state\.workspaces\?\.some\(w=>w\.secured&&w\.unlocked\)&&!secured\(\)\.lockAll\('manual'\)\)return;(?:\/\*[^*]*\*\/)?const before=state;database\.transaction\(/);
  assert.doesNotMatch(main, /c\.dispatchAction\(\{type:'workspace\.lock',id:workspace\.id\}\)/, 'no lock after the change any more');
});

test('profiles as spaces: light or dark follows the profile on screen when the space changes', () => {
  // QA #6: the app-wide appearance (and websites' prefers-color-scheme) changed only on focus, so Work's Dark waited for a focus event.
  const commit = body('function commitAction(action){', 'secured().afterAction');
  assert.match(commit, /if\(state===previous\)return state;(?:\/\*[^*]*\*\/)?if\(previous\.activeBrowserProfileId!==state\.activeBrowserProfileId&&mainWindow\)updateNativeAppearance\(\);/);
});

test('profiles as spaces: "open in own window" moves the space\'s tabs to the new window, written there before they leave', () => {
  // QA #12: the new window had one empty New tab while the space's tabs stayed in the first.
  assert.match(main, /if\(existing\)existing\.show\(\);else if\(state\.settings\.spaces==='profiles'&&!webApp\)\{(?:\/\*[^*]*\*\/)?void openSpaceInOwnWindow\(action\.id\)/);
  const open = body('async function openSpaceInOwnWindow(profileId){', 'target.show();');
  assert.match(open, /const parts=peekProfiles\(\[profileId\]\);\s*const target=createBrowserWindow\(\{profileId\}\);/);
  assert.match(open, /if\(parts\.length\)\{target\.adoptParts\(parts,true\);takeProfiles\(\[profileId\]\);\}/);
  const adopt = body('function adoptParts(parts,replaceBlank=false){', 'commitState(next);}');
  assert.match(adopt, /const blank=replaceBlank&&next\.tabs\.length===1&&next\.tabs\[0\]\.url==='acira:\/\/new'/, 'the new window\'s untouched New tab gives way');
});

test('profiles as spaces, the founder\'s words (3 Nov): the question says "Switch anyway", and one toast says what changed', () => {
  assert.match(main, /const confirmSpacesChange=\(from,next\)=>confirmMoves\(from,spacesMoves\(from,next\),tm\('profiles\.switchAnyway'\)\);/, 'both ways');
  // After the durable step: "Profiles are spaces now…" or "Workspaces are back…", from the state before it; with a window of another
  // profile still on screen, its "Bring here" toast is the one toast.
  assert.match(main, /const before=state;database\.transaction\(\(\)=>\{commitAction\(action\);settleProfileWindows\(controller\);for\(const c of ordinaryWindows\(\)\)c\.save\(\);\}\);(?:\/\*[^*]*\*\/)?if\(next!=='profiles'\|\|!shownWindows\(controller\)\.length\)\{const said=spacesChangedToast\(before,next\);dispatch\(\{type:'toast',text:tm\(said\.id,said\.params\),i18n:said,tone:'info'\}\);\}/);
  assert.match(main, /const \{addPart,profilesIn,spacesChangedToast,takePart\}=require\('\.\/runtime\.cjs'\);/);
});
