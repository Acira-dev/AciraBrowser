'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const runtime=require('../desktop/runtime.cjs');
const {createInitialState,reduceBrowser,persistedSnapshot,restoreSnapshot}=runtime;
const {validateAction}=require('../desktop/validation.cjs');
const {createRewind}=require('../desktop/rewind/rewind.cjs');
const model=require('../desktop/rewind/checkpoint-model.cjs');
const {COMMANDS,createShortcutRegistry}=require('../desktop/shortcut-registry.cjs');
const {resolveDefaultShortcut}=require('../desktop/shortcuts.cjs');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const key=(k,extra={})=>({type:'keyDown',key:k,code:`Digit${k}`,alt:false,control:false,meta:false,shift:false,...extra});
const run=(state,...actions)=>actions.reduce(reduceBrowser,state);
function windowWith(urls){let s=createInitialState();for(const url of urls)s=reduceBrowser(s,{type:'tab.new',url});return s;}

test('the bridge accepts the workspace actions and refuses malformed ones',()=>{
 const base=run(windowWith(['https://a.test/']),{type:'workspace.create',name:'Work'});
 const work=base.workspaces.find(w=>w.name==='Work').id,first=base.workspaces[0].id,tab=base.tabs[0].id;
 const ok=a=>validateAction(a,base);
 assert.equal(ok({type:'workspace.create',name:'Home',icon:'home',color:'#0088FF',tabs:'move'}).name,'Home');
 assert.equal(ok({type:'workspace.create',id:'workspace-'+'0'.repeat(8)+'-0000-0000-0000-'+'0'.repeat(12),name:'Study'}).name,'Study');
 assert.equal(ok({type:'workspace.select',id:work}).id,work);
 assert.equal(ok({type:'workspace.delete',id:first}).id,first);
 assert.equal(ok({type:'workspace.restore',id:'workspace-gone'}).id,'workspace-gone','Undo of a workspace this window no longer lists is left to the reducer');
 assert.deepEqual(ok({type:'workspace.update',id:work,patch:{color:null}}).patch,{color:null});
 assert.equal(ok({type:'workspace.move-tabs',tabIds:[tab],workspaceId:work}).workspaceId,work);
 assert.equal(ok({type:'tab.new',workspaceId:work,background:true}).workspaceId,work);
 for(const bad of [
  {type:'workspace.create'},{type:'workspace.create',name:''},{type:'workspace.create',name:'x'.repeat(201)},{type:'workspace.create',name:'A',color:'blue'},{type:'workspace.create',name:'A',tabs:'all'},
  {type:'workspace.create',name:'A',id:'workspace-short'},{type:'workspace.create',name:'A',extra:1},{type:'workspace.select',id:'workspace-nope'},{type:'workspace.select'},
  {type:'workspace.update',id:work,patch:{}},{type:'workspace.update',id:work,patch:{name:5}},{type:'workspace.update',id:work,patch:{color:'red'}},{type:'workspace.update',id:work,patch:{id:'x'}},
  {type:'workspace.move-tabs',tabIds:['tab-nope'],workspaceId:work},{type:'workspace.move-tabs',tabIds:[tab],workspaceId:'workspace-nope'},{type:'tab.new',workspaceId:'workspace-nope'},
 ])assert.throws(()=>ok(bad),undefined,JSON.stringify(bad));
});

