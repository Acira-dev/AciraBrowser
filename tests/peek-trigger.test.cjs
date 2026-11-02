'use strict';
// How a link is previewed from the page: Alt+click and Shift+click open Peek, a hold does too, Ctrl+Alt+click is split view.
// The page-input preload runs here against a small fake window, so the gestures are tested as written.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');

function load({mainFrame=true}={}){
 const sent=[],listeners={},handlers={};
 class Anchor{constructor(href,rects){this.href=href;this.rects=rects;}getClientRects(){return this.rects;}}
 class Area extends Anchor{}
 const window={addEventListener(name,fn,options){(listeners[name]??=[]).push({fn,options});}};
 const timers=[];
 const sandbox={document:{addEventListener(){},querySelectorAll:()=>[],pointerLockElement:null},require:name=>{if(name==='electron')return {ipcRenderer:{send:(...args)=>sent.push(JSON.parse(JSON.stringify(args))),on:(channel,fn)=>{handlers[channel]=fn;}}};throw new Error(name);},window,process:{isMainFrame:mainFrame},HTMLAnchorElement:Anchor,HTMLAreaElement:Area,Date,Math,Number,String,Object,Set,Array,
  setTimeout:(fn,ms)=>{timers.push({fn,ms,live:true});return timers.length-1;},clearTimeout:id=>{if(timers[id])timers[id].live=false;}};
 vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/page-input-preload.cjs'),'utf8'),sandbox);
 const fire=(name,event)=>{const state={prevented:false,stopped:false};const e={isTrusted:true,button:0,clientX:100,clientY:50,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,pointerType:'mouse',deltaMode:0,getModifierState:()=>false,composedPath:()=>[],preventDefault:()=>{state.prevented=true;},stopImmediatePropagation:()=>{state.stopped=true;},...event};
  for(const {fn} of listeners[name]||[])fn(e);return state;};
 return {sent,fire,timers,Anchor,Area,handlers};
}
const link=(h,href='https://example.com/page',rects)=>new h.Anchor(href,rects??[{left:90,top:44,right:210,bottom:62,width:120,height:18}]);

test('Alt+click on a link previews it, growing from the link (its box crosses with the address and the point)',()=>{
 const h=load(),a=link(h);
 h.fire('mousedown',{});const state=h.fire('click',{altKey:true,composedPath:()=>[a]});
 assert.equal(state.prevented,true);assert.equal(state.stopped,true,'the page never sees the click');
 assert.deepEqual(h.sent,[['acira:page-peek-link',{url:'https://example.com/page',x:100,y:50,rect:{x:90,y:44,width:120,height:18}}]]);
});

test('Shift+click still previews, now with the link box too; a plain click does nothing',()=>{
 const h=load(),a=link(h);
 h.fire('mousedown',{});h.fire('click',{shiftKey:true,composedPath:()=>[a]});
 assert.equal(h.sent.length,1);assert.equal(h.sent[0][0],'acira:page-peek-link');assert.deepEqual(h.sent[0][1].rect,{x:90,y:44,width:120,height:18});
 h.sent.length=0;const plain=h.fire('click',{composedPath:()=>[a]});assert.equal(plain.prevented,false);assert.deepEqual(h.sent,[]);
});

test('a wrapped link grows from the line the pointer is on',()=>{
 const h=load(),a=link(h,'https://example.com/wrapped',[{left:10,top:10,right:300,bottom:28,width:290,height:18},{left:10,top:30,right:120,bottom:48,width:110,height:18}]);
 h.fire('mousedown',{clientX:50,clientY:38});h.fire('click',{altKey:true,clientX:50,clientY:38,composedPath:()=>[a]});
 assert.deepEqual(h.sent[0][1].rect,{x:10,y:30,width:110,height:18});
});

test('Ctrl+Alt+click opens the link in split view beside this page; AltGr, Meta and a dragged click do not preview',()=>{
 const h=load(),a=link(h);
 h.fire('mousedown',{});const split=h.fire('click',{altKey:true,ctrlKey:true,composedPath:()=>[a]});
 assert.equal(split.prevented,true);assert.deepEqual(h.sent,[['acira:page-split-link','https://example.com/page']]);
 h.sent.length=0;h.fire('click',{altKey:true,ctrlKey:true,getModifierState:key=>key==='AltGraph',composedPath:()=>[a]});assert.deepEqual(h.sent,[],'AltGr is a letter, not a gesture');
 h.fire('click',{altKey:true,metaKey:true,composedPath:()=>[a]});h.fire('click',{altKey:true,shiftKey:true,composedPath:()=>[a]});
 assert.deepEqual(h.sent,[],'Alt with another modifier is not Peek');
 h.fire('mousedown',{clientX:0,clientY:0});const dragged=h.fire('click',{altKey:true,clientX:80,clientY:60,composedPath:()=>[a]});
 assert.equal(dragged.prevented,false,'a drag that moved more than 4px is not a click');assert.deepEqual(h.sent,[]);
});

