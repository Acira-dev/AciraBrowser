'use strict';
// data-safety-2 (beta.10 round 2): the leftovers of field-safety and startup-recovery.
// 1. "Acira could not start securely" was English only: it now comes from the catalog in the system's language, like "Acira could not start".
// 2. Quit on the restore question showed a second "Nothing was changed" box; the question now says Quit changes nothing and Acira just quits.
// 3. A damaged small settings file fell back to the defaults and kept nothing; it is now kept aside as <name>.damaged-<time> (the newest 2).
// 4. There were two files called main.log; the blocked-hosts one in logs/ is now logs/blocked.log.
// Review: 5. pruning could remove the copy just set aside when the clock was behind; 6. the secure-start box did not say the links Acira was asked
// to open were dropped; 7. a settings file with a byte-order mark was taken for damage.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {BrowserDatabase,SCHEMA}=require('../desktop/database.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs'),backups=require('../desktop/database-backups.cjs');
const processErrors=require('../desktop/process-errors.cjs'),{readJsonFile}=require('../desktop/atomic-file.cjs');
const LOCALES=['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','tr','ru','ko','hi'];
const catalog=code=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n',code+'.json'),'utf8'));
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-data-safety-2-'));
const marker=(id,params)=>'['+id+(params?' '+JSON.stringify(params):'')+']';
const kept=(dir,name)=>fs.readdirSync(dir).filter(entry=>entry.startsWith(name+'.damaged-')).sort();
const DAMAGED='{"version":1,"bindings":{"new-tab":["Ctrl+Shift+Y"]'+'\0'.repeat(40);// cut off mid-write, NUL bytes after

test('1. the secure-start message is two catalog messages; the gate\'s English reason goes to main.log, not into the box',()=>{
 const dir=folder(),log=path.join(dir,'main.log'),errors=processErrors.createProcessErrors({file:log,echo:()=>{}});
 const shown=[];let quits=0;
 processErrors.secureStartFailed({ready:false,error:'The persisted native encryption-key metadata could not be verified.'},{record:errors.record,showError:(title,text)=>shown.push([title,text]),quit:()=>{quits++;},t:marker});
 assert.deepEqual(shown,[['[main.secureStartFailedTitle]','[main.secureStartFailedText]']]);assert.equal(quits,1);
 assert.match(fs.readFileSync(log,'utf8'),/Secure start failed[\s\S]*encryption-key metadata could not be verified/,'the reason is in main.log for support');
 // the gate gave no reason: still the same two messages
 processErrors.secureStartFailed({ready:false},{record(){},showError:(title,text)=>shown.push([title,text]),quit(){},t:marker});
 assert.deepEqual(shown[1],['[main.secureStartFailedTitle]','[main.secureStartFailedText]']);
 // the catalog itself failed: the reason, never nothing
 processErrors.secureStartFailed({ready:false,error:'Startup links could not be verified.'},{record(){},showError:(title,text)=>shown.push([title,text]),quit(){},t:()=>{throw new Error('no catalog');}});
 assert.deepEqual(shown[2],['Acira','Startup links could not be verified.']);
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.doesNotMatch(main,/Acira could not start securely|Secure website-session storage is unavailable\. Close Acira/,'main.cjs keeps no English sentence for it');
 assert.match(main,/if\(!secureStartup\.restarting\)require\('\.\/process-errors\.cjs'\)\.secureStartFailed\(secureStartup,\{record:processErrors\.record,showError:\(title,text\)=>\{if\(process\.env\.ACIRA_BROWSER_TEST_HIDDEN!=='1'\)dialog\.showErrorBox\(title,text\);\},quit:\(\)=>app\.quit\(\)\}\);return;\}/);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('1. a German system gets the secure-start message in German, through the same translator as "Acira could not start"; every catalog has its own words',()=>{
 const i18n=require('../desktop/i18n.cjs'),shown=[];
 try{
  i18n.setMainLocale('system','de-DE');
  processErrors.secureStartFailed({ready:false,error:'Secure website-session storage could not be initialized.'},{record(){},showError:(title,text)=>shown.push([title,text]),quit(){}});
  processErrors.startupFailed(new Error('boom'),{record(){},hasWindow:()=>false,showError:(title,text)=>shown.push([title,text]),quit(){}});
 }finally{i18n.setMainLocale('system','en-US');}
 assert.equal(shown[0][0],'Acira konnte nicht sicher starten');assert.match(shown[0][1],/^Acira konnte den sicheren Speicher nicht verwenden/);assert.match(shown[0][1],/main\.log/);
 assert.doesNotMatch(shown[0][1],/Secure website-session/,'no English reason in a German box');
 assert.equal(shown[1][0],'Acira konnte nicht starten','the round-1 message goes the same way');
 const en=catalog('en');
 assert.equal(en['main.secureStartFailedTitle'],'Acira could not start securely','the English title is unchanged');
 for(const code of LOCALES.filter(code=>code!=='en')){const c=catalog(code);
  for(const id of ['main.secureStartFailedTitle','main.secureStartFailedText'])assert.ok(c[id]&&c[id]!==en[id],code+' '+id+' is translated');
  assert.ok(c['main.secureStartFailedText'].includes('main.log'),code+' names main.log');}
});

function damagedWithCopy(){
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);
 db.saveWindow('main',{browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[],tabs:[{id:'t1',url:'https://a.example/'}]});backups.take(db,{now:Date.now()});db.close();
 const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,whole.length>>1),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);return {file,damaged};
}

