'use strict';
// Beta.12 item 15: "Put to sleep" from a tab's, a group's and a workspace's menu. The sleep itself is the Memory Saver's own
// (desktop/tab-sleep.cjs): sleepNow takes the idle sweep's protections and its adapter, and skips only the waiting.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTabSleep,stayAwakeKind}=require('../desktop/tab-sleep.cjs');
const {validateAction}=require('../desktop/validation.cjs');

const MIN=60*1000;
function harness({visible=['a'],protect={},refuse=new Set(),ids=['a','b','c','d','e'],settings={enabled:true,idleMinutes:15,neverSleep:[]}}={}){
 let time=1_000_000;const calls=[],on=new Set(visible),tabs=new Map(ids.map(id=>[id,{id}])),seen=[];
 const adapter={tabs:()=>[...tabs.values()],isVisible:id=>on.has(id),
  protectedReason:async(tab,choice)=>{calls.push(['check',tab.id]);seen.push(choice);if(protect[tab.id]==='throw')throw new Error('page is gone');return protect[tab.id]||null;},
  sleep:async id=>{calls.push(['sleep',id]);if(refuse.has(id))return {slept:false,reason:'page-asked-to-stay'};tabs.delete(id);return {slept:true};},
  freeze:async id=>{calls.push(['freeze',id]);return true;},unfreeze:async id=>{calls.push(['unfreeze',id]);}};
 const sleeper=createTabSleep({adapter,settings:()=>settings,now:()=>time,freezeAfterMs:5*MIN,memory:()=>({free:4*1024**3,total:8*1024**3})});
 return {sleeper,calls,tabs,seen,advance:ms=>{time+=ms;}};
}

test('Put to sleep sleeps the tabs it may and keeps the tab on screen, protected tabs and refusals awake, each with its reason',async()=>{
 const h=harness({protect:{c:'audio',d:'edited-form'},refuse:new Set(['e'])});
 const report=await h.sleeper.sleepNow(['a','b','c','d','e']);
 assert.deepEqual(report.slept,['b']);
 assert.deepEqual(report.stayed,{a:'visible',c:'audio',d:'edited-form',e:'page-asked-to-stay'});
 assert.deepEqual(report.asleep,[]);
 assert.ok(!h.calls.some(call=>call[1]==='a'),'the tab on screen is never even inspected, let alone closed');
 assert.ok(!h.calls.some(call=>call[0]==='sleep'&&['c','d'].includes(call[1])),'a protected tab is never closed');
 assert.ok(!h.tabs.has('b')&&h.tabs.has('c')&&h.tabs.has('d')&&h.tabs.has('e')&&h.tabs.has('a'));
});

test('it asks the same protections as the idle sweep, with the person\'s never-sleep list, and the Memory Saver switch does not matter',async()=>{
 const h=harness({settings:{enabled:false,idleMinutes:30,neverSleep:['mail.example.com']}});
 const report=await h.sleeper.sleepNow(['b','c']);
 assert.deepEqual(report.slept,['b','c'],'turning the automatic sleep off does not stop a request');
 assert.ok(h.seen.length===2&&h.seen.every(choice=>choice.neverSleep.includes('mail.example.com')&&choice.idleMinutes===30),'protectedReason gets the validated Memory Saver settings, so the never-sleep list and the pinned, audio, capture and download rules apply');
});

test('a tab with no page is already asleep, and an unknown or repeated id is harmless',async()=>{
 const h=harness();
 const report=await h.sleeper.sleepNow(['zz','b','b',7,null,'b']);
 assert.deepEqual(report.slept,['b'],'once');
 assert.deepEqual(report.asleep,['zz']);
 assert.equal(h.calls.filter(call=>call[0]==='sleep').length,1);
 assert.deepEqual(await h.sleeper.sleepNow(undefined),{slept:[],stayed:{},asleep:[]});
 assert.deepEqual(await h.sleeper.sleepNow([]),{slept:[],stayed:{},asleep:[]});
});

test('a frozen page is woken before the safety check, and a slept tab is forgotten',async()=>{
 const h=harness();
 await h.sleeper.sweep();h.advance(6*MIN);await h.sleeper.sweep();
 assert.ok(h.sleeper.frozen('b'));h.calls.length=0;
 const report=await h.sleeper.sleepNow(['b']);
 assert.deepEqual(report.slept,['b']);
 assert.deepEqual(h.calls.slice(0,3),[['unfreeze','b'],['check','b'],['sleep','b']],'a frozen page cannot run the check');
 assert.ok(!h.sleeper.frozen('b'));
});