test('only http(s) links and trusted clicks count',()=>{
 const h=load();
 h.fire('mousedown',{});h.fire('click',{altKey:true,composedPath:()=>[link(h,'javascript:alert(1)')]});h.fire('click',{altKey:true,composedPath:()=>[link(h,'file:///C:/x')]});
 h.fire('click',{altKey:true,isTrusted:false,composedPath:()=>[link(h)]});h.fire('click',{altKey:true,button:1,composedPath:()=>[link(h)]});
 assert.deepEqual(h.sent,[]);
});

test('press and hold previews with the link box; releasing early is a click; the click after a preview is swallowed',()=>{
 const h=load(),a=link(h);
 h.fire('pointerdown',{composedPath:()=>[a]});assert.equal(h.timers.length,1);assert.equal(h.timers[0].ms,450);
 h.timers[0].fn();assert.deepEqual(h.sent,[['acira:page-peek-link',{url:'https://example.com/page',x:100,y:50,rect:{x:90,y:44,width:120,height:18}}]]);
 const swallowed=h.fire('click',{composedPath:()=>[a]});assert.equal(swallowed.prevented,true,'the click that follows the hold does not navigate');
 const early=load();early.fire('pointerdown',{composedPath:()=>[link(early)]});early.fire('pointerup',{});assert.equal(early.timers[0].live,false);assert.deepEqual(early.sent,[]);
});

test('Alt+Enter on a focused link previews it from the keyboard, growing from the link box; AltGr+Enter and plain Enter do not',()=>{
 const h=load(),a=link(h);
 const state=h.fire('keydown',{key:'Enter',altKey:true,composedPath:()=>[a]});
 assert.equal(state.prevented,true);assert.deepEqual(h.sent,[['acira:page-peek-link',{url:'https://example.com/page',x:150,y:53,rect:{x:90,y:44,width:120,height:18}}]]);
 h.sent.length=0;h.fire('keydown',{key:'Enter',composedPath:()=>[a]});h.fire('keydown',{key:'Enter',altKey:true,getModifierState:k=>k==='AltGraph',composedPath:()=>[a]});h.fire('keydown',{key:'Enter',altKey:true,repeat:true,composedPath:()=>[a]});
 assert.deepEqual(h.sent,[]);
});

test('Settings › Tabs › Link preview off: Alt+click, Shift+click, hold and Alt+Enter are left to the page; on again, they preview',()=>{
 const h=load(),a=link(h);h.handlers['acira:link-preview']({}, {on:false});
 h.fire('mousedown',{});const alt=h.fire('click',{altKey:true,composedPath:()=>[a]}),shift=h.fire('click',{shiftKey:true,composedPath:()=>[a]});
 h.fire('pointerdown',{composedPath:()=>[a]});const enter=h.fire('keydown',{key:'Enter',altKey:true,composedPath:()=>[a]});
 assert.equal(alt.prevented||shift.prevented||enter.prevented,false,'the page keeps its gestures');assert.equal(h.timers.filter(t=>t.live).length,0,'no hold timer');assert.deepEqual(h.sent,[]);
 h.handlers['acira:link-preview']({}, {on:true});h.fire('click',{altKey:true,composedPath:()=>[a]});assert.equal(h.sent.length,1);
});


test('the page preload never cancels Ctrl+wheel: a trackpad pinch arrives as one and Chromium turns it into visual zoom',()=>{
 for(const mainFrame of [true,false]){
  const h=load({mainFrame});
  for(const event of [{ctrlKey:true,deltaY:-120},{ctrlKey:true,deltaY:-.25},{ctrlKey:true,deltaY:120},{deltaY:120},{ctrlKey:true,altKey:true,deltaY:120}])assert.equal(h.fire('wheel',event).prevented,false,'the wheel stays left to Chromium');
  assert.deepEqual(h.sent,[],'no zoom request crosses the bridge; Chromium zooms the page and magnifies on pinch');
 }
});
