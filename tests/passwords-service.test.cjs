'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createPasswords,CLIPBOARD_CLEAR_MS}=require('../desktop/passwords/passwords.cjs');
const {createGate}=require('../desktop/passwords/gate.cjs');

const deviceKey=crypto.createHash('sha256').update('svc').digest();
const keys={available:()=>true,wrap:b=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',deviceKey,iv);return Buffer.concat([iv,c.update(b),c.final(),c.getAuthTag()]);},unwrap:blob=>{const d=crypto.createDecipheriv('aes-256-gcm',deviceKey,blob.subarray(0,12));d.setAuthTag(blob.subarray(blob.length-16));return Buffer.concat([d.update(blob.subarray(12,blob.length-16)),d.final()]);}};
function harness({allow=true,confirmAnswer=true,open=null,save=null}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-pws-')),timers=[],gateCalls=[];
 // Electron 44's clipboard is asynchronous (readText and writeText return promises); the fake behaves the same.
 const clip={text:'',secret:false,async writeText(v){this.text=v;this.secret=false;},async writeSecret(v){this.text=v;this.secret=true;},async readText(){return this.text;},async clear(){this.text='';}};
 const gate=createGate({verify:async reason=>{gateCalls.push(reason);return allow?{ok:true,method:'test'}:{ok:false,code:'cancelled',message:'Cancelled.'};}});
 const h={dir,clip,timers,gateCalls,answers:{confirm:confirmAnswer,open,save},confirms:[]};
 h.svc=createPasswords({dir,keys,gate,clipboard:clip,confirm:async(window,options)=>{h.confirms.push(options);return h.answers.confirm;},pickOpen:async()=>h.answers.open,pickSave:async()=>h.answers.save,timers:{setTimeout:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}}});
 h.ask=(request,extra={})=>h.svc.handle(request,{profileId:'profile-personal',privateMode:false,window:{},...extra}).then(r=>r.passwords);
 return h;
}
const SITE={origin:'https://app.example.com',username:'ada',password:'Zr8!kQ#m2Lp9-vXw',note:'backup 99-1'};

test('listing carries no secrets; detail, status and check are safe to call without the gate',async()=>{
 const h=harness();await h.ask({type:'passwords.save',...SITE});await h.ask({type:'passwords.save',origin:'https://other.test',username:'bob',password:'123456'});
 const list=await h.ask({type:'passwords.list'});
 assert.equal(list.items.length,2);assert.equal(JSON.stringify(list).includes(SITE.password),false);assert.equal(JSON.stringify(list).includes('123456'),false);assert.equal(JSON.stringify(list).includes('backup'),false);
 const detail=await h.ask({type:'passwords.detail',id:list.items[0].id});assert.equal(JSON.stringify(detail).includes(SITE.password),false);
 const status=await h.ask({type:'passwords.status'});assert.deepEqual([status.ok,status.count,status.enabled],[true,2,true]);
 const verdict=await h.ask({type:'passwords.check'});assert.deepEqual([verdict.total,verdict.weak],[2,1]);assert.equal(JSON.stringify(verdict).includes('123456'),false);
 assert.deepEqual(h.gateCalls,[],'none of these needed the gate');
});

test('reveal and password copy need the gate; a refusal returns no secret; copy happens in main and clears later',async()=>{
 const denied=harness({allow:false});const saved=await denied.ask({type:'passwords.save',...SITE});
 const no=await denied.ask({type:'passwords.reveal',id:saved.id});assert.equal(no.denied.code,'cancelled');assert.equal(JSON.stringify(no).includes(SITE.password),false);
 const noCopy=await denied.ask({type:'passwords.copy',id:saved.id,field:'password'});assert.ok(noCopy.denied);assert.equal(denied.clip.text,'');
 const h=harness();const item=await h.ask({type:'passwords.save',...SITE});
 const shown=await h.ask({type:'passwords.reveal',id:item.id});assert.deepEqual([shown.password,shown.note],[SITE.password,SITE.note]);
 const copied=await h.ask({type:'passwords.copy',id:item.id,field:'password'});
 assert.equal(JSON.stringify(copied).includes(SITE.password),false,'the renderer never receives the secret from copy');
 assert.equal(h.clip.text,SITE.password);assert.equal(h.clip.secret,true,'a password is written as a secret (kept out of clipboard history)');assert.equal(copied.clearsInMs,CLIPBOARD_CLEAR_MS);
 const timer=h.timers.at(-1);assert.equal(timer.ms,CLIPBOARD_CLEAR_MS);await timer.fn();assert.equal(h.clip.text,'','cleared when unchanged');
 await h.ask({type:'passwords.copy',id:item.id,field:'password'});h.clip.text='something the user copied since';await h.timers.at(-1).fn();assert.equal(h.clip.text,'something the user copied since','a newer clipboard is left alone');
 const username=await h.ask({type:'passwords.copy',id:item.id,field:'username'});assert.equal(h.clip.text,'ada');assert.equal(h.clip.secret,false,'a username is plain text');assert.equal(username.clearsInMs,0);
 assert.deepEqual(h.gateCalls,['reveal'],'one prompt covers the unlock window; copy right after reveal does not ask again');
});

