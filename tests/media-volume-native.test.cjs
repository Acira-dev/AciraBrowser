'use strict';
// The tab's volume (desktop/media-controls.cjs `action: 'volume'`): Electron has no per-tab volume, so main sets `volume` on the
// tab's media elements in every frame, keeps it for elements added later and for new documents in the tab, and forgets it
// with the tab. The page is a fake WebContents; the script runs against a fake document.
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createMediaControls,volumeScript,VOLUME_READ}=require('../desktop/media-controls.cjs');

class FakeMedia{constructor(over={}){Object.assign(this,{volume:1,paused:false,ended:false},over);}}
/** A frame: a document with media elements and capture listeners, a window the script may leave its hook on. */
function frame(elements=[]){
 const listeners=[],window={};
 const document={querySelectorAll:()=>elements,addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture})};
 const context=vm.createContext({window,document,HTMLMediaElement:FakeMedia,WeakSet,Symbol,Object,Number,Math});
 return {elements,listeners,window,
  executeJavaScript:code=>{try{return Promise.resolve(vm.runInContext(code,context));}catch(error){return Promise.reject(error);}},
  /** The page starts an element: the capture listener sees its `play`. */
  play(el){el.paused=false;for(const l of listeners)if(l.type==='play')l.fn({target:el});}};
}
function page(frames){
 const wc=new EventEmitter();wc.mainFrame={framesInSubtree:frames};wc.destroyed=false;wc.isDestroyed=()=>wc.destroyed;return wc;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a level reaches every media element in every frame, and the call says how many took it',async()=>{
 const a=new FakeMedia(),b=new FakeMedia({paused:true}),c=new FakeMedia();
 const top=frame([a,b]),ad=frame([c]),media=createMediaControls(),wc=page([top,ad]);
 media.attach('tab-1',wc,()=>{});
 assert.equal(await media.command('tab-1','volume',.4),3);
 assert.deepEqual([a.volume,b.volume,c.volume],[.4,.4,.4]);
 assert.equal(await media.command('tab-1','volume',.257),3);assert.equal(a.volume,.26,'whole percent');
 assert.equal(media.level('tab-1'),.26);
 assert.equal(await media.command('tab-1','volume',Number.NaN),0,'not a number: nothing');
 assert.equal(top.listeners.filter(l=>l.type==='play'&&l.capture===true).length,1,'one hook per document, however often the level moves');
});

test('an element that starts later gets the level once; the site may change it afterwards and is not fought',async()=>{
 const first=new FakeMedia(),top=frame([first]),media=createMediaControls(),wc=page([top]);
 media.attach('tab-1',wc,()=>{});await media.command('tab-1','volume',.3);
 const next=new FakeMedia({volume:1,paused:true});top.elements.push(next);
 top.play(next);assert.equal(next.volume,.3,'a player added later plays at the level');
 next.volume=.9;top.play(next);assert.equal(next.volume,.9,'the site\'s own control moved it: left alone');
 first.volume=.7;wc.emit('media-started-playing');await settle();
 assert.equal(first.volume,.7,'a later run only reaches elements not seen yet');
 const late=new FakeMedia();top.elements.push(late);wc.emit('did-frame-finish-load');await settle();assert.equal(late.volume,.3,'a frame that loads: new elements get it');
 await media.command('tab-1','volume',.5);assert.deepEqual(top.elements.map(el=>el.volume),[.5,.5,.5],'the person moving the slider sets all of them');
});

test('a new document in the tab (a navigation) gets the hook and the level again; a tab never set is never touched',async()=>{
 const media=createMediaControls();let current=frame([new FakeMedia()]);const wc=page([current]);
 media.attach('tab-1',wc,()=>{});
 wc.emit('dom-ready');await settle();assert.equal(current.elements[0].volume,1,'no level set: the page is left alone');
 assert.equal(current.listeners.length,0,'and gets no hook');
 await media.command('tab-1','volume',.2);
 current=frame([new FakeMedia()]);wc.mainFrame.framesInSubtree=[current];
 wc.emit('dom-ready');await settle();
 assert.equal(current.elements[0].volume,.2,'the next page in the tab plays at the level');assert.equal(current.listeners.length,1);
});

test('reading the level: what the page plays at now, else the level set here, else nothing',async()=>{
 const media=createMediaControls(),top=frame([new FakeMedia({volume:.35}),new FakeMedia({volume:.9,paused:true})]),wc=page([top]);
 media.attach('tab-1',wc,()=>{});
 assert.equal(await media.command('tab-1','volume'),.35,'the playing element, not the louder paused one');
 top.elements.length=0;assert.equal(await media.command('tab-1','volume'),null,'no media and nothing set');
 await media.command('tab-1','volume',.6);assert.equal(await media.command('tab-1','volume'),.6);
 assert.equal(await media.command('nope','volume'),null);
 assert.equal(vm.runInNewContext(VOLUME_READ,{document:{querySelectorAll:()=>[{volume:.5,paused:true,ended:false}]},Number,Math}),.5,'nothing playing: the loudest element');
});

test('levels go with their tab (prune), survive the page view being rebuilt, and dispose clears them',async()=>{
 const media=createMediaControls(),wc=page([frame([new FakeMedia()])]);
 media.attach('tab-1',wc,()=>{});await media.command('tab-1','volume',.4);
 wc.emit('destroyed');const again=frame([new FakeMedia()]),woken=page([again]);media.attach('tab-1',woken,()=>{});
 woken.emit('dom-ready');await settle();assert.equal(again.elements[0].volume,.4,'a slept tab that wakes keeps its level');
 media.prune(['tab-2']);assert.equal(media.level('tab-1'),undefined,'closed: forgotten');
 await media.command('tab-1','volume',.4);media.dispose();assert.equal(media.level('tab-1'),undefined);
});

test('the script is fixed text plus a rounded number: no page data, no gesture, nothing else',()=>{
 const code=volumeScript(.123456,true);
 assert.match(code,/const v=0\.12,all=true/);assert.doesNotMatch(volumeScript('1;alert(1)',false),/alert/,'a string cannot get in');
 assert.match(volumeScript(7,false),/const v=1,all=false/);assert.match(volumeScript(-3,true),/const v=0,/);
 assert.doesNotMatch(code,/location|cookie|fetch|XMLHttp|eval|Function\(|postMessage/);assert.ok(code.length<800);
});

test('the volume command crosses the desktop bridge: a level 0..1, only on volume',()=>{
 const {createInitialState}=require('../desktop/runtime.cjs'),{validateCommand}=require('../desktop/validation.cjs');
 const s=createInitialState(),id=s.activeTabId;
 for(const level of [0,.5,1])assert.equal(validateCommand({type:'media',tabId:id,action:'volume',level},s).level,level);
 assert.doesNotThrow(()=>validateCommand({type:'media',tabId:id,action:'volume'},s),'no level: a read');
 for(const level of [-.1,1.1,Number.NaN,'0.5'])assert.throws(()=>validateCommand({type:'media',tabId:id,action:'volume',level},s),String(level));
 assert.throws(()=>validateCommand({type:'media',tabId:id,action:'play',level:.5},s),'only volume carries a level');
 const main=require('node:fs').readFileSync(require.resolve('../desktop/main.cjs'),'utf8');
 assert.match(main,/if\(c\.action==='volume'\)return mediaControls\.command\(c\.tabId,'volume',c\.level\)/,'main answers with the result (a read resolves with the level)');
 assert.match(main,/mediaControls\.prune\(state\.tabs\.map\(t=>t\.id\)\)/,'closed tabs lose their level');
});
