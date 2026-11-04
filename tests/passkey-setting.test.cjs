'use strict';
// "Passkeys and security keys" (28 Oct): the choice is off by default for new and existing profiles, persists, reaches the guard through the
// main process, backs the guard up with a Permissions-Policy header while off, and has a searchable Settings > Privacy row in all 13 languages
// (Windows and Linux; a Mac has no such choice: its guard answers with no setting, so the row did nothing there and is not shown, 4 Nov).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createPrivacyPlus,DEFAULTS}=require('../desktop/browser-services/privacy-plus.cjs');
const {passkeyPolicyPatch,DENY}=require('../desktop/browser-services/passkey-policy.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const directory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-passkeys-'));

test('the choice is off in a new profile and in one saved before the choice existed (nothing to migrate: a missing key reads as off)',()=>{
 assert.equal(DEFAULTS.passkeys,false);
 const fresh=directory();
 assert.equal(createPrivacyPlus({directory:fresh}).get().passkeys,false,'no file: off');
 const legacy=directory();
 const old={cnameUncloaking:true,skipTrackingRedirects:false,stripTrackingParams:true,deAmp:true,fingerprint:'strict',phishingLists:true,pageWarnings:true};
 fs.writeFileSync(path.join(legacy,'privacy-plus.json'),JSON.stringify({version:1,choice:old}));
 const store=createPrivacyPlus({directory:legacy}).get();
 assert.equal(store.passkeys,false,'a profile saved by the previous version is off');
 assert.equal(store.fingerprint,'strict');assert.equal(store.skipTrackingRedirects,false,'its other choices are kept');
});

test('the choice persists, takes only on/off, and leaves the other anti-tracking choices alone',()=>{
 const dir=directory();
 const first=createPrivacyPlus({directory:dir});
 assert.equal(first.set({passkeys:true}).passkeys,true);
 assert.equal(createPrivacyPlus({directory:dir}).get().passkeys,true,'saved to the profile');
 assert.equal(createPrivacyPlus({directory:dir}).get().fingerprint,'standard');
 assert.throws(()=>first.set({passkeys:'yes'}),/on or off/);assert.throws(()=>first.set({passkeys:1}),/on or off/);
 assert.equal(first.get().passkeys,true,'a refused value changes nothing');
 assert.equal(first.set({passkeys:false}).passkeys,false);
 assert.equal(createPrivacyPlus({directory:dir}).get().passkeys,false);
 assert.equal(first.set({pageWarnings:false}).passkeys,false,'another choice does not turn it on');
});

test('while the choice is off every web page response denies passkeys by Permissions-Policy; while on, nothing is touched',()=>{
 const page={resourceType:'mainFrame',url:'https://accounts.example/signin',responseHeaders:{'Content-Type':['text/html']}};
 const patch=passkeyPolicyPatch(page,false);
 assert.deepEqual(patch.responseHeaders['Permissions-Policy'],[DENY]);
 assert.deepEqual(patch.responseHeaders['Content-Type'],['text/html'],'other headers are kept');
 assert.equal(page.responseHeaders['Permissions-Policy'],undefined,'the engine\'s own header object is not mutated');
 assert.match(DENY,/publickey-credentials-get=\(\)/);assert.match(DENY,/publickey-credentials-create=\(\)/);
 assert.deepEqual(passkeyPolicyPatch({...page,resourceType:'subFrame'},false).responseHeaders['Permissions-Policy'],[DENY],'sub-frames too');
 // A page's own policy stays, ours comes last so it wins for the two passkey features.
 const own=passkeyPolicyPatch({...page,responseHeaders:{'permissions-policy':['camera=(), publickey-credentials-get=*']}},false).responseHeaders;
 assert.deepEqual(own['permissions-policy'],['camera=(), publickey-credentials-get=*',DENY]);assert.equal(own['Permissions-Policy'],undefined,'same header, same spelling');
 // Nothing to change: on, other kinds of request, non-web addresses, no headers.
 assert.deepEqual(passkeyPolicyPatch(page,true),{},'on');
 for(const odd of [{...page,resourceType:'script'},{...page,resourceType:'xhr'},{...page,url:'acira://settings'},{...page,url:'file:///c:/a.html'},{...page,responseHeaders:undefined},undefined])assert.deepEqual(passkeyPolicyPatch(odd,false),{});
});

