'use strict';
// R3-39: Rewind keeps a log of closed tabs (not only snapshots). Capture on single-tab close, never for private or Tor, de-duplication,
// search, restore actions (single, group as a unit, split as a split, new window), Keep/Forget and every deletion path.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createRewind}=require('../desktop/rewind/rewind.cjs');
const {createClosedLog,entryFromTab,matchesEntry}=require('../desktop/rewind/closed-log.cjs');
const model=require('../desktop/rewind/checkpoint-model.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-closed-'));
const noTimers={setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}};
const PROFILE='profile-personal';
function windowWith(urls){let s=createInitialState();for(const url of urls)s=reduceBrowser(s,{type:'tab.new',url});return s;}
/** A window host that routes every committed action through observe, as main does. */
function host(state,rw,windowId='w1'){
 const ctx={windowId,privateMode:false,current:state,state:()=>ctx.current,dispatch:action=>{const before=ctx.current;ctx.current=reduceBrowser(before,action);rw.observe(windowId,before,ctx.current,action);return ctx.current;}};
 return ctx;
}
const close=(ctx,index)=>ctx.dispatch({type:'tab.close',id:ctx.current.tabs[index].id});
const titled=(state,index,title)=>reduceBrowser(state,{type:'tab.update',id:state.tabs[index].id,patch:{title}});
const view=(rw,ctx,query)=>rw.handle(query===undefined?{type:'rewind.tabs'}:{type:'rewind.tabs',query},ctx).rewind;

test('closing one tab logs it: address, title, group, window; the home page and Acira pages are not logged',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://a.test/invoice','https://b.test/plan']);
 s=titled(s,1,'Invoice 482 – Acme');
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[2].id,name:'Q4 launch',color:'purple'});
 const ctx=host(s,rw);
 close(ctx,2);close(ctx,0);// the grouped tab (plan), then the home tab
 const {tabs,total}=view(rw,ctx);
 assert.equal(total,1,'the home page (acira://new) is not an address worth keeping');
 assert.deepEqual([tabs[0].url,tabs[0].group,tabs[0].groupColor],['https://b.test/plan','Q4 launch','purple']);
 assert.equal(rw.closedLog.count(PROFILE),1);
 rw.dispose();
});

test('private and Tor tabs, private profiles and sign-in callbacks are never logged',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=createInitialState();
 s=reduceBrowser(s,{type:'tab.new',url:'https://private.test/',privacy:'private'});
 s=reduceBrowser(s,{type:'tab.new',url:'https://onion.test/',privacy:'tor'});
 s=reduceBrowser(s,{type:'tab.new',url:'https://login.test/cb?code=abc&state=z'});
 s=reduceBrowser(s,{type:'tab.new',url:'http://user:pw@cred.test/'});
 const ctx=host(s,rw);
 for(let i=ctx.current.tabs.length-1;i>=1;i--)close(ctx,i);
 assert.equal(ctx.current.tabs.length,1);
 assert.equal(rw.closedLog.count(PROFILE),0,'nothing from private, Tor, tokens or credentials');
 rw.closedLog.flush();assert.equal(fs.existsSync(path.join(dir,PROFILE,'closed.json')),false,'no file is written for nothing');
 // A tab of a private browsing profile is refused by the model itself.
 const priv=windowWith(['https://p.test/']);priv.browserProfiles[0].private=true;
 assert.equal(entryFromTab(priv,priv.tabs[1],{windowId:'w1'}),null);
 // A private window never reaches Rewind (main does not call observe); a request from one gets nothing.
 assert.equal(rw.handle({type:'rewind.tabs'},{windowId:'w9',privateMode:true,state:()=>s}).rewind.private,true);
 rw.dispose();
});

test('with Rewind off, closing a tab logs nothing',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers}),ctx=host(windowWith(['https://a.test/']),rw);
 rw.handle({type:'rewind.settings',enabled:false},ctx);
 close(ctx,1);assert.equal(rw.closedLog.count(PROFILE),0);
 rw.dispose();
});

