import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForPopupVideo} from '../src/ui/popupMedia';

function fixture(hasFrameCallback=true){
 const frames=new Map<number,FrameRequestCallback>();let next=0,callback:(()=>void)|undefined,cancelled=false;
 const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=fn=>{const id=++next;frames.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 const video=Object.assign(new EventTarget(),{readyState:2,videoWidth:800,videoHeight:600,play:async()=>{},requestVideoFrameCallback:hasFrameCallback?((fn:()=>void)=>{callback=fn;return 7;}):undefined,cancelVideoFrameCallback:()=>{cancelled=true;callback=undefined;}}) as unknown as HTMLVideoElement;
 return {video,controller:new AbortController(),present(){const fn=callback;callback=undefined;fn?.();},async frame(){const pending=[...frames];frames.clear();for(const [,fn]of pending)fn(0);await Promise.resolve();},get pending(){return frames.size;},get cancelled(){return cancelled;},restore(){globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;}};
}

test('decoded playback stays covered until a presented texture and two paint frames',async()=>{
 const f=fixture();try{let ready=false;const promise=waitForPopupVideo(f.video,f.controller.signal).then(()=>{ready=true;});await f.frame();assert.equal(ready,false);f.video.dispatchEvent(new Event('loadeddata'));assert.equal(f.pending,0);f.present();assert.equal(ready,false);await f.frame();assert.equal(ready,false);await f.frame();await promise;assert.equal(ready,true);assert.equal(f.pending,0);}finally{f.restore();}
});
test('presentation before play resolves still waits for both readiness conditions',async()=>{
 const f=fixture();try{const promise=waitForPopupVideo(f.video,f.controller.signal);f.present();await f.frame();await f.frame();await f.frame();await promise;assert.equal(f.pending,0);}finally{f.restore();}
});
test('older engines prime a decoded texture for two frames without video callbacks',async()=>{
 const f=fixture(false);try{const promise=waitForPopupVideo(f.video,f.controller.signal);await f.frame();await f.frame();await f.frame();await promise;}finally{f.restore();}
});
test('close cancels a pending presentation and cannot resolve from a stale frame',async()=>{
 const f=fixture();try{const promise=waitForPopupVideo(f.video,f.controller.signal);const rejected=assert.rejects(promise,{name:'AbortError'});await f.frame();f.controller.abort();await rejected;assert.equal(f.cancelled,true);assert.equal(f.pending,0);f.present();await f.frame();}finally{f.restore();}
});
test('close cancels an in-flight paint fence',async()=>{
 const f=fixture();try{const promise=waitForPopupVideo(f.video,f.controller.signal);const rejected=assert.rejects(promise,{name:'AbortError'});await f.frame();f.present();await f.frame();f.controller.abort();await rejected;assert.equal(f.pending,0);}finally{f.restore();}
});
test('capture that never presents times out and cancels the callback',async()=>{
 const f=fixture();try{const promise=waitForPopupVideo(f.video,f.controller.signal,10);await f.frame();await assert.rejects(promise,/first frame timed out/);assert.equal(f.cancelled,true);assert.equal(f.pending,0);}finally{f.restore();}
});
test('play failure and decode failure release every pending callback',async()=>{
 for(const failure of ['play','decode']){const f=fixture();try{if(failure==='play')f.video.play=async()=>{throw Error('Playback denied');};const promise=waitForPopupVideo(f.video,f.controller.signal);const rejected=assert.rejects(promise,failure==='play'?/Playback denied/:/could not decode/);if(failure==='decode')f.video.dispatchEvent(new Event('error'));else await f.frame();await rejected;assert.equal(f.cancelled,true);assert.equal(f.pending,0);}finally{f.restore();}}
});
