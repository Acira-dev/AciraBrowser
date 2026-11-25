'use strict';
const tickJudge=()=>new Promise(r=>setImmediate(r));      // the length check of a starting sound answers on the next turn (desktop/media-controls.cjs judge)
// Media controls (desktop/media-controls.cjs): which tabs get a row, and play or pause. The page is a fake WebContents.
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createMediaControls,SCRIPTS,PAUSED_KEEP_MS,PLAYING_SCRIPT}=require('../desktop/media-controls.cjs');

function page(frames=1){
 const wc=new EventEmitter(),ran=[];
 const make=index=>({executeJavaScript:(code,gesture)=>{if(code===PLAYING_SCRIPT)return Promise.resolve(0);      // Beta 14.4 (D182): after Chromium's "paused" the page is asked whether an element with sound still plays: the fake page plays nothing
  ran.push({frame:index,code,gesture});return Promise.resolve(index===0?1:0);}});
 const all=Array.from({length:frames},(_,i)=>make(i));
 wc.mainFrame={framesInSubtree:all};wc.destroyed=false;wc.isDestroyed=()=>wc.destroyed;wc.ran=ran;
 return wc;
}
function setup(options={}){
 const media=createMediaControls(options),wc=page(options.frames),events=[],state={muted:false};
 media.attach('tab-1',wc,patch=>events.push(patch),{muted:()=>state.muted});
 return {media,wc,events,state,last:()=>events.at(-1)?.media};
}

test('a page that plays sound gets a row; pausing keeps it as paused so it can resume from the sidebar',async()=>{
 const m=setup();
 m.wc.emit('media-started-playing');await tickJudge();assert.deepEqual(m.events,[],'playing but silent so far: nothing');
 m.wc.emit('audio-state-changed',{audible:true});assert.deepEqual(m.events.map(e=>e.media),['playing']);assert.equal(typeof m.events[0].mediaAt,'number','Beta 14 N: the state carries when the sound began');
 m.wc.emit('media-paused');await tickJudge();assert.equal(m.last(),'paused');
 m.wc.emit('audio-state-changed',{audible:false});assert.equal(m.media.state('tab-1'),'paused','the sound dying later does not remove it');
 m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});assert.equal(m.last(),'playing');
});

test('a silent autoplay video never gets a row; a muted tab that plays does',async()=>{
 const silent=setup();silent.wc.emit('media-started-playing');await tickJudge();silent.wc.emit('media-paused');await tickJudge();assert.deepEqual(silent.events,[],'never audible: no row, not even paused');
 const muted=setup();muted.state.muted=true;muted.wc.emit('media-started-playing');await tickJudge();assert.equal(muted.last(),'playing','muted by the person: still there, so it can be unmuted');
});

test('a quiet stretch inside a track keeps its row; each state is announced once',async()=>{
 const m=setup();
 m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});
 m.wc.emit('audio-state-changed',{audible:false});assert.equal(m.media.state('tab-1'),'playing','between songs the row stays');
 m.wc.emit('audio-state-changed',{audible:true});assert.deepEqual(m.events.map(e=>e.media),['playing'],'no repeated announcements');
});

test('a paused row goes after ten minutes; a new page or closing the tab ends it; a hash change does not',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const m=setup();
 m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});m.wc.emit('media-paused');await tickJudge();
 t.mock.timers.tick(PAUSED_KEEP_MS-1);assert.equal(m.media.state('tab-1'),'paused');t.mock.timers.tick(1);assert.equal(m.media.state('tab-1'),null);assert.equal(m.last(),null);
 const n=setup();n.wc.emit('media-started-playing');await tickJudge();n.wc.emit('audio-state-changed',{audible:true});
 n.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});assert.equal(n.media.state('tab-1'),'playing','a hash change or pushState keeps playing');
 n.wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});assert.equal(n.media.state('tab-1'),'playing','a frame navigating is not the tab leaving');
 n.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});assert.equal(n.media.state('tab-1'),null,'a new page in the tab ends its media');
 n.wc.emit('media-paused');await tickJudge();assert.equal(n.media.state('tab-1'),null,'and a stale pause event does not bring it back');
 const o=setup();o.wc.emit('media-started-playing');await tickJudge();o.wc.emit('audio-state-changed',{audible:true});o.wc.emit('media-paused');await tickJudge();o.wc.emit('destroyed');
 t.mock.timers.tick(PAUSED_KEEP_MS+1);assert.equal(o.last(),'paused','a closed tab sends nothing more');
});

