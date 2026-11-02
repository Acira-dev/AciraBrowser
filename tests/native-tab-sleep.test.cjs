'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTabSleep,memorySaverChoice,normalizeSite,neverSleeps}=require('../desktop/tab-sleep.cjs');

const MIN=60*1000;
function harness(overrides={}){
 let time=1_000_000;const calls=[],visible=new Set(),tabs=new Map([['a',{id:'a'}],['b',{id:'b'}],['c',{id:'c'}]]);
 visible.add('a');
 const adapter={tabs:()=>[...tabs.values()],isVisible:id=>visible.has(id),protectedReason:(tab)=>overrides.protect?.[tab.id]||null,
  sleep:async id=>{calls.push(['sleep',id]);if(overrides.refuse?.has(id))return {slept:false,reason:'unsaved-form'};tabs.delete(id);return {slept:true};},
  freeze:async id=>{calls.push(['freeze',id]);return true;},unfreeze:async id=>{calls.push(['unfreeze',id]);}};
 let choice=overrides.choice||{enabled:true,idleMinutes:15,neverSleep:[]};
 const sleeper=createTabSleep({adapter,settings:()=>choice,now:()=>time,freezeAfterMs:5*MIN,memory:()=>({free:4*1024**3,total:8*1024**3})});
 return {sleeper,calls,tabs,visible,advance:ms=>{time+=ms;},set:value=>{choice=value;}};
}

test('settings are validated and never-sleep entries normalised to hosts',()=>{
 assert.deepEqual(memorySaverChoice(undefined),{enabled:true,idleMinutes:15,neverSleep:[]});
 assert.deepEqual(memorySaverChoice({enabled:false,idleMinutes:30,neverSleep:['https://Mail.Example.com/inbox','*.docs.test','bad host!',7,'mail.example.com']}),{enabled:false,idleMinutes:30,neverSleep:['mail.example.com','docs.test']});
 assert.equal(memorySaverChoice({idleMinutes:0}).idleMinutes,15);assert.equal(memorySaverChoice({idleMinutes:'5'}).idleMinutes,15);
 assert.equal(normalizeSite('http://localhost:3000/'),'localhost');
 assert.equal(neverSleeps('https://app.example.com/x',['example.com']),true);assert.equal(neverSleeps('https://notexample.com/',['example.com']),false);
});

test('hidden tabs freeze after 5 minutes and sleep after the idle time; the visible tab is never touched',async()=>{
 const h=harness();await h.sleeper.sweep();
 h.advance(4*MIN);assert.deepEqual((await h.sleeper.sweep()).frozen,[]);
 h.advance(2*MIN);let report=await h.sleeper.sweep();assert.deepEqual(report.frozen.sort(),['b','c']);assert.ok(!h.calls.some(c=>c[1]==='a'));
 h.advance(5*MIN);assert.deepEqual((await h.sleeper.sweep()).slept,[],'not yet 15 minutes');
 h.advance(5*MIN);report=await h.sleeper.sweep();assert.deepEqual(report.slept.sort(),['b','c']);assert.ok(h.tabs.has('a'));
});

test('showing a frozen tab wakes it and restarts its clock',async()=>{
 const h=harness();await h.sleeper.sweep();h.advance(6*MIN);await h.sleeper.sweep();assert.ok(h.sleeper.frozen('b'));
 h.visible.delete('a');h.visible.add('b');h.sleeper.touch('b');const report=await h.sleeper.sweep();assert.deepEqual(report.woke,['b']);assert.ok(!h.sleeper.frozen('b'));
 h.advance(14*MIN);assert.deepEqual((await h.sleeper.sweep()).slept.includes('b'),false);
});

test('protected tabs stay awake and unfreeze; refused sleeps retry only after 10 minutes',async()=>{
 const h=harness({protect:{b:'playing-audio'},refuse:new Set(['c'])});await h.sleeper.sweep();
 h.advance(16*MIN);let report=await h.sleeper.sweep();assert.equal(report.protected.b,'playing-audio');assert.equal(report.protected.c,'unsaved-form');assert.deepEqual(report.slept,[]);assert.ok(h.tabs.has('b')&&h.tabs.has('c'));
 const attempts=()=>h.calls.filter(c=>c[0]==='sleep'&&c[1]==='c').length;assert.equal(attempts(),1);
 h.advance(5*MIN);await h.sleeper.sweep();assert.equal(attempts(),1,'no second attempt inside the retry window');
 h.advance(6*MIN);await h.sleeper.sweep();assert.equal(attempts(),2);
});

test('turning the memory saver off wakes frozen tabs and stops sleeping',async()=>{
 const h=harness();await h.sleeper.sweep();h.advance(6*MIN);await h.sleeper.sweep();assert.ok(h.sleeper.frozen('b'));
 h.set({enabled:false,idleMinutes:15,neverSleep:[]});h.advance(30*MIN);const report=await h.sleeper.sweep();assert.deepEqual(report.slept,[]);assert.ok(!h.sleeper.frozen('b'));assert.ok(h.tabs.has('b'));
});

