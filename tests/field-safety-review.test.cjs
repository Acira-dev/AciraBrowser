'use strict';
// field-safety, second round (code review of the first): each case below was broken in the first round's code.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {BrowserDatabase,SCHEMA}=require('../desktop/database.cjs'),{readSavedWindow,salvage,createSavedWindowRecovery}=require('../desktop/saved-window.cjs');
const {restoreSnapshot,createInitialState,makeTab,persistedSnapshot,reduceBrowser}=require('../desktop/runtime.cjs');
const backups=require('../desktop/database-backups.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs'),{scrub}=require('../desktop/process-errors.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-review-'));
const tools={restoreSnapshot,createInitialState,makeTab};
const bookmark=(id,title,profileId,position=0)=>({id,type:'bookmark',title,url:'https://'+id+'.example/',parentId:null,position,browserProfileId:profileId});
const visit=(id,profileId,day)=>({id,url:'https://'+id+'.example/',title:id,time:new Date(Date.UTC(2026,10,day)).toISOString(),browserProfileId:profileId});

test('1. Start fresh takes bookmarks, history, downloads and profiles from the tables, never from an older window\'s record; the first save keeps them',()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);
 let state=createInitialState();const personal=state.activeBrowserProfileId;
 state=reduceBrowser(state,{type:'tab.new',url:'https://one.example/'});
 const work={...state.browserProfiles[0],id:'profile-work',name:'Work',partition:'persist:work'};
 // weeks ago: a window (closed since, its record never deleted) saved two profiles, one old bookmark, one old visit, a chosen setting
 const old={...state,browserProfiles:[...state.browserProfiles,work],settings:{...state.settings,searchEngine:'duckduckgo'},bookmarkNodes:[bookmark('old',`Old`,personal)],browsingHistory:[visit('old',personal,1),visit('work-visit','profile-work',1)]};
 db.saveWindow('window-old',persistedSnapshot(old));
 db.removeProfile('profile-work');
 // today: the main window has a new bookmark too, and a new visit
 const today={...state,bookmarkNodes:[bookmark('new','New',personal,0),bookmark('old','Old',personal,1)],browsingHistory:[visit('new',personal,3),visit('old',personal,1)]};
 db.saveWindow('main',persistedSnapshot(today));
 db.db.prepare("UPDATE windows SET payload='{\"tabs\":[' WHERE id='main'").run();
 const fresh=salvage({database:db,windowId:'main',...tools});
 assert.deepEqual(fresh.bookmarkNodes.map(b=>b.title).sort(),['New','Old'],'today\'s bookmarks, from the table');
 assert.deepEqual(fresh.browsingHistory.map(v=>v.id).sort(),['new','old']);
 assert.ok(!fresh.browserProfiles.some(p=>p.id==='profile-work'),'a removed profile does not come back');
 assert.ok(!fresh.browsingHistory.some(v=>v.browserProfileId==='profile-work'));
 assert.equal(fresh.settings.searchEngine,'duckduckgo','settings, which only records hold, come from the other window');
 db.saveWindow('main',persistedSnapshot(fresh));
 assert.deepEqual(db.db.prepare('SELECT payload FROM bookmarks ORDER BY position').all().map(r=>JSON.parse(r.payload).title),['New','Old'],'the first save keeps today\'s tables');
 assert.equal(db.db.prepare("SELECT count(*) AS n FROM profiles WHERE id='profile-work'").get().n,0);
 db.close();
});

test('2. clearing browsing data or removing a profile also deletes the copy before an update; the damaged and newer files set aside stay (third round)',()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',{browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[]});
 backups.take(db,{now:Date.now()-2*86400000});
 const before=path.join(backups.folderOf(file),'browser-before-v2.sqlite'),aside=[file+'.damaged-2026-11-03T10-00-00-000Z',file+'.damaged-2026-11-03T10-00-00-000Z-wal',file+'.newer-2026-11-02T10-00-00-000Z'];
 for(const name of [before,...aside])fs.writeFileSync(name,'history lives here');
 backups.refresh(db);
 assert.equal(fs.existsSync(before),false,'the copy before an update is gone');
 for(const name of aside)assert.ok(fs.existsSync(name),path.basename(name)+' stays: it may be the only copy');
 assert.deepEqual(backups.list(file).map(entry=>entry.day),[backups.dayOf(Date.now())],'one fresh daily copy');
 assert.ok(fs.existsSync(file),'the profile itself stays');
 fs.writeFileSync(before,'again');backups.forget(file);
 assert.equal(fs.existsSync(before),false);for(const name of aside)assert.ok(fs.existsSync(name));
 db.close();
});

