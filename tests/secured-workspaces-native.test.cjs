'use strict';
// R3-38 secured workspaces, the main-process half (docs/launch/SECURED_WORKSPACES.md rows marked "native").
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createSecuredVault}=require('../desktop/browser-services/secured-vault.cjs');
const {createSecuredWorkspaces,lockMinutes}=require('../desktop/secured-workspaces.cjs');
const {createGate,windowsVerifier}=require('../desktop/passwords/gate.cjs');
const {validateAction}=require('../desktop/validation.cjs');

const MARK='secret-marker-91c2',root=path.join(__dirname,'..');
/** A DPAPI stand-in: wraps with a fixed XOR so a test can tell the key file is not the raw key. */
const keys={available:()=>true,wrap:buf=>Buffer.from(buf.map(b=>b^0x5a)),unwrap:buf=>Buffer.from(buf.map(b=>b^0x5a))};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-secured-'));
function scan(dir,needle){const hits=[];const walk=d=>{for(const name of fs.readdirSync(d)){const file=path.join(d,name),stat=fs.statSync(file);if(stat.isDirectory())walk(file);else{const raw=fs.readFileSync(file);if(raw.includes(Buffer.from(needle,'utf8'))||raw.includes(Buffer.from(needle,'utf16le')))hits.push(file);}}};walk(dir);return hits;}
const tab=(id,ws,extra={})=>({id,url:`https://${MARK}.test/${id}`,title:`Title ${MARK} ${id}`,history:[`https://${MARK}.test/${id}`],historyIndex:0,privacy:'secured',workspaceId:ws,browserProfileId:'profile-personal',...extra});

