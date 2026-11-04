'use strict';
// field-safety: a damaged browser.sqlite with no usable backup, or one written by a newer Acira, used to end in "Nothing was changed" and Quit, every
// time Acira was opened: the person could not use Acira again without deleting a file by hand. Now the question offers Start fresh (the file is moved
// aside under the name the question gives, never deleted) or Quit (changes nothing). A file that may be fine (read-only folder, busy, no permission, an
// update of its layout that failed) is never moved. Schema updates copy the file first (backups/browser-before-v<N>.sqlite).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{BrowserDatabase,SCHEMA,kindOf}=require('../desktop/database.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs');
const backups=require('../desktop/database-backups.cjs');
const NOW=Date.UTC(2026,10,3,14,0,0),STAMP='2026-11-03T14-00-00-000Z';
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-fresh-'));
const profile={id:'profile-1',name:'Personal',partition:'persist:p1'};
function seeded(){
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);
 db.saveWindow('main',{browserProfiles:[profile],bookmarkNodes:[],downloads:[],tabs:[{id:'t1',url:'https://kept.example/'}],browsingHistory:[{id:'h1',browserProfileId:profile.id,url:'https://kept.example/',time:new Date(NOW).toISOString()}]});
 db.close();return file;
}
function cutInHalf(file){const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,Math.floor(whole.length/2)),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);return damaged;}
function harness(file,answer,extra={}){
 const calls={errors:[],quits:0,asked:[],warnings:[]};
 return {calls,options:{create:name=>new BrowserDatabase(name),file,backups,supported:SCHEMA,formatDay:backups.dayLabel,now:()=>NOW,showError:(title,text)=>calls.errors.push({title,text}),quit:()=>{calls.quits++;},warn:message=>calls.warnings.push(message),
  choose:question=>{calls.asked.push(question);return answer;},...extra}};
}
const md5=file=>require('node:crypto').createHash('md5').update(fs.readFileSync(file)).digest('hex');

test('damaged, no usable copy: Start fresh moves the file (and its -wal) aside byte for byte and opens a new, empty one',()=>{
 const file=seeded(),damaged=cutInHalf(file);fs.writeFileSync(file+'-wal','stale log');
 const h=harness(file,'fresh'),opened=openBrowserDatabase(h.options);
 assert.ok(opened instanceof BrowserDatabase);assert.equal(h.calls.quits,0);assert.equal(h.calls.errors.length,0);
 const question=h.calls.asked[0];
 assert.equal(question.title,'Acira could not open your saved data');assert.equal(question.fresh,'Start fresh');assert.equal(question.quit,'Quit');assert.equal(question.restore,undefined);
 assert.equal(question.preferred,'fresh','Start fresh is the default: the file cannot be used as it is');
 assert.match(question.text,/^database disk image is malformed\n\n/,'SQLite\'s reason first');
 assert.ok(question.text.includes('“browser.sqlite.damaged-'+STAMP+'”'),'the question names the file the data will be kept as');
 const aside=file+'.damaged-'+STAMP;
 assert.equal(opened.startedFresh,aside);
 assert.deepEqual(fs.readFileSync(aside),damaged,'kept byte for byte');
 // the first look is read-only, so the failed open neither folds the log into the damaged file nor drops it: it goes aside with the file, byte for byte
 assert.equal(fs.readFileSync(aside+'-wal','utf8'),'stale log','its log went with it, so it is never applied to the new file');
 assert.equal(opened.readWindow('main'),null,'a new, empty database');
 assert.equal(opened.db.prepare('PRAGMA user_version').get().user_version,SCHEMA);
 opened.close();
});

test('damaged, no usable copy: Quit changes nothing and no second message follows the question',()=>{
 const file=seeded(),damaged=cutInHalf(file),h=harness(file,'quit');
 assert.equal(openBrowserDatabase(h.options),null);
 assert.equal(h.calls.asked.length,1);assert.match(h.calls.asked[0].text,/Quit changes nothing/);
 assert.equal(h.calls.quits,1);assert.equal(h.calls.errors.length,0);
 assert.deepEqual(fs.readFileSync(file),damaged);assert.deepEqual(fs.readdirSync(path.dirname(file)),['browser.sqlite']);
});