test('3. the log scrubber also removes host names without a scheme, unquoted paths with spaces, UNC paths and IPv6 addresses; stack lines stay readable',()=>{
 const text=[
  'Error: getaddrinfo ENOTFOUND my-therapist-portal.com',
  'Error: queryCname ENOTFOUND clinic.example.net',
  "Hostname/IP does not match certificate's altnames: Host: secret.example.org. is not in the cert's altnames",
  'failed to load bank.example.com/account?id=12345 in time',
  'EPERM: could not copy D:\\Taxes 2025\\Jo Smith divorce papers.pdf',
  'could not open /Volumes/Backup Drive/Jo Smith/medical.pdf',
  'saving \\\\fileserver\\home$\\jsmith\\report final.docx failed',
  'connect ECONNREFUSED fe80::1ff:fe23:4567:890a%en0 and 2001:db8:0:0:0:0:2:1 and [::1]:8080',
  'TypeError: Cannot read properties of undefined (reading \'webContents\')',
  '    at Object.persist (/Applications/Acira Browser.app/Contents/Resources/app.asar/desktop/main.cjs:992:120)',
  '    at node:internal/process/task_queues:95:5',
  'EACCES writing /Users/jo/Library/Application Support/AciraBrowser/window-state.json',
  'Widevine 4.10.3112.0 failed at 14:44:36',
 ].join('\n');
 const out=scrub(text,{app:'/Applications/Acira Browser.app/Contents/Resources/app.asar',profile:'/Users/jo/Library/Application Support/AciraBrowser',home:'/Users/jo',temp:'/var/folders/T'});
 for(const secret of ['therapist','clinic','secret.example','bank.example','12345','Taxes','Jo Smith','divorce','medical','Backup Drive','fileserver','jsmith','report final','fe80','2001:db8','::1'])assert.ok(!out.includes(secret),secret+' is gone:\n'+out);
 assert.match(out,/ {4}at Object\.persist \(<app>\/desktop\/main\.cjs:992:120\)/,'Acira\'s own stack frames stay readable');
 assert.match(out,/node:internal\/process\/task_queues:95:5/);
 assert.match(out,/EACCES writing <profile>\/window-state\.json/);
 assert.match(out,/Widevine 4\.10\.3112\.0 failed at 14:44:36/);
});

test('4. a read that fails because the database is busy or locked is tried again and never offers Start fresh; damage or unreadable text does (any other failure too: third round)',async()=>{
 const file=path.join(folder(),'browser.sqlite'),db=new BrowserDatabase(file);db.saveWindow('main',persistedSnapshot(createInitialState()));
 const real=db.readWindow.bind(db);let failures=2;
 db.readWindow=id=>{if(failures-->0)throw Object.assign(new Error('database is locked'),{errcode:5});return real(id);};
 const read=await readSavedWindow({database:db,windowId:'main',restoreSnapshot,pause:async()=>{}});
 assert.ok(read.snapshot,'read on the third try');
 db.readWindow=()=>{throw Object.assign(new Error('database is locked'),{errcode:5});};
 const io=await readSavedWindow({database:db,windowId:'main',restoreSnapshot,pause:async()=>{}});
 assert.ok(io.unavailable&&!io.damaged,'a database that stays locked is not damage');
 db.readWindow=()=>{throw Object.assign(new Error('database disk image is malformed'),{errcode:11});};
 assert.ok((await readSavedWindow({database:db,windowId:'main',restoreSnapshot,pause:async()=>{}})).damaged);
 db.readWindow=()=>{throw new SyntaxError('Unterminated string in JSON');};
 assert.ok((await readSavedWindow({database:db,windowId:'main',restoreSnapshot,pause:async()=>{}})).damaged);
 // the passing failure is explained once and Acira quits: no question, nothing copied, nothing written
 let asked=0,explained=0,quits=0;const before=fs.readdirSync(path.dirname(file)).sort();
 const recovery=createSavedWindowRecovery({database:db,...tools,asideName:backups.asideName,ask:async()=>{asked++;return 'fresh';},quit:()=>{quits++;},explain:()=>{explained++;},warn:()=>{}});
 await Promise.all([recovery.unavailable('main',io.unavailable),recovery.unavailable('window-2',io.unavailable)]);
 assert.equal(asked,0);assert.equal(explained,1);assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(),before);
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/const saved=await require\('\.\/saved-window\.cjs'\)\.readSavedWindow\(\{database,windowId,restoreSnapshot\}\);if\(saved\?\.unavailable\)\{recordUnreadable=true;await savedWindows\(\)\.unavailable\(windowId,saved\.unavailable\);throw /);
 db.close();
});