test('play, pause and toggle run a fixed script in every frame with a user gesture; toggle follows what is playing',async()=>{
 const m=setup({frames:3});
 m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});await new Promise(r=>setImmediate(r));m.wc.ran.length=0;      // (the length check of a starting sound has run: desktop/media-controls.cjs judge)
 assert.equal(await m.media.command('tab-1','toggle'),true,'frame 0 had something to pause');
 assert.equal(m.wc.ran.length,3);assert.deepEqual(m.wc.ran.map(r=>r.frame),[0,1,2]);assert.ok(m.wc.ran.every(r=>r.gesture===true&&r.code===SCRIPTS.pause),'toggle while playing pauses');
 m.wc.ran.length=0;m.wc.emit('media-paused');await tickJudge();
 await m.media.command('tab-1','toggle');assert.ok(m.wc.ran.every(r=>r.code===SCRIPTS.play),'toggle while paused plays');
 m.wc.ran.length=0;await m.media.command('tab-1','pause');assert.ok(m.wc.ran.every(r=>r.code===SCRIPTS.pause));
 assert.equal(await m.media.command('tab-1','explode'),false);assert.equal(await m.media.command('nope','play'),false);
 m.wc.destroyed=true;assert.equal(await m.media.command('tab-1','play'),false,'a destroyed page is left alone');
});

test('the scripts hold no page data and no interpolation; they are the only code run in a page',async()=>{
 for(const [name,code] of Object.entries(SCRIPTS)){assert.doesNotMatch(code,/\$\{|\+\s*['"`]|location|cookie|fetch|XMLHttp|eval|Function\(/,name);assert.ok(code.length<1400,name+' (Beta 14.1: the media list and the handler rule are part of the text)');}
 assert.deepEqual(Object.keys(SCRIPTS).sort(),['pause','play']);
});

test('pause stops what is playing and marks it; play resumes exactly that, else the first started element',async()=>{
 const element=(over={})=>({paused:false,ended:false,currentTime:5,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},...over});
 const run=(code,elements)=>vm.runInNewContext(code,{document:{querySelectorAll:()=>elements},window:{},navigator:{mediaSession:{}}});
 const a=element(),b=element({paused:true}),c=element({ended:true,paused:true});
 assert.equal(run(SCRIPTS.pause,[a,b,c]),1,'only the one that was playing');assert.equal(a.paused,true);
 const d=element({paused:true,currentTime:0}),e=element({paused:true,currentTime:30});
 assert.equal(run(SCRIPTS.play,[a,d]),1,'resumes what pause stopped, not the untouched one');assert.equal(a.paused,false);assert.equal(d.paused,true);
 assert.equal(run(SCRIPTS.play,[d,e]),1,'nothing was paused by us: the first element that had started');assert.equal(e.paused,false);assert.equal(d.paused,true);
 assert.equal(run(SCRIPTS.play,[]),0);assert.equal(run(SCRIPTS.pause,[]),0);
});

test('the media command and tab state cross the desktop bridge and the reducer',async()=>{
 const {createInitialState,reduceBrowser,persistedSnapshot,restoreSnapshot}=require('../desktop/runtime.cjs'),{validateCommand}=require('../desktop/validation.cjs');
 let s=createInitialState();const id=s.activeTabId;
 for(const action of ['toggle','play','pause'])assert.doesNotThrow(()=>validateCommand({type:'media',tabId:id,action},s));
 assert.throws(()=>validateCommand({type:'media',tabId:id,action:'seek'},s));assert.throws(()=>validateCommand({type:'media',tabId:'nope',action:'play'},s));assert.throws(()=>validateCommand({type:'media',tabId:id},s));
 s=reduceBrowser(s,{type:'tab.navigate',url:'https://example.com/'});
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://example.com/',title:'x',loading:false,media:'playing'}});assert.equal(s.tabs[0].media,'playing');
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,media:'paused'}});assert.equal(s.tabs[0].media,'paused');
 assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s)))).tabs[0].media,undefined,'a restart forgets media rows (the field is cleared, not saved)');
 assert.equal('media' in persistedSnapshot(s).tabs[0],false);
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,media:null}});assert.equal('media' in s.tabs[0],false);
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,media:'playing'}});s=reduceBrowser(s,{type:'tab.duplicate',id});assert.equal(s.tabs.find(t=>t.id===s.activeTabId).media,undefined,'a duplicate is not playing');
});

