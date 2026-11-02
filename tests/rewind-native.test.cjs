'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createRewind}=require('../desktop/rewind/rewind.cjs');
const model=require('../desktop/rewind/checkpoint-model.cjs');
const {createClosedPages}=require('../desktop/rewind/undo-close.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-rewind-'));
const noTimers={setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}};
function windowWith(urls){let s=createInitialState();for(const url of urls)s=reduceBrowser(s,{type:'tab.new',url});return s;}
function host(state){const ctx={windowId:'w1',privateMode:false,state:()=>ctx.current,dispatch:a=>{ctx.current=reduceBrowser(ctx.current,a);return ctx.current;},current:state};return ctx;}
const files=(dir,profile='profile-personal')=>{try{return fs.readdirSync(path.join(dir,profile)).filter(f=>f.endsWith('.json'));}catch{return [];}};

test('projection keeps only arrangement metadata of http(s) tabs and drops secrets',()=>{
 let s=windowWith(['https://a.test/x?q=1','https://login.test/cb?code=abc&state=z','http://user:pw@b.test/','https://c.test/#frag']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[1].id,name:'Research',color:'blue'});
 const p=model.project(s,'profile-personal');
 assert.deepEqual(p.tabs.map(t=>t.url),['https://a.test/x?q=1','https://c.test/#frag']);
 assert.equal(p.skipped,3);// home tab + callback + credentials
 // `workspace` is the id of the workspace the tab was in (R3-57): an internal id, no page content.
 for(const tab of p.tabs)assert.deepEqual(Object.keys(tab).sort(),['active','groupRef','order','pinned','ref','title','url','workspace']);
});

test('capture writes one bounded file, dedupes identical structure, restore is additive and lazy',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 const s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 assert.equal(rw.capture(s,{windowId:'w1',reason:'manual'}).ok,true);
 assert.equal(rw.capture(s,{windowId:'w1',reason:'periodic'}).deduped,true);
 assert.equal(files(dir).length,1);
 // Close two tabs, then restore everything: only the missing two come back, as background tabs.
 let now=reduceBrowser(reduceBrowser(s,{type:'tab.close',id:s.tabs[2].id}),{type:'tab.close',id:s.tabs[3].id});
 const ctx=host(now),[{id}]=rw.list('profile-personal');
 const {rewind:detail}=rw.handle({type:'rewind.get',id},ctx);
 assert.deepEqual(detail.checkpoint.tabs.map(t=>t.open),[true,false,false]);
 const {rewind:result}=rw.handle({type:'rewind.restore',id,refs:detail.checkpoint.tabs.map(t=>t.ref)},ctx);
 assert.equal(result.restored,2);assert.equal(result.skipped[0].reason,'already-open');
 assert.deepEqual(ctx.current.tabs.slice(-2).map(t=>t.url),['https://b.test/','https://c.test/']);
 assert.equal(ctx.current.activeTabId,now.activeTabId,'restore never steals the current tab');
 // Repeating restore does not duplicate.
 const again=rw.handle({type:'rewind.restore',id,refs:detail.checkpoint.tabs.map(t=>t.ref)},ctx).rewind;
 assert.equal(again.restored,0);assert.equal(ctx.current.tabs.length,4);
 rw.dispose();
});

test('restored groups keep name and colour; a name already in use gets "· Recovered"',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[1].id,name:'Research',color:'green'});
 s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id],groupId:s.tabGroups[0].id});
 rw.capture(s,{windowId:'w1',reason:'manual'});
 const kept=reduceBrowser(windowWith(['https://z.test/']),{type:'tab.group.create',tabId:'tab-home',name:'Research'});
 const ctx=host(kept),[{id}]=rw.list('profile-personal'),refs=rw.handle({type:'rewind.get',id},ctx).rewind.checkpoint.tabs.map(t=>t.ref);
 const result=rw.handle({type:'rewind.restore',id,refs},ctx).rewind;
 assert.deepEqual(result.groups,['Research · Recovered']);
 const group=ctx.current.tabGroups.find(g=>g.name==='Research · Recovered');assert.equal(group.color,'green');
 assert.equal(ctx.current.tabs.filter(t=>t.group==='Research · Recovered').length,2);
 assert.equal(ctx.current.tabs.filter(t=>t.group==='Research').length,1,'existing group untouched');
 rw.dispose();
});