test('a page that cannot be inspected stays awake and the others still go to sleep',async()=>{
 const h=harness({protect:{b:'throw'}});
 const report=await h.sleeper.sleepNow(['b','c','d']);
 assert.deepEqual(report.slept,['c','d']);
 assert.equal(report.stayed.b,'not-safe');
});

test('a whole workspace worth of tabs is handled a few at a time and every tab is answered',async()=>{
 const ids=Array.from({length:23},(_,i)=>'t'+i),tabs=new Map(ids.map(id=>[id,{id}]));let running=0,most=0;
 const adapter={tabs:()=>[...tabs.values()],isVisible:id=>id==='t0',
  protectedReason:async tab=>{running++;most=Math.max(most,running);await new Promise(resolve=>setTimeout(resolve,2));running--;return tab.id==='t5'?'recently-audible':tab.id==='t11'?'pinned':null;},
  sleep:async id=>{tabs.delete(id);return {slept:true};},freeze:async()=>true,unfreeze:async()=>{}};
 const sleeper=createTabSleep({adapter,settings:()=>({enabled:true,idleMinutes:15,neverSleep:[]}),now:()=>1,memory:()=>({free:4*1024**3,total:8*1024**3})});
 const report=await sleeper.sleepNow(ids);
 assert.equal(report.slept.length,20);
 assert.deepEqual(Object.keys(report.stayed).sort(),['t0','t11','t5']);
 assert.equal(report.slept.length+Object.keys(report.stayed).length+report.asleep.length,23,'every tab is accounted for');
 assert.ok(most>1&&most<=4,'checked in small batches, not one by one and not all at once: '+most);
});

test('the toast says plainly why a tab stayed awake',()=>{
 for(const reason of ['audio','recently-audible','capturing','playing-media-or-live-stream','picture-in-picture'])assert.equal(stayAwakeKind(reason),'media',reason);
 for(const reason of ['edited-form','credential-or-file-input','editable-or-canvas-content'])assert.equal(stayAwakeKind(reason),'edits',reason);
 assert.equal(stayAwakeKind('visible'),'screen');
 for(const reason of ['pinned','never-sleep','notifications','download','busy','private','internal','inspecting','page-asked-to-stay','not-safe','pdf'])assert.equal(stayAwakeKind(reason),'other',reason);
});

test('the tab.sleep action is checked at the boundary: a list of this window\'s tabs, nothing else',()=>{
 const snapshot={tabs:[{id:'a'},{id:'b'}]};
 assert.doesNotThrow(()=>validateAction({type:'tab.sleep',tabIds:['a','b']},snapshot));
 assert.throws(()=>validateAction({type:'tab.sleep',tabIds:['a','nope']},snapshot),/outside the current tabs scope/);
 assert.throws(()=>validateAction({type:'tab.sleep'},snapshot));
 assert.throws(()=>validateAction({type:'tab.sleep',tabIds:'a'},snapshot));
 assert.throws(()=>validateAction({type:'tab.sleep',tabIds:['a'],extra:1},snapshot));
 assert.throws(()=>validateAction({type:'tab.sleep',tabIds:Array.from({length:501},(_,i)=>'t'+i)},{tabs:Array.from({length:501},(_,i)=>({id:'t'+i}))}));
});

test('main wires the action to sleepNow, and every message it speaks is in the English catalog',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),en=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n/en.json'),'utf8'));
 assert.match(main,/actionNames\.add\('tab\.sleep'\)/,'the renderer may send it');
 assert.match(main,/function nativeAction\(action\)\{if\(action\.type==='tab\.sleep'\)\{void sleepTabsNow\(action\.tabIds\);return true;\}/,'main handles it, the reducer never sees it');
 const body=main.slice(main.indexOf('async function sleepTabsNow(ids)'),main.indexOf('function tabSleepWake()'));
 assert.ok(body.includes('tabSleep.sleepNow(ids)'),'the Memory Saver\'s own sleep, with its adapter');
 assert.ok(body.includes('if(!tabSleep)'),'a private window keeps every tab awake and says so');
 const keys=[...body.matchAll(/'(tabsleep\.[A-Za-z]+)'/g)].map(match=>match[1]);
 assert.ok(keys.length>=8);
 for(const key of keys)assert.ok(en[key],key+' is in en.json');
 assert.deepEqual(Object.keys(en).filter(key=>key.startsWith('tabsleep.')).sort(),[...new Set([...keys,'tabsleep.menuTab','tabsleep.menuGroup','tabsleep.menuWorkspace','tabsleep.tipSleeping'])].sort(),'no unused or missing tabsleep strings');
});