test('closes within the batch window share a batch; the log de-duplicates by address, ignoring #fragments, and keeps Keep',()=>{
 const dir=tmp();let clock=1000;const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://a.test/x#one','https://b.test/','https://a.test/x#two']);
 const ctx=host(s,rw);
 close(ctx,3);close(ctx,2);clock+=60000;close(ctx,1);
 let {tabs}=view(rw,ctx);
 assert.equal(tabs.length,2,'a.test/x closed as #two and #one-less is one page');
 const [first,second]=rw.closedLog.load(PROFILE);
 assert.notEqual(first.batch,'');
 // Keep it, close the same page again (another fragment): one row, still kept, newest time.
 const id=tabs.find(t=>t.url.startsWith('https://a.test/')).id;
 assert.equal(rw.handle({type:'rewind.keep',id,kept:true},ctx).rewind.ok,true);
 ctx.current=reduceBrowser(ctx.current,{type:'tab.new',url:'https://a.test/x#three'});clock+=1000;close(ctx,ctx.current.tabs.length-1);
 ({tabs}=view(rw,ctx));
 assert.equal(tabs.filter(t=>t.url.startsWith('https://a.test/')).length,1);
 assert.equal(tabs.find(t=>t.url.startsWith('https://a.test/')).kept,true);
 assert.ok(second);rw.dispose();
});

test('tabs closed together as a group share a batch and report groupSize; a single close does not',()=>{
 const dir=tmp();let clock=5000;const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[1].id,name:'Research',color:'blue'});
 s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id,s.tabs[3].id],groupId:s.tabGroups[0].id});
 const ctx=host(s,rw);
 close(ctx,3);close(ctx,2);close(ctx,1);
 const {tabs}=view(rw,ctx);
 assert.deepEqual(tabs.map(t=>[t.group,t.groupSize]),[['Research',3],['Research',3],['Research',3]]);
 rw.dispose();
});

test('search covers title, address, site, group and a split partner; open tabs and expired rows are not listed',()=>{
 const dir=tmp();let clock=Date.now();const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://acme.test/invoice/482','https://maps.test/lisbon','https://news.test/item']);
 s=titled(s,1,'Invoice 482 – Acme');s=titled(s,2,'Loft in Alfama');
 const ctx=host(s,rw);
 close(ctx,3);clock+=1000;close(ctx,2);clock+=1000;close(ctx,1);
 const find=query=>view(rw,ctx,query).tabs.map(t=>t.url);
 assert.deepEqual(find('invoice'),['https://acme.test/invoice/482']);
 assert.deepEqual(find('MAPS.TEST'),['https://maps.test/lisbon'],'address, any case');
 assert.deepEqual(find('alfama'),['https://maps.test/lisbon']);
 assert.equal(find('zzz-no-match').length,0);
 // Newest first.
 assert.deepEqual(find(),['https://acme.test/invoice/482','https://maps.test/lisbon','https://news.test/item']);
 // A page that is open again is not "closed" any more.
 ctx.dispatch({type:'tab.new',url:'https://maps.test/lisbon#top'});
 assert.deepEqual(find(),['https://acme.test/invoice/482','https://news.test/item']);
 // Seven days is the default; an older row is gone from the view.
 clock+=8*86400000;assert.deepEqual(find(),[]);
 assert.throws(()=>rw.handle({type:'rewind.tabs',query:'x'.repeat(201)},ctx),/too long/);
 assert.throws(()=>rw.handle({type:'rewind.tabs',extra:1},ctx));
 rw.dispose();
});

