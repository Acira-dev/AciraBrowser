'use strict';
// Rewind's "Recently closed" reopen puts a closed split pane back into its split, at its slot, linked again when it was a linked copy:
// the same path Undo / Ctrl+Shift+T take (rejoinSplit), fed from the closed-tab log's addresses instead of tab ids.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createRewind}=require('../desktop/rewind/rewind.cjs');
const {createClosedLog}=require('../desktop/rewind/closed-log.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-reopen-split-'));
const noTimers={setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}};
const PROFILE='profile-personal';
const windowWith=urls=>{let s=createInitialState();for(const url of urls)s=reduceBrowser(s,{type:'tab.new',url});return s;};
function host(state,rw,windowId='w1'){
 const ctx={windowId,privateMode:false,current:state,state:()=>ctx.current,dispatch:action=>{const before=ctx.current;ctx.current=reduceBrowser(before,action);rw.observe(windowId,before,ctx.current,action);return ctx.current;}};
 return ctx;
}
const byUrl=(ctx,url)=>ctx.current.tabs.find(tab=>tab.url===url);
const urlsOf=(ctx,group)=>group.tabIds.map(id=>ctx.current.tabs.find(tab=>tab.id===id)?.url);
const splitOfTab=(ctx,id)=>(ctx.current.windowUi.splitGroups||[]).find(group=>group.tabIds.includes(id));
const entryOf=(rw,ctx,url)=>rw.handle({type:'rewind.tabs'},ctx).rewind.tabs.find(tab=>tab.url===url);