test('edit is gated, delete confirms in the UI, delete-all is gated and confirmed',async()=>{
 const h=harness({allow:false});const a=await h.ask({type:'passwords.save',...SITE});
 assert.ok((await h.ask({type:'passwords.update',id:a.id,password:'new-secret-1!'})).denied);
 assert.ok((await h.ask({type:'passwords.deleteAll'})).denied);assert.equal((await h.ask({type:'passwords.list'})).items.length,1);
 const ok=harness();const b=await ok.ask({type:'passwords.save',...SITE});
 await ok.ask({type:'passwords.update',id:b.id,password:'new-secret-1!',username:'ada2'});
 assert.equal((await ok.ask({type:'passwords.reveal',id:b.id})).password,'new-secret-1!');
 assert.equal((await ok.ask({type:'passwords.list'})).items[0].username,'ada2');
 ok.answers.confirm=false;assert.equal((await ok.ask({type:'passwords.deleteAll'})).cancelled,true);assert.equal((await ok.ask({type:'passwords.list'})).items.length,1);
 ok.answers.confirm=true;const done=await ok.ask({type:'passwords.deleteAll'});assert.equal(done.deleted,1);assert.match(ok.confirms.at(-1).message,/Delete all 1 saved password/);
 assert.equal((await ok.ask({type:'passwords.list'})).items.length,0);
 const c=await ok.ask({type:'passwords.save',...SITE});await ok.ask({type:'passwords.delete',id:c.id});assert.equal((await ok.ask({type:'passwords.list'})).items.length,0);
});

test('private windows never touch the vault; the offer-to-save setting persists',async()=>{
 const h=harness();
 for(const type of ['passwords.list','passwords.status','passwords.reveal','passwords.export'])assert.deepEqual(await h.ask({type,id:'a'.repeat(32)},{privateMode:true}),{private:true});
 assert.equal(fs.existsSync(path.join(h.dir,'master.key')),false,'no key was even created');
 assert.equal((await h.ask({type:'passwords.settings',enabled:false})).enabled,false);assert.equal(h.svc.enabled,false);
 const again=createPasswords({dir:h.dir,keys,gate:{ensure:async()=>({ok:true}),lock(){}},clipboard:h.clip,confirm:async()=>true,pickOpen:async()=>null,pickSave:async()=>null});assert.equal(again.enabled,false);
});

test('requests are validated: unknown fields, bad ids, bad types, oversized bodies',async()=>{
 const h=harness();const item=await h.ask({type:'passwords.save',...SITE});
 const reject=async request=>assert.rejects(()=>h.ask(request),/Unexpected|Unknown|Invalid|Choose/);
 await reject({type:'passwords.list',extra:1});await reject({type:'passwords.reveal',id:'../../x'});await reject({type:'passwords.reveal',id:item.id,extra:true});
 await reject({type:'passwords.copy',id:item.id,field:'note'});await reject({type:'passwords.settings',enabled:'yes'});await reject({type:'passwords.nope'});await reject({type:'passwords.delete',id:42});
 await reject(null);await reject([]);await assert.rejects(()=>h.ask({type:'passwords.save',origin:'https://a.test',username:'u',password:'x'.repeat(20000)}),/Invalid/);
 const bad=await h.ask({type:'passwords.save',origin:'ftp://x.test',username:'u',password:'p'});assert.equal(bad.error.code,'invalid');assert.equal(JSON.stringify(bad).includes('p"'),false);
 const missing=await h.ask({type:'passwords.reveal',id:'f'.repeat(32)});assert.equal(missing.error.code,'missing');
});