test('the main process answers the guard and applies the header in every session it protects',()=>{
 const blocking=read('desktop/content-blocking.cjs');
 assert.match(blocking,/ipcMain\.on\('acira:passkeys-allowed',event=>\{event\.returnValue=passkeysAllowed\(\);\}\)/);
 assert.match(blocking,/const passkeysAllowed=\(\)=>privacyPlus\.get\(\)\.passkeys===true/,'only an explicit yes is a yes');
 assert.match(blocking,/pipeline\.useHeaders\(passkeyPolicy\)/,'every attached session (ordinary, private, secured, Tor) gets the header');
 assert.match(blocking,/passkeyPolicy=details=>passkeyPolicyPatch\(details,passkeysAllowed\(\)\)/);
 const guard=read('desktop/browser-services/passkey-guard-preload.cjs');
 assert.match(guard,/sendSync\('acira:passkeys-allowed'\)===true/);
 const tor=read('desktop/browser-services/tor-window.cjs');
 assert.match(tor,/contentBlocking\.attach\(session,profileId,true\)/,'Tor windows go through the same attach()');
 const main=read('desktop/main.cjs');
 assert.match(main,/antitracking\.set/,'the Settings switch writes through antitracking.set');
});

test('Settings > Privacy has the row (switch off unless on), it is searchable, and every catalog has its text',()=>{
 const panel=read('src/features/settings/panels/anti-tracking.tsx');
 assert.match(panel,/id="passkeys" title=\{t\("privacy\.passkeysAndSecurityKeys"\)\} detail=\{t\("privacy\.passkeysDetail"\)\}/);
 assert.match(panel,/checked=\{status\?\.settings\.passkeys \?\? false\}/,'shown off until the real answer arrives');
 assert.match(panel,/patch: \{ passkeys: next \}/);
 const entries=read('src/features/settings/entries/privacy.ts');
 assert.match(entries,/id: 'passkeys'/);assert.match(entries,/'security key'/);assert.match(entries,/'windows hello'/);
 assert.match(read('src/runtime/nativeNetwork.ts'),/passkeys:boolean/);
 const english=JSON.parse(read('src/i18n/en.json'));
 assert.equal(english['privacy.passkeysAndSecurityKeys'],'Passkeys and security keys');
 assert.equal(english['privacy.passkeysDetail'],'Let sites ask Windows for a passkey or security key. When off, sites use your password instead.');
 const locales=fs.readdirSync(path.join(__dirname,'..','src','i18n')).filter(name=>/^[a-zA-Z-]+\.json$/.test(name)&&name!=='converted.json');
 assert.equal(locales.length,13);
 for(const file of locales){
  const messages=JSON.parse(read('src/i18n/'+file));
  for(const id of ['privacy.passkeysAndSecurityKeys','privacy.passkeysDetail','privacy.passkeysReload'])assert.ok(typeof messages[id]==='string'&&messages[id].trim(),file+' has '+id);
  if(file!=='en.json')assert.notEqual(messages['privacy.passkeysDetail'],english['privacy.passkeysDetail'],file+' is translated');
 }
});

test('Settings › Privacy shows the passkeys row, and search offers it, on Windows and Linux, never on a Mac (it did nothing there)',async()=>{
 const panel=read('src/features/settings/panels/anti-tracking.tsx'),entries=read('src/features/settings/entries/privacy.ts');
 assert.match(panel,/\{!isMac\(\) && <Passkeys disabled=\{disabled\} \/>\}/);
 assert.match(entries,/\]\)\.filter\(\(entry\) => entry\.id !== 'passkeys' \|\| !isMac\(\)\);/);
 // Settings drawn as a person reads it (tests/fixtures/settings-text.ts), for each platform's browser.
 const root=path.join(__dirname,'..'),draw=async platform=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),path.join(root,'tests/fixtures/settings-text.ts'),'en'],{cwd:root,maxBuffer:64*1024*1024,env:{...process.env,ACIRA_TEST_NAVIGATOR_PLATFORM:platform}})).stdout);
 const platforms=[['MacIntel',false],['Win32',true],['Linux x86_64',true]],drawn=await Promise.all(platforms.map(([platform])=>draw(platform)));
 platforms.forEach(([platform,shown],index)=>{
  const {sections,registry}=drawn[index];
  assert.ok(sections.Privacy.includes('Phishing and malware protection'),platform+': Privacy is drawn');
  assert.equal(sections.Privacy.includes('Passkeys and security keys'),shown,platform+': the row');
  assert.equal(registry.includes('Passkeys and security keys'),shown,platform+': Settings search');
 });
});