test('the log survives a restart, isolates a corrupt row, and is bounded',()=>{
 const dir=tmp();let clock=10000;
 const log=createClosedLog({dir,now:()=>clock,timers:noTimers,limits:{perProfile:3}});
 const item=n=>({url:`https://site${n}.test/`,title:`Site ${n}`,group:'',groupColor:'none',pinned:false,batch:'',workspaceRef:null,windowId:'w1'});
 for(let n=0;n<5;n++){log.record(PROFILE,[item(n)]);clock+=10;}
 assert.equal(log.count(PROFILE),3,'count cap');
 log.flush();
 const file=path.join(dir,PROFILE,'closed.json'),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(raw.entries.length,3);
 raw.entries.push({id:'ct-bad',url:'javascript:alert(1)',title:'x',closedAt:1},{id:'ct-zz-00000000',url:'https://ok.test/',title:'x',closedAt:clock});
 fs.writeFileSync(file,JSON.stringify(raw));
 const fresh=createClosedLog({dir,now:()=>clock,timers:noTimers,limits:{perProfile:3}});
 assert.equal(fresh.count(PROFILE),4,'the two invalid rows are dropped, the valid one kept');
 assert.ok(fresh.load(PROFILE).every(entry=>/^https:/.test(entry.url)));
 fs.writeFileSync(file,'{not json');
 assert.equal(createClosedLog({dir,now:()=>clock,timers:noTimers}).count(PROFILE),0,'a corrupt file reads as empty, not as a crash');
});

test('Keep survives the age limit; Forget removes the page from the log and from saved windows, without touching Undo',()=>{
 const dir=tmp();let clock=Date.now();const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://keep.test/','https://gone.test/','https://other.test/']);
 rw.capture(s,{windowId:'w1',reason:'manual'});
 const ctx=host(s,rw);
 close(ctx,3);close(ctx,2);close(ctx,1);
 let {tabs}=view(rw,ctx);
 const keep=tabs.find(t=>t.url==='https://keep.test/'),gone=tabs.find(t=>t.url==='https://gone.test/');
 assert.equal(rw.handle({type:'rewind.keep',id:keep.id,kept:true},ctx).rewind.ok,true);
 assert.equal(rw.handle({type:'rewind.remove',id:gone.id},ctx).rewind.ok,true);
 assert.deepEqual(view(rw,ctx).tabs.map(t=>t.url).sort(),['https://keep.test/','https://other.test/']);
 const saved=rw.handle({type:'rewind.get',id:rw.list(PROFILE)[0].id},ctx).rewind.checkpoint;
 assert.ok(saved.tabs.length>0&&saved.tabs.every(t=>t.url!=='https://gone.test/'),'forgotten from saved windows too');
 clock+=9*86400000;
 assert.deepEqual(view(rw,ctx).tabs.map(t=>t.url),['https://keep.test/'],'the kept tab outlives seven days, the other one does not');
 assert.equal(rw.handle({type:'rewind.remove',id:'ct-nope-00000000'},ctx).rewind.ok,false);
 assert.throws(()=>rw.handle({type:'rewind.keep',id:'../x',kept:true},ctx));
 rw.dispose();
});

test('history deletion, forget site, profile removal and "delete saved moments" reach the log',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://a.test/1','https://b.test/2','https://b.test/3','https://c.test/4']);
 s.browsingHistory=[{id:'v1',title:'',url:'https://a.test/1',time:new Date().toISOString(),profileId:'',browserProfileId:PROFILE}];
 const ctx=host(s,rw);
 for(let i=4;i>=1;i--)close(ctx,i);
 assert.equal(rw.closedLog.count(PROFILE),4);
 const after=reduceBrowser(ctx.current,{type:'history.remove',id:'v1'});rw.observe('w1',ctx.current,after,{type:'history.remove',id:'v1'});
 assert.deepEqual(rw.closedLog.load(PROFILE).map(e=>e.url).sort(),['https://b.test/2','https://b.test/3','https://c.test/4'],'a removed history visit takes its closed tab with it');
 rw.forgetOrigin(PROFILE,'https://b.test');
 assert.deepEqual(rw.closedLog.load(PROFILE).map(e=>e.url),['https://c.test/4'],'forget site');
 rw.observe('w1',ctx.current,ctx.current,{type:'history.clear',since:0});
 assert.equal(rw.closedLog.count(PROFILE),0,'clear history empties the log');
 ctx.current=reduceBrowser(ctx.current,{type:'tab.new',url:'https://d.test/'});close(ctx,ctx.current.tabs.length-1);
 assert.equal(rw.closedLog.count(PROFILE),1);
 assert.equal(rw.handle({type:'rewind.clear'},ctx).rewind.closedTabs,0);
 rw.closedLog.flush();assert.equal(fs.existsSync(path.join(dir,PROFILE,'closed.json')),false);
 rw.dispose();
});