test('batch close captures the before-state once; single close does not',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 let next=reduceBrowser(s,{type:'tab.close',id:s.tabs[3].id});rw.observe('w1',s,next,{type:'tab.close',id:s.tabs[3].id});rw.flush('w1');
 assert.equal(files(dir).length,0,'one tab is Undo territory, not a checkpoint');
 s=next;next=reduceBrowser(s,{type:'tab.close',id:s.tabs[1].id});rw.observe('w1',s,next,{type:'tab.close'});
 const mid=next;next=reduceBrowser(mid,{type:'tab.close',id:mid.tabs[1].id});rw.observe('w1',mid,next,{type:'tab.close'});rw.flush('w1');
 const [cp]=rw.list('profile-personal');assert.equal(cp.reason,'tabs-close');assert.equal(cp.tabCount,2);
 rw.dispose();
});

test('history deletion, forget site and profile removal reach checkpoints; epoch drops stale captures',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://keep.test/','https://gone.test/a','https://gone.test/b']);
 s.browsingHistory=[{id:'v1',title:'',url:'https://gone.test/a',time:new Date().toISOString(),profileId:'',browserProfileId:'profile-personal'}];
 rw.capture(s,{windowId:'w1',reason:'manual'});
 const after=reduceBrowser(s,{type:'history.remove',id:'v1'});rw.observe('w1',s,after,{type:'history.remove',id:'v1'});
 let [cp]=rw.list('profile-personal');assert.equal(cp.tabCount,2,'removed visit URL purged');
 rw.forgetOrigin('profile-personal','https://gone.test');[cp]=rw.list('profile-personal');assert.equal(cp.tabCount,1);
 // A batch started before a deletion is discarded (privacy epoch).
 let a=windowWith(['https://x.test/','https://y.test/','https://w.test/']),b=reduceBrowser(a,{type:'tab.close',id:a.tabs[1].id});
 rw.observe('w2',a,b,{type:'tab.close'});const c=reduceBrowser(b,{type:'tab.close',id:b.tabs[1].id});rw.observe('w2',b,c,{type:'tab.close'});
 rw.forgetOrigin('profile-personal','https://nothing.test');rw.flush('w2');
 assert.equal(rw.list('profile-personal').length,1,'stale batch dropped');
 // history.clear since T deletes checkpoints created after T.
 rw.observe('w1',s,s,{type:'history.clear',since:0});assert.equal(rw.list('profile-personal').length,0);
 rw.capture(s,{windowId:'w1',reason:'manual',force:true});assert.equal(files(dir).length,1);
 rw.removeProfile('profile-personal');assert.equal(files(dir).length,0);assert.equal(rw.list('profile-personal').length,0);
 rw.dispose();
});

test('retention: age, per-profile count and size caps; corrupt files are isolated',()=>{
 const dir=tmp();let t=Date.now()-8*86400000;const rw=createRewind({dir,timers:noTimers,now:()=>t,limits:{perProfile:3}});
 for(let i=0;i<5;i++){const s=windowWith([`https://site${i}.test/`]);rw.capture(s,{windowId:'w1',reason:'manual'});t+=1000;}
 assert.equal(files(dir).length,3,'count cap');
 t=Date.now();rw.tick();assert.equal(files(dir).length,0,'7-day cap');
 fs.mkdirSync(path.join(dir,'profile-personal'),{recursive:true});fs.writeFileSync(path.join(dir,'profile-personal','cp-abc-0123abcd.json'),'{not json');
 const fresh=createRewind({dir,timers:noTimers});assert.equal(fresh.list('profile-personal').length,0);assert.equal(files(dir).length,0);
 rw.dispose();fresh.dispose();
});

