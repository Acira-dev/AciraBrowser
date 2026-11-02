'use strict';
// A protected page opened while the CDM is still installing (a first run, or a profile whose CDM is missing) is reloaded once it is ready, without the
// "couldn't start protected playback" notice in between. If it is not there, the notice shows as before, and the tab still reloads if it arrives later.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {refused,cdmChanged}=require('../desktop/browser-services/protected-media.cjs');
let n=0;const T=1.8e12; // real clock times: the notice's 5-second cooldown counts from 0
function page(url){const wc=new EventEmitter();wc.url=url;wc.reloads=0;wc.destroyed=false;wc.getURL=()=>wc.url;wc.isDestroyed=()=>wc.destroyed;wc.reload=()=>{wc.reloads++;};return wc;}
const tab=()=>'tab-'+(++n);
const INSTALLING={status:'installing',version:null,expected:true},MISSING={status:'unavailable',version:null,expected:true},READY={status:'ready',version:'4.10.3112.0',expected:true},NONE={status:'unavailable',version:null,expected:false};

test('refused while installing: no notice, then one reload when the CDM is ready',()=>{
 const wc=page('https://www.netflix.com/browse'),told=[];
 assert.equal(refused(wc,tab(),e=>told.push(e),INSTALLING,T+1000),false);
 assert.deepEqual(told,[]);
 cdmChanged(READY,T+2000);assert.equal(wc.reloads,1);
 cdmChanged(READY,T+3000);assert.equal(wc.reloads,1,'reloaded once');
});
test('a tab that moved to another site is not reloaded',()=>{
 const wc=page('https://www.netflix.com/watch/1');refused(wc,tab(),()=>{},INSTALLING,T+1000);
 wc.url='https://example.com/';cdmChanged(READY,T+2000);assert.equal(wc.reloads,0);
});
test('a closed tab is forgotten',()=>{
 const wc=page('https://open.spotify.com/');refused(wc,tab(),()=>{},INSTALLING,T+1000);
 wc.destroyed=true;wc.emit('destroyed');cdmChanged(READY,T+2000);assert.equal(wc.reloads,0);
});
test('installing turns into missing: the held tab is told then, and still reloads if the CDM comes later',()=>{
 const wc=page('https://www.disneyplus.com/'),told=[],id=tab();
 refused(wc,id,e=>told.push(e),INSTALLING,T+1000);
 cdmChanged(MISSING,T+30000);assert.deepEqual(told,[{type:'protected-media',tabId:id,host:'disneyplus.com'}]);
 cdmChanged(MISSING,T+40000);assert.equal(told.length,1,'told once');
 cdmChanged(READY,T+90000);assert.equal(wc.reloads,1);
});
test('refused while missing: the usual notice at once, and a reload if it arrives',()=>{
 const wc=page('https://www.primevideo.com/'),told=[];
 assert.equal(refused(wc,tab(),e=>told.push(e),MISSING,T+1000),true);assert.equal(told.length,1);
 cdmChanged(READY,T+2000);assert.equal(wc.reloads,1);
});
test('refused with a ready CDM, or on a runtime that has none: the notice only, never a reload',()=>{
 for(const cdm of [READY,NONE]){
  const wc=page('https://www.netflix.com/title/2'),told=[];
  assert.equal(refused(wc,tab(),e=>told.push(e),cdm,T+1000),true);assert.equal(told.length,1);
  cdmChanged(READY,T+2000);assert.equal(wc.reloads,0);
 }
});