test('2. restore question, Quit: Acira quits with no second box and nothing changed; the question itself says so in all 13 languages',()=>{
 const {file,damaged}=damagedWithCopy(),errors=[],asked=[];let quits=0;
 const result=openBrowserDatabase({create:name=>new BrowserDatabase(name),file,backups,supported:SCHEMA,formatDay:backups.dayLabel,showError:(title,text)=>errors.push({title,text}),quit:()=>{quits++;},warn(){},choose:question=>{asked.push(question);return 'quit';}});
 assert.equal(result,null);assert.equal(asked.length,1);assert.ok(asked[0].restore,'it was the restore question');
 assert.deepEqual(errors,[],'no "Nothing was changed" box after Quit');assert.equal(quits,1);
 assert.deepEqual(fs.readFileSync(file),damaged,'the file is as it was');assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(name=>name.includes('damaged')),[]);
 for(const code of LOCALES){const c=catalog(code),quit=c['main.dataFreshQuestion'].match(/[^.。।]+[.。।]$/)[0].trim();
  assert.ok(c['main.dataRestoreQuestion'].endsWith(quit),code+': the restore question ends like the others: '+quit);}
});

test('3. readJsonFile: a damaged file is kept aside before the defaults; missing, unreadable or refused files are left alone; the newest 2 are kept',()=>{
 const dir=folder(),file=path.join(dir,'shortcuts.json'),warnings=[];
 assert.equal(readJsonFile(file),undefined,'missing');assert.deepEqual(fs.readdirSync(dir),[]);
 fs.writeFileSync(file,'{"enabled":false}');assert.deepEqual(readJsonFile(file),{enabled:false});assert.deepEqual(kept(dir,'shortcuts.json'),[]);
 for(const [i,text] of ['',DAMAGED,'null','[1,2]','"text"'].entries()){
  fs.writeFileSync(file,text);assert.equal(readJsonFile(file,{now:()=>Date.UTC(2026,10,3,10,i),warn:message=>warnings.push(message)}),undefined,JSON.stringify(text));
  assert.equal(fs.existsSync(file),false,'moved, so the next save cannot write over it');
 }
 assert.deepEqual(kept(dir,'shortcuts.json'),['shortcuts.json.damaged-2026-11-03T10-03-00-000Z','shortcuts.json.damaged-2026-11-03T10-04-00-000Z'],'the newest 2 only');
 assert.equal(fs.readFileSync(path.join(dir,'shortcuts.json.damaged-2026-11-03T10-04-00-000Z'),'utf8'),'"text"','byte for byte');
 assert.match(warnings[0],/^shortcuts\.json could not be read; it was kept as shortcuts\.json\.damaged-2026-11-03T10-00-00-000Z/);
 // larger than the caller's limit: no Acira wrote it
 fs.writeFileSync(file,JSON.stringify({pad:'x'.repeat(200)}));assert.equal(readJsonFile(file,{maxBytes:100,now:()=>Date.UTC(2026,10,3,11)}),undefined);assert.equal(fs.existsSync(file),false);
 // a folder at its place, and a file it may not read: left where they are
 const other=path.join(dir,'privacy-plus.json');fs.mkdirSync(other);assert.equal(readJsonFile(other),undefined);assert.ok(fs.statSync(other).isDirectory());
 if(process.platform!=='win32'&&process.getuid?.()!==0){const locked=path.join(dir,'locked.json');fs.writeFileSync(locked,'{broken');fs.chmodSync(locked,0);assert.equal(readJsonFile(locked),undefined);assert.ok(fs.existsSync(locked),'unreadable just now: not moved');fs.chmodSync(locked,0o600);}
 // a file that cannot be moved (Windows: a scanner holds it): the defaults, no error, the start goes on
 const stuck={statSync:fs.statSync,readFileSync:fs.readFileSync,renameSync(){throw Object.assign(new Error('EBUSY'),{code:'EBUSY'});},readdirSync:fs.readdirSync,rmSync:fs.rmSync};
 const busy=path.join(dir,'busy.json');fs.writeFileSync(busy,'{cut');assert.doesNotThrow(()=>assert.equal(readJsonFile(busy,{fileSystem:stuck,warn:()=>{throw new Error('no console');}}),undefined));assert.ok(fs.existsSync(busy));
 fs.rmSync(dir,{recursive:true,force:true});
});

