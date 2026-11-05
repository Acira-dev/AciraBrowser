'use strict';
// field-safety: a view whose page dies is shown again or answered, never left blank with something waiting on it for good.
// - The question window (desktop/app-dialog.cjs): its renderer dying used to leave the question unanswered, and every later question queued behind it.
// - The site prompt card (desktop/site-prompt.cjs): the same, for permissions, "Leave this site?" and "Close Acira?".
// - The interface views (main.cjs createUI): reloaded three times a minute as before; after that an empty window used to be all that was left.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAppDialog}=require('../desktop/app-dialog.cjs'),{createSitePrompt}=require('../desktop/site-prompt.cjs');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const tick=async(times=6)=>{for(let i=0;i<times;i++)await new Promise(resolve=>setImmediate(resolve));};

/** Fakes for the question window: a page that loads at once and reports its height; the test answers or crashes it. */
function dialogHarness(){
 const ipcMain=new EventEmitter(),pages=[],windows=[];
 class FakeContents extends EventEmitter{constructor(){super();this.sent=[];pages.push(this);}setWindowOpenHandler(){}loadURL(){setImmediate(()=>this.emit('did-finish-load'));return Promise.resolve();}
  send(channel,payload){this.sent.push(payload);if(channel==='acira:dialog-init')setImmediate(()=>ipcMain.emit('acira:dialog-ready',{sender:this},180));}
  focus(){}executeJavaScript(){return Promise.resolve();}answer(index){ipcMain.emit('acira:dialog-respond',{sender:this},index);}crash(){this.emit('render-process-gone',{},{reason:'crashed',exitCode:11});}}
 class FakeView{constructor(){this.webContents=new FakeContents();}setBounds(){}}
 class FakeWindow extends EventEmitter{constructor(){super();this.destroyed=false;this.contentView={addChildView(){}};windows.push(this);}isDestroyed(){return this.destroyed;}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
  setContentSize(){}setPosition(){}show(){this.shown=true;}hide(){}moveTop(){}setParentWindow(){}getBounds(){return {x:0,y:0,width:800,height:600};}}
 const dialog=createAppDialog({BaseWindow:FakeWindow,WebContentsView:FakeView,ipcMain,nativeTheme:{shouldUseDarkColors:false},preload:'',pageURL:'acira-browser-ui://ui/native-dialog.html',fallback:{showMessageBox:async()=>({response:-1})}});
 return {dialog,pages,windows,ipcMain};
}
const question={type:'question',message:'Open this file?',buttons:['Open','Cancel'],defaultId:0,cancelId:1};
const parent=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getBounds:()=>({x:0,y:0,width:800,height:600})});

test('the question window: a page that dies while asking is asked again in a new window, and the answer reaches the caller',async()=>{
 const h=dialogHarness(),asking=h.dialog.showMessageBox(parent,question);
 await tick();assert.equal(h.pages.length,1);assert.equal(h.pages[0].sent.at(-1).title,'Open this file?');
 h.pages[0].crash();await tick();
 assert.equal(h.windows[0].destroyed,true,'the dead window is thrown away');assert.equal(h.pages.length,2,'a new one is made');
 assert.equal(h.pages[1].sent.at(-1).title,'Open this file?','and the same question is shown in it');
 h.pages[1].answer(0);assert.deepEqual(await asking,{response:0,checkboxChecked:false});
 // the next question is not stuck behind the old one, and uses the new window
 const next=h.dialog.showMessageBox(parent,{...question,message:'Next one'});await tick();
 assert.equal(h.pages[1].sent.at(-1).title,'Next one');h.pages[1].answer(1);assert.equal((await next).response,1);
 assert.equal(h.ipcMain.listenerCount('acira:dialog-respond'),1,'the dead window\'s listeners went with it');
});

test('the question window: a page that keeps dying is answered the safe way (cancel), and later questions still get asked',async()=>{
 const h=dialogHarness(),asking=h.dialog.showMessageBox(parent,question);
 await tick();h.pages[0].crash();await tick();h.pages[1].crash();await tick();
 assert.deepEqual(await asking,{response:1,checkboxChecked:false,dismissed:true});
 const later=h.dialog.showMessageBox(parent,question);await tick();h.pages.at(-1).answer(0);assert.equal((await later).response,0);
});