test('5. a fresh start that cannot make a new file puts the old one back even when the half-made file cannot be removed, and never leaves a log beside a missing file',()=>{
 const file=path.join(folder(),'browser.sqlite');{const db=new BrowserDatabase(file);db.saveWindow('main',{browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[]});db.close();}
 const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,whole.length>>1),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);fs.writeFileSync(file+'-wal','log');
 const errors=[];let calls=0;const realRm=fs.rmSync;
 fs.rmSync=(target,...rest)=>{if(target===file)throw Object.assign(new Error('EBUSY: resource busy or locked'),{code:'EBUSY'});return realRm(target,...rest);};
 try{
  const result=openBrowserDatabase({file,backups,supported:SCHEMA,now:()=>Date.UTC(2026,10,3),showError:(title,text)=>errors.push(text),quit(){},warn(){},choose:()=>'fresh',
   create:name=>{calls++;if(calls===1)return new BrowserDatabase(name);fs.writeFileSync(name,'half');throw Object.assign(new Error('disk I/O error'),{errcode:10});}});
  assert.equal(result,null);
 }finally{fs.rmSync=realRm;}
 assert.deepEqual(fs.readFileSync(file),damaged,'the old file is back');assert.equal(fs.readFileSync(file+'-wal','utf8'),'log','with its log');
 assert.match(errors[0],/Nothing was changed or deleted/);
 // the trio moves together: when the main file cannot be moved, its log is put back beside it, never left beside a missing file
 const dir=folder(),main=path.join(dir,'browser.sqlite');fs.writeFileSync(main,'main');fs.writeFileSync(main+'-wal','wal');
 const realRename=fs.renameSync;fs.renameSync=(from,to)=>{if(from===main)throw Object.assign(new Error('EPERM'),{code:'EPERM'});return realRename(from,to);};
 try{assert.throws(()=>backups.setAside(main,main+'.damaged-x'),/EPERM/);}finally{fs.renameSync=realRename;}
 assert.equal(fs.readFileSync(main,'utf8'),'main');assert.equal(fs.readFileSync(main+'-wal','utf8'),'wal');
 // and when putting back fails for the main file, the log stays aside with it
 const moved=backups.setAside(main,main+'.damaged-y');fs.renameSync=(from,to)=>{if(to===main)throw Object.assign(new Error('EPERM'),{code:'EPERM'});return realRename(from,to);};
 try{backups.putBack(main,main+'.damaged-y',moved);}finally{fs.renameSync=realRename;}
 assert.ok(!(fs.existsSync(main+'-wal')&&!fs.existsSync(main)),'no log beside a missing file');
});