test('private windows get nothing and validation is strict',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});const ctx=host(windowWith(['https://a.test/']));
 assert.equal(rw.handle({type:'rewind.list'},{...ctx,privateMode:true}).rewind.private,true);
 assert.throws(()=>rw.handle({type:'rewind.list',extra:1},ctx));
 assert.throws(()=>rw.handle({type:'rewind.restore',id:'../../etc',refs:['t0']},ctx));
 assert.throws(()=>rw.handle({type:'rewind.settings',days:30},ctx));
 assert.throws(()=>rw.handle({type:'nope'},ctx));
 rw.dispose();
});

test('closed-page cache keeps page state in memory only, once, for the same page',()=>{
 const pages=createClosedPages({limit:2});
 const wc=(urls,index)=>({isDestroyed:()=>false,navigationHistory:{getAllEntries:()=>urls.map(url=>({url,title:'',pageState:'state:'+url})),getActiveIndex:()=>index}});
 assert.equal(pages.remember('t1',wc(['https://a.test/','https://b.test/'],1)),true);
 assert.equal(pages.take('t1','https://other.test/'),null,'wrong page -> nothing');
 pages.remember('t1',wc(['https://a.test/','https://b.test/'],1));
 assert.deepEqual(pages.take('t1','https://b.test/').entries[1],{url:'https://b.test/',title:'',pageState:'state:https://b.test/'});
 assert.equal(pages.take('t1','https://b.test/'),null,'only once');
 assert.equal(pages.remember('t2',wc(['acira://new'],0)),false,'internal pages are not kept');
 for(const id of ['a','b','c'])pages.remember(id,wc(['https://a.test/'],0));assert.equal(pages.size,2);
});

test('closing a window offers Undo in a surviving window and Undo reopens the whole arrangement',async()=>{
 const dir=tmp();let opened=null;
 const make=(state,windowId)=>{const c={windowId,privateMode:false,closing:false,window:{isDestroyed:()=>false},state,get profileId(){return c.state.activeBrowserProfileId;},commitAction(a){c.state=reduceBrowser(c.state,a);return c.state;},ready:Promise.resolve(true)};return c;};
 const rw=createRewind({dir,timers:noTimers,openWindow:({profileId,initialURL})=>{let s=createInitialState();s=reduceBrowser(s,{type:'tab.navigate',tabId:s.activeTabId,url:initialURL});opened=make(s,'w3');return opened;}});
 let closing=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 closing=reduceBrowser(closing,{type:'tab.group.create',tabId:closing.tabs[2].id,name:'Work',color:'red'});
 closing=reduceBrowser(closing,{type:'tab.group.assign',tabIds:[closing.tabs[2].id,closing.tabs[3].id],groupId:closing.tabGroups[0].id});
 rw.windowClosed('w1',closing);
 const survivor=make(windowWith(['https://z.test/']),'w2');
 assert.equal(rw.windowGone('w1',[survivor]),true);
 assert.equal(survivor.state.toast.text,'Window with 3 tabs closed');
 const command=survivor.state.toast.action.command;assert.deepEqual(command,{type:'window.reopen',id:'w1'});
 const before=survivor.state;survivor.commitAction(command);assert.equal(survivor.state.toast,null);
 await rw.reopenWindow('w1');
 assert.deepEqual(opened.state.tabs.map(t=>t.url),['https://a.test/','https://b.test/','https://c.test/']);
 assert.equal(opened.state.tabs.filter(t=>t.group==='Work').length,2);
 assert.equal(await rw.reopenWindow('w1'),null,'only once');
 assert.equal(rw.windowGone('w9',[survivor]),false,'unknown window -> no toast');
 assert.ok(before);rw.dispose();
});

