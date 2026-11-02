'use strict';
// Ctrl+wheel over a page the interface draws (Settings, History, the new tab...): a wheel notch, or Control held with a trackpad's
// two-finger scroll, steps the page zoom in main; a pinch (a ctrl+wheel with small precise deltas and no Control key down, which is how
// Chromium sends one) is told to the page's own script as 'acira:pinch' and never reaches main. The interface preload runs here
// against a small fake window.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');

async function load(){
 const sent=[],listeners={},dispatched=[];
 class CustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}}
 const window={addEventListener(name,fn,options){(listeners[name]??=[]).push({fn,options});},dispatchEvent:event=>{dispatched.push(event);return true;}};
 const ipcRenderer={setMaxListeners(){},on(){},removeListener(){},sendSync:()=>({}),invoke:()=>Promise.resolve(),send:(...args)=>sent.push(JSON.parse(JSON.stringify(args)))};
 const sandbox={window,CustomEvent,document:{documentElement:null,getElementById:()=>null,createElement:()=>({})},process:{platform:'darwin'},JSON,Number,Math,Promise,console,
  require:name=>{if(name==='electron')return {contextBridge:{exposeInMainWorld(){}},ipcRenderer};throw new Error('unexpected require '+name);}};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),sandbox);
 const over=area=>({closest:selector=>selector==='.page-area'&&area?{}:null});
 const wheel=(extra={})=>{const state={prevented:false};const e={isTrusted:true,ctrlKey:true,altKey:false,deltaY:-3,deltaMode:0,clientX:410,clientY:230,target:over(true),preventDefault(){state.prevented=true;},...extra};for(const {fn} of listeners.wheel||[])fn(e);return state;};
 const key=(type,k)=>{for(const {fn} of listeners[type]||[])fn({key:k});};
 const flush=async()=>{await Promise.resolve();await Promise.resolve();};
 const zoomRequests=()=>sent.filter(m=>m[0]==='acira:internal-wheel-zoom').map(m=>m[1]);
 return {wheel,key,flush,zoomRequests,dispatched,listeners,blur:()=>{for(const {fn} of listeners.blur||[])fn({});}};
}

test('a pinch over a page the interface draws is told to the page and cancelled, not sent to main as page zoom',async()=>{
 const h=await load();
 const state=h.wheel({deltaY:-3.5});await h.flush();
 assert.equal(state.prevented,true,'the interface itself is never magnified by Chromium');
 assert.deepEqual(h.zoomRequests(),[],'a pinch is not a page zoom step');
 assert.equal(h.dispatched.length,1);assert.equal(h.dispatched[0].type,'acira:pinch');
 assert.deepEqual(JSON.parse(h.dispatched[0].detail),{deltaY:-3.5,x:410,y:230},'the delta and the fingers\' point cross as text (an object would not cross the isolated world)');
});

test('with Control held a trackpad scroll steps the page zoom in main, and stops being one when Control is released or the window loses focus',async()=>{
 const h=await load();
 h.key('keydown','Control');h.wheel({deltaY:-3.5});await h.flush();
 assert.deepEqual(h.zoomRequests(),[{deltaY:-3.5,deltaMode:0}]);assert.equal(h.dispatched.length,0);
 h.key('keyup','Control');h.wheel({deltaY:-3.5});assert.equal(h.dispatched.length,1,'a pinch again once Control is up');
 h.key('keydown','Control');h.blur();h.wheel({deltaY:-3.5});assert.equal(h.dispatched.length,2,'blur lets go of Control');
});

test('a wheel notch, or a wheel counted in lines, steps the page zoom whatever Control reports',async()=>{
 const h=await load();
 h.wheel({deltaY:-120});h.wheel({deltaY:-3,deltaMode:1});h.wheel({deltaY:40});await h.flush();
 assert.deepEqual(h.zoomRequests(),[{deltaY:-120,deltaMode:0},{deltaY:-3,deltaMode:1},{deltaY:40,deltaMode:0}]);assert.equal(h.dispatched.length,0);
});

test('only a trusted Ctrl+wheel over the page area is taken; Alt, the toolbar, a plain wheel and a still wheel are left alone',async()=>{
 const h=await load();
 for(const extra of [{isTrusted:false},{ctrlKey:false},{altKey:true},{target:{closest:()=>null}},{deltaY:0},{deltaY:Number.NaN}]){
  const state=h.wheel(extra);assert.equal(state.prevented,false,JSON.stringify(extra));
 }
 await h.flush();assert.deepEqual(h.zoomRequests(),[]);assert.equal(h.dispatched.length,0);
 const wheelListeners=h.listeners.wheel;assert.equal(wheelListeners.length,1);assert.deepEqual(JSON.parse(JSON.stringify(wheelListeners[0].options)),{capture:true,passive:false});
});

test('main tells the interface when a zoom command reached a page it draws, so a pinch is cleared even when the level stays',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/if\(!wc\)\{if\(c\.type==='zoom'\)\{browserEvent\(tab\.id,\{zoom:[^]*?emitBrowser\(\{type:'page-zoom-set',tabId:tab\.id\}\);\}return;\}/);
});

test('a level another window saved for an Acira page reaches the tabs on it here, as it does for a site',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/const aciraZoomKey=url=>\/\^acira:\\\/\\\/\[a-z\]\[a-z0-9-\]\{0,31\}\$\/\.test\(url\)\?url:null;/);
 assert.match(main,/\[aciraZoomKey\(url\)\?\?new URL\(url\)\.origin\]/,'preferredZoom looks an Acira page up under its address');
 assert.match(main,/for\(const tab of state\.tabs\)\{if\(tab\.contentKind==='internal'\)\{tab\.zoom=Math\.round\(preferredZoom\(tab\)\*100\);continue;\}if\(tab\.contentKind!=='web'\)continue;/);
});
