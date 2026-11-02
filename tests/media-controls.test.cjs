'use strict';
// Media controls (desktop/media-controls.cjs): which tabs get a row, and play or pause. The page is a fake WebContents.
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createMediaControls,SCRIPTS,PAUSED_KEEP_MS}=require('../desktop/media-controls.cjs');

function page(frames=1){
 const wc=new EventEmitter(),ran=[];
 const make=index=>({executeJavaScript:(code,gesture)=>{ran.push({frame:index,code,gesture});return Promise.resolve(index===0?1:0);}});
 const all=Array.from({length:frames},(_,i)=>make(i));
 wc.mainFrame={framesInSubtree:all};wc.destroyed=false;wc.isDestroyed=()=>wc.destroyed;wc.ran=ran;
 return wc;
}
function setup(options={}){
 const media=createMediaControls(options),wc=page(options.frames),events=[],state={muted:false};
 media.attach('tab-1',wc,patch=>events.push(patch),{muted:()=>state.muted});
 return {media,wc,events,state,last:()=>events.at(-1)?.media};
}

test('a page that plays sound gets a row; pausing keeps it as paused so it can resume from the sidebar',()=>{
 const m=setup();
 m.wc.emit('media-started-playing');assert.deepEqual(m.events,[],'playing but silent so far: nothing');
 m.wc.emit('audio-state-changed',{audible:true});assert.deepEqual(m.events,[{media:'playing'}]);
 m.wc.emit('media-paused');assert.equal(m.last(),'paused');
 m.wc.emit('audio-state-changed',{audible:false});assert.equal(m.media.state('tab-1'),'paused','the sound dying later does not remove it');
 m.wc.emit('media-started-playing');m.wc.emit('audio-state-changed',{audible:true});assert.equal(m.last(),'playing');
});

test('a silent autoplay video never gets a row; a muted tab that plays does',()=>{
 const silent=setup();silent.wc.emit('media-started-playing');silent.wc.emit('media-paused');assert.deepEqual(silent.events,[],'never audible: no row, not even paused');
 const muted=setup();muted.state.muted=true;muted.wc.emit('media-started-playing');assert.equal(muted.last(),'playing','muted by the person: still there, so it can be unmuted');
});

test('a quiet stretch inside a track keeps its row; each state is announced once',()=>{
 const m=setup();
 m.wc.emit('media-started-playing');m.wc.emit('audio-state-changed',{audible:true});
 m.wc.emit('audio-state-changed',{audible:false});assert.equal(m.media.state('tab-1'),'playing','between songs the row stays');
 m.wc.emit('audio-state-changed',{audible:true});assert.deepEqual(m.events,[{media:'playing'}],'no repeated announcements');
});

test('a paused row goes after ten minutes; a new page or closing the tab ends it; a hash change does not',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const m=setup();
 m.wc.emit('media-started-playing');m.wc.emit('audio-state-changed',{audible:true});m.wc.emit('media-paused');
 t.mock.timers.tick(PAUSED_KEEP_MS-1);assert.equal(m.media.state('tab-1'),'paused');t.mock.timers.tick(1);assert.equal(m.media.state('tab-1'),null);assert.equal(m.last(),null);
 const n=setup();n.wc.emit('media-started-playing');n.wc.emit('audio-state-changed',{audible:true});
 n.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});assert.equal(n.media.state('tab-1'),'playing','a hash change or pushState keeps playing');
 n.wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});assert.equal(n.media.state('tab-1'),'playing','a frame navigating is not the tab leaving');
 n.wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});assert.equal(n.media.state('tab-1'),null,'a new page in the tab ends its media');
 n.wc.emit('media-paused');assert.equal(n.media.state('tab-1'),null,'and a stale pause event does not bring it back');
 const o=setup();o.wc.emit('media-started-playing');o.wc.emit('audio-state-changed',{audible:true});o.wc.emit('media-paused');o.wc.emit('destroyed');
 t.mock.timers.tick(PAUSED_KEEP_MS+1);assert.equal(o.last(),'paused','a closed tab sends nothing more');
});

test('play, pause and toggle run a fixed script in every frame with a user gesture; toggle follows what is playing',async()=>{
 const m=setup({frames:3});
 m.wc.emit('media-started-playing');m.wc.emit('audio-state-changed',{audible:true});
 assert.equal(await m.media.command('tab-1','toggle'),true,'frame 0 had something to pause');
 assert.equal(m.wc.ran.length,3);assert.deepEqual(m.wc.ran.map(r=>r.frame),[0,1,2]);assert.ok(m.wc.ran.every(r=>r.gesture===true&&r.code===SCRIPTS.pause),'toggle while playing pauses');
 m.wc.ran.length=0;m.wc.emit('media-paused');
 await m.media.command('tab-1','toggle');assert.ok(m.wc.ran.every(r=>r.code===SCRIPTS.play),'toggle while paused plays');
 m.wc.ran.length=0;await m.media.command('tab-1','pause');assert.ok(m.wc.ran.every(r=>r.code===SCRIPTS.pause));
 assert.equal(await m.media.command('tab-1','explode'),false);assert.equal(await m.media.command('nope','play'),false);
 m.wc.destroyed=true;assert.equal(await m.media.command('tab-1','play'),false,'a destroyed page is left alone');
});

test('the scripts hold no page data and no interpolation; they are the only code run in a page',()=>{
 for(const [name,code] of Object.entries(SCRIPTS)){assert.doesNotMatch(code,/\$\{|\+\s*['"`]|location|cookie|fetch|XMLHttp|eval|Function\(/,name);assert.ok(code.length<700,name);}
 assert.deepEqual(Object.keys(SCRIPTS).sort(),['pause','play']);
});

test('pause stops what is playing and marks it; play resumes exactly that, else the first started element',()=>{
 const element=(over={})=>({paused:false,ended:false,currentTime:5,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},...over});
 const run=(code,elements)=>vm.runInNewContext(code,{document:{querySelectorAll:()=>elements}});
 const a=element(),b=element({paused:true}),c=element({ended:true,paused:true});
 assert.equal(run(SCRIPTS.pause,[a,b,c]),1,'only the one that was playing');assert.equal(a.paused,true);
 const d=element({paused:true,currentTime:0}),e=element({paused:true,currentTime:30});
 assert.equal(run(SCRIPTS.play,[a,d]),1,'resumes what pause stopped, not the untouched one');assert.equal(a.paused,false);assert.equal(d.paused,true);
 assert.equal(run(SCRIPTS.play,[d,e]),1,'nothing was paused by us: the first element that had started');assert.equal(e.paused,false);assert.equal(d.paused,true);
 assert.equal(run(SCRIPTS.play,[]),0);assert.equal(run(SCRIPTS.pause,[]),0);
});

test('the media command and tab state cross the desktop bridge and the reducer',()=>{
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