/** Fakes for the site prompt card, as tests/site-prompt.test.cjs plays them: the page says it is ready, reports its height, and answers. */
function cardHarness(){
 let state=createInitialState();state=reduceBrowser(state,{type:'tab.new',url:'https://one.test/'});
 const views=[],children=[];
 class FakeContents extends EventEmitter{constructor(){super();this.ipc=new EventEmitter();this.sent=[];this.destroyed=false;}
  loadFile(){setImmediate(()=>this.ipc.emit('acira:site-prompt',{},{type:'ready'}));return Promise.resolve();}
  send(channel,message){this.sent.push(message);if(message.type==='show')setImmediate(()=>this.ipc.emit('acira:site-prompt',{},{type:'size',token:message.token,height:130}));}
  setZoomFactor(){}setWindowOpenHandler(){}isDestroyed(){return this.destroyed;}close(){this.destroyed=true;}focus(){}isFocused(){return false;}
  answer(message){this.ipc.emit('acira:site-prompt',{},message);}crash(){this.emit('render-process-gone',{},{reason:'crashed',exitCode:11});}}
 class FakeView{constructor(){this.webContents=new FakeContents();views.push(this);}setBounds(){}setVisible(){}setBackgroundColor(){}}
 const win={isDestroyed:()=>false,isFocused:()=>true,contentView:{children,getBounds:()=>({x:0,y:0,width:1200,height:800}),addChildView(v){if(!children.includes(v))children.push(v);},removeChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);}}};
 const card=createSitePrompt({WebContentsView:FakeView,getWindow:()=>win,getState:()=>state,anchorOf:async()=>({x:96,y:36,width:28,height:28}),pageBounds:()=>({x:0,y:72,width:1200,height:728}),reducedMotion:()=>true,say:id=>id});
 return {card,views,shows:index=>views[index].webContents.sent.filter(m=>m.type==='show')};
}
const permission={type:'question',popover:true,message:'example.com wants to send you notifications',buttons:['Block','Allow'],defaultId:0,cancelId:0,site:{host:'example.com'}};

test('the site prompt card: a card whose page dies is shown again on a new card, and the answer reaches the site',async()=>{
 const h=cardHarness(),asking=h.card.showMessageBox(permission);
 await new Promise(resolve=>setTimeout(resolve,30));await tick();
 assert.equal(h.shows(0).length,1);const token=h.shows(0)[0].token;
 h.views[0].webContents.crash();await new Promise(resolve=>setTimeout(resolve,30));await tick();
 assert.equal(h.views[0].webContents.destroyed,true);assert.equal(h.views.length,2,'a new card view');
 assert.equal(h.shows(1).length,1);assert.equal(h.shows(1)[0].token,token,'the same request, shown again');
 h.views[1].webContents.answer({type:'answer',token,index:1});
 assert.equal((await asking).response,1);
});

test('the site prompt card: when it keeps dying (three times in a minute) the waiting requests are answered the safe way, never left waiting',async()=>{
 const h=cardHarness(),first=h.card.showMessageBox(permission),second=h.card.showMessageBox({...permission,message:'example.com wants your location'});
 for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,30));await tick();h.views.at(-1).webContents.crash();}
 const answers=await Promise.all([first,second]);
 assert.deepEqual(answers.map(a=>[a.response,a.dismissed]),[[0,true],[0,true]]);
 assert.equal(h.card.pending,0);
});

test('the interface views: past three reloads a minute, one calm question per window, Restart Acira or Later',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/if\(uiCrashTimes\.length>=3\)\{interfaceStopped\(\);return;\}uiCrashTimes\.push\(now\);/,'the reload limit stays three a minute, then the question');
 assert.match(main,/function interfaceStopped\(\)\{if\(interfaceStoppedShown\|\|quitting\|\|windowClosing\)return;interfaceStoppedShown=true;/,'once per window');
 assert.match(main,/buttons:\[tm\('main\.restartButton'\),tm\('update\.later'\)\],defaultId:0,cancelId:1,noLink:true\}/);
 assert.match(main,/if\(response===0&&!quitting\)restart\.request\(\);/,'a restart is an ordinary quit (everything saved), relaunched once the quit happens (restart.cjs)');
 assert.match(main,/processErrors\.record\('Interface view stopped',kind\+' view: '\+details\.reason/,'each stop is written to main.log, without any address');
});