test('Alt+1–8 reach the Nth workspace; Ctrl+1–9 stays go to tab',()=>{
 for(let n=1;n<=8;n++){
  assert.deepEqual(resolveDefaultShortcut(key(String(n),{alt:true}),'win32'),{action:'switch-workspace',index:n-1});
  assert.deepEqual(resolveDefaultShortcut(key(String(n),{control:true}),'win32'),{action:'select-tab',index:n-1});
  assert.deepEqual(resolveDefaultShortcut(key(String(n),{control:true}),'darwin'),{action:'switch-workspace',index:n-1},'a Mac uses Ctrl: Option+digit types characters');
  assert.deepEqual(resolveDefaultShortcut(key(String(n),{meta:true}),'darwin'),{action:'select-tab',index:n-1});
 }
 assert.equal(resolveDefaultShortcut(key('9',{alt:true}),'win32'),null,'nine is not a workspace');
 assert.equal(resolveDefaultShortcut(key('1',{alt:true,shift:true}),'win32')?.action,undefined,'Alt+Shift+1 is not taken');
 const ids=COMMANDS.filter(c=>/^switch-workspace-\d$/.test(c.id));
 assert.equal(ids.length,8);
 assert.deepEqual(ids.map(c=>c.defaults[0]),Array.from({length:8},(_,i)=>`Alt+${i+1}`));
 assert.deepEqual(ids.map(c=>c.mac[0]),Array.from({length:8},(_,i)=>`Ctrl+${i+1}`));
 assert.ok(COMMANDS.some(c=>c.id==='new-workspace'&&c.action.action==='workspace-new'));
 const registry=createShortcutRegistry({file:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'acira-ws-keys-')),'keys.json'),platform:'win32'});
 assert.deepEqual(registry.effective().get('Alt+2'),'switch-workspace-2');
 // Nothing else owns Alt+1–8, so no stock binding lost its key.
 assert.equal([...registry.effective().keys()].filter(a=>/^Alt\+[1-8]$/.test(a)).length,8);
});

