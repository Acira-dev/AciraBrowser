const test=require('node:test'),assert=require('node:assert/strict');
const {wheelPageZoom,nextPageZoom,websiteWheelZoom}=require('../desktop/page-zoom.cjs');
const levels=require('../page-zoom-levels.json');
function gesture(deltas,start=100){const state={};let zoom=start;deltas.forEach((deltaY,i)=>{zoom=wheelPageZoom(zoom,{deltaY,deltaMode:0},state,i*8)??zoom;});return zoom;}
test('a pinch always lands on one of the browser preset steps, however small its updates',()=>{
 for(const delta of [-.1,-.5,-1,-3,.4,2])for(const count of [10,40,100])assert.ok(levels.includes(gesture(Array(count).fill(delta))),delta+' x'+count);
});
test('tiny pinch updates accumulate distance instead of jumping a whole step each',()=>{
 assert.equal(gesture(Array(100).fill(-.1)),110,'a short pinch is one step');
 assert.equal(gesture(Array(40).fill(-.5)),125,'twice as long reaches the step the distance asks for');
 assert.equal(gesture(Array(8).fill(-.1)),100,'a twitch under half a step changes nothing');
});
test('the same pinch distance has the same result at different event rates',()=>{
 assert.equal(gesture(Array(40).fill(-.5)),gesture(Array(10).fill(-2)));
 assert.equal(gesture([...Array(20).fill(-1),...Array(20).fill(1)]),100);
});
test('wheel notches and subsequent keyboard zoom retain standard browser steps',()=>{
 assert.equal(wheelPageZoom(100,{deltaY:-120,deltaMode:0},{},0),110);
 assert.equal(wheelPageZoom(110,{deltaY:3,deltaMode:1},{},0),100);
 assert.equal(nextPageZoom(gesture(Array(20).fill(-1)),1),150);
});
test('pinch bounds and a new gesture after a keyboard change are respected',()=>{
 assert.equal(gesture(Array(100).fill(-20)),500);
 assert.equal(gesture(Array(100).fill(20)),25);
 const state={};wheelPageZoom(100,{deltaY:-1,deltaMode:0},state,0);
 assert.equal(wheelPageZoom(200,{deltaY:-15,deltaMode:0},state,10),250,'the stale target of the old zoom is dropped');
});
test('switching between pinch and wheel notches cannot reuse the other sensitivity',()=>{
 const state={};
 assert.equal(wheelPageZoom(100,{deltaY:-1,deltaMode:0},state,0),null);
 assert.equal(wheelPageZoom(100,{deltaY:-120,deltaMode:0},state,16),110);
 assert.equal(wheelPageZoom(110,{deltaY:-1,deltaMode:0},state,32),null);
});
test('malformed gesture input cannot change page zoom',()=>{
 for(const input of [null,{},NaN,0,{deltaY:Infinity,deltaMode:0},{deltaY:1,deltaMode:3},{deltaY:10001,deltaMode:0}])assert.equal(wheelPageZoom(100,input,{},0),null);
});