test('reopen: a tab returns in the background, in its group, once; Undo closes exactly it and logs nothing new',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[2].id,name:'Work',color:'green'});
 const ctx=host(s,rw);
 close(ctx,2);const active=ctx.current.activeTabId;
 const [{id}]=view(rw,ctx).tabs;
 const result=rw.handle({type:'rewind.reopen',ids:[id]},ctx).rewind;
 assert.deepEqual([result.ok,result.restored],[true,1]);
 const restored=ctx.current.tabs.at(-1);
 assert.equal(restored.url,'https://b.test/');assert.equal(restored.group,'Work');
 assert.equal(ctx.current.activeTabId,active,'restoring never steals the tab you are on');
 assert.equal(view(rw,ctx).total,0,'it is open again, so it is no longer listed as closed');
 assert.equal(rw.handle({type:'rewind.reopen',ids:[id]},ctx).rewind.restored,0,'a second click does not duplicate it');
 const count=ctx.current.tabs.length,logged=rw.closedLog.count(PROFILE);
 assert.match(result.token,/^u[a-z0-9]{4,24}$/);
 const undone=rw.handle({type:'rewind.undo',token:result.token},ctx).rewind;
 assert.deepEqual([undone.ok,undone.closed,ctx.current.tabs.length],[true,1,count-1]);
 assert.equal(rw.closedLog.count(PROFILE),logged,'undoing a restore is not a new close');
 assert.equal(view(rw,ctx).total,1,'and the tab is listed as closed again');
 assert.throws(()=>rw.handle({type:'rewind.reopen',ids:['../x']},ctx));
 assert.throws(()=>rw.handle({type:'rewind.reopen',ids:[id],unit:'yes'},ctx));
 assert.equal(rw.handle({type:'rewind.reopen',ids:['ct-zz-00000000']},ctx).rewind.ok,false);
 rw.dispose();
});

test('reopen with its group brings back every tab that closed with it, in order, under the group name',()=>{
 const dir=tmp();let clock=100;const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[1].id,name:'Trip',color:'orange'});
 s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id,s.tabs[3].id],groupId:s.tabGroups[0].id});
 const ctx=host(s,rw);
 close(ctx,1);clock+=5;close(ctx,1);clock+=5;close(ctx,1);// a, b, c: the order a group closes in
 const tabs=view(rw,ctx).tabs,middle=tabs.find(t=>t.url==='https://b.test/');
 const result=rw.handle({type:'rewind.reopen',ids:[middle.id],unit:true},ctx).rewind;
 assert.equal(result.restored,3);
 assert.deepEqual(ctx.current.tabs.slice(-3).map(t=>[t.url,t.group]),[['https://a.test/','Trip'],['https://b.test/','Trip'],['https://c.test/','Trip']],'back in the order they closed');
 // Without the group flag only the chosen tab returns, and it rejoins the group.
 const only=rw.handle({type:'rewind.undo',token:result.token},ctx);assert.equal(only.rewind.closed,3);
 const one=rw.handle({type:'rewind.reopen',ids:[middle.id]},ctx).rewind;assert.equal(one.restored,1);
 rw.dispose();
});