// Beta 14.0, EDICT (Discord, 19 Nov): a page that changes owner (a link preview opened as a tab) keeps its card. Chromium says "started playing" once; the new tab never hears it.
test('a page handed from a preview to a tab keeps its card: the tab shows it at once, with the stamp it began with, and the preview stops following',async()=>{
 const media=createMediaControls(),wc=page(),a=[],b=[];
 media.attach('peek:tab-1',wc,patch=>a.push(patch),{muted:()=>false});
 wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});assert.equal(a.at(-1).media,'playing');const began=a.at(-1).mediaAt;
 media.attach('tab-9',wc,patch=>b.push(patch),{muted:()=>false});
 assert.deepEqual(b,[{media:'playing',mediaAt:began}],'the new owner shows it at once; the card does not jump to the front (same stamp)');
 assert.equal(a.at(-1).media,null,'the preview\'s row ends');assert.equal(media.state('peek:tab-1'),null);assert.equal(media.state('tab-9'),'playing');
 const before=a.length;wc.emit('media-paused');await tickJudge();assert.equal(b.at(-1).media,'paused');assert.equal(a.length,before,'the old owner hears nothing more');
 assert.equal(wc.listenerCount('media-paused'),1,'one listener per event: none left from the preview');
});
test('a preview that was paused is a paused card as a tab; one that never made a sound is nothing',async()=>{
 const media=createMediaControls(),wc=page(),b=[];
 media.attach('peek:tab-1',wc,()=>{},{});wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});wc.emit('media-paused');await tickJudge();
 media.attach('tab-9',wc,patch=>b.push(patch),{});assert.deepEqual(b.map(e=>e.media),['paused']);
 const quiet=createMediaControls(),w2=page(),c=[];quiet.attach('peek:tab-1',w2,()=>{},{});quiet.attach('tab-9',w2,patch=>c.push(patch),{});assert.deepEqual(c,[],'nothing played: no card');
});
test('a page that is already audible when a tab takes it over shows its card; an unseen page never does',async()=>{
 const media=createMediaControls(),wc=page(),b=[];wc.isCurrentlyAudible=()=>true;
 media.attach('tab-5',wc,patch=>b.push(patch),{});assert.equal(b.at(-1).media,'playing');assert.equal(typeof b.at(-1).mediaAt,'number');
 const w2=page(),c=[];w2.isCurrentlyAudible=()=>true;createMediaControls().attach('tab-6',w2,patch=>c.push(patch),{unseen:()=>true});assert.deepEqual(c,[],'a page nobody has looked at yet is held by the gate, not given a card');
 const w3=page(),d=[];createMediaControls().attach('tab-7',w3,patch=>d.push(patch),{});assert.deepEqual(d,[],'a page that is not audible: nothing');
});
test('detach: the owner stops following the page and its card is cleared',async()=>{
 const media=createMediaControls(),wc=page(),a=[];const entry=media.attach('peek:x',wc,patch=>a.push(patch),{});
 wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});entry.detach();
 assert.equal(a.at(-1).media,null);assert.equal(media.state('peek:x'),null);assert.equal(wc.listenerCount('media-started-playing'),0);
});

