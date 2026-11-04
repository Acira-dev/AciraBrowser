'use strict';
// Daily copies of browser.sqlite (one a day at a clean start, the last 3), and the restore offer when the file cannot be opened: "Restore the backup from
// <date>" or "Quit". Restoring moves the damaged file aside and never deletes it; a profile from a newer Acira is never restored over.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{BrowserDatabase,SCHEMA}=require('../desktop/database.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs');
const backups=require('../desktop/database-backups.cjs');
const DAY=24*60*60*1000,folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-db-backups-'));
const profile={id:'profile-1',name:'Personal',partition:'persist:p1'},hidden={id:'private-1',name:'Private',partition:'private-1',private:true};
function snapshot(urls,{withPrivate=false}={}){
 return {browserProfiles:[profile,...(withPrivate?[hidden]:[])],bookmarkNodes:[],downloads:[],tabs:urls.map((url,i)=>({id:'t'+i,url})),
  browsingHistory:[...urls.map((url,i)=>({id:'h'+i,browserProfileId:profile.id,url,time:new Date(1.8e12+i).toISOString()})),...(withPrivate?[{id:'secret',browserProfileId:hidden.id,url:'https://secret.example/',time:new Date(1.8e12).toISOString()}]:[])]};
}
function seeded(urls,options){const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',snapshot(urls,options));return db;}
const tabsIn=db=>db.readWindow('main').tabs.map(tab=>tab.url);
function cutInHalf(file){const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,Math.floor(whole.length/2)),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);return damaged;}
function harness(file,answer){
 const calls={errors:[],quits:0,asked:[],warnings:[]};
 return {calls,options:{create:name=>new BrowserDatabase(name),file,backups,supported:SCHEMA,formatDay:backups.dayLabel,showError:(title,text)=>calls.errors.push({title,text}),quit:()=>{calls.quits++;},warn:message=>calls.warnings.push(message),
  choose:question=>{calls.asked.push(question);return answer;}}};
}

test('one copy a day at most, the last 3 kept, named by the local day, readable only by the person',()=>{
 const db=seeded(['https://a.example/']),start=new Date(2026,10,2,9).getTime();
 assert.equal(backups.take(db,{now:start}).day,'2026-11-02');
 assert.equal(backups.take(db,{now:start+3*60*60*1000}),null,'a second start the same day makes none');
 for(let i=1;i<=4;i++)backups.take(db,{now:start+i*DAY});
 assert.deepEqual(backups.list(db.filename).map(entry=>entry.day),['2026-11-06','2026-11-05','2026-11-04']);
 const copy=backups.list(db.filename)[0].file;
 // NTFS uses inherited ACLs; POSIX mode bits do not describe Windows permissions.
 if(process.platform!=='win32') assert.equal((fs.statSync(copy).mode&0o777).toString(8),'600');
 else assert.doesNotThrow(()=>fs.accessSync(copy,fs.constants.R_OK|fs.constants.W_OK));
 assert.equal(backups.usable(backups.list(db.filename)[0],{supported:SCHEMA}),true);
 assert.equal(backups.dayLabel('2026-11-02'),'2 November 2026');
 db.close();
});

test('a copy holds ordinary profiles only: a private window\'s history never reaches browser.sqlite, so no copy carries it',()=>{
 const db=seeded(['https://a.example/'],{withPrivate:true});const entry=backups.take(db,{now:Date.now()});
 const copy=new DatabaseSync(entry.file,{readOnly:true});
 assert.equal(copy.prepare('SELECT count(*) AS n FROM history WHERE profile_id=?').get(hidden.id).n,0);
 assert.equal(copy.prepare('SELECT count(*) AS n FROM profiles WHERE id=?').get(hidden.id).n,0);
 assert.equal(copy.prepare('SELECT count(*) AS n FROM history WHERE profile_id=?').get(profile.id).n,1);
 copy.close();db.close();
});