// macOS: Chromium zooms the page on Ctrl+wheel on every other platform and scrolls on a Mac, so qa/page-zoom-rendering.mjs failed its
// "Ctrl+wheel zooms once over the website" check there (the page stayed at 100% and scrolled). The preload now zooms on the wheel while the
// Control key is held; a pinch (a ctrl+wheel with no Control key) and a page that cancels the wheel itself are left alone.
const fs=require('node:fs'),path=require('node:path');
function preload(platform){
 const listeners=new Map(),sent=[],add=(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  win={addEventListener:(type,fn)=>add(type,fn),removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)},
  doc={addEventListener:()=>{},removeEventListener:()=>{}},handlers={},ipc={send:(...args)=>{if(!String(args[0]).startsWith('acira:key-ack'))sent.push(args);},on:(channel,fn)=>{handlers[channel]=fn;},invoke(){return Promise.resolve();}};
 const src=fs.readFileSync(path.join(__dirname,'../desktop/page-input-preload.cjs'),'utf8');
 new Function('require','window','document','process','navigator','location',src)(()=>({ipcRenderer:ipc}),win,doc,{platform,isMainFrame:true},{},{href:'https://a.test/'});
 const fire=(type,event)=>{for(const fn of [...(listeners.get(type)||[])])fn(event);};
 return {sent,fire,handlers,wheelListeners:()=>listeners.get('wheel')?.size||0};
}
const wheel=(deltaY,extra={})=>({isTrusted:true,ctrlKey:true,metaKey:false,altKey:false,defaultPrevented:false,deltaY,deltaMode:0,prevented:false,preventDefault(){this.prevented=true;this.defaultPrevented=true;},...extra});
test('macOS: the wheel with Control held zooms one step per notch and does not scroll',()=>{
 const page=preload('darwin'),idle=page.wheelListeners();
 page.fire('keydown',{key:'Control'});assert.equal(page.wheelListeners(),idle+1,'the wheel listener (a blocking one costs scroll smoothness) exists only while Control is down');
 const up=wheel(-120),down=wheel(120);page.fire('wheel',up);page.fire('wheel',down);
 assert.deepEqual(page.sent.filter(m=>m[0]==='acira:page-wheel-zoom').map(m=>m[1]),[{deltaY:-120,deltaMode:0},{deltaY:120,deltaMode:0}],'each wheel crosses the bridge with its deltas: main keeps the running total');
 assert.ok(up.prevented&&down.prevented,'the page does not scroll as well');
 page.fire('keyup',{key:'Control'});assert.equal(page.wheelListeners(),idle);
});
test('macOS: a pinch (ctrl+wheel with no Control key), a page that cancels the wheel, other modifiers and untrusted events are left alone',()=>{
 const page=preload('darwin'),idle=page.wheelListeners();
 page.fire('wheel',wheel(-1.5));assert.equal(page.sent.filter(m=>m[0]==='acira:page-wheel-zoom').length,0,'no zoom without a held Control key');
 page.fire('keydown',{key:'Control'});
 for(const event of [wheel(-120,{defaultPrevented:true}),wheel(-120,{metaKey:true}),wheel(-120,{altKey:true}),wheel(-120,{isTrusted:false}),wheel(-120,{ctrlKey:false}),wheel(0)]){page.fire('wheel',event);assert.equal(event.prevented,false);}
 assert.equal(page.sent.filter(m=>m[0]==='acira:page-wheel-zoom').length,0);
 page.fire('blur',{});assert.equal(page.wheelListeners(),idle,'losing focus lets go of a Control key whose keyup never arrives');
});
test('other platforms keep Chromium\'s own Ctrl+wheel zoom (zoom-changed): the preload adds nothing',()=>{
 const page=preload('win32'),idle=page.wheelListeners();page.fire('keydown',{key:'Control'});assert.equal(page.wheelListeners(),idle);
});
test('main answers the preload\'s wheel step for the visible active tab only',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/pageBridge\.on\('acira:page-wheel-zoom',\(event,input\)=>\{[^]*?tab\.id!==state\.activeTabId[^]*?websiteWheelZoom\(current,input,entry\.wheelZoom\?\?=\{\}\);if\(zoom!==null\)browserCommand\(\{type:'zoom',tabId:tab\.id,zoom,instant:true\}\);\}\);/,'main steps a website through a per-tab running total, and a wheel step is instant (only plus, minus and Reset glide)');
});

