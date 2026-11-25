'use strict';
// Beta.12 item 15 ("Unload tab" from 13.10): "Put to sleep" from a tab's, a group's and a workspace's menu. The sleep itself is the Memory Saver's own
// (desktop/tab-sleep.cjs): sleepNow takes the idle sweep's protections and its adapter, and skips only the waiting.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTabSleep,stayAwakeKind}=require('../desktop/tab-sleep.cjs');
const {validateAction}=require('../desktop/validation.cjs');

const MIN=60*1000;
function harness({visible=['a'],protect={},refuse=new Set(),ids=['a','b','c','d','e'],settings={enabled:true,idleMinutes:15,neverSleep:[]}}={}){
 let time=1_000_000;const calls=[],on=new Set(visible),tabs=new Map(ids.map(id=>[id,{id}])),seen=[],contexts=[];
 const adapter={tabs:()=>[...tabs.values()],isVisible:id=>on.has(id),
  protectedReason:async(tab,choice,context)=>{calls.push(['check',tab.id]);seen.push(choice);contexts.push(context);if(protect[tab.id]==='throw')throw new Error('page is gone');return protect[tab.id]||null;},
  sleep:async id=>{calls.push(['sleep',id]);if(refuse.has(id))return {slept:false,reason:'page-asked-to-stay'};tabs.delete(id);return {slept:true};},
  freeze:async id=>{calls.push(['freeze',id]);return true;},unfreeze:async id=>{calls.push(['unfreeze',id]);}};
 const sleeper=createTabSleep({adapter,settings:()=>settings,now:()=>time,freezeAfterMs:5*MIN,memory:()=>({free:4*1024**3,total:8*1024**3})});
 return {sleeper,calls,tabs,seen,contexts,advance:ms=>{time+=ms;}};
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
 assert.ok(body.includes('tabSleep.sleepNow(wanted,{explicit:wanted.length===1})'),'the Memory Saver\'s own sleep, with its adapter; one tab the person named is an explicit request (13.10)');
 assert.ok(body.includes('if(!tabSleep)'),'a private window keeps every tab awake and says so');
 const keys=[...body.matchAll(/'(tabsleep\.[A-Za-z]+)'/g)].map(match=>match[1]);
 assert.ok(keys.length>=8);
 for(const key of keys)assert.ok(en[key],key+' is in en.json');
 assert.deepEqual(Object.keys(en).filter(key=>key.startsWith('tabsleep.')).sort(),[...new Set([...keys,'tabsleep.menuTab','tabsleep.menuGroup','tabsleep.menuWorkspace','tabsleep.tipSleeping'])].sort(),'no unused or missing tabsleep strings');
});

test('13.10 Unload tab: one tab the person named is an explicit request, a group or workspace row is not',async()=>{
 const h=harness({visible:[]});
 await h.sleeper.sleepNow(['b'],{explicit:true});
 assert.deepEqual(h.contexts,[{explicit:true}],'protectedReason hears that the person asked (a pinned tab, the never-sleep list and notification sites no longer keep it)');
 const g=harness({visible:[]});
 await g.sleeper.sleepNow(['b','c']);
 assert.deepEqual(g.contexts,[undefined,undefined],'a bulk row keeps every protection of the automatic sleep');
});

test('13.10: check() says why a tab would stay, without unloading it, and wakes a frozen page first',async()=>{
 const h=harness({visible:['a'],protect:{a:'audio'}});
 assert.equal(await h.sleeper.check('a',{explicit:true}),'audio');
 assert.equal(await h.sleeper.check('b',{explicit:true}),null);
 assert.equal(await h.sleeper.check('zz'),'gone');
 assert.ok(!h.calls.some(call=>call[0]==='sleep'),'a check never unloads');
 assert.deepEqual(h.contexts,[{explicit:true},{explicit:true}]);
 await h.sleeper.sweep();h.advance(6*MIN);await h.sleeper.sweep();
 assert.ok(h.sleeper.frozen('b'));h.calls.length=0;
 assert.equal(await h.sleeper.check('b'),null);
 assert.deepEqual(h.calls.slice(0,2),[['unfreeze','b'],['check','b']],'a frozen page cannot run the check');
});

test('13.10: main\'s protectedReason lets the person unload a pinned tab and skips the sweep\'s own keep-awake reasons for an explicit request only',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const at=main.indexOf('async protectedReason(tab,choice,context)'),body=main.slice(at,main.indexOf('async sleep(id)',at));
 assert.ok(body.includes("if(tabIsPinned(state,tab)&&!context?.pressure&&!context?.explicit)return 'pinned';"),'(pinned folders, 14.0: pinned is the tab\'s own flag or a pinned folder)');
 for(const reason of ['recently-audible','background-activity','notifications','never-sleep'])assert.ok(new RegExp('!context\\?\\.explicit&&[^;]*'+reason).test(body)||body.includes("if(!context?.explicit)try{const site")&&reason==='notifications',reason+' only for the automatic sleep');
 for(const reason of ["'capturing'","'audio'","'download'","'inspecting'"])assert.ok(body.includes('return '+reason),reason+' still keeps a tab for an explicit request');
 const sleepNow=main.slice(main.indexOf('async function sleepTabsNow(ids)'),main.indexOf('function tabSleepWake()'));
 assert.ok(sleepNow.includes('unloadLanding(state,tab)')&&sleepNow.indexOf("tabSleep.check(tab.id,{explicit:true})")<sleepNow.indexOf("dispatch({type:'tab.select',id:landing.id})"),'the tab on screen is checked first, then the person moves, then it unloads');
 assert.ok(sleepNow.includes("commitAction({type:'tab.unloaded',ids:report.slept})"),'what was unloaded leaves the trail');
});

