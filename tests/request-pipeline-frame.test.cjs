'use strict';
// Electron's webRequest details carry `frame` as a getter: read after the frame navigated or went away it answers null and logs "Frame property
// was accessed after it navigated or was destroyed" (most of the remaining lines in the soak came from here). The pipeline spread the details
// for every participant, so it read the getter for each of them, and after an asynchronous participant (CNAME uncloaking) late. It is now
// read only by a participant that asks, and once per request.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {RequestPipeline}=require('../desktop/request-pipeline.cjs');

function rig(){
 const events={},webRequest={onBeforeRequest:(_f,h)=>events.before=h,onHeadersReceived:(_f,h)=>events.headers=h,onCompleted:(_f,h)=>events.completed=h,onErrorOccurred:(_f,h)=>events.failed=h};
 const pipeline=new RequestPipeline({webRequest});
 const frame={url:'https://site.example/'};let gone=false,reads=0,late=0;
 const details={id:1,url:'https://cdn.example/a.js',resourceType:'script',webContentsId:3};
 Object.defineProperty(details,'frame',{enumerable:true,get(){reads++;if(gone){late++;return null;}return frame;}});
 const send=()=>new Promise(resolve=>events.before(details,resolve));
 return {pipeline,send,frame,leave:()=>{gone=true;},counts:()=>({reads,late})};
}

test('participants that never ask for the frame never read it',async()=>{
 const r=rig();let seen=null;
 r.pipeline.useBefore(details=>{seen=details.url;return {};});
 r.pipeline.useBefore(()=>Promise.resolve({}).then(()=>{r.leave();return {};}));   // an asynchronous participant, after which the frame is gone
 r.pipeline.useBefore(details=>({requestHeaders:{x:details.resourceType}}));
 assert.deepEqual(await r.send(),{requestHeaders:{x:'script'}});
 assert.equal(seen,'https://cdn.example/a.js');
 assert.deepEqual(r.counts(),{reads:0,late:0});
});

test('a participant that asks gets the frame; it is read once per request, also for the ones after an asynchronous step',async()=>{
 const r=rig(),got=[];
 r.pipeline.useBefore(details=>{got.push(details.frame);return {};});
 r.pipeline.useBefore(()=>Promise.resolve({}).then(()=>{r.leave();return {};}));
 r.pipeline.useBefore(details=>{got.push(details.frame);assert.ok(Object.keys(details).includes('frame'),'the frame is still listed');return {};});
 assert.deepEqual(await r.send(),{});
 assert.deepEqual(got,[r.frame,r.frame],'the request\'s frame, as read when it started');
 assert.deepEqual(r.counts(),{reads:1,late:0});
});