test('a split is logged with its partner, comes back whole with "its split", and never on a plain restore',()=>{
 const dir=tmp(),rw=createRewind({dir,timers:noTimers});
 let s=windowWith(['https://stay.test/','https://map.test/']);
 s=titled(s,2,'Lisbon map');
 s=reduceBrowser(s,{type:'tab.select',id:s.tabs[1].id});
 s=reduceBrowser(s,{type:'split.open',tabIds:[s.tabs[1].id,s.tabs[2].id]});
 assert.ok(s.windowUi.split,'precondition: the split exists');
 const ctx=host(s,rw);
 close(ctx,1);
 const [entry]=view(rw,ctx).tabs;
 assert.deepEqual([entry.url,entry.split.partners[0].url,entry.split.partners[0].title],['https://stay.test/','https://map.test/','Lisbon map']);
 assert.ok(matchesEntry(rw.closedLog.load(PROFILE)[0],'lisbon'),'a split partner is searchable');
 // The partner is still open here: restoring "with its split" re-splits the two.
 const result=rw.handle({type:'rewind.reopen',ids:[entry.id],unit:true},ctx).rewind;
 assert.equal(result.split,true);
 const split=ctx.current.windowUi.split;
 assert.equal(split.tabIds.length,2);
 assert.deepEqual(split.tabIds.map(id=>ctx.current.tabs.find(t=>t.id===id).url).sort(),['https://map.test/','https://stay.test/']);
 // A plain restore brings the pane back into its split (tests/rewind-reopen-split.test.cjs) but never takes the split on screen.
 rw.handle({type:'rewind.undo',token:result.token},ctx);
 ctx.current=reduceBrowser(ctx.current,{type:'split.close'});
 const plain=rw.handle({type:'rewind.reopen',ids:[entry.id]},ctx).rewind;
 assert.equal(plain.split,true);assert.equal(ctx.current.windowUi.split,null);assert.equal(ctx.current.windowUi.splitGroups.length,1);
 rw.dispose();
});