// Ctrl+wheel over a website on a Mac sent one zoom step per wheel event: a trackpad's Control + two-finger scroll is about 60 small events a
// second (and momentum after the fingers lift), so one short swipe ran from 100% to the top preset. Websites now share the running total of
// Acira's own pages (wheelPageZoom), a mouse notch stays one step.
// 'site' feeds what a page is told (the device's pixels divided by the page's zoom, as Chromium reports them); 'page' feeds Acira's own pages
// (wheelPageZoom, the interface's zoom is 100%) the device's pixels.
function stream(deltas,{start=100,gap=16,kind='site',state={},t0=1000}={}){
 let zoom=start;const seen=[];
 deltas.forEach((device,i)=>{const now=t0+i*gap,next=kind==='site'?websiteWheelZoom(zoom,{deltaY:device/(zoom/100),deltaMode:0},state,now):wheelPageZoom(zoom,{deltaY:device,deltaMode:0},state,now);if(next!==null)zoom=next;seen.push(zoom);});
 return seen;
}
test('one mouse notch is exactly one step, in pixel or line mode, either way',()=>{
 for(const [input,from,to] of [[{deltaY:-120,deltaMode:0},100,110],[{deltaY:-100,deltaMode:0},100,110],[{deltaY:120,deltaMode:0},100,90],[{deltaY:-40,deltaMode:0},100,110],[{deltaY:-3,deltaMode:1},100,110],[{deltaY:3,deltaMode:1},110,100],[{deltaY:-1,deltaMode:2},125,150]])
  assert.equal(websiteWheelZoom(from,input,{},0),to,JSON.stringify(input));
});
test('a notch reported twice a few ms apart is one step; the next notch a moment later is another',()=>{
 const state={};
 assert.equal(websiteWheelZoom(100,{deltaY:-120,deltaMode:0},state,1000),110);
 assert.equal(websiteWheelZoom(110,{deltaY:-120,deltaMode:0},state,1002),null,'the doubled tick');
 assert.equal(websiteWheelZoom(110,{deltaY:-120,deltaMode:0},state,1060),125,'a real second notch');
});
test('a trackpad stream steps as far as the fingers moved, not once per event',()=>{
 const seen=stream(Array.from({length:40},(_,i)=>-(3+i%6)));
 assert.equal(seen[11],200,'after 12 small events (66 px) the page is five steps up (one step per event would be at 500)');
 assert.equal(stream(Array(12).fill(-5)).at(-1),175,'60 px of movement is three or four steps up (one step per event reaches 500)');
 assert.equal(stream(Array(12).fill(5)).at(-1),50,'and the same distance down (one step per event reaches 25)');
 assert.equal(seen.at(-1),500,'a long swipe (220 px) still gets to the top');
});
test('a trackpad stream over a website steps exactly like the same stream over an Acira page',()=>{
 const deltas=Array.from({length:40},(_,i)=>-(3+(i*7)%6));
 assert.deepEqual(stream(deltas),stream(deltas,{kind:'page'}));
 const taper=[-8,-8,-7,-7,-6,-5,-5,-4,-3,-3,-2,-2,-1,-1];
 assert.deepEqual(stream(taper),stream(taper,{kind:'page'}),'momentum after the fingers lift tapers the same way');
});
test('the page\'s own zoom does not change the distance: Chromium divides the pixel deltas by it, and they are put back',()=>{
 for(const start of [100,125,200,300,500]){
  const deltas=Array.from({length:30},(_,i)=>(i%2?-1:1)*(3+i%6));
  assert.deepEqual(stream(deltas,{start}),stream(deltas,{start,kind:'page'}),'a stream from '+start+'%');
 }
 // A notch of 120 reads 80 at 150%, 40 at 300% and 24 at 500%: still one step.
 assert.equal(websiteWheelZoom(150,{deltaY:-80,deltaMode:0},{},0),175);
 assert.equal(websiteWheelZoom(300,{deltaY:-40,deltaMode:0},{},0),400);
 assert.equal(websiteWheelZoom(500,{deltaY:24,deltaMode:0},{},0),400,'24 px is a notch at 500%, not a creep');
});
test('streams are per tab, and a pause starts a new gesture',()=>{
 const a={},b={};
 assert.deepEqual(stream(Array(6).fill(-5),{state:a}),stream(Array(6).fill(-5),{state:b}),'two tabs do not share a total');
 const state={};stream(Array(8).fill(-5),{state,t0:1000});
 assert.equal(websiteWheelZoom(110,{deltaY:-1,deltaMode:0},state,1000+8*16+400),null,'a pause drops the old target; one px is not a step');
});
test('malformed wheel input changes nothing',()=>{
 for(const input of [null,undefined,1,'x',{},{deltaY:NaN,deltaMode:0},{deltaY:0,deltaMode:0},{deltaY:-120},{deltaY:-120,deltaMode:7},{deltaY:-99999,deltaMode:0}])assert.equal(websiteWheelZoom(100,input,{},0),null,JSON.stringify(input));
});

// A key reaches only the focused frame. With the keyboard in the top document, a Control + trackpad scroll over an embedded frame found that frame
// without a held Control (found by qa/page-zoom-rendering.mjs: its swipe lands on the fixture's iframe). Main now says when Control moves.
test('macOS: main tells a frame when Control is held, so a wheel over an embedded frame zooms although the key went elsewhere',()=>{
 const frame=preload('darwin'),idle=frame.wheelListeners();
 assert.equal(typeof frame.handlers['acira:control-held'],'function');
 frame.handlers['acira:control-held']({},true);assert.equal(frame.wheelListeners(),idle+1);
 const up=wheel(-6);frame.fire('wheel',up);assert.ok(up.prevented);
 assert.deepEqual(frame.sent.filter(m=>m[0]==='acira:page-wheel-zoom').map(m=>m[1]),[{deltaY:-6,deltaMode:0}]);
 frame.handlers['acira:control-held']({},false);assert.equal(frame.wheelListeners(),idle,'and lets go when Control is released');
 frame.handlers['acira:control-held']({},'yes');assert.equal(frame.wheelListeners(),idle,'only a real true holds it');
});
test('main reports Control going down and up (and losing focus) to every frame of the page, on macOS only',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/if\(process\.platform==='darwin'\)\{const control=down=>\{if\(entry\.controlDown===down\)return;entry\.controlDown=down;[^]*?framesInSubtree\)[^]*?frame\.send\('acira:control-held',down\)[^]*?input\.key==='Control'&&!input\.isAutoRepeat\)control\(input\.type==='keyDown'\)[^]*?wc\.on\('blur',\(\)=>control\(false\)\);\}/);
});