test('written by a newer Acira: Quit is the default and changes nothing; Start fresh keeps the newer file whole as browser.sqlite.newer-<time>',()=>{
 const file=path.join(folder(),'browser.sqlite'),raw=new DatabaseSync(file);raw.exec("CREATE TABLE kept(value TEXT); INSERT INTO kept VALUES('tabs'); PRAGMA user_version=7");raw.close();
 const before=md5(file);
 const quit=harness(file,'quit');assert.equal(openBrowserDatabase(quit.options),null);
 assert.equal(quit.calls.asked[0].preferred,'quit');assert.equal(quit.calls.asked[0].restore,undefined,'never restored over');
 assert.match(quit.calls.asked[0].text,/newer version of Acira[\s\S]*install the latest Acira[\s\S]*“browser\.sqlite\.newer-2026-11-03T14-00-00-000Z”/);
 assert.doesNotMatch(quit.calls.asked[0].text,/This profile was created/,'no untranslated English reason in front of it');
 assert.equal(quit.calls.errors.length,0);assert.equal(md5(file),before);
 const fresh=harness(file,'fresh'),opened=openBrowserDatabase(fresh.options);
 assert.ok(opened instanceof BrowserDatabase);
 const aside=file+'.newer-'+STAMP;assert.equal(md5(aside),before,'the newer Acira can still read it');assert.equal(backups.fileVersion(aside),7);
 assert.equal(opened.db.prepare('PRAGMA user_version').get().user_version,SCHEMA);opened.close();
});

test('a file that may be fine is never moved: read-only, no permission or busy is explained and Acira quits, with no question',()=>{
 for(const failure of [{errcode:1544,message:'attempt to write a readonly database'},{errcode:14,message:'unable to open database file'},{errcode:5,message:'database is locked'},{code:'ENOSPC',message:'ENOSPC: no space left on device, write'}]){
  const file=seeded(),before=md5(file);
  const h=harness(file,'fresh',{create:()=>{throw Object.assign(new Error(failure.message),failure);}});
  assert.equal(openBrowserDatabase(h.options),null);
  assert.equal(h.calls.asked.length,0,failure.message+': no question');assert.equal(h.calls.quits,1);assert.match(h.calls.errors[0].text,/Nothing was changed or deleted/);
  assert.equal(md5(file),before);assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(),['browser.sqlite']);
 }
 assert.equal(kindOf(Object.assign(new Error('file is not a database'),{errcode:26})),'damaged');
 assert.equal(kindOf(Object.assign(new Error('database disk image is malformed'),{errcode:11})),'damaged');
 assert.equal(kindOf(new Error('Browser data integrity check failed. Your data has been preserved.')),'damaged');
});

test('when no new file can be made after moving the old one aside, the old one is put back and Acira explains and quits',()=>{
 const file=seeded(),damaged=cutInHalf(file);let calls=0;
 const h=harness(file,'fresh',{create:name=>{calls++;if(calls===1)return new BrowserDatabase(name);throw Object.assign(new Error('disk I/O error'),{errcode:10});}});
 assert.equal(openBrowserDatabase(h.options),null);
 assert.deepEqual(fs.readFileSync(file),damaged,'back where it was');assert.deepEqual(fs.readdirSync(path.dirname(file)),['browser.sqlite']);
 assert.equal(h.calls.quits,1);assert.match(h.calls.errors[0].text,/Nothing was changed or deleted/);
});