test('CSV import: preview counts, one-shot token, nothing secret returned, optional file delete',async()=>{
 const h=harness();await h.ask({type:'passwords.save',origin:'https://same.test',username:'u',password:'keep-1'});await h.ask({type:'passwords.save',origin:'https://change.test',username:'u',password:'old-pw'});
 const file=path.join(h.dir,'export.csv');
 fs.writeFileSync(file,'name,url,username,password,note\nsame,https://same.test,u,keep-1,\nchange,https://change.test,u,new-pw,\nfresh,https://fresh.test,v,brand-new,\ndup,https://fresh.test,v,brand-new,\nbad,javascript:1,x,y,\nempty,https://e.test,u,,\n');
 h.answers.open=file;
 const preview=await h.ask({type:'passwords.import.preview'});
 assert.deepEqual([preview.total,preview.new,preview.update,preview.same,preview.skipped,preview.name],[4,1,1,2,2,'export.csv']);
 assert.equal(JSON.stringify(preview).includes('brand-new'),false);assert.match(preview.token,/^[0-9a-f]{32}$/);
 const done=await h.ask({type:'passwords.import.apply',token:preview.token});assert.deepEqual([done.added,done.updated,done.failed],[1,1,0]);assert.equal(JSON.stringify(done).includes('new-pw'),false);
 assert.equal((await h.ask({type:'passwords.list'})).items.length,3);
 await assert.rejects(()=>h.ask({type:'passwords.import.apply',token:preview.token}),/expired/);// entries cleared after use
 const second=await h.ask({type:'passwords.import.preview'});assert.equal((await h.ask({type:'passwords.import.delete-file',token:second.token})).fileDeleted,true);assert.equal(fs.existsSync(file),false);
 await assert.rejects(()=>h.ask({type:'passwords.import.apply',token:'0'.repeat(32)}),/expired/);
 h.answers.open=null;assert.equal((await h.ask({type:'passwords.import.preview'})).cancelled,true);
 h.answers.open=path.join(h.dir,'missing.csv');assert.match((await h.ask({type:'passwords.import.preview'})).unreadable,/couldn’t be read/);
 const junk=path.join(h.dir,'junk.csv');fs.writeFileSync(junk,'hello\nworld');h.answers.open=junk;assert.match((await h.ask({type:'passwords.import.preview'})).unreadable,/doesn’t look like a passwords file/);
});

test('CSV export: gate, then an explicit confirmation, then a file; refusals write nothing',async()=>{
 const h=harness();await h.ask({type:'passwords.save',...SITE});const target=path.join(h.dir,'out.csv');h.answers.save=target;
 h.answers.confirm=false;assert.equal((await h.ask({type:'passwords.export'})).cancelled,true);assert.equal(fs.existsSync(target),false);
 assert.match(h.confirms.at(-1).detail,/plain text/);
 h.answers.confirm=true;const done=await h.ask({type:'passwords.export'});assert.deepEqual([done.exported,done.name],[1,'out.csv']);
 const text=fs.readFileSync(target,'utf8');assert.match(text,/^name,url,username,password,note\r\n/);assert.ok(text.includes(SITE.password));
 fs.rmSync(target);const denied=harness({allow:false});await denied.ask({type:'passwords.save',...SITE});denied.answers.save=target;
 assert.ok((await denied.ask({type:'passwords.export'})).denied);assert.equal(fs.existsSync(target),false);assert.equal(denied.confirms.length,0,'no confirmation before the gate passes');
 const empty=harness();assert.equal((await empty.ask({type:'passwords.export'})).empty,true);
});

test('password import tokens belong to the profile that selected the file',async()=>{
 const h=harness(),file=path.join(h.dir,'owned.csv');fs.writeFileSync(file,'url,username,password\nhttps://owned.test,qa,fixture-password\n');h.answers.open=file;
 try{
  const preview=await h.ask({type:'passwords.import.preview'});
  await assert.rejects(()=>h.ask({type:'passwords.import.apply',token:preview.token},{profileId:'other-profile'}),/expired/);
  await assert.rejects(()=>h.ask({type:'passwords.import.delete-file',token:preview.token},{profileId:'other-profile'}),/expired/);
  assert.equal((await h.ask({type:'passwords.list'},{profileId:'other-profile'})).items.length,0);
  assert.equal(fs.existsSync(file),true);
  assert.equal((await h.ask({type:'passwords.import.apply',token:preview.token})).added,1);
  assert.equal((await h.ask({type:'passwords.import.delete-file',token:preview.token})).fileDeleted,true);
  fs.writeFileSync(file,'url,username,password\nhttps://owned.test,qa,fixture-password\n');
  const removed=await h.ask({type:'passwords.import.preview'});h.svc.removeProfile('profile-personal');
  await assert.rejects(()=>h.ask({type:'passwords.import.apply',token:removed.token}),/expired/);
  assert.equal(fs.existsSync(file),true,'retiring the profile never deletes its source file');
 }finally{fs.rmSync(h.dir,{recursive:true,force:true});}
});

