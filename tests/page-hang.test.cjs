'use strict';
// A page stuck in an endless loop held its tab for good: Stop, Reload and a new address all need the page's own process, and nothing
// listened for 'unresponsive'. page-hang.cjs asks "This page isn't responding" (Wait / Close page) and ends a page that cannot answer
// Stop, Reload or a new address within a few seconds, then repeats the action.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createPageHang}=require('../desktop/page-hang.cjs');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

function page({answers=true}={}){
 const wc=new EventEmitter();let destroyed=false;wc.crashes=0;wc.scripts=0;
 wc.isDestroyed=()=>destroyed;wc.destroy=()=>{destroyed=true;};
 wc.mainFrame={processId:7,routingId:1,executeJavaScript:()=>{wc.scripts++;return answers?Promise.resolve(0):new Promise(()=>{});}};
 wc.forcefullyCrashRenderer=()=>{wc.crashes++;wc.emit('render-process-gone',{},{reason:'killed'});};
 return wc;
}
function rig(){const timers=[],asked=[];let answer=null;const changes=[];
 const hang=createPageHang({ask:question=>{asked.push(question);return new Promise(resolve=>{answer=resolve;});},onChange:()=>changes.push(1),setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;}});
 const flush=async()=>{await new Promise(r=>setImmediate(r));while(timers.length){const {fn}=timers.shift();fn();await new Promise(r=>setImmediate(r));}};
 return {hang,asked,timers,changes,flush,answer:value=>answer(value)};}

test('an unresponsive page asks Wait / Close page once; Close page ends its process',async()=>{
 const r=rig(),wc=page();r.hang.watch(wc,{host:()=>'stuck.example'});
 wc.emit('unresponsive');wc.emit('unresponsive');
 assert.equal(r.asked.length,1,'one question at a time');assert.equal(r.asked[0].host,'stuck.example');assert.equal(r.asked[0].contents,wc);
 assert.equal(r.asked[0].stale(),false);
 r.answer(true);await r.flush();assert.equal(wc.crashes,1,'Close page ends the page\'s process (the tab then shows its error page)');
});

test('Wait leaves the page alone and asks again next time; a page that answers again takes the question away',async()=>{
 const r=rig(),wc=page();r.hang.watch(wc);
 wc.emit('unresponsive');r.answer(false);await r.flush();assert.equal(wc.crashes,0,'Wait');
 wc.emit('unresponsive');assert.equal(r.asked.length,2,'still stuck: asked again');
 wc.emit('responsive');assert.equal(r.asked[1].stale(),true,'the page answered: the card is stale');assert.equal(r.changes.length,1,'and the prompt is told to drop it');
 r.answer(true);await r.flush();assert.equal(wc.crashes,0,'a late Close page on a page that recovered does nothing');
});

test('Stop, Reload or a new address on a page that gives no answer ends it after the wait, then repeats the action',async()=>{
 const r=rig(),wc=page({answers:false});let redone=0;
 r.hang.recover(wc,()=>redone++);assert.equal(r.timers[0].ms,4000,'a few seconds');
 await r.flush();assert.equal(wc.crashes,1);assert.equal(redone,1,'the action runs again on a fresh process');
 const stop=page({answers:false});r.hang.recover(stop,null);await r.flush();assert.equal(stop.crashes,1,'Stop just ends it (the error page offers Reload)');
});

test('a page that answers, a document that replaced it, or a later action is left alone',async()=>{
 const r=rig(),fine=page();let redone=0;r.hang.recover(fine,()=>redone++);await r.flush();assert.deepEqual([fine.crashes,redone],[0,0],'it answered');
 const moved=page({answers:false});r.hang.recover(moved,()=>redone++);moved.mainFrame={...moved.mainFrame,processId:8};await r.flush();assert.equal(moved.crashes,0,'another process shows the page now');
 const twice=page({answers:false});let first=0,second=0;r.hang.recover(twice,()=>first++);r.hang.recover(twice,()=>second++);await r.flush();assert.deepEqual([twice.crashes,first,second],[1,0,1],'only the latest action is repeated');
 const gone=page({answers:false});r.hang.recover(gone,()=>redone++);gone.destroy();await r.flush();assert.equal(gone.crashes,0,'a closed tab');
});

test('main asks with the in-window card and recovers Stop, Reload, the reload shortcut and a new address',()=>{
 assert.ok(main.includes("const pageHang=require('./page-hang.cjs').createPageHang({ask:async({contents,host,stale})=>(await siteDialog({type:'warning',title:tm(\"main.pageNotResponding\"),message:tm(\"main.pageNotResponding\")"));
 assert.ok(main.includes('buttons:[tm("main.wait"),tm("main.closePage")],defaultId:0,cancelId:0,site:{centered:true,contents,host,stale}})).response===1'),'Wait is the default; Close page is the second button');
 assert.ok(main.includes("pageHang.watch(wc,{host:()=>"),'every page is watched');
 assert.ok(main.includes('reload();pageHang.recover(wc,reload);')&&main.includes('reload();pageHang.recover(page,reload);'),'Reload, button and shortcut');
 assert.ok(main.includes("wc.stop();browserEvent(tab.id,{loading:false});pageHang.recover(wc,null);"),'Stop');
 assert.ok(main.includes("if(!first){const load=entry.loads=(entry.loads||0)+1;pageHang.recover(wc,()=>{if(entry.loads===load&&pages.get(tab.id)===entry){entry.loadedURL=tab.url;"),'a new address (not the first load of a tab), unless a newer one started; the stopped load had put the old address back');
});

test('a page waiting on its own alert() card is blocked on purpose: Stop, Reload or a new address never end it',async()=>{
 const {createJsDialogs}=require('../desktop/browser-services/js-dialogs.cjs');
 const wc=page({answers:false});let answer;
 const controller={closing:false,pages:new Map([['tab-1',{view:{webContents:wc}}]]),sitePrompt:{enabled:()=>true,showMessageBox:()=>new Promise(resolve=>{answer=resolve;})}};
 wc.getURL=()=>'https://example.com/';
 const dialogs=createJsDialogs({controllers:new Set([controller]),t:id=>id});
 const event={sender:wc,senderFrame:{url:'https://example.com/'},returnValue:undefined};dialogs.handle(event,{kind:'alert',message:'Saved'});
 assert.equal(dialogs.waiting(wc),true,'the card is open');
 const timers=[],hang=createPageHang({ask:async()=>false,waiting:dialogs.waiting,setTimer:fn=>timers.push(fn)});
 hang.recover(wc,()=>{});assert.equal(timers.length,0,'no probe while the page waits for the person');
 answer({response:0});await new Promise(r=>setImmediate(r));assert.deepEqual(event.returnValue,{ok:true});assert.equal(dialogs.waiting(wc),false,'answered: the page runs again');
 hang.recover(wc,()=>{});assert.equal(timers.length,1,'and is watched as usual');
 assert.ok(main.includes('waiting:wc=>Boolean(jsDialogs?.waiting(wc))'),'main tells page-hang about open dialogs');
});