// Beta 14.0, the mini player: short sounds (a chime, a notification ding) do not flash a card in and leave a paused one behind.
const {EventEmitter:Emitter}=require('node:events');
function lengthPage(answer){const wc=new Emitter(),ran=[];wc.mainFrame={framesInSubtree:[{executeJavaScript:(code)=>{ran.push(code);return Promise.resolve(code===PLAYING_SCRIPT?0:code.includes('el.duration')?answer():1);}}]};wc.isDestroyed=()=>false;wc.ran=ran;return wc;}
const tickAsync=()=>new Promise(r=>setImmediate(r));
test('a sound from a media element shorter than 3 s never gets a card; a long one gets it at once',async()=>{
 const short=lengthPage(()=>({n:1,short:1})),a=[];createMediaControls().attach('tab-1',short,p=>a.push(p),{});
 short.emit('media-started-playing');await tickJudge();short.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();assert.deepEqual(a,[],'a 1 s chime: no card, not even for a moment');
 short.emit('media-paused');await tickJudge();assert.deepEqual(a,[]);
 const long=lengthPage(()=>({n:1,short:0})),b=[];createMediaControls().attach('tab-1',long,p=>b.push(p),{});
 long.emit('media-started-playing');await tickJudge();long.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();assert.deepEqual(b.map(e=>e.media),['playing'],'music: a card, with no wait');
 const mixed=lengthPage(()=>({n:2,short:1})),c=[];createMediaControls().attach('tab-1',mixed,p=>c.push(p),{});
 mixed.emit('media-started-playing');await tickJudge();mixed.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();assert.deepEqual(c.map(e=>e.media),['playing'],'a long track with a short chime beside it is still a track');
});
test('a sound no element explains waits a moment for its card; a chime that ends in that time never shows, and one that ends later leaves no paused card',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const wc=lengthPage(()=>({n:0,short:0})),a=[],media=createMediaControls({clock:Date.now});media.attach('tab-1',wc,p=>a.push(p),{});
 wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();assert.deepEqual(a,[],'held while it might be a ding');
 t.mock.timers.tick(400);wc.emit('media-paused');await tickJudge();wc.emit('audio-state-changed',{audible:false});t.mock.timers.tick(2000);assert.deepEqual(a,[],'a ding that ended inside the wait: nothing');
 wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();t.mock.timers.tick(1100);assert.equal(a.at(-1)?.media,'playing','still going after the wait: it is a sound worth a card');
 t.mock.timers.tick(500);wc.emit('media-paused');await tickJudge();assert.equal(a.at(-1).media,null,'it ended by itself within 3 s: no paused card left behind');assert.equal(media.state('tab-1'),null);
});
test('the person\'s own pause is a pause, whatever the sound; media in the page that stops is paused, not gone',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const wc=lengthPage(()=>({n:0,short:0})),a=[],media=createMediaControls({clock:Date.now});media.attach('tab-1',wc,p=>a.push(p),{});
 wc.emit('media-started-playing');await tickJudge();wc.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();t.mock.timers.tick(1100);assert.equal(a.at(-1).media,'playing');
 await media.command('tab-1','pause');wc.emit('media-paused');await tickJudge();assert.equal(a.at(-1).media,'paused','paused from the card inside 3 s: still a paused card');
 const page2=lengthPage(()=>({n:1,short:0})),b=[],m2=createMediaControls({clock:Date.now});m2.attach('tab-2',page2,p=>b.push(p),{});
 page2.emit('media-started-playing');await tickJudge();page2.emit('audio-state-changed',{audible:true});await tickAsync();await tickAsync();t.mock.timers.tick(300);page2.emit('media-paused');await tickJudge();assert.equal(b.at(-1).media,'paused','a video the page paused after a moment: paused');
});

test('a page whose process crashed or was killed loses its card at once (it plays nothing, and its buttons would do nothing)',async()=>{
 const m=setup();m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});assert.equal(m.last(),'playing');
 m.wc.emit('render-process-gone',{},{reason:'crashed'});assert.equal(m.last(),null);assert.equal(m.media.state('tab-1'),null);
 m.wc.emit('media-started-playing');await tickJudge();m.wc.emit('audio-state-changed',{audible:true});assert.equal(m.last(),'playing','the reloaded page brings it back');
});

// Beta 14.0, EDICT: the card's commands for a Link preview's page (id `peek:<source tab>`) were refused by the command check ("outside the current tabs scope"): no play, pause, volume, seek or artwork for a preview's card.
test('the command check admits the card\'s media commands for a preview of a tab that is here, and for nothing else that is not a tab',()=>{
 const {validateCommand}=require('../desktop/validation.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),s=createInitialState(),tabId=s.activeTabId;
 for(const action of ['pause','play','toggle','info','stop','pip'])assert.doesNotThrow(()=>validateCommand({type:'media',tabId:'peek:'+tabId,action},s),action);
 assert.doesNotThrow(()=>validateCommand({type:'media',tabId:'peek:'+tabId,action:'volume',level:.4},s));
 assert.doesNotThrow(()=>validateCommand({type:'media',tabId:'peek:'+tabId,action:'seek',seconds:12},s));
 assert.throws(()=>validateCommand({type:'media',tabId:'peek:tab-nobody',action:'pause'},s),/scope/,'a preview of a tab that is not here is no preview of this window');
 assert.throws(()=>validateCommand({type:'media',tabId:'tab-nobody',action:'pause'},s),/scope/);
 assert.throws(()=>validateCommand({type:'navigate',tabId:'peek:'+tabId,url:'https://a.test/'},s),/scope/,'only media commands are admitted by a preview\'s id');
});
test('a page with a frame that never answers (an ad) shows the card of its long media at once, not after the wait',async()=>{
 const wc=new Emitter();wc.mainFrame={framesInSubtree:[{executeJavaScript:()=>new Promise(()=>{})},{executeJavaScript:code=>Promise.resolve(code===PLAYING_SCRIPT?0:code.includes('el.duration')?{n:1,short:0}:1)}]};wc.isDestroyed=()=>false;
 const a=[];createMediaControls().attach('tab-1',wc,p=>a.push(p),{});wc.emit('media-started-playing');wc.emit('audio-state-changed',{audible:true});
 await tickAsync();await tickAsync();assert.deepEqual(a.map(e=>e.media),['playing'],'no waiting on the frame that does not answer');
});