test('14.0: a title or icon change counts as background activity only for a hidden page that has loaded and been left alone for 10 s; a tab opened in the background and never shown is not marked by its own loading',()=>{
 const {countsAsBackgroundUpdate,BACKGROUND_UPDATE_GRACE_MS}=require('../desktop/tab-sleep.cjs');
 assert.equal(BACKGROUND_UPDATE_GRACE_MS,10000);
 const T=1_000_000,base={visible:false,discarding:false,loading:false,now:T};
 // opened in the background, never shown (shownAt undefined): the fault was that this counted from the first title on
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-300,loading:true}),false,'its title while it loads');
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-4000,loadedAt:T-3000}),false,'its icon 3 s after it loaded');
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-30000,loadedAt:T-9000}),false,'a slow page: 9 s after it finished loading, however long ago it was opened');
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-60000,loadedAt:T-50000}),true,'a real background update: an unread count a minute after it was opened');
 // a tab that was on screen: as before, 10 s after it was left
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-600000,loadedAt:T-590000,shownAt:T-5000}),false);
 assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-600000,loadedAt:T-590000,shownAt:T-11000}),true);
 // never while it is on screen, being unloaded or loading (a reload in the background)
 for(const patch of [{visible:true},{discarding:true},{loading:true}])assert.equal(countsAsBackgroundUpdate({...base,openedAt:T-600000,loadedAt:T-590000,shownAt:T-60000,...patch}),false,JSON.stringify(patch));
 assert.equal(countsAsBackgroundUpdate({...base}),false,'nothing known about the page: not marked');
 // main asks this rule, with the three clocks
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),at=main.indexOf("for(const event of ['page-title-updated','page-favicon-updated'])"),handler=main.slice(at,main.indexOf('\n',at));
 assert.ok(/countsAsBackgroundUpdate\(\{[^}]*shownAt:entry\.shownAt,openedAt:entry\.openedAt,loadedAt:entry\.loadedAt/.test(handler),'the handler passes last shown, opened and loaded');
 // (D125, 14.1: the same did-finish-load also has the page's weight counted, so the line is matched up to the load clock)
 assert.ok(main.slice(at-400,at).includes("entry.openedAt=Date.now();wc.on('did-finish-load',()=>{entry.loadedAt=Date.now();"),'both clocks are stamped where the page is made');
 assert.ok(!/Date\.now\(\)-\(entry\.shownAt\|\|0\)>10000/.test(main),'the old clock (last shown, or never) is gone');
});

test('13.10: tab.close accepts the batch it closes with, and only tab ids',()=>{
 const snapshot={tabs:[{id:'a'},{id:'b'}]};
 assert.doesNotThrow(()=>validateAction({type:'tab.close',id:'a'},snapshot));
 assert.doesNotThrow(()=>validateAction({type:'tab.close',id:'a',soon:['a','b']},snapshot));
 assert.throws(()=>validateAction({type:'tab.close',id:'a',soon:'b'},snapshot));
 assert.throws(()=>validateAction({type:'tab.close',id:'a',soon:[7]},snapshot));
 assert.throws(()=>validateAction({type:'tab.close',id:'a',extra:1},snapshot));
});

test('13.10: Unload on the tab on screen waits out Acira\'s own picture of the page (it counts as being captured) before it refuses or unloads',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const body=main.slice(main.indexOf('async function sleepTabsNow(ids)'),main.indexOf('function tabSleepWake()'));
 assert.ok(body.includes('isBeingCaptured?.()'),'it asks whether the page is being captured');
 assert.ok(body.includes("if(reason==='capturing'){await settle();"),'a capturing answer is asked again once the picture is done');
 assert.ok(body.indexOf("dispatch({type:'tab.select',id:landing.id});\n  await settle();")>0,'after the switch it waits for the switch\'s own still before it unloads');
});

test('13.10: a tab whose page closes itself (a target=_blank link calling window.close()) leaves the list: every page gets the destroyed handler, not only the ones a page opened',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.ok(!main.includes("if(fromPage)view.webContents.once('destroyed',()=>{"),'no longer only for tabs a page opened');
 assert.match(main,/view\.webContents\.once\('destroyed',\(\)=>\{\/\* A tab a page opened, and \(13\.10\) any tab whose page closes itself/);
 assert.ok(main.includes("if(entry.closing||entry.discarding||pages.get(tab.id)!==entry)return;removePageView(entry);pages.delete(tab.id);"),'a close, a sleep and a replaced page keep their own handling');
});
