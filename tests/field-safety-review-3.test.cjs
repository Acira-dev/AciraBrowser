'use strict';
// field-safety, third round (re-review of the second): each case below was broken in the second round's code.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {BrowserDatabase,SCHEMA}=require('../desktop/database.cjs'),{readSavedWindow}=require('../desktop/saved-window.cjs');
const {restoreSnapshot,createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
const backups=require('../desktop/database-backups.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs'),{scrub}=require('../desktop/process-errors.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-review-3-'));
const empty={browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[]};
const full=()=>Object.assign(new Error('database or disk is full'),{errcode:13});

test('1. clearing data keeps the damaged and newer files set aside (they may be the only copy); refresh copies before it deletes, and a full disk still ends with a copy',()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',empty);
 const real=db.backup.bind(db);backups.take(db,{now:Date.now()-2*86400000});
 const aside=[file+'.damaged-2026-11-03T10-00-00-000Z',file+'.damaged-2026-11-03T10-00-00-000Z-wal',file+'.damaged-2026-11-03T10-00-00-000Z-shm',file+'.newer-2026-11-02T10-00-00-000Z'];
 for(const name of aside)fs.writeFileSync(name,'the only copy');
 const before=path.join(backups.folderOf(file),'browser-before-v2.sqlite');fs.writeFileSync(before,'before the update');
 let oldAtCopy=null;db.backup=target=>{oldAtCopy??=backups.list(file).length;return real(target);};
 backups.refresh(db);
 assert.equal(oldAtCopy,1,'the new copy is written while the old one is still there');
 for(const name of aside)assert.equal(fs.readFileSync(name,'utf8'),'the only copy',path.basename(name)+' is kept');
 assert.equal(fs.existsSync(before),false,'the copy before an update goes, as before');
 assert.deepEqual(backups.list(file).map(entry=>entry.day),[backups.dayOf(Date.now())]);
 backups.forget(file);for(const name of aside)assert.ok(fs.existsSync(name),path.basename(name)+' survives forget too');
 // a full disk while the old copies take the room: they still go (what was cleared must not come back from them) and the copy is made in the room they free
 db.backup=real;backups.take(db,{now:Date.now()-86400000});
 db.backup=target=>{if(backups.list(file).length)throw full();return real(target);};
 assert.equal(backups.refresh(db).day,backups.dayOf(Date.now()));assert.deepEqual(backups.list(file).map(entry=>entry.day),[backups.dayOf(Date.now())]);
 assert.deepEqual(fs.readdirSync(backups.folderOf(file)).filter(name=>name.endsWith('.next')),[],'no half copy left');
 // no room at all: no copy can be made, and none of the old ones is left to bring the cleared data back
 db.backup=real;backups.take(db,{now:Date.now()-86400000});db.backup=()=>{throw full();};
 assert.throws(()=>backups.refresh(db),/full/);assert.deepEqual(backups.list(file),[]);
 db.close();
});

test('2. only a busy or locked database is a passing failure; a read that keeps failing for any other reason gets the Start fresh question',async()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',persistedSnapshot(createInitialState()));
 const read=async(errcode,message)=>{let calls=0;db.readWindow=()=>{calls++;throw Object.assign(new Error(message),{errcode});};return {result:await readSavedWindow({database:db,windowId:'main',restoreSnapshot,pause:async()=>{}}),calls};};
 for(const [errcode,message] of [[10,'disk I/O error'],[3850,'disk I/O error'],[18,'string or blob too big'],[1,'SQL logic error']]){
  const {result}=await read(errcode,message);
  assert.ok(result.damaged&&!result.unavailable,message+' ('+errcode+') gets the question, or Acira would never open again');
 }
 for(const [errcode,message] of [[5,'database is locked'],[517,'database is locked'],[6,'database table is locked'],[262,'database table is locked']]){
  const {result,calls}=await read(errcode,message);
  assert.ok(result.unavailable&&!result.damaged,message+' ('+errcode+') is tried again, never offered Start fresh');assert.equal(calls,3);
 }
 db.close();
});

