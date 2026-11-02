import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPopupCaptureLifetime,type PopupCaptureStream} from '../src/ui/popupCaptureLifetime';
import {freezePopupVideo} from '../src/ui/popupMedia';
import {decodePopupSnapshot} from '../src/ui/popupSnapshot';

test('a cropped snapshot clips original view corners and discards its image after decode or cancellation',async()=>{
 const calls:unknown[][]=[],images:{src:string}[]=[];
 let wait:Promise<void>|undefined;
 const descriptors=['Image','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 class SnapshotImage {src='';naturalWidth=400;naturalHeight=200;constructor(){images.push(this);}decode(){return wait??Promise.resolve();}}
 const canvas={width:0,height:0,setAttribute(){},getContext:()=>({scale:(...args:unknown[])=>calls.push(['scale',...args]),beginPath(){},roundRect:(...args:unknown[])=>calls.push(['clip',...args]),clip(){},drawImage:(...args:unknown[])=>calls.push(['draw',...args])})};
 Object.defineProperty(globalThis,'Image',{configurable:true,value:SnapshotImage});Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
 const source={key:'page:1',bounds:{x:300,y:200,width:200,height:100},sourceBounds:{x:0,y:80,width:1200,height:800},radius:12,image:'data:image/png;base64,fixture'};
 try{
  const decoded=await decodePopupSnapshot(source,new AbortController().signal);
  assert.equal(decoded,canvas);assert.deepEqual(calls[1],['clip',-300,-120,1200,800,12]);assert.equal(images[0].src,'');
  let finish!:()=>void;wait=new Promise(resolve=>{finish=resolve;});const controller=new AbortController(),pending=decodePopupSnapshot(source,controller.signal);controller.abort();finish();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(images[1].src,'');assert.equal(calls.filter(call=>call[0]==='draw').length,1,'A cancelled decode publishes no pixels');
  await assert.rejects(decodePopupSnapshot({...source,image:'https://remote/image.png'},new AbortController().signal),/Invalid/);
 }finally{for(const[key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});

function capture(trackCount=1){
 const tracks=Array.from({length:trackCount},()=>({readyState:'live',stops:0,stop(){this.readyState='ended';this.stops++;}}));
 const stream={getTracks:()=>tracks} as unknown as PopupCaptureStream;
 return {stream,tracks};
}

test('closing a capture owner ends every track and repeated cleanup is harmless',()=>{
 const owner=createPopupCaptureLifetime(),page=capture(2),chrome=capture();
 assert.equal(owner.closed,false);
 assert.equal(owner.adopt(page.stream),true);assert.equal(owner.adopt(chrome.stream),true);
 owner.adopt(page.stream); // A repeated registration must not double-own a stream.
 owner.close();owner.close();owner.release(page.stream);
 assert.equal(owner.closed,true);
 for(const track of [...page.tracks,...chrome.tracks]){assert.equal(track.readyState,'ended');assert.equal(track.stops,1);}
});

test('freezing/releasing one source ends only that source and removes it from later cleanup',()=>{
 const owner=createPopupCaptureLifetime(),page=capture(2),chrome=capture(),foreign=capture();
 owner.adopt(page.stream);owner.adopt(chrome.stream);
 owner.release(foreign.stream);assert.equal(foreign.tracks[0].stops,0);
 owner.release(page.stream);owner.release(page.stream);
 assert.ok(page.tracks.every(track=>track.stops===1));assert.equal(chrome.tracks[0].readyState,'live');
 owner.close();assert.ok(page.tracks.every(track=>track.stops===1));assert.equal(chrome.tracks[0].stops,1);
});

test('acquisition resolving after owner closure is rejected and its tracks end immediately',async()=>{
 const owner=createPopupCaptureLifetime(),late=capture(2);
 let deliver!:(stream:PopupCaptureStream)=>void;
 const acquisition=new Promise<PopupCaptureStream>(resolve=>{deliver=resolve;});
 const accepted=acquisition.then(stream=>owner.adopt(stream));
 owner.close();deliver(late.stream);
 assert.equal(await accepted,false);
 assert.ok(late.tracks.every(track=>track.readyState==='ended'&&track.stops===1));
});

test('late work from an old generation cannot keep its stream or close a new generation',async()=>{
 const previous=createPopupCaptureLifetime(),old=capture(),late=capture(),next=capture();
 previous.adopt(old.stream);previous.close();
 const current=createPopupCaptureLifetime();assert.equal(current.adopt(next.stream),true);
 assert.equal(await Promise.resolve(late.stream).then(stream=>previous.adopt(stream)),false);
 previous.close();previous.release(next.stream);
 assert.equal(old.tracks[0].readyState,'ended');assert.equal(late.tracks[0].readyState,'ended');
 assert.equal(next.tracks[0].readyState,'live');assert.equal(current.closed,false);
 current.close();assert.equal(next.tracks[0].stops,1);
});

test('frozen material copies a decoded frame before capture ownership is released',()=>{
 const owner=createPopupCaptureLifetime(),source=capture(),calls:unknown[][]=[];
 owner.adopt(source.stream);
 const canvas={width:0,height:0,setAttribute:(...args:unknown[])=>calls.push(args),getContext:()=>({drawImage:(...args:unknown[])=>{
  assert.equal(source.tracks[0].readyState,'live');calls.push(args);
 }})};
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{assert.equal(tag,'canvas');return canvas;}}});
 try{
  const video={readyState:2,videoWidth:640,videoHeight:480} as HTMLVideoElement;
  assert.equal(freezePopupVideo(video),canvas);owner.release(source.stream);
  assert.equal(canvas.width,640);assert.equal(canvas.height,480);
  assert.deepEqual(calls,[['aria-hidden','true'],[video,0,0]]);
  assert.equal(source.tracks[0].readyState,'ended');
  for(const invalid of [{readyState:1,videoWidth:640,videoHeight:480},{readyState:2,videoWidth:0,videoHeight:480},{readyState:2,videoWidth:640,videoHeight:0}]){
   assert.throws(()=>freezePopupVideo(invalid as HTMLVideoElement),/not decoded/);
  }
  assert.equal(calls.length,2);
 }finally{owner.close();if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');}
});