test('moments carry the session; the list says what is not open, what changed and what matches a search',()=>{
 const {SESSION}=require('../desktop/rewind/rewind.cjs');
 const dir=tmp();let clock=1000;const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://mail.test/inbox','https://figma.test/file/launch','https://maps.test/lisbon']);
 s=reduceBrowser(s,{type:'tab.update',id:s.tabs[3].id,patch:{title:'Loft in Alfama, Lisbon'}});
 assert.equal(rw.capture(s,{windowId:'w1',reason:'manual'}).checkpoint.sessionId,SESSION);
 clock+=60000;const later=reduceBrowser(reduceBrowser(s,{type:'tab.close',id:s.tabs[3].id}),{type:'tab.new',url:'https://docs.test/plan'});
 rw.capture(later,{windowId:'w1',reason:'periodic'});
 const {rewind:view}=rw.handle({type:'rewind.list'},host(later));
 assert.equal(view.session,SESSION);
 const [newest,oldest]=view.checkpoints;
 assert.deepEqual([newest.added,newest.removed,newest.first],[1,1,false],'one tab in, one tab out since the previous moment of this window');
 assert.deepEqual([oldest.first,oldest.added],[true,3]);
 assert.equal(oldest.closed,1,'only the Lisbon tab is missing now');assert.equal(newest.closed,0);
 assert.deepEqual(oldest.sites,['Mail','Figma','Maps']);assert.equal(oldest.siteCount,3);
 // Search reaches tab titles and addresses, not just site names.
 const find=query=>rw.handle({type:'rewind.list',query},host(later)).rewind.checkpoints;
 assert.deepEqual(find('alfama').map(c=>[c.id,c.hits]),[[oldest.id,1]]);
 assert.equal(find('docs.test/plan').length,1);assert.equal(find('nothing-like-this').length,0);
 assert.throws(()=>rw.handle({type:'rewind.list',query:'x'.repeat(201)},host(later)),/too long/);
 // A stored session id survives a re-read; a malformed one is dropped, not trusted.
 const file=path.join(dir,'profile-personal',files(dir)[0]);const raw=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(model.readCheckpoint(raw,'profile-personal').sessionId,SESSION);
 assert.equal(model.readCheckpoint({...raw,sessionId:'<bad>'},'profile-personal').sessionId,'');
});

test('restore hands back an undo token; undo closes exactly those tabs, in that window, without saving a new moment',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:{...noTimers,setTimeout:fn=>{rw.__flush=fn;return 1;}}});
 const s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);rw.capture(s,{windowId:'w1',reason:'manual'});
 const now=reduceBrowser(reduceBrowser(s,{type:'tab.close',id:s.tabs[2].id}),{type:'tab.close',id:s.tabs[3].id});
 const ctx=host(now);const observeDispatch=ctx.dispatch;ctx.dispatch=a=>{const before=ctx.current;const next=observeDispatch(a);rw.observe('w1',before,next,a);return next;};
 const [{id}]=rw.list('profile-personal'),refs=rw.handle({type:'rewind.get',id},ctx).rewind.checkpoint.tabs.map(t=>t.ref);
 const restored=rw.handle({type:'rewind.restore',id,refs},ctx).rewind;
 assert.equal(restored.restored,2);assert.match(restored.token,/^u[a-z0-9]{4,24}$/);
 const open=ctx.current.tabs.length;
 // Another window can't undo it.
 assert.equal(rw.handle({type:'rewind.undo',token:restored.token},{...ctx,windowId:'w2'}).rewind.ok,false);
 const undone=rw.handle({type:'rewind.undo',token:restored.token},ctx).rewind;
 assert.deepEqual([undone.ok,undone.closed,ctx.current.tabs.length],[true,2,open-2]);
 assert.equal(rw.__flush,undefined,'closing the restored tabs started no "before closing" capture');
 assert.equal(files(dir).length,1);
 assert.equal(rw.handle({type:'rewind.undo',token:restored.token},ctx).rewind.ok,false,'one undo per restore');
 assert.throws(()=>rw.handle({type:'rewind.undo',token:'../x'},ctx),/Nothing to undo/);
});