test('a pane of a three-pane split comes back at its slot with the split\'s layout',()=>{
 const rw=createRewind({dir:tmp(),timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/','https://c.test/']);
 s=reduceBrowser(s,{type:'tab.select',id:byUrl({current:s},'https://a.test/').id});
 s=reduceBrowser(s,{type:'split.open',tabIds:s.tabs.slice(1).map(tab=>tab.id),layout:'three-rows'});
 const ctx=host(s,rw),before=splitOfTab(ctx,byUrl(ctx,'https://b.test/').id);
 assert.deepEqual(urlsOf(ctx,before),['https://a.test/','https://b.test/','https://c.test/']);
 ctx.dispatch({type:'tab.close',id:byUrl(ctx,'https://b.test/').id});
 assert.equal(rw.closedLog.load(PROFILE)[0].split.slot,1,'the log remembers the slot (one partner before it)');
 const entry=entryOf(rw,ctx,'https://b.test/');assert.ok(entry,'listed in Recently closed');
 const activeBefore=ctx.current.activeTabId;
 const result=rw.handle({type:'rewind.reopen',ids:[entry.id]},ctx).rewind;
 assert.equal(result.ok,true);
 assert.equal(ctx.current.activeTabId,activeBefore,'a reopen is a background action: the active tab does not change');assert.equal(result.split,true,'the page can say it came back with its split');
 const back=splitOfTab(ctx,byUrl(ctx,'https://b.test/').id);
 assert.deepEqual(urlsOf(ctx,back),['https://a.test/','https://b.test/','https://c.test/'],'at its slot, not appended');
 assert.equal(back.layout,'three-rows','the old layout is back because every pane is');
 assert.equal(back.id,before.id,'the saved split itself, not a new one');
 // Undo closes exactly the reopened tab; the split shrinks again.
 rw.handle({type:'rewind.undo',token:result.token},ctx);
 assert.equal(splitOfTab(ctx,byUrl(ctx,'https://a.test/').id).tabIds.length,2);
 rw.dispose();
});

test('the first pane of a two-pane split ends with the close; reopening makes the split again, first',()=>{
 const rw=createRewind({dir:tmp(),timers:noTimers});
 let s=windowWith(['https://left.test/','https://right.test/']);
 s=reduceBrowser(s,{type:'tab.select',id:byUrl({current:s},'https://left.test/').id});
 s=reduceBrowser(s,{type:'split.open',tabIds:s.tabs.slice(1).map(tab=>tab.id)});
 const ctx=host(s,rw);
 ctx.dispatch({type:'tab.close',id:byUrl(ctx,'https://left.test/').id});
 assert.equal(splitOfTab(ctx,byUrl(ctx,'https://right.test/').id),undefined,'the split ended');
 const result=rw.handle({type:'rewind.reopen',ids:[entryOf(rw,ctx,'https://left.test/').id]},ctx).rewind;
 assert.equal(result.split,true);
 const back=splitOfTab(ctx,byUrl(ctx,'https://left.test/').id);
 assert.deepEqual(urlsOf(ctx,back),['https://left.test/','https://right.test/']);
 rw.dispose();
});

test('a tab that was linked into a loose split is linked again, and keeps its group',()=>{
 const rw=createRewind({dir:tmp(),timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/','https://g.test/']);
 s=reduceBrowser(s,{type:'tab.group.create',tabId:byUrl({current:s},'https://g.test/').id,name:'Docs',color:'blue'});
 s=reduceBrowser(s,{type:'tab.select',id:byUrl({current:s},'https://a.test/').id});
 s=reduceBrowser(s,{type:'split.open',tabIds:[byUrl({current:s},'https://a.test/').id,byUrl({current:s},'https://b.test/').id]});
 s=reduceBrowser(s,{type:'split.group.add',id:splitOfTab({current:s},byUrl({current:s},'https://a.test/').id).id,tabId:byUrl({current:s},'https://g.test/').id});
 const ctx=host(s,rw),linked=splitOfTab(ctx,byUrl(ctx,'https://g.test/').id);
 assert.deepEqual(linked.linked,[byUrl(ctx,'https://g.test/').id],'precondition: the grouped tab is a linked copy');
 ctx.dispatch({type:'tab.close',id:byUrl(ctx,'https://g.test/').id});
 const logged=rw.closedLog.load(PROFILE)[0];assert.equal(logged.split.linked,true);assert.equal(logged.group,'Docs');
 const result=rw.handle({type:'rewind.reopen',ids:[entryOf(rw,ctx,'https://g.test/').id]},ctx).rewind;
 assert.equal(result.split,true);
 const tab=byUrl(ctx,'https://g.test/'),back=splitOfTab(ctx,tab.id);
 assert.deepEqual(back.linked,[tab.id],'linked again');
 assert.equal(tab.group,'Docs','and back in its group');
 assert.deepEqual(urlsOf(ctx,back).sort(),['https://a.test/','https://b.test/','https://g.test/']);
 assert.equal(ctx.current.tabs.find(item=>item.id===back.home).url,'https://a.test/','the home pane is still the pane the split was made from');
 rw.dispose();
});

test('no partner open, or the partner is in another split now: the tab comes back alone, as before',()=>{
 const rw=createRewind({dir:tmp(),timers:noTimers});
 let s=windowWith(['https://a.test/','https://b.test/','https://x.test/','https://y.test/']);
 const id=url=>byUrl({current:s},url).id;
 s=reduceBrowser(s,{type:'tab.select',id:id('https://a.test/')});
 s=reduceBrowser(s,{type:'split.open',tabIds:[id('https://a.test/'),id('https://b.test/')]});
 const ctx=host(s,rw);
 // Both panes closed: the partner is not open, so there is nothing to rejoin.
 ctx.dispatch({type:'tab.close',id:id('https://b.test/')});
 ctx.dispatch({type:'tab.close',id:byUrl(ctx,'https://a.test/').id});
 const lone=rw.handle({type:'rewind.reopen',ids:[entryOf(rw,ctx,'https://a.test/').id]},ctx).rewind;
 assert.equal(lone.restored,1);assert.equal(lone.split,false);assert.equal(splitOfTab(ctx,byUrl(ctx,'https://a.test/').id),undefined);
 // The partner (a) is now in a different split with x: reopening b must not pull it into that split.
 ctx.dispatch({type:'tab.select',id:byUrl(ctx,'https://x.test/').id});
 ctx.dispatch({type:'split.open',tabIds:[byUrl(ctx,'https://x.test/').id,byUrl(ctx,'https://a.test/').id]});
 const other=rw.handle({type:'rewind.reopen',ids:[entryOf(rw,ctx,'https://b.test/').id]},ctx).rewind;
 assert.equal(other.restored,1);assert.equal(other.split,false);
 assert.equal(splitOfTab(ctx,byUrl(ctx,'https://b.test/').id),undefined);
 assert.deepEqual(urlsOf(ctx,splitOfTab(ctx,byUrl(ctx,'https://a.test/').id)).sort(),['https://a.test/','https://x.test/'],'the other split is untouched');
 rw.dispose();
});

test('slot and linked survive the log file; an old row without them still reads',()=>{
 const dir=tmp(),log=createClosedLog({dir,timers:noTimers});
 const [row]=log.record(PROFILE,[{url:'https://k.test/',title:'K',group:'',groupColor:'none',pinned:false,batch:'',workspaceRef:null,windowId:'w1',
  split:{layout:'columns',slot:1,linked:true,partners:[{url:'https://p.test/',title:'P',linked:true},{url:'https://q.test/',title:'Q'}]}}]);
 assert.deepEqual([row.split.slot,row.split.linked,row.split.partners.map(p=>!!p.linked)],[1,true,[true,false]]);
 log.flush();
 const again=createClosedLog({dir,timers:noTimers}).load(PROFILE)[0];
 assert.deepEqual([again.split.slot,again.split.linked,again.split.partners[0].linked],[1,true,true]);
 const [old]=log.record(PROFILE,[{url:'https://old.test/',title:'Old',split:{layout:'rows',partners:[{url:'https://p.test/',title:'P'}]}}]);
 assert.equal(old.split.slot,1,'no slot saved: after its partners');assert.equal(old.split.linked,undefined);
 const [wild]=log.record(PROFILE,[{url:'https://wild.test/',title:'W',split:{layout:'rows',slot:99,partners:[{url:'https://p.test/',title:'P'}]}}]);
 assert.equal(wild.split.slot,1,'a slot past the partners is clamped');
});