test('a tab that disappears is forgotten',async()=>{
 const h=harness();await h.sleeper.sweep();h.tabs.delete('b');await h.sleeper.sweep();h.advance(30*MIN);assert.ok(!(await h.sleeper.sweep()).slept.includes('b'));
});

test('calls, chat and music sites are always kept awake, even with an empty never-sleep list',()=>{
 const {neverSleeps,KEEP_ALIVE}=require('../desktop/tab-sleep.cjs');
 assert.ok(KEEP_ALIVE.length>=20);
 for(const url of ['https://meet.google.com/abc-defg-hij','https://us02web.zoom.us/j/123','https://discord.com/channels/@me','https://open.spotify.com/playlist/1','https://music.youtube.com/'])assert.equal(neverSleeps(url,[]),true,url);
 for(const url of ['https://example.com/','https://notzoom.us.example.com/','https://youtube.com/watch?v=1'])assert.equal(neverSleeps(url,[]),false,url);
 assert.equal(neverSleeps('https://mail.example.com/',['example.com']),true);
});

test('inspectPage (runs in the page) refuses edited fields, credentials, editable pages and live media, and accepts a plain page',()=>{
 const {inspectPage}=require('../desktop/tab-sleep.cjs');
 const run=(controls=[],extra={})=>{const saved={document:globalThis.document,MediaStream:globalThis.MediaStream};globalThis.MediaStream=class{};
  globalThis.document={designMode:'off',querySelectorAll:selector=>selector==='input,textarea,select'?controls:selector==='audio,video'?(extra.media||[]):[],querySelector:()=>extra.editable?{}:null,getElementsByTagName:()=>({length:10}),createElement:()=>{const attrs={};return {setAttribute:(k,v)=>{attrs[k]=v;},get value(){return attrs.value??'';}};}};
  try{return inspectPage();}finally{globalThis.document=saved.document;if(saved.MediaStream===undefined)delete globalThis.MediaStream;else globalThis.MediaStream=saved.MediaStream;}};
 const input=(over)=>({tagName:'INPUT',type:'text',value:'',hasAttribute:()=>false,getAttribute:()=>null,...over});
 assert.deepEqual(run([input({})]),{safe:true});
 assert.equal(run([input({value:'typed'})]).reason,'edited-form');
 assert.equal(run([input({type:'password',value:'secret'})]).reason,'credential-or-file-input');
 assert.equal(run([{tagName:'TEXTAREA',value:'draft',defaultValue:''}]).reason,'edited-form');
 assert.equal(run([],{editable:true}).reason,'editable-or-canvas-content');
 assert.equal(run([],{media:[{paused:false,ended:false}]}).reason,'playing-media-or-live-stream');
});

test('under real memory pressure the oldest frozen tabs are discarded early, two per sweep; with enough memory nothing changes',async()=>{
 const GB=1024*1024*1024,{underPressure}=require('../desktop/tab-sleep.cjs');
 assert.equal(underPressure({free:900*1024*1024,total:8*GB}),true);assert.equal(underPressure({free:2*GB,total:8*GB}),false,'25% free is plenty');assert.equal(underPressure({free:2*GB,total:32*GB}),true,'6% of a big machine is not');assert.equal(underPressure({free:NaN,total:8*GB}),false);
 for(const [free,expected] of [[4*GB,[]],[500*1024*1024,2]]){
  let time=1_000_000;const calls=[],visible=new Set(['a']),tabs=new Map(['a','b','c','d','e'].map(id=>[id,{id}]));
  const adapter={tabs:()=>[...tabs.values()],isVisible:id=>visible.has(id),protectedReason:tab=>tab.id==='d'?'audible':null,sleep:async id=>{calls.push(id);tabs.delete(id);return {slept:true};},freeze:async()=>true,unfreeze:async()=>{}};
  const sleeper=createTabSleep({adapter,settings:()=>({enabled:true,idleMinutes:60,neverSleep:[]}),now:()=>time,freezeAfterMs:5*MIN,memory:()=>({free,total:8*GB})});
  await sleeper.sweep();time+=6*MIN;sleeper.touch('c');time+=MIN;await sleeper.sweep();const report=await sleeper.sweep();
  if(Array.isArray(expected)){assert.deepEqual(calls,expected);assert.equal(report.pressure,false);}
  else{assert.equal(calls.length,expected,'one sweep discards two hidden tabs early');assert.ok(!calls.includes('d'),'protected tabs stay');assert.ok(!calls.includes('a'),'the visible tab stays');assert.ok(!calls.includes('c')||calls.indexOf('c')>calls.indexOf('b'),'oldest first: the touched tab goes last');}
 }
});