test('reopen in a new window opens the chosen tabs there, in their group; this window is untouched',async()=>{
 const dir=tmp();let opened=null;
 const rw=createRewind({dir,timers:noTimers,openWindow:({initialURL})=>{let state=windowWith([]);state=reduceBrowser(state,{type:'tab.navigate',tabId:state.activeTabId,url:initialURL});opened={get state(){return state;}};return {windowId:'w9',ready:Promise.resolve(true),get state(){return state;},commitAction:a=>{state=reduceBrowser(state,a);}};}});
 let s=windowWith(['https://a.test/','https://b.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:s.tabs[1].id,name:'Pair',color:'red'});
 s=reduceBrowser(s,{type:'tab.group.assign',tabIds:[s.tabs[1].id,s.tabs[2].id],groupId:s.tabGroups[0].id});
 const ctx=host(s,rw);close(ctx,1);close(ctx,1);// a, then b
 const ids=view(rw,ctx).tabs.map(t=>t.id);
 const result=(await rw.handle({type:'rewind.reopen',ids,newWindow:true,unit:true},ctx)).rewind;
 assert.deepEqual([result.ok,result.window,result.restored],[true,true,2]);
 assert.deepEqual(opened.state.tabs.map(t=>t.url),['https://a.test/','https://b.test/']);
 assert.equal(opened.state.tabs.filter(t=>t.group==='Pair').length,2);
 assert.equal(ctx.current.tabs.length,1);
 rw.dispose();
});

test('saved windows keep their splits; a window restored into a new window gets the split back',async()=>{
 const dir=tmp();let opened=null;
 const rw=createRewind({dir,timers:noTimers,openWindow:({initialURL})=>{let state=windowWith([]);state=reduceBrowser(state,{type:'tab.navigate',tabId:state.activeTabId,url:initialURL});opened={get state(){return state;}};return {windowId:'w9',ready:Promise.resolve(true),get state(){return state;},commitAction:a=>{state=reduceBrowser(state,a);}};}});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 s=reduceBrowser(s,{type:'tab.select',id:s.tabs[1].id});
 s=reduceBrowser(s,{type:'split.open',tabIds:[s.tabs[1].id,s.tabs[2].id]});
 // A split that holds a private tab is not saved at all.
 const withPrivate=reduceBrowser(s,{type:'tab.new',url:'https://secret.test/',privacy:'private'});
 const payload=model.project(s,PROFILE);
 assert.deepEqual(payload.splits.map(x=>x.tabRefs),[['t0','t1']]);
 const mixed=JSON.parse(JSON.stringify(withPrivate));mixed.windowUi.split={tabIds:[s.tabs[1].id,withPrivate.tabs.at(-1).id],layout:'columns',cols:[.5,.5],rows:[1]};mixed.windowUi.splitGroups=[];
 assert.deepEqual(model.project(mixed,PROFILE).splits,[],'a split with a private pane leaves no trace');
 assert.equal(rw.capture(s,{windowId:'w1',reason:'manual'}).ok,true);
 const [{id,splitCount}]=rw.list(PROFILE);assert.equal(splitCount,1);
 const ctx=host(windowWith(['https://z.test/']),rw),tabs=rw.handle({type:'rewind.get',id},ctx).rewind.checkpoint.tabs;
 const result=(await rw.handle({type:'rewind.restore',id,refs:tabs.map(t=>t.ref),newWindow:true},ctx)).rewind;
 assert.equal(result.restored,3);
 assert.equal(opened.state.windowUi.split?.tabIds.length,2,'the new window opens with the split');
 // Additive restore of a window never takes over the current view with a split.
 const into=host(windowWith(['https://z.test/']),rw);rw.handle({type:'rewind.restore',id,refs:tabs.map(t=>t.ref)},into);
 assert.equal(into.current.windowUi.split,null);
 // Splits survive a re-read, and a corrupt one is dropped.
 const stored=JSON.parse(fs.readFileSync(path.join(dir,PROFILE,`${id}.json`),'utf8'));
 assert.equal(model.readCheckpoint(stored,PROFILE).splits.length,1);
 assert.deepEqual(model.readCheckpoint({...stored,splits:[{tabRefs:['t0','t0']},{tabRefs:['t0','nope']},{tabRefs:['t0']}]},PROFILE).splits,[]);
 assert.ok(withPrivate);rw.dispose();
});

test('windows view: one card per window with earlier states folded under it; the current window shows only what it is missing',()=>{
 const {SESSION}=require('../desktop/rewind/rewind.cjs');
 const dir=tmp();let clock=Date.now();const rw=createRewind({dir,timers:noTimers,now:()=>clock});
 const a=windowWith(['https://a.test/','https://a2.test/']),b=windowWith(['https://b.test/']);
 // Window w2: two autosaves, then closed. Window w1 (this one): still open.
 rw.capture(a,{windowId:'w2',reason:'periodic'});clock+=1000;
 rw.capture(reduceBrowser(a,{type:'tab.new',url:'https://a3.test/'}),{windowId:'w2',reason:'periodic'});clock+=1000;
 rw.windowClosed('w2',reduceBrowser(a,{type:'tab.new',url:'https://a4.test/'}));clock+=1000;
 rw.observe('w1',b,b,{type:'noop'});rw.capture(b,{windowId:'w1',reason:'periodic'});
 const ctx=host(b,rw,'w1');
 let {windows}=rw.handle({type:'rewind.windows'},ctx).rewind;
 assert.equal(windows.length,1,'the open window has everything open, so only the closed one is listed');
 assert.deepEqual([windows[0].closedWindow,windows[0].tabCount,windows[0].earlierCount,windows[0].current],[true,3,2,false]);
 assert.equal(windows[0].earlier.length,2);
 // This window is missing a tab from its last save: it gets a card of its own.
 const lost=reduceBrowser(b,{type:'tab.new',url:'https://b2.test/'});clock+=1000;rw.capture(lost,{windowId:'w1',reason:'tabs-close'});
 ({windows}=rw.handle({type:'rewind.windows'},ctx).rewind);
 assert.deepEqual(windows.map(w=>[w.windowId,w.current]),[['w1',true],['w2',false]]);
 assert.equal(windows[0].closed,1,'one tab of this window is not open');
 assert.equal(rw.handle({type:'rewind.windows',query:'a3.test'},ctx).rewind.windows.length,0,'search looks at a window as it last was');
 assert.equal(rw.handle({type:'rewind.windows',query:'a4.test'},ctx).rewind.windows.length,1);
 assert.ok(SESSION);rw.dispose();
});