test('"Open in new window" puts the chosen tabs of a moment in a fresh window, in order, with their group',async()=>{
 const dir=tmp();let opened=null;
 const rw=createRewind({dir,timers:noTimers,openWindow:({profileId,initialURL})=>{let state=windowWith([]);state=reduceBrowser(state,{type:'tab.navigate',tabId:state.activeTabId,url:initialURL});opened={profileId,initialURL,get state(){return state;}};return {windowId:'w9',ready:Promise.resolve(true),get state(){return state;},commitAction:a=>{state=reduceBrowser(state,a);}};}});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[2].id,name:'Pair',color:'green'});s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[s.tabs[2].id,s.tabs[3].id],groupId:s.tabGroups[0].id});
 rw.capture(s,{windowId:'w1',reason:'manual'});
 const ctx=host(s),[{id}]=rw.list('profile-personal'),tabs=rw.handle({type:'rewind.get',id},ctx).rewind.checkpoint.tabs;
 const result=(await rw.handle({type:'rewind.restore',id,refs:tabs.map(t=>t.ref),newWindow:true},ctx)).rewind;
 assert.deepEqual([result.ok,result.window,result.restored],[true,true,3]);
 assert.equal(opened.initialURL,'https://a.test/');
 assert.deepEqual(opened.state.tabs.map(t=>t.url),['https://a.test/','https://b.test/','https://c.test/']);
 assert.equal(opened.state.tabs.filter(t=>t.group==='Pair').length,2);
 assert.equal(ctx.current.tabs.length,s.tabs.length,'the current window is untouched');
 assert.throws(()=>rw.handle({type:'rewind.restore',id,refs:['t0'],newWindow:'yes'},ctx),/true or false/);
});

test('a kept moment outlives the age limit, goes last under the caps, and history deletion still removes it',()=>{
 const dir=tmp();let clock=Date.now();const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 const a=windowWith(['https://a.test/']),b=windowWith(['https://b.test/']);
 rw.capture(a,{windowId:'w1',reason:'manual'});clock+=1000;rw.capture(b,{windowId:'w2',reason:'manual'});
 const ctx=host(b),[newer,older]=rw.list('profile-personal');
 assert.equal(rw.handle({type:'rewind.keep',id:older.id,kept:true},ctx).rewind.ok,true);
 assert.throws(()=>rw.handle({type:'rewind.keep',id:older.id,kept:'yes'},ctx),/true or false/);
 clock+=8*86400000;rw.tick();
 const left=rw.list('profile-personal');assert.deepEqual(left.map(c=>[c.id,c.kept]),[[older.id,true]],'the unkept one expired; the kept one stays');
 const raw=JSON.parse(fs.readFileSync(path.join(dir,'profile-personal',`${older.id}.json`),'utf8'));assert.equal(raw.kept,true,'kept is written to disk');
 rw.deleteSince('profile-personal',0);assert.equal(rw.list('profile-personal').length,0,'clearing history removes kept moments too');
 assert.ok(newer);
});

test('the toast Undo for a restore is a valid action, and its token is checked',()=>{
 const {validateAction}=require('../desktop/validation.cjs');const s=createInitialState();
 assert.deepEqual(validateAction({type:'rewind.undo',token:'uabcdef12'},s),{type:'rewind.undo',token:'uabcdef12'});
 assert.throws(()=>validateAction({type:'rewind.undo',token:'../x'},s),/Undo token is invalid/);
 assert.throws(()=>validateAction({type:'rewind.undo'},s));
 assert.equal(validateAction({type:'toast',text:'3 tabs restored',action:{label:'Undo',command:{type:'rewind.undo',token:'uabcdef12'}}},s).action.command.token,'uabcdef12');
 assert.throws(()=>validateAction({type:'toast',text:'x',action:{label:'Undo',command:{type:'rewind.undo',token:'u1',extra:1}}},s));
});
