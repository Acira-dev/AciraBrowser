'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createContentBlocking}=require('../desktop/content-blocking.cjs');

test('site blocking controls affect local ad requests, survive service restoration and stay profile scoped',()=>{
 const policies=new Map(),database={policy:(profile,site)=>policies.get(profile+'|'+site),setPolicy:(profile,site,value)=>policies.set(profile+'|'+site,value)};
 const create=()=>createContentBlocking({database,ipcMain:{handle(){},on(){}},getOwner:()=>({}),filtersPath:path.resolve('resources/filters'),cachePath:path.resolve('.qa-profiles/services-unit/quick-blocker-cache'),privacyPlusDirectory:path.resolve('.qa-profiles/services-unit/quick-blocker-privacy')});
 const attach=(blocker,profile,id)=>{const session={webRequest:{onBeforeRequest(_filter,callback){this.before=callback;},onHeadersReceived(){}},registerPreloadScript(){}};blocker.attach(session,profile,false);return Object.assign(new EventEmitter(),{id,session,isDestroyed:()=>false,getURL:()=>'http://127.0.0.1:45678/fixture'});};
 const request=wc=>{let response;wc.session.webRequest.before({webContents:wc,webContentsId:wc.id,url:'http://127.0.0.1:45678/ads/banners/fixture.svg',referrer:wc.getURL(),resourceType:'image',id:1},result=>response=result);return response;};
 const blocker=create(),one=attach(blocker,'profile-one',100),two=attach(blocker,'profile-two',101);
 assert.equal(request(one).cancel,true);
 assert.equal(blocker.status(one).blocked,1);
 assert.equal(blocker.set(one,false,'site').blocking,false);
 assert.equal(request(one).cancel,undefined);
 assert.equal(request(two).cancel,true);
 assert.equal(blocker.status(one).profileBlocking,true,'site exception does not change global default');
 const restored=create(),sameProfile=attach(restored,'profile-one',102);
 assert.equal(restored.status(sameProfile).blocking,false);
 assert.equal(request(sameProfile).cancel,undefined);
 assert.equal(restored.set(sameProfile,true,'site').blocking,true);
 assert.equal(request(sameProfile).cancel,true);
});