test('a layout update copies the file first (backups/browser-before-v2.sqlite), runs in a transaction, and one that fails leaves the file as it was',()=>{
 const file=seeded(),addColumn=db=>db.exec('ALTER TABLE windows ADD COLUMN pinned INTEGER DEFAULT 0');
 const upgraded=new BrowserDatabase(file,{migrations:[addColumn]});
 assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version,2);
 assert.equal(upgraded.readWindow('main').tabs[0].url,'https://kept.example/');
 upgraded.close();
 const copy=path.join(path.dirname(file),'backups','browser-before-v2.sqlite');
 const saved=new DatabaseSync(copy,{readOnly:true});
 assert.equal(saved.prepare('PRAGMA user_version').get().user_version,1,'the copy is the file before the update');
 assert.match(saved.prepare("SELECT payload FROM windows WHERE id='main'").get().payload,/kept\.example/);saved.close();
 if(process.platform!=='win32')assert.equal((fs.statSync(copy).mode&0o777).toString(8),'600');
 // a failing step: the transaction rolls back, the file stays at version 1 with everything in it, and database-open does not move it
 const second=seeded(),broken=()=>{throw new Error('no such column: nope');};
 assert.throws(()=>new BrowserDatabase(second,{migrations:[broken]}),error=>error.code==='ACIRA_UPGRADE_FAILED'&&/still at version 1/.test(error.message));
 const check=new DatabaseSync(second,{readOnly:true});assert.equal(check.prepare('PRAGMA user_version').get().user_version,1);assert.match(check.prepare("SELECT payload FROM windows WHERE id='main'").get().payload,/kept\.example/);check.close();
 assert.ok(fs.existsSync(path.join(path.dirname(second),'backups','browser-before-v2.sqlite')));
 const h=harness(second,'fresh',{create:name=>new BrowserDatabase(name,{migrations:[broken]}),supported:2});
 assert.equal(openBrowserDatabase(h.options),null);assert.equal(h.calls.asked.length,0,'an update that failed is not damage');assert.equal(h.calls.quits,1);
 // a brand-new profile has nothing to copy
 const fresh=path.join(folder(),'browser.sqlite'),made=new BrowserDatabase(fresh,{migrations:[addColumn]});made.close();
 assert.equal(fs.existsSync(path.join(path.dirname(fresh),'backups')),false);
});

test('the new words are in all thirteen catalogs with the English parameters, and none is written in the code',()=>{
 const KEYS=['main.dataFreshButton','main.dataFreshQuestion','main.dataNewerQuestion','main.windowDataQuestion','main.interfaceStoppedTitle','main.interfaceStoppedText','main.restartButton','main.dataKeptAside'];
 const read=code=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n',code+'.json'),'utf8'));
 const params=text=>[...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]))].sort();
 const en=read('en');
 for(const code of ['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','tr','ru','ko','hi']){const catalog=read(code);for(const id of KEYS){assert.equal(typeof catalog[id],'string',code+' '+id);assert.deepEqual(params(catalog[id]),params(en[id]),code+' '+id);if(code!=='en')assert.notEqual(catalog[id],en[id],code+' '+id+' is translated');}}
 const code=fs.readFileSync(path.join(__dirname,'../desktop/database-open.cjs'),'utf8').split('\n').filter(line=>!/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n').replace(/\/\/[^\n]*/g,'');
 assert.doesNotMatch(code,/'Start fresh'|newer version of Acira|Quit changes nothing/);
 const i18n=require('../desktop/i18n.cjs');
 try{i18n.setMainLocale('system','de-DE');assert.equal(i18n.tm('main.dataFreshButton'),'Neu beginnen');}finally{i18n.setMainLocale('system','en-US');}
});

test('a journal left by a crash mid-write (rollback mode) is rolled back by the ordinary open, not mistaken for damage by the read-only first look',()=>{
 const file=path.join(folder(),'browser.sqlite'),{spawnSync}=require('node:child_process');
 // a child starts a big write in rollback-journal mode and is killed before it commits: browser.sqlite-journal is left "hot"
 spawnSync(process.execPath,['-e',"const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=1;');d.exec('BEGIN; CREATE TABLE scratch(a); '+Array.from({length:3000},(_,i)=>'INSERT INTO scratch VALUES('+i+');').join('')+' UPDATE scratch SET a=a+1;');process.kill(process.pid,'SIGKILL');",file]);
 assert.ok(fs.existsSync(file+'-journal'),'the crash left its journal');
 assert.throws(()=>{const ro=new DatabaseSync(file,{readOnly:true});try{ro.prepare('SELECT 1').get();ro.prepare('SELECT count(*) FROM sqlite_master').get();}finally{ro.close();}},/readonly/,'a read-only look cannot roll it back');
 const h=harness(file,'fresh'),opened=openBrowserDatabase(h.options);
 assert.ok(opened instanceof BrowserDatabase,'opened as before');assert.equal(h.calls.asked.length,0);assert.equal(h.calls.errors.length,0);
 assert.equal(opened.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='scratch'").get().n,0,'the unfinished write was rolled back');
 opened.close();
});