test('the file/confirm stand-in works only in an unpackaged run inside an isolated test profile',async()=>{
 const {dialogs}=require('../desktop/passwords/index.cjs');
 const real=calls=>({
  showOpenDialog:async()=>{calls.push('open');return {canceled:true,filePaths:[]};},
  showSaveDialog:async()=>{calls.push('save');return {canceled:true};},
  showMessageBox:async()=>{calls.push('confirm');return {response:0};},
 });
 const env={ACIRA_BROWSER_TEST_DATA:'x',ACIRA_PASSWORDS_TEST_FILES:JSON.stringify({open:'C:\fake\in.csv',save:'C:\fake\out.csv',confirm:true})};
 const run=async packaged=>{const calls=[];const d=dialogs({dialog:real(calls),appDialog:real(calls),env,packaged});return {open:await d.pickOpen(null),save:await d.pickSave(null),confirm:await d.confirm(null,{message:'m',confirmLabel:'Go'}),calls};};
 const dev=await run(false);assert.deepEqual([dev.open,dev.save,dev.confirm,dev.calls.length],['C:\fake\in.csv','C:\fake\out.csv',true,0]);
 for(const packaged of [true,undefined]){
  const shipped=await run(packaged);
  assert.deepEqual([shipped.open,shipped.save,shipped.confirm],[null,null,false],'an installed app ignores the stand-in');
  assert.deepEqual(shipped.calls,['open','save','confirm'],'the real dialogs were used');
 }
});

test('every test switch is read behind testSwitchesAllowed, and main hands it app.isPackaged',()=>{
 const dir=path.join(__dirname,'..','desktop','passwords');
 for(const name of fs.readdirSync(dir).filter(f=>f.endsWith('.cjs'))){
  const source=fs.readFileSync(path.join(dir,name),'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
  if(/ACIRA_PASSWORDS_TEST/.test(source))assert.match(source,/testSwitchesAllowed/,`${name} reads a test switch without the packaged check`);
 }
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 assert.match(main,/sharedPasswords\(\{[^}]*packaged:app\.isPackaged[^}]*\}\)/,'main must pass app.isPackaged so an installed app ignores the switches');
});

test('a private tab in a normal window is never an owner, and main never gives it the page script',()=>{
 const windowSource=fs.readFileSync(path.join(__dirname,'..','desktop','passwords','window.cjs'),'utf8');
 assert.match(windowSource,/private:privateMode\|\|Boolean\(tab\.privacy\)/,'ownerOf marks private tabs');
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 assert.match(main,/if\(!entry\.privateTab\)pwWin\.attachSession\(wc\.session\)/,'private tab sessions get no page script');
});

test('Windows copy: text and the history/cloud/monitor exclusions go in one atomic write, DWORD 0; other systems and failures still copy',async()=>{
 const {clipboardPort,WINDOWS_PRIVATE_FORMATS}=require('../desktop/passwords/index.cjs');
 class Item{constructor(items){this.items=items;}}
 const make=(extra={})=>{const log={writes:[],texts:[]};return {log,clipboard:{async write(list){log.writes.push(list);},async writeText(t){log.texts.push(t);},async readText(){return 'x';},async clear(){},...extra}};};
 const win=make();await clipboardPort({clipboard:win.clipboard,ClipboardItem:Item,platform:'win32'}).writeSecret('s3cret');
 assert.equal(win.log.writes.length,1,'one atomic write: a second write would replace the first');assert.deepEqual(win.log.texts,[]);
 const items=win.log.writes[0][0].items;assert.equal(items['text/plain'],'s3cret');
 for(const name of ['ExcludeClipboardContentFromMonitorProcessing','CanIncludeInClipboardHistory','CanUploadToCloudClipboard']){
  assert.ok(WINDOWS_PRIVATE_FORMATS.includes(name));const blob=items[`electron application/osclipboard;format="${name}"`];assert.equal(blob.size,4,name);assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[0,0,0,0],'DWORD 0');
 }
 const mac=make();await clipboardPort({clipboard:mac.clipboard,ClipboardItem:Item,platform:'darwin'}).writeSecret('s3cret');assert.deepEqual([mac.log.writes.length,mac.log.texts],[0,['s3cret']]);
 const bare=make();await clipboardPort({clipboard:bare.clipboard,platform:'win32'}).writeSecret('s3cret');assert.deepEqual(bare.log.texts,['s3cret'],'no ClipboardItem: plain text');
 const broken=make({async write(){throw new Error('no formats');}});await clipboardPort({clipboard:broken.clipboard,ClipboardItem:Item,platform:'win32'}).writeSecret('s3cret');assert.deepEqual(broken.log.texts,['s3cret'],'a format failure never loses the copy');
});

test('a clipboard failure is a plain message, not a crash, and schedules no clear',async()=>{
 const h=harness();const item=(await h.ask({type:'passwords.save',...SITE})).saved;h.clip.writeSecret=async()=>{throw new Error('boom');};
 const before=h.timers.length;const result=await h.ask({type:'passwords.copy',id:(await h.ask({type:'passwords.list'})).items[0].id,field:'password'});
 assert.equal(result.error.code,'clipboard');assert.equal(h.timers.length,before);assert.equal(JSON.stringify(result).includes(SITE.password),false);
});