test('6. Restart Acira relaunches only once the quit is really happening, with no link or web-app arguments, and a quit called off does not restart later',()=>{
 const {createRestart,restartArgs}=require('../desktop/restart.cjs');
 const app=Object.assign(new EventEmitter(),{quits:0,relaunches:[],quit(){this.quits++;},relaunch(options){this.relaunches.push(options);}});
 let now=1e12;const restart=createRestart({app,now:()=>now,argv:['/Apps/Acira','--use-mock-keychain','https://example.com/','--acira-app=abc','--acira-installer-quit','-psn_0_1234'],defaultApp:false,execPath:'/Apps/Acira'});
 restart.request();assert.equal(app.quits,1);assert.equal(app.relaunches.length,0,'not before the quit is happening');
 app.emit('will-quit');assert.deepEqual(app.relaunches,[{execPath:'/Apps/Acira',args:['--use-mock-keychain']}]);
 app.emit('will-quit');assert.equal(app.relaunches.length,1,'once');
 // a quit called off ("Leave this site?" → Stay): a quit much later is an ordinary one
 restart.request();now+=10*60*1000;app.emit('will-quit');assert.equal(app.relaunches.length,1);
 assert.deepEqual(restartArgs(['/electron','--use-mock-keychain','--inspect=9','/repo','https://a.example/'],{defaultApp:true}),['--use-mock-keychain','--inspect=9','/repo'],'from source, the app folder stays, wherever Electron put it');
 assert.deepEqual(restartArgs(['/electron','/repo','--inspect=9'],{defaultApp:true}),['/repo','--inspect=9']);
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const body=main.slice(main.indexOf('function interfaceStopped(){'),main.indexOf('function interfaceStopped(){')+900);
 assert.doesNotMatch(body,/app\.relaunch\(/);assert.match(body,/restart\.request\(\)/);
});

test('7. "Acira could not start" after a failed load speaks the system language, before any translator is set up',()=>{
 const {installEarly,systemLocale}=require('../desktop/process-errors.cjs');
 assert.equal(systemLocale({env:{LANG:'de_DE.UTF-8'}}),'de-DE');
 assert.equal(systemLocale({env:{LANG:'C'},app:{getPreferredSystemLanguages:()=>['ja-JP']}}),'ja-JP');
 assert.equal(systemLocale({env:{},app:{getPreferredSystemLanguages:()=>[]},intl:()=>'fr-FR'}),'fr-FR');
 const shown=[],source=new EventEmitter(),dir=folder();
 installEarly({source,env:{LANG:'de_DE.UTF-8',ACIRA_BROWSER_TEST_DATA:dir},electron:()=>({app:{exit(){},getPreferredSystemLanguages:()=>['en-US']},dialog:{showErrorBox:(title,text)=>shown.push([title,text])}})});
 source.emit('uncaughtException',new Error("Cannot find module './x.cjs'"));
 assert.equal(shown[0][0],'Acira konnte nicht starten');
 require('../desktop/i18n.cjs').setMainLocale('system','en-US');
});

test('8. temporary files left by an earlier run (a crash before the rename) are removed, and a busy rename is retried only briefly',()=>{
 const {writeFileAtomic}=require('../desktop/atomic-file.cjs');
 const dir=folder(),file=path.join(dir,'window-state.json');
 for(const name of ['window-state.json.4242-1.tmp','window-state.json.4242-2.tmp'])fs.writeFileSync(path.join(dir,name),'{"half":');
 fs.writeFileSync(path.join(dir,'other.json.4242-1.tmp'),'not ours');
 writeFileAtomic(file,'{}');
 assert.deepEqual(fs.readdirSync(dir).sort(),['other.json.4242-1.tmp','window-state.json']);
 const waits=[];const busy={...fs,renameSync:()=>{throw Object.assign(new Error('EBUSY'),{code:'EBUSY'});}};
 assert.throws(()=>writeFileAtomic(file,'{"x":1}',{fileSystem:busy,wait:ms=>waits.push(ms)}),/EBUSY/);
 assert.ok(waits.reduce((a,b)=>a+b,0)<=60,'the main thread waits at most a few tens of milliseconds: '+waits.join(','));
 assert.equal(fs.readFileSync(file,'utf8'),'{}');
});

test('9. the question window: a page that died after it was given up on cannot clear the question now asked in a new window, and a given-up page is closed',async()=>{
 const {createAppDialog}=require('../desktop/app-dialog.cjs');
 const ipcMain=new EventEmitter(),pages=[];let loads=0;
 class FakeContents extends EventEmitter{constructor(){super();this.sent=[];this.closed=false;pages.push(this);}setWindowOpenHandler(){}
  loadURL(){if(++loads>1)setImmediate(()=>this.emit('did-finish-load'));return Promise.resolve();}
  send(channel,payload){this.sent.push(payload);if(channel==='acira:dialog-init')setImmediate(()=>ipcMain.emit('acira:dialog-ready',{sender:this},180));}
  focus(){}executeJavaScript(){return Promise.resolve();}isDestroyed(){return this.closed;}close(){this.closed=true;}}
 class FakeView{constructor(){this.webContents=new FakeContents();}setBounds(){}}
 class FakeWindow extends EventEmitter{constructor(){super();this.destroyed=false;this.contentView={addChildView(){}};}isDestroyed(){return this.destroyed;}destroy(){if(!this.destroyed){this.destroyed=true;this.emit('closed');}}
  setContentSize(){}setPosition(){}show(){}hide(){}moveTop(){}setParentWindow(){}getBounds(){return {x:0,y:0,width:800,height:600};}}
 const dialog=createAppDialog({BaseWindow:FakeWindow,WebContentsView:FakeView,ipcMain,nativeTheme:{shouldUseDarkColors:false},preload:'',pageURL:'x',loadTimeout:30,fallback:{showMessageBox:async()=>({response:-1})}});
 const parent=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getBounds:()=>({x:0,y:0,width:800,height:600})});
 const asking=dialog.showMessageBox(parent,{message:'Open this file?',buttons:['Open','Cancel'],cancelId:1});
 await new Promise(resolve=>setTimeout(resolve,80));
 assert.equal(pages.length,2,'the first page never loaded and was given up on');assert.equal(pages[0].closed,true,'and closed');
 assert.equal(pages[1].sent.at(-1).title,'Open this file?');
 pages[0].emit('render-process-gone',{},{reason:'killed'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pages.length,2,'the old page dying does not ask again');
 ipcMain.emit('acira:dialog-respond',{sender:pages[1]},0);
 assert.deepEqual(await asking,{response:0,checkboxChecked:false});
});