test('3. a path with a bracket in a folder name is scrubbed to its end, not cut at the ")"',()=>{
 const out=scrub([
  'EPERM: open D:\\Clients (2025)\\Acme Corp\\contract.pdf',
  'ENOENT: no such file, stat /Volumes/Backup (old)/Clients/Jo Smith/contract.pdf',
  'EACCES: open /Users/jo/Clients (2025)/Acme/brief.pdf',
  'Error (while saving /Users/jo/Notes/a b.txt)',
  'Error (while saving /srv/share/plan.txt) after 3 tries',
 ].join('\n'),{app:'/Applications/Acira.app/Contents/Resources/app.asar',profile:'/Users/jo/Library/Application Support/AciraBrowser',home:'/Users/jo',temp:'/var/folders/T'});
 for(const secret of ['Acme','Clients','contract','Jo Smith','Backup (old)','brief','Notes','plan.txt','share'])assert.ok(!out.includes(secret),secret+' is gone:\n'+out);
 assert.match(out,/^EPERM: open <path>$/m);assert.match(out,/\(while saving <home>\/…\)$/m);assert.match(out,/\(while saving <path>\) after 3 tries$/m,'a bracket that closes the message part still ends the path');
});

test('4. code in an error message stays readable (mainWindow.webContents.send, Intl.DateTimeFormat, resources.pak); real host names still go',()=>{
 const out=scrub([
  'TypeError: mainWindow.webContents.send is not a function',
  'TypeError: Cannot read properties of undefined (reading overlay.bounds.width)',
  'RangeError: Intl.DateTimeFormat could not format the date',
  'Error: resources.pak and icudtl.dat could not be read',
  'getaddrinfo ENOTFOUND my-therapist-portal.com',
  'queryCname ENOTFOUND clinic.example.net',
  'connect ECONNREFUSED portal.example:443',
  'getaddrinfo ENOTFOUND Jos-MacBook-Pro.local',
  'printer.lan did not answer; nor did my.clinic, appointments.bank or BANK.EXAMPLE.COM',
  'a person\'s files keep going like hosts: contract.pdf, JoSmithTaxes.pdf, budget.numbers, Tax Return 2025.pdf, and MyBank.com in capitals',
  'TypeError: wc.getURL is not a function',
 ].join('\n'),{home:'/Users/jo',temp:'/var/folders/T'});
 for(const code of ['mainWindow.webContents.send is not a function','overlay.bounds.width','Intl.DateTimeFormat could not','resources.pak and icudtl.dat','wc.getURL'])assert.ok(out.includes(code),code+' stays:\n'+out);
 for(const secret of ['therapist','clinic','portal.example','MacBook','printer','appointments','BANK','contract','JoSmith','budget','2025.pdf','MyBank'])assert.ok(!out.includes(secret),secret+' is gone:\n'+out);
});