const keys=(()=>{const key=crypto.createHash('sha256').update('data-safety-2').digest();
 return {available:()=>true,wrap:b=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(b),c.final(),c.getAuthTag()]);},
  unwrap:blob=>{const d=crypto.createDecipheriv('aes-256-gcm',key,blob.subarray(0,12));d.setAuthTag(blob.subarray(-16));return Buffer.concat([d.update(blob.subarray(12,-16)),d.final()]);}};})();

test('3. each small settings file keeps its damaged copy before falling back: shortcuts, download place, anti-tracking, Rewind, passwords, allow-list',async()=>{
 const dir=folder(),write=(name,text=DAMAGED)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 const copyOf=name=>{const list=kept(path.dirname(path.join(dir,name)),path.basename(name));assert.equal(list.length,1,name+' kept aside once');return fs.readFileSync(path.join(path.dirname(path.join(dir,name)),list[0]),'utf8');};
 const warn=console.warn;console.warn=()=>{};
 try{
  write('shortcuts.json');const {createShortcutRegistry}=require('../desktop/shortcut-registry.cjs');
  const registry=createShortcutRegistry({file:path.join(dir,'shortcuts.json'),platform:'win32'});
  assert.ok(registry.list().every(command=>!command.customized),'defaults');assert.equal(copyOf('shortcuts.json'),DAMAGED);
  const first=registry.list().find(command=>command.defaults.length);registry.clear(first.id);
  assert.equal(copyOf('shortcuts.json'),DAMAGED,'the first save of the person\'s new choice leaves the copy alone');assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'shortcuts.json'),'utf8')).bindings);

  write('download-preferences.json');const prefs=require('../desktop/download-preferences.cjs').createDownloadPreferences({file:path.join(dir,'download-preferences.json'),defaultFolder:dir});
  assert.equal(prefs.get().askWhere,false);assert.equal(copyOf('download-preferences.json'),DAMAGED);

  write('privacy-plus.json');const {createPrivacyPlus,DEFAULTS}=require('../desktop/browser-services/privacy-plus.cjs');
  assert.deepEqual(createPrivacyPlus({directory:dir}).get(),DEFAULTS);assert.equal(copyOf('privacy-plus.json'),DAMAGED);

  write('rewind/settings.json');const rewind=require('../desktop/rewind/rewind.cjs').createRewind({dir:path.join(dir,'rewind'),timers:{setTimeout:()=>0,clearTimeout(){},setInterval:()=>({unref(){}}),clearInterval(){}}});
  assert.deepEqual(rewind.settings(),{enabled:true,days:7});assert.equal(copyOf('rewind/settings.json'),DAMAGED);

  write('passwords/settings.json');const passwords=require('../desktop/passwords/passwords.cjs').createPasswords({dir:path.join(dir,'passwords'),keys,gate:{ensure:async()=>({ok:true}),lock(){}},clipboard:{},confirm:async()=>true,pickOpen:async()=>null,pickSave:async()=>null});
  assert.equal(passwords.enabled,true);assert.equal(copyOf('passwords/settings.json'),DAMAGED);

  write('threat-lists/site-allowlist.json');const allowlist=require('../desktop/browser-services/site-allowlist.cjs').createSiteAllowlist({cachePath:path.join(dir,'threat-lists')});
  allowlist.load();assert.equal(allowlist.status().entries,0);assert.equal(copyOf('threat-lists/site-allowlist.json'),DAMAGED);

  // a file a newer Acira may have written (an anti-tracking choice this one does not know) is not damaged: left where it is, as before
  const newer=JSON.stringify({version:1,choice:{cnameUncloaking:false,somethingNew:true}}),again=folder();fs.writeFileSync(path.join(again,'privacy-plus.json'),newer);
  assert.deepEqual(createPrivacyPlus({directory:again}).get(),DEFAULTS);assert.equal(fs.readFileSync(path.join(again,'privacy-plus.json'),'utf8'),newer);assert.deepEqual(kept(again,'privacy-plus.json'),[]);
  fs.rmSync(again,{recursive:true,force:true});

  // favicons.json is not kept: it is a cache of the icons of visited sites, and a copy would outlive Clear browsing data and profile removal
  write('favicons.json');const store=require('../desktop/browser-services/favicon-store.cjs').createFaviconStore({file:path.join(dir,'favicons.json'),nativeImage:{}});
  assert.deepEqual(store.list('p1',new Set()),{});assert.deepEqual(kept(dir,'favicons.json'),[]);
 }finally{console.warn=warn;fs.rmSync(dir,{recursive:true,force:true});}
});