test('in a real Electron process the question window\'s renderer is killed while it asks, and the question still gets its answer',async t=>{
 const electron=require('electron');
 if(typeof electron!=='string'||!fs.existsSync(electron)){t.skip('no Electron binary');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-dead-dialog-')),script=path.join(dir,'main.cjs'),out=path.join(dir,'result.json');
 // the page answers "button 0" as soon as it is asked; the first page is killed before it can
 const page='data:text/html,'+encodeURIComponent('<script>aciraDialog.onInit(()=>{aciraDialog.ready(150);setTimeout(()=>aciraDialog.respond(0),400);});</script>');
 fs.writeFileSync(script,`const {app,BaseWindow,WebContentsView,ipcMain,nativeTheme}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});
const {createAppDialog}=require(${JSON.stringify(path.join(__dirname,'../desktop/app-dialog.cjs'))});
app.whenReady().then(async()=>{
 const d=createAppDialog({BaseWindow,WebContentsView,ipcMain,nativeTheme,preload:${JSON.stringify(path.join(__dirname,'../desktop/dialog-preload.cjs'))},pageURL:${JSON.stringify(page)},fallback:{showMessageBox:async()=>({response:-1})}});
 const parent=new BaseWindow({width:600,height:400,show:false});let killed=0;
 ipcMain.on('acira:dialog-ready',event=>{if(!killed++){if(process.platform==='linux')process.kill(event.sender.getOSProcessId(),'SIGKILL');else event.sender.forcefullyCrashRenderer();}});
 const asked=d.showMessageBox(parent,{message:'Keep this file?',buttons:['Keep','Cancel'],defaultId:0,cancelId:1});
 const result=await Promise.race([asked,new Promise(r=>setTimeout(()=>r({timeout:true}),20000))]);
 require('fs').writeFileSync(${JSON.stringify(out)},JSON.stringify({result,killed}));d.dispose();app.exit(0);
});`);
 const {spawnSync}=require('node:child_process');const env={...process.env,HOME:dir,ACIRA_BROWSER_TEST_DATA:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,['--use-mock-keychain',script],{env,timeout:40000,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr.slice(-500));
 const {result,killed}=JSON.parse(fs.readFileSync(out,'utf8'));
 assert.equal(killed,2,'the first page was killed when it was ready; a second page was made and asked');
 assert.deepEqual(result,{response:0,checkboxChecked:false},'answered by the new page, not left waiting');
 fs.rmSync(dir,{recursive:true,force:true});
});

test('in a real Electron process the site prompt card\'s renderer is killed while it shows, and a new card shows the same request',async t=>{
 const electron=require('electron');
 if(typeof electron!=='string'||!fs.existsSync(electron)){t.skip('no Electron binary');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-dead-card-')),script=path.join(dir,'main.cjs'),out=path.join(dir,'result.json');
 fs.writeFileSync(script,`const {app,BaseWindow,WebContentsView}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});
const {createSitePrompt}=require(${JSON.stringify(path.join(__dirname,'../desktop/site-prompt.cjs'))});const {createInitialState}=require(${JSON.stringify(path.join(__dirname,'../desktop/runtime.cjs'))});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BaseWindow({width:900,height:700,show:false}),state=createInitialState();
 const card=createSitePrompt({WebContentsView,getWindow:()=>win,getState:()=>state,reducedMotion:()=>true,say:id=>id});
 const asked=card.showMessageBox({type:'question',message:'Leave this site?',buttons:['Leave','Stay'],defaultId:0,cancelId:1,site:{host:'example.com',centered:true}});
 for(let i=0;i<100&&!card.visible;i++)await wait(50);
 const first={visible:card.visible,token:card.current?.token,contents:card.webContents?.id};
 if(process.platform==='linux')process.kill(card.webContents.getOSProcessId(),'SIGKILL');else card.webContents.forcefullyCrashRenderer();
 for(let i=0;i<20;i++){await wait(50);if(!card.visible)break;}
 for(let i=0;i<100&&!(card.visible&&card.webContents?.id!==first.contents);i++)await wait(50);
 const second={visible:card.visible,token:card.current?.token,contents:card.webContents?.id};
 card.webContents.ipc.emit('acira:site-prompt',{},{type:'answer',token:second.token,index:0});
 const result=await Promise.race([asked,wait(5000).then(()=>({timeout:true}))]);
 require('fs').writeFileSync(${JSON.stringify(out)},JSON.stringify({first,second,result}));card.dispose();app.exit(0);
});`);
 const {spawnSync}=require('node:child_process');const env={...process.env,HOME:dir,ACIRA_BROWSER_TEST_DATA:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,['--use-mock-keychain',script],{env,timeout:40000,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr.slice(-500));
 const {first,second,result}=JSON.parse(fs.readFileSync(out,'utf8'));
 assert.equal(first.visible,true,'the card was on screen');
 assert.equal(second.visible,true,'a card is on screen again after its page was killed');assert.notEqual(second.contents,first.contents,'on a new page');
 assert.equal(second.token,first.token,'showing the same request');
 assert.deepEqual(result,{response:0,checkboxChecked:false},'and the answer reached the caller');
 fs.rmSync(dir,{recursive:true,force:true});
});