test('5. Restart, then a quit called off ("Leave this site?" → Stay), then an ordinary quit within 2 minutes: no relaunch; the restart quit going on does relaunch',()=>{
 const {createRestart}=require('../desktop/restart.cjs');
 const app=Object.assign(new EventEmitter(),{relaunches:[],quit(){this.emit('before-quit');},relaunch(options){this.relaunches.push(options);}});
 let now=1e12;const restart=createRestart({app,now:()=>now,argv:['/Apps/Acira','--use-mock-keychain'],defaultApp:false,execPath:'/Apps/Acira'});
 restart.request();restart.calledOff();
 now+=30*1000;app.quit();app.emit('will-quit');
 assert.equal(app.relaunches.length,0,'Cmd+Q after the quit was called off is an ordinary quit');
 // the usual restart: every window's close is held for its question, so the quit that ends it comes from the last window closing, not from request()
 restart.request();now+=20*1000;app.quit();app.emit('will-quit');
 assert.equal(app.relaunches.length,1,'the restart still restarts');
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/closeGuard\.confirmWindowClose\(controller\)\.then\(ok=>\{closeGate\.asking=false;if\(!ok\)restart\.calledOff\(\);/,'Cancel on the close card calls the restart off');
 assert.equal((main.match(/closeGuard\.revoke\(\);restart\.calledOff\(\);/g)||[]).length,2,'so does a page that asked to stay, and a window that could not close');
 assert.equal((main.match(/closeGuard\.revoke\(\)/g)||[]).length,2);
});

test('6. a fresh start that fails never puts the old file back beside a log it did not move, and names where the old files really are',()=>{
 const setup=withLog=>{
  const file=path.join(folder(),'browser.sqlite');{const db=new BrowserDatabase(file);db.saveWindow('main',empty);db.close();}
  const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,whole.length>>1),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);
  if(withLog)fs.writeFileSync(file+'-wal','old log');
  return {file,damaged,aside:file+'.damaged-2026-11-03T00-00-00-000Z'};
 };
 const run=(file,{rm=()=>{},rename=()=>{}})=>{
  const errors=[],realRm=fs.rmSync,realRename=fs.renameSync;let calls=0;
  // armed once the new file was tried, so the first look at the old file cleans up after itself as usual
  fs.rmSync=(target,...rest)=>{if(calls>1)rm(target);return realRm(target,...rest);};fs.renameSync=(from,to)=>{if(calls>1)rename(from,to);return realRename(from,to);};
  try{
   const result=openBrowserDatabase({file,backups,supported:SCHEMA,now:()=>Date.UTC(2026,10,3),showError:(title,text)=>errors.push(text),quit(){},warn(){},choose:()=>'fresh',
    create:name=>{calls++;if(calls===1)return new BrowserDatabase(name);fs.writeFileSync(name,'half');fs.writeFileSync(name+'-wal','new log');throw Object.assign(new Error('disk I/O error'),{errcode:10});}});
   assert.equal(result,null);
  }finally{fs.rmSync=realRm;fs.renameSync=realRename;}
  return errors[0];
 };
 const busy=()=>Object.assign(new Error('EBUSY: resource busy or locked'),{code:'EBUSY'});
 // the old file had no log; the new file's log cannot be removed (a virus scanner holds it): the old file stays aside, never beside that log
 {const {file,damaged,aside}=setup(false);
  const text=run(file,{rm:target=>{if(target===file+'-wal')throw busy();}});
  assert.deepEqual(fs.readFileSync(aside),damaged,'the old file is kept aside');
  assert.ok(!(fs.existsSync(file)&&fs.readFileSync(file).equals(damaged)),'and not put back beside the new log');
  assert.doesNotMatch(text,/Nothing was changed/);assert.ok(text.includes(aside),text);}
 // the old file had a log, and the log cannot go back: the old file goes aside again with it, and the message names where they are
 {const {file,damaged,aside}=setup(true);
  const text=run(file,{rename:(from,to)=>{if(from===aside+'-wal'&&to===file+'-wal')throw busy();}});
  assert.deepEqual(fs.readFileSync(aside),damaged);assert.equal(fs.readFileSync(aside+'-wal','utf8'),'old log','the database and its log stay together');
  assert.doesNotMatch(text,/Nothing was changed/);assert.ok(text.includes(aside),text);}
 // and when even that cannot be done, the message names both real places
 {const {file,damaged,aside}=setup(true);
  const text=run(file,{rename:(from,to)=>{if(from===aside+'-wal'&&to===file+'-wal')throw busy();if(from===file&&to===aside)throw busy();}});
  assert.deepEqual(fs.readFileSync(file),damaged);assert.equal(fs.readFileSync(aside+'-wal','utf8'),'old log');
  assert.ok(text.includes(file+',')||text.includes(file+'”')||text.includes(file+'“'),text);assert.ok(text.includes(aside+'-wal'),text);}
});

test('7. clearing data also removes half copies an interrupted copy left (backups/*.sqlite.next, browser.sqlite.restoring)',()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',empty);
 fs.mkdirSync(backups.folderOf(file),{recursive:true});
 const half=[path.join(backups.folderOf(file),'browser-2026-11-02.sqlite.next'),path.join(backups.folderOf(file),'browser-before-v2.sqlite.next'),file+'.restoring'];
 for(const name of half)fs.writeFileSync(name,'cleared history');
 backups.forget(file);
 for(const name of half)assert.equal(fs.existsSync(name),false,path.basename(name)+' is gone');
 for(const name of half)fs.writeFileSync(name,'cleared history');
 backups.refresh(db);
 for(const name of half)assert.equal(fs.existsSync(name),false,path.basename(name)+' is gone after refresh too');
 db.close();
});