test('row 2 at rest: the sealed file holds no readable address or title (disk scan), and reads back exactly', () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys});
    vault.write('workspace-h',{tabs:[tab('t1','workspace-h'),tab('t2','workspace-h')],activeId:'t2'});
    // Control: the same bytes unsealed would be found; the scan itself works.
    fs.writeFileSync(path.join(dir,'control.txt'),MARK);
    assert.deepEqual(scan(dir,MARK).map(file=>path.basename(file)),['control.txt'],'only the control file holds the marker');
    fs.rmSync(path.join(dir,'control.txt'));
    const back=createSecuredVault({dir,keys}).read('workspace-h');
    assert.deepEqual(back.tabs.map(item=>item.id),['t1','t2']);assert.equal(back.activeId,'t2');
    assert.ok(back.tabs[0].title.includes(MARK));
    const keyFile=JSON.parse(fs.readFileSync(path.join(dir,'master.key'),'utf8'));
    assert.ok(keyFile.wrapped&&!fs.readFileSync(path.join(dir,'master.key'),'utf8').includes('"key"'),'the key is stored wrapped only');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a damaged or foreign sealed file is never read as data and never overwritten', () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys});vault.write('workspace-h',{tabs:[tab('t1','workspace-h')]});
    const file=path.join(dir,'workspace-h.vault'),raw=JSON.parse(fs.readFileSync(file,'utf8'));
    raw.ct=Buffer.from(Buffer.from(raw.ct,'base64').map((b,i)=>i===0?b^1:b)).toString('base64');fs.writeFileSync(file,JSON.stringify(raw));
    const fresh=createSecuredVault({dir,keys});
    assert.throws(()=>fresh.read('workspace-h'),{code:'corrupt'});
    const before=fs.readFileSync(file,'utf8');
    assert.throws(()=>fresh.write('workspace-h',{tabs:[]}),{code:'corrupt'});
    assert.equal(fs.readFileSync(file,'utf8'),before,'left exactly as it was');
    // A file sealed for one workspace can't be passed off as another's (the workspace id is in the authenticated data).
    vault.write('workspace-a',{tabs:[tab('x','workspace-a')]});fs.copyFileSync(path.join(dir,'workspace-a.vault'),path.join(dir,'workspace-b.vault'));
    assert.throws(()=>createSecuredVault({dir,keys}).read('workspace-b'),{code:'corrupt'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

/** A fake window controller: the reducer is the real one (desktop/runtime.cjs is built from src/runtime/core.ts). */
function fakeWindow(state){const c={privateMode:false,webApp:null,state,window:{isDestroyed:()=>false,protected:null,setContentProtection(on){this.protected=on;}},actions:[],commitAction(action){c.actions.push(action);if(action.type==='workspace.secured-lock'){const ws=c.state.workspaces.find(w=>w.id===action.id);if(ws)delete ws.unlocked;c.state.tabs=c.state.tabs.filter(t=>t.workspaceId!==action.id);}if(action.type==='workspace.secured-unlock'){const ws=c.state.workspaces.find(w=>w.id===action.id);ws.unlocked=true;c.state.tabs.push(...action.tabs.map(t=>({...t,privacy:'secured',workspaceId:action.id,browserProfileId:'profile-personal'})));}}};return c;}
const stateWith=(unlocked=true)=>({activeBrowserProfileId:'profile-personal',activeWorkspaceId:'workspace-h',activeTabId:'t1',settings:{},windowUi:{},workspaces:[{id:'workspace-default',name:'',browserProfileId:'profile-personal'},{id:'workspace-h',name:'Health',browserProfileId:'profile-personal',secured:true,...(unlocked?{unlocked:true}:{})}],tabs:[{id:'m1',url:'https://main.test/',browserProfileId:'profile-personal'},tab('t1','workspace-h')]});
const timers={setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},setInterval:()=>null,clearInterval(){}};

test('row 3 suspend-on-lock: lock seals FIRST, then removes the tabs; a failed seal hides nothing and loses nothing', () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys}),c=fakeWindow(stateWith()),service=createSecuredWorkspaces({controllers:new Set([c]),vault,gate:{ensure:async()=>({ok:true})},timers});
    assert.equal(service.lock('workspace-h','manual'),true);
    assert.deepEqual(c.actions.map(a=>a.type),['workspace.secured-lock']);
    assert.ok(!c.state.tabs.some(t=>t.workspaceId==='workspace-h'),'its tabs left the window');
    assert.deepEqual(vault.read('workspace-h').tabs.map(t=>t.id),['t1'],'and they are in the sealed file');
    // Failure path: the vault can't write -> no lock action, a toast, the tabs stay.
    const c2=fakeWindow(stateWith()),broken={...vault,write(){throw Object.assign(new Error('x'),{code:'unavailable'});}};
    const s2=createSecuredWorkspaces({controllers:new Set([c2]),vault:broken,gate:{ensure:async()=>({ok:true})},timers});
    assert.equal(s2.lock('workspace-h'),false);
    assert.deepEqual(c2.actions.map(a=>a.type),['toast']);
    assert.ok(c2.state.tabs.some(t=>t.id==='t1'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('row 6 unlock gate: a denied Windows check opens nothing; the test substitute only works unpackaged in a test profile', async () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys});vault.write('workspace-h',{tabs:[tab('t1','workspace-h')]});
    const denyGate=createGate({verify:windowsVerifier({env:{ACIRA_PASSWORDS_TEST_GATE:'deny',ACIRA_BROWSER_TEST_DATA:dir},packaged:false}),windowMs:0});
    const c=fakeWindow(stateWith(false));c.state.tabs=c.state.tabs.filter(t=>t.workspaceId!=='workspace-h');
    const denied=await createSecuredWorkspaces({controllers:new Set([c]),vault,gate:denyGate,timers}).unlock('workspace-h',c);
    assert.equal(denied.ok,false);assert.equal(c.actions.length,0,'no unlock action without the check');
    // Packaged builds ignore the switch entirely (fail closed to the real prompt, which a test never reaches here).
    const packaged=windowsVerifier({env:{ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_BROWSER_TEST_DATA:dir},packaged:true,platform:'linux'});
    assert.equal((await packaged('secured')).ok,false);
    const allowGate=createGate({verify:windowsVerifier({env:{ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_BROWSER_TEST_DATA:dir},packaged:false}),windowMs:0});
    const opened=await createSecuredWorkspaces({controllers:new Set([c]),vault,gate:allowGate,timers}).unlock('workspace-h',c);
    assert.equal(opened.ok,true);assert.deepEqual(c.actions.map(a=>a.type),['workspace.secured-unlock']);
    assert.deepEqual(c.actions[0].tabs.map(t=>t.id),['t1']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('row 1 partition isolation: one memory-only session per secured workspace, never persist:, never a profile\'s', () => {
  const service=createSecuredWorkspaces({controllers:new Set(),vault:{},gate:{},run:'r1'});
  const a=service.profileFor({workspaceId:'workspace-h'},{color:'#123456'}),b=service.profileFor({workspaceId:'workspace-h'},{}),other=service.profileFor({workspaceId:'workspace-w'},{});
  assert.equal(a,b,'tabs of one workspace share its session (one sign-in for the workspace)');
  assert.notEqual(a.partition,other.partition,'two secured workspaces never share');
  assert.ok(!a.partition.startsWith('persist:'),'memory only: nothing of the page storage is written');
  assert.ok(a.id.startsWith('private-'),'the private- id prefix: permissions, downloads, spelling, favicons and blocking keep nothing');
  assert.notEqual(createSecuredWorkspaces({controllers:new Set(),vault:{},gate:{}}).profileFor({workspaceId:'workspace-h'},{}).partition,a.partition,'a new run never reuses an old session');
});

test('lock triggers: leaving the workspace locks it; minimise / Windows lock / idle lock everything; the window stays out of capture while a secured page shows', () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys}),c=fakeWindow(stateWith()),handlers={};
    const power={on:(event,fn)=>{handlers[event]=fn;},getSystemIdleTime:()=>301};
    const service=createSecuredWorkspaces({controllers:new Set([c]),vault,gate:{},timers,powerMonitor:power});
    service.protect(c);assert.equal(c.window.protected,true,'a secured page on screen: excluded from screen capture and thumbnails');
    const previous=c.state,next={...c.state,activeWorkspaceId:'workspace-default',activeTabId:'m1'};c.state=next;
    service.afterAction(c,previous,next,{type:'workspace.select',id:'workspace-default'});
    assert.ok(c.actions.some(a=>a.type==='workspace.secured-lock'&&a.reason==='leave'));
    assert.equal(c.window.protected,false);
    for(const event of ['lock-screen','suspend'])assert.equal(typeof handlers[event],'function',`locks on ${event}`);
    const c2=fakeWindow(stateWith()),s2=createSecuredWorkspaces({controllers:new Set([c2]),vault,gate:{},timers,powerMonitor:power});
    s2.tick();assert.ok(c2.actions.some(a=>a.type==='workspace.secured-lock'&&a.reason==='idle'),'5 min idle (default) locks');
    assert.equal(lockMinutes({}),5);assert.equal(lockMinutes({securedLockMinutes:0}),0);assert.equal(lockMinutes({securedLockMinutes:7}),5,'only the offered choices; no "never"');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('groups and splits across a lock: the vault seals the workspace’s tab groups and splits with its tabs (disk scan), and unlock hands them back', async () => {
  const dir=tmp();try{
    const vault=createSecuredVault({dir,keys}),state=stateWith();
    state.tabs.push(tab('t2','workspace-h',{group:'Grp '+MARK}),tab('t3','workspace-h'));
    state.tabGroups=[{id:'group-1',name:'Grp '+MARK,color:'green',collapsed:true,browserProfileId:'profile-personal',workspaceId:'workspace-h',lastActiveTabId:'t2'},{id:'group-main',name:'Main group',color:'blue',collapsed:false,browserProfileId:'profile-personal'}];
    state.windowUi={splitGroups:[{id:'split-7',groupId:'split-7',tabIds:['t2','t3'],layout:'two-columns',cols:[0.4,0.6],rows:[1],collapsed:false,name:'Pair '+MARK},{id:'split-main',groupId:'split-main',tabIds:['m1','x'],layout:'two-columns',cols:[0.5,0.5],rows:[1],collapsed:false}]};
    const c=fakeWindow(state),service=createSecuredWorkspaces({controllers:new Set([c]),vault,gate:{ensure:async()=>({ok:true})},timers});
    assert.equal(service.lock('workspace-h','manual'),true);
    assert.deepEqual(scan(dir,MARK),[],'the group and split names are sealed, not readable');
    const sealed=vault.read('workspace-h');
    assert.deepEqual(sealed.tabs.map(t=>[t.id,t.group||'']),[['t1',''],['t2','Grp '+MARK],['t3','']]);
    assert.deepEqual(sealed.groups,[{id:'group-1',name:'Grp '+MARK,color:'green',collapsed:true,lastActiveTabId:'t2'}],'only this workspace’s groups');
    assert.deepEqual(sealed.splits.map(sp=>[sp.id,sp.tabIds,sp.layout,sp.cols,sp.rows,sp.name]),[['split-7',['t2','t3'],'two-columns',[0.4,0.6],[1],'Pair '+MARK]],'only splits made of its tabs');
    const result=await service.unlock('workspace-h',c);assert.equal(result.ok,true);
    const unlock=c.actions.find(a=>a.type==='workspace.secured-unlock');
    assert.deepEqual(unlock.groups,sealed.groups);assert.deepEqual(unlock.splits,sealed.splits);
    // A sealed split naming a tab that isn't in the file, or a group with a bad colour, can't come back half-made.
    const {cleanSplits,cleanGroups}=require('../desktop/browser-services/secured-vault.cjs');
    assert.deepEqual(cleanSplits([{id:'split-x',tabIds:['t1','ghost'],layout:'two-columns'}],new Set(['t1'])),[]);
    assert.equal(cleanGroups([{id:'g',name:'G',color:'#ff0000'}],new Set())[0].color,'none');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('notifications: a secured page’s notification shows one neutral line, never its words, only while unlocked; locking takes it away', () => {
  const dir=tmp();try{
    const made=[];class FakeNotification{constructor(options){this.options=options;this.handlers={};this.closed=false;made.push(this);}static isSupported(){return true;}on(event,fn){this.handlers[event]=fn;}show(){this.shown=true;}close(){this.closed=true;}}
    let clock=1000;const clicks=[];
    const vault=createSecuredVault({dir,keys}),c=fakeWindow(stateWith());
    const service=createSecuredWorkspaces({tm:key=>key==='workspaces.securedNotification'?'New notification in a locked workspace':key,controllers:new Set([c]),vault,gate:{},timers,Notification:FakeNotification,now:()=>clock,onNotificationClick:(controller,tabId,token)=>clicks.push([tabId,token])});
    assert.deepEqual(service.notify(c,'t1',{token:'n1'}),{ok:true});
    assert.equal(made.length,1);assert.deepEqual(made[0].options,{title:'New notification in a locked workspace',body:'',silent:false});
    assert.ok(made[0].shown&&!JSON.stringify(made[0].options).includes(MARK),'shown, with no title, address or body of the page');
    assert.equal(service.notify(c,'t1',{token:'n2'}).merged,true,'a burst is one line');assert.equal(made.length,1);
    made[0].handlers.click();assert.deepEqual(clicks,[['t1','n1']],'clicking brings the tab forward');
    assert.equal(service.notify(c,'m1',{}).code,'not-secured','an ordinary tab never goes this way');
    clock+=10000;service.notify(c,'t1',{});assert.equal(made.length,2);
    service.lock('workspace-h','idle');
    assert.equal(made[1].closed,true,'locking closes what is still shown');
    clock+=10000;const locked=fakeWindow(stateWith(false));locked.state.tabs.push(tab('t9','workspace-h'));
    assert.equal(service.notify(locked,'t9',{}).code,'locked','nothing while locked');assert.equal(made.length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('notifications and extensions: Chromium’s own notifications are refused for secured sessions, and no extension sees a secured page', () => {
  const engine=fs.readFileSync(path.join(root,'desktop','browser-services','permission-engine.cjs'),'utf8');
  assert.ok(engine.includes("const quietNotifications=String(profile).startsWith('private-secured-');")&&engine.includes("if(quietNotifications&&permission==='notifications')return false;"),'the check handler refuses notifications for a secured profile, so a bypass gets an error event and Windows shows nothing');
  const preload=fs.readFileSync(path.join(root,'desktop','browser-services','secured-notification-preload.cjs'),'utf8');
  assert.ok(preload.includes("ipcRenderer.send('acira:secured-notification', {token: String(token).slice(0, 64), silent: silent === true})"),'the page sends only a token and the silent flag, no words');
  assert.ok(preload.includes("Object.defineProperty(window, 'Notification'")&&preload.includes("'showNotification'"),'both page ways of showing a notification are replaced');
  const main=fs.readFileSync(path.join(root,'desktop','main.cjs'),'utf8');
  for(const [needle,why] of [
    ["if(profileId.startsWith('private-secured-')&&typeof ses.registerPreloadScript==='function'){const file=path.join(__dirname,'browser-services','secured-notification-preload.cjs')","the preload runs in secured sessions only"],
    ["ipcMain.on('acira:secured-notification',(event,request)=>{try{if(!securedService||!permissionService||permissionService.stateFor(event.sender,event.senderFrame,'notifications')!=='granted')return;","main shows one only with the site's permission"],
    ["if(tab.privacy!=='secured')attachExtensionTab(tab.id,wc);","a secured page is never handed to the extension runtime"],
    ["if(entry.privacy!=='secured')extensionManager?.attachTab(wc,mainWindow);","not even when a close is cancelled"],
    ["if(tab.privacy==='secured')return {extensionToolbar:{supported:false,secured:true,","the toolbar shows extensions as unavailable in a secured workspace"],
  ])assert.ok(main.includes(needle),why);
});

test('the interface may lock but can never unlock, seal or make secured through an action', () => {
  const snapshot={workspaces:[{id:'workspace-h',name:'Health',browserProfileId:'profile-personal',secured:true}],tabs:[]};
  assert.doesNotThrow(()=>validateAction({type:'workspace.lock',id:'workspace-h'},snapshot));
  for(const action of [{type:'workspace.secured-unlock',id:'workspace-h',tabs:[]},{type:'workspace.secured-lock',id:'workspace-h'},{type:'workspace.secured-set',id:'workspace-h',secured:false}])
    assert.throws(()=>validateAction(action,snapshot),/not a renderer capability|unsupported fields/,action.type);
});

test('main wires every guard (source assertions where no live test runs)', () => {
  const main=fs.readFileSync(path.join(root,'desktop','main.cjs'),'utf8');
  for(const [needle,why] of [
    ["if(tab.privacy==='secured'&&!privateMode){const shared=secured().profileFor(tab,real)","pages of a secured workspace use its memory-only session"],
    ["entry.privacy==='secured')return;","the shared session is not retired per page"],
    ["if(action.type==='workspace.lock'){","the interface's lock goes through the seal-first path"],
    ["secured().afterAction(controller,previous,state,action)","leave-lock, sealing edits, forgetting deleted ones, capture exclusion"],
    ["securedService.windowClosing(controller)","closing a window seals and locks"],
    ["securedService.lockAll('minimize')","minimising locks"],
    ["securedService?.flush()","quit seals synchronously"],
    ["bridge.handle('acira:secured'","unlock only through main"],
    ["'workspace.move-tabs','workspace.lock'])actionNames.add(name)","the interface may send workspace.lock (and only that)"],
    ["platformVerifier({packaged:app.isPackaged,systemPreferences:require('electron').systemPreferences})","the real platform gate; test switches only unpackaged"],
  ])assert.ok(main.includes(needle),why);
  assert.ok(fs.readFileSync(path.join(root,'desktop','browser-services','download-engine.cjs'),'utf8').includes("!profileId.startsWith('private-secured-')"),'row 10: a secured download always asks where to save');
  const core=fs.readFileSync(path.join(root,'src','runtime','core.ts'),'utf8');
  assert.ok(core.includes("s.tabs=s.tabs.filter(t=>!t.privacy&&"),'saved state drops every privacy tab, secured included');
  assert.ok(core.includes("const {unlocked:_unlocked,...kept}=w"),'saved and restored workspaces are locked');
});

// Forgetting the shared private partition also retires native per-session policy.
test('forget notifies native profile retirement once and leaves other secured profiles intact',()=>{
 const retired=[],service=createSecuredWorkspaces({controllers:new Set(),vault:{remove(){}},gate:{},onForgetProfile:profile=>retired.push(profile),timers});
 const first=service.profileFor({workspaceId:'workspace-first'},{}),other=service.profileFor({workspaceId:'workspace-other'},{});
 service.forget('workspace-first');service.forget('workspace-first');
 assert.deepEqual(retired,[first]);assert.equal(service.partitionOf('workspace-first'),null);assert.equal(service.partitionOf('workspace-other'),other.partition);
});