test('Rewind keeps the workspace a tab was in and restores it there without switching',()=>{
 let s=windowWith(['https://a.test/','https://b.test/']);
 s=run(s,{type:'workspace.create',name:'Work'});
 const work=s.workspaces.find(w=>w.name==='Work').id;
 s=run(s,{type:'tab.new',url:'https://w1.test/'},{type:'tab.new',url:'https://w2.test/'});
 s=run(s,{type:'tab.group.create',tabId:s.activeTabId,name:'Q4',color:'green'});
 const payload=model.project(s,'profile-personal');
 assert.equal(payload.workspaceRef,work,'workspaceRef is the workspace on screen');
 assert.deepEqual(payload.tabs.map(t=>[t.url,t.workspace===work]).filter(([url])=>/w\d/.test(url)),[['https://w1.test/',true],['https://w2.test/',true]]);
 assert.equal(payload.tabs.find(t=>t.url==='https://a.test/').workspace,s.workspaces[0].id);
 assert.equal(payload.groups[0].workspace,work);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-rewind-ws-')),rw=createRewind({dir,timers:{setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}}});
 assert.equal(rw.capture(s,{windowId:'w1',reason:'manual'}).ok,true);
 const [{id}]=rw.list('profile-personal');
 // Close the Work tabs, go back to the first workspace, restore from there.
 let now=s;for(const tab of s.tabs.filter(t=>t.url.includes('w')))now=run(now,{type:'tab.close',id:tab.id});
 now=run(now,{type:'workspace.select',id:now.workspaces[0].id});
 const ctx={windowId:'w1',privateMode:false,state:()=>ctx.current,dispatch:a=>{ctx.current=reduceBrowser(ctx.current,a);return ctx.current;},current:now};
 const {rewind:detail}=rw.handle({type:'rewind.get',id},ctx);
 const file=fs.readdirSync(path.join(dir,'profile-personal')).find(name=>name.endsWith('.json'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile-personal',file),'utf8')).workspaceRef,work,'the moment names the workspace it was saved in');
 const wanted=detail.checkpoint.tabs.filter(t=>/w\d/.test(t.url)).map(t=>t.ref);
 const {rewind:result}=rw.handle({type:'rewind.restore',id,refs:wanted},ctx);
 assert.equal(result.restored,2);
 assert.equal(ctx.current.activeWorkspaceId,now.workspaces[0].id,'restoring does not switch workspace');
 const back=ctx.current.tabs.filter(t=>/w\d/.test(t.url));
 assert.deepEqual(back.map(t=>t.workspaceId),[work,work]);
 assert.equal(ctx.current.tabGroups.filter(g=>g.name==='Q4'&&g.workspaceId===work).length,1,'the group came back in Work');
 assert.equal(ctx.current.tabGroups.filter(g=>g.name==='Q4'&&!g.workspaceId).length,0,'and not in the first workspace');
});

test('deleting a workspace is a Rewind moment',()=>{
 const source=read('desktop/rewind/rewind.cjs');
 assert.match(source,/action\?\.type==='tab\.close'\|\|action\?\.type==='workspace\.delete'/);
 let s=windowWith(['https://a.test/']);
 s=run(s,{type:'workspace.create',name:'Work'},{type:'tab.new',url:'https://w1.test/'},{type:'tab.new',url:'https://w2.test/'});
 const timers=[];const fake={setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-rewind-del-')),rw=createRewind({dir,timers:fake});
 const after=run(s,{type:'workspace.delete',id:s.activeWorkspaceId});
 rw.observe('w1',s,after,{type:'workspace.delete',id:s.activeWorkspaceId});
 for(const fn of timers.splice(0))fn();
 const saved=rw.list('profile-personal');
 assert.equal(saved.length,1);
 assert.ok(saved[0].tabCount>=3,'the deleted workspace\'s tabs are in the moment');
});

test('the window wiring: one window per open workspace, scoped shortcuts, other windows\' changes settle',()=>{
 const main=read('desktop/main.cjs');
 // The renderer's actions reach the reducer only through main's allow-list (a missing name fails as "Invalid browser action").
 for(const type of ['workspace.create','workspace.select','workspace.update','workspace.delete','workspace.restore','workspace.move-tabs'])assert.ok(main.includes(`'${type}'`),`${type} is in main's actionNames`);
 assert.match(main,/action\.type==='workspace\.select'&&!privateMode/,'picking a workspace another window has open brings that window forward');
 assert.match(main,/c\.state\.activeWorkspaceId===action\.id/);
 // Scoped to the open workspace: listedTabs is workspaceTabs without a favorite's own tab in the sidebar layout (favoriteTabs.ts).
 assert.match(main,/case 'select-tab':\{const here=listedTabs\(state\)/);
 assert.match(main,/case 'cycle-tab':\{[^}]*const here=listedTabs\(state\)/);
 assert.match(read('src/runtime/favoriteTabs.ts'),/const here = workspaceTabs\(state\);/);
 assert.match(main,/case 'switch-workspace':/);
 assert.match(main,/normalizeWorkspaces\(state\)/);
 for(const name of ['workspaceTabs','listedTabs','normalizeWorkspaces','windowWorkspaces','scopeToWorkspace','workspaceIdOf'])assert.equal(typeof runtime[name],'function',name);
});

test('a workspace saved in one run opens as it was in the next, and an old save opens as one workspace',()=>{
 let s=windowWith(['https://a.test/']);
 s=run(s,{type:'workspace.create',name:'Work',icon:'code',color:'#0088FF'},{type:'tab.new',url:'https://w1.test/'});
 const saved=JSON.parse(JSON.stringify(persistedSnapshot(s))),back=restoreSnapshot(saved);
 assert.deepEqual(back.workspaces.map(w=>[w.name,w.icon,w.color]),[['',undefined,undefined],['Work','code','#0088ff']]);
 assert.equal(back.activeWorkspaceId,s.activeWorkspaceId);
 assert.deepEqual(runtime.workspaceTabs(back).map(t=>t.url),['acira://new','https://w1.test/']);
 delete saved.workspaces;delete saved.activeWorkspaceId;for(const tab of saved.tabs)delete tab.workspaceId;
 const old=restoreSnapshot(saved);
 assert.equal(old.workspaces.length,1);
 assert.equal(runtime.workspaceTabs(old).length,old.tabs.length);
});