test('4. one name means one file: blocked hosts go to logs/blocked.log, never logs/main.log beside the error log main.log',()=>{
 const {createMainLog}=require('../desktop/browser-services/main-log.cjs'),profile=folder(),logs=path.join(profile,'logs');
 createMainLog({directory:logs,echo(){},now:()=>new Date('2026-11-03T12:00:00Z')})('Blocked page resources from a.example');
 assert.deepEqual(fs.readdirSync(logs),['blocked.log']);assert.match(fs.readFileSync(path.join(logs,'blocked.log'),'utf8'),/a\.example/);
 // a beta.9 profile: its logs/main.log becomes logs/blocked.log at the first line, so the lines a bug report needs stay together
 const old=folder(),oldLogs=path.join(old,'logs');fs.mkdirSync(oldLogs);fs.writeFileSync(path.join(oldLogs,'main.log'),'2026-11-02T10:00:00.000Z Blocked page resources from old.example\n');
 const log=createMainLog({directory:oldLogs,echo(){},now:()=>new Date('2026-11-03T12:00:00Z')});log('Blocked page resources from new.example');log('Blocked page resources from third.example');
 assert.deepEqual(fs.readdirSync(oldLogs),['blocked.log']);assert.match(fs.readFileSync(path.join(oldLogs,'blocked.log'),'utf8'),/old\.example[\s\S]*new\.example[\s\S]*third\.example/);
 // both already there (an older Acira run after this one): nothing is written over
 fs.writeFileSync(path.join(oldLogs,'main.log'),'older lines\n');createMainLog({directory:oldLogs,echo(){}})('one more');
 assert.equal(fs.readFileSync(path.join(oldLogs,'main.log'),'utf8'),'older lines\n');
 const blocking=fs.readFileSync(path.join(__dirname,'../desktop/content-blocking.cjs'),'utf8');
 assert.match(blocking,/createMainLog\(\{directory:path\.join\(app\.getPath\('userData'\),'logs'\)\}\)/,'the blocked-host log is in <profile>/logs');
 for(const dir of [profile,old])fs.rmSync(dir,{recursive:true,force:true});
});