test('clearing history replaces every copy with a fresh one taken after the clear, so cleared history cannot come back from one',()=>{
 const db=seeded(['https://a.example/','https://b.example/']);backups.take(db,{now:Date.now()-2*DAY});backups.take(db,{now:Date.now()-DAY});
 assert.equal(backups.list(db.filename).length,2);
 // what main does: the windows save the cleared state, then the copies are refreshed
 db.saveWindow('main',{...snapshot(['https://a.example/','https://b.example/']),browsingHistory:[]});
 const fresh=backups.refresh(db);
 assert.deepEqual(backups.list(db.filename).map(entry=>entry.day),[backups.dayOf(Date.now())],'only a new copy of today is left');
 const copy=new DatabaseSync(fresh.file,{readOnly:true});
 assert.equal(copy.prepare('SELECT count(*) AS n FROM history').get().n,0,'no cleared visit in the copy');
 assert.doesNotMatch(copy.prepare('SELECT payload FROM windows').get().payload,/"browsingHistory":\[\{/,'nor in the saved window state');
 assert.deepEqual(JSON.parse(copy.prepare('SELECT payload FROM windows').get().payload).tabs.map(tab=>tab.url),['https://a.example/','https://b.example/'],'the open tabs are still in it');
 copy.close();
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/database\?\.scrub\(\);\}catch\(error\)\{console\.error\('Database scrub:',error\.message\);\}[^\n]{0,200}for\(const other of controllers\)other\.save\(\);require\('\.\/database-backups\.cjs'\)\.refresh\(database\)/,'Clear browsing data: every window saves, then the copies are refreshed');
 assert.match(main,/onRemoved:profile=>\{[^\n]{0,600}require\('\.\/database-backups\.cjs'\)\.refresh\(database\)/,'removing a profile refreshes the copies (every window has saved by then)');
 db.close();
});

test('a file cut in half: the newest good copy is offered, restoring brings the tabs back and keeps the damaged file aside, byte for byte',()=>{
 const db=seeded(['https://old.example/']),file=db.filename;
 backups.take(db,{now:Date.now()-2*DAY});
 db.saveWindow('main',snapshot(['https://kept.example/','https://second.example/']));backups.take(db,{now:Date.now()-DAY});
 db.saveWindow('main',snapshot(['https://newest-not-in-a-copy.example/']));db.scrub();db.close();
 const damaged=cutInHalf(file);
 const h=harness(file,'restore'),opened=openBrowserDatabase(h.options);
 assert.ok(opened instanceof BrowserDatabase);assert.equal(h.calls.errors.length,0);assert.equal(h.calls.quits,0);
 assert.equal(h.calls.asked.length,1);
 const yesterday=backups.dayOf(Date.now()-DAY);
 assert.equal(h.calls.asked[0].restore,'Restore the backup from '+backups.dayLabel(yesterday));assert.equal(h.calls.asked[0].quit,'Quit');
 assert.match(h.calls.asked[0].text,/moved aside, not deleted/);
 assert.deepEqual(tabsIn(opened),['https://kept.example/','https://second.example/'],'yesterday\'s copy, not the older one');
 assert.equal(opened.restoredFrom,yesterday,'main makes no new copy on this start');
 const aside=fs.readdirSync(path.dirname(file)).filter(name=>name.startsWith('browser.sqlite.damaged-')&&!/-(wal|shm)$/.test(name));
 assert.equal(aside.length,1);assert.deepEqual(fs.readFileSync(path.join(path.dirname(file),aside[0])),damaged,'moved aside, never changed or deleted');
 assert.equal(backups.list(file).length,2,'the copies are still there');
 assert.match(h.calls.warnings.join('\n'),/restored from the copy of/);
 opened.close();
});

test('a damaged file with a stale write-ahead log: the log moves aside with it and is never applied to the copy',()=>{
 const db=seeded(['https://copy.example/']),file=db.filename;backups.take(db,{now:Date.now()});db.close();
 cutInHalf(file);fs.writeFileSync(file+'-wal',Buffer.from('not a log for the copy'));fs.writeFileSync(file+'-shm',Buffer.alloc(32768,1));
 const h=harness(file,'restore'),opened=openBrowserDatabase(h.options);
 assert.deepEqual(tabsIn(opened),['https://copy.example/']);
 const names=fs.readdirSync(path.dirname(file));
 assert.ok(names.some(name=>/^browser\.sqlite\.damaged-.*-wal$/.test(name)));assert.ok(names.some(name=>/^browser\.sqlite\.damaged-.*-shm$/.test(name)));
 opened.close();
});

test('the person chooses Quit: the file is left exactly as it was and Acira quits, with no second message (the question says Quit changes nothing)',()=>{
 const db=seeded(['https://a.example/']),file=db.filename;backups.take(db,{now:Date.now()});db.close();
 const damaged=cutInHalf(file),h=harness(file,'quit');
 assert.equal(openBrowserDatabase(h.options),null);
 assert.equal(h.calls.asked.length,1);assert.equal(h.calls.quits,1);assert.deepEqual(h.calls.errors,[],'no "Nothing was changed" box after Quit');
 assert.deepEqual(fs.readFileSync(file),damaged);assert.equal(fs.readdirSync(path.dirname(file)).filter(name=>name.includes('damaged')).length,0);
});

test('no copy yet: nothing to restore, so the question is Start fresh or Quit; Quit leaves the file untouched (field-safety)',()=>{
 const db=seeded(['https://a.example/']),file=db.filename;db.close();
 const damaged=cutInHalf(file),h=harness(file,'restore');
 assert.equal(openBrowserDatabase(h.options),null,'"restore" is not on offer, so it counts as Quit');
 assert.equal(h.calls.asked.length,1);assert.equal(h.calls.asked[0].restore,undefined);assert.equal(h.calls.asked[0].fresh,'Start fresh');assert.equal(h.calls.asked[0].preferred,'fresh');
 assert.equal(h.calls.quits,1);assert.equal(h.calls.errors.length,0,'the question already said Quit changes nothing');
 assert.deepEqual(fs.readFileSync(file),damaged);
});

test('a profile written by a newer Acira is never restored over, even with a copy at hand: only Quit (the default) or Start fresh',()=>{
 const db=seeded(['https://a.example/']),file=db.filename;backups.take(db,{now:Date.now()});db.close();
 fs.rmSync(file);for(const suffix of ['-wal','-shm'])fs.rmSync(file+suffix,{force:true});
 const raw=new DatabaseSync(file);raw.exec('CREATE TABLE kept(value TEXT); INSERT INTO kept VALUES(\'tabs\'); PRAGMA user_version=7');raw.close();
 const before=fs.readFileSync(file),h=harness(file,'restore');
 assert.equal(openBrowserDatabase(h.options),null);
 assert.equal(h.calls.asked.length,1);assert.equal(h.calls.asked[0].restore,undefined,'no restore on offer');assert.equal(h.calls.asked[0].preferred,'quit');
 assert.match(h.calls.asked[0].text,/newer version of Acira/);assert.equal(h.calls.quits,1);
 assert.deepEqual(fs.readFileSync(file),before);
 assert.equal(backups.fileVersion(file),7);
});

test('a newer profile whose header is readable but whose body is damaged is still recognised as newer',()=>{
 const file=path.join(folder(),'browser.sqlite'),raw=new DatabaseSync(file);raw.exec('CREATE TABLE kept(value TEXT); PRAGMA user_version=9');raw.close();
 const bytes=fs.readFileSync(file);bytes.fill(0x55,100);fs.writeFileSync(file,bytes);
 assert.equal(backups.fileVersion(file),9);
});

test('a copy from a newer Acira, or a damaged copy, is not offered; an older good one is',()=>{
 const db=seeded(['https://good.example/']),file=db.filename;backups.take(db,{now:Date.now()-2*DAY});db.close();
 const folderOf=backups.folderOf(file),today=backups.dayOf(Date.now()),yesterday=backups.dayOf(Date.now()-DAY);
 const newer=new DatabaseSync(path.join(folderOf,'browser-'+today+'.sqlite'));newer.exec('CREATE TABLE x(v); PRAGMA user_version=5');newer.close();
 fs.writeFileSync(path.join(folderOf,'browser-'+yesterday+'.sqlite'),'not a database at all, just text');
 cutInHalf(file);
 const h=harness(file,'restore'),opened=openBrowserDatabase(h.options);
 assert.deepEqual(tabsIn(opened),['https://good.example/']);opened.close();
});

test('a copy that cannot be written moves everything back and says nothing was deleted',()=>{
 const db=seeded(['https://a.example/']),file=db.filename;backups.take(db,{now:Date.now()});db.close();
 const damaged=cutInHalf(file);
 const broken={...backups,restore:(target,entry)=>backups.restore(target,{...entry,file:entry.file+'.missing'})};
 const h=harness(file,'restore');h.options.backups=broken;
 assert.equal(openBrowserDatabase(h.options),null);assert.equal(h.calls.quits,1);
 assert.match(h.calls.errors[0].text,/Nothing was changed or deleted/);assert.deepEqual(fs.readFileSync(file),damaged,'the damaged file is back where it was');
});

test('main offers the restore with the real buttons, and takes the daily copy off the start-up path, not after a restore or a fresh start',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/openBrowserDatabase\(\{[^\n]*backups:databaseBackups,supported:require\('\.\/database\.cjs'\)\.SCHEMA,/);
 assert.match(main,/const offered=\[\['restore',restore\],\['fresh',fresh\],\['quit',quit\]\]\.filter\(\(\[,label\]\)=>label\);/);
 assert.match(main,/dialog\.showMessageBoxSync\(\{type:'warning',title,message:title,detail:text,buttons:offered\.map\(\(\[,label\]\)=>label\),defaultId:Math\.max\(0,offered\.findIndex\(\(\[id\]\)=>id===preferred\)\),cancelId:offered\.length-1,noLink:true\}\);return offered\[picked\]\?\.\[0\]\|\|'quit';/);
 assert.match(main,/if\(!database\.restoredFrom&&!database\.startedFresh\)setTimeout\(\(\)=>\{try\{databaseBackups\.take\(database\);\}/);
});