test('5. the copy just set aside is never the one pruned, even when the clock is behind older copies (a reset clock, a date changed by hand)',()=>{
 const dir=folder(),file=path.join(dir,'privacy-plus.json'),warnings=[];
 for(const day of [1,2])fs.writeFileSync(file+'.damaged-2027-03-0'+day+'T10-00-00-000Z','older '+day);
 fs.writeFileSync(file,DAMAGED);
 assert.equal(readJsonFile(file,{now:()=>Date.UTC(2026,10,4,9),warn:message=>warnings.push(message)}),undefined);
 const made='privacy-plus.json.damaged-2026-11-04T09-00-00-000Z';
 assert.deepEqual(kept(dir,'privacy-plus.json'),[made,'privacy-plus.json.damaged-2027-03-02T10-00-00-000Z'],'the new copy and the newest other one: still 2');
 assert.equal(fs.readFileSync(path.join(dir,made),'utf8'),DAMAGED,'byte for byte');
 assert.match(warnings[0],/kept as privacy-plus\.json\.damaged-2026-11-04T09-00-00-000Z /,'and the console line tells the truth');
 // window-state.json (round 1, the newest 3), through its own reader on the real clock: three copies stamped 2099 all sort as newer
 const {readState}=require('../desktop/window-placement.cjs'),state=path.join(dir,'window-state.json');
 for(const day of [1,2,3])fs.writeFileSync(state+'.damaged-2099-01-0'+day+'T00-00-00-000Z','old '+day);
 fs.writeFileSync(state,'{"windows":');
 const warn=console.warn;console.warn=()=>{};try{readState(state);}finally{console.warn=warn;}
 const copies=kept(dir,'window-state.json'),fresh=copies.find(name=>!name.includes('2099'));
 assert.equal(copies.length,3);assert.ok(fresh,'the copy just made is there');assert.equal(fs.readFileSync(path.join(dir,fresh),'utf8'),'{"windows":');
 assert.ok(!copies.includes('window-state.json.damaged-2099-01-01T00-00-00-000Z'),'the oldest other one went instead');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('6. when the links Acira was asked to open are dropped (Windows\' first-start restart could not keep them), the secure-start box says so',async()=>{
 const {createStartupGate}=require('../desktop/startup-gate.cjs'),{createExternalLinkIntake}=require('../desktop/accounts/external-links.cjs'),{EventEmitter}=require('node:events');
 const dir=folder(),app=new EventEmitter(),argv=['acira','https://a.example/page'];app.getPath=()=>dir;
 // the first start of a Windows profile restarts Acira to commit its key; the links wait for the restarted copy, encrypted. Here that encryption fails.
 const safeStorage={encryptString(){throw new Error('no key');},decryptString(){throw new Error('no key');}};
 const gate=createStartupGate({app,argv,safeStorage,links:createExternalLinkIntake({app,argv}),bootstrapFactory:()=>({prepare:()=>({ready:false,relaunchRequired:true}),restart(){}})});
 const result=await gate.prepare();
 assert.deepEqual(result,{ready:false,error:'Startup links could not be preserved securely. Reopen them after restarting Acira.'},'startup-gate.cjs: the reason the box used to keep to main.log');
 const shown=[],box=error=>processErrors.secureStartFailed(error===undefined?{ready:false}:{ready:false,error},{record(){},showError:(title,text)=>shown.push(text),quit(){},t:marker});
 // every reason of the gate's about those links gets the sentence (the kept ones could not be read, too many); the others do not
 for(const error of [result.error,'Startup links could not be verified.','Startup links could not be restored into the pending queue.','Too many startup links are waiting to be reopened.'])box(error);
 box('Secure website-session storage could not be initialized.');box(undefined);
 assert.deepEqual(shown,[...Array(4).fill('[main.secureStartFailedText] [main.secureStartLinksText]'),'[main.secureStartFailedText]','[main.secureStartFailedText]']);
 // the real catalogs, in the system's language; no space after a Japanese full stop
 const i18n=require('../desktop/i18n.cjs'),real=[];
 try{for(const tag of ['en-US','de-DE','ja-JP']){i18n.setMainLocale('system',tag);processErrors.secureStartFailed(result,{record(){},showError:(title,text)=>real.push(text),quit(){}});}}
 finally{i18n.setMainLocale('system','en-US');}
 const en=catalog('en');
 assert.equal(real[0],en['main.secureStartFailedText']+' The links you asked Acira to open were not opened; open them again once Acira has started.');
 assert.match(real[1],/in Ihrem Acira-Datenordner\. Die Links, die Acira öffnen sollte, wurden nicht geöffnet\. Öffnen Sie sie erneut/);
 assert.match(real[2],/main\.log に記録されています。Acira で開こうとしたリンク/);
 for(const code of LOCALES.filter(code=>code!=='en')){const text=catalog(code)['main.secureStartLinksText'];assert.ok(text&&text!==en['main.secureStartLinksText'],code+' has its own words');}
 assert.deepEqual(fs.readdirSync(dir),[],'nothing was written');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('7. a settings file saved with a byte-order mark (Notepad and other editors) is read as it is, not kept aside as damaged',()=>{
 const dir=folder(),BOM=Buffer.from([0xEF,0xBB,0xBF]),withMark=file=>fs.writeFileSync(file,Buffer.concat([BOM,fs.readFileSync(file)]));
 const file=path.join(dir,'download-preferences.json');fs.writeFileSync(file,JSON.stringify({askWhere:true,folder:''}));withMark(file);
 assert.deepEqual(readJsonFile(file),{askWhere:true,folder:''});
 assert.equal(require('../desktop/download-preferences.cjs').createDownloadPreferences({file,defaultFolder:dir}).get().askWhere,true,'the person\'s choice is used');
 // a custom shortcut, the file a person is most likely to edit by hand
 const {createShortcutRegistry}=require('../desktop/shortcut-registry.cjs'),shortcuts=path.join(dir,'shortcuts.json');
 const first=createShortcutRegistry({file:shortcuts,platform:'win32'}),command=first.list().find(entry=>entry.defaults.length);first.clear(command.id);withMark(shortcuts);
 assert.equal(createShortcutRegistry({file:shortcuts,platform:'win32'}).list().find(entry=>entry.id===command.id).customized,true,'the custom shortcut is kept');
 assert.deepEqual([...kept(dir,'download-preferences.json'),...kept(dir,'shortcuts.json')],[],'nothing set aside');
 // a mark with nothing after it, or before a cut-off file, is still damage
 fs.writeFileSync(file,BOM);assert.equal(readJsonFile(file,{warn(){}}),undefined);
 fs.writeFileSync(file,Buffer.concat([BOM,Buffer.from(DAMAGED)]));assert.equal(readJsonFile(file,{warn(){},now:()=>Date.UTC(2026,10,4,10)}),undefined);
 assert.equal(kept(dir,'download-preferences.json').length,2);
 fs.rmSync(dir,{recursive:true,force:true});
});
