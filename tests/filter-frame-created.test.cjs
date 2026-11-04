'use strict';
// optional-filtering.cjs puts its frame script into a page's subframes at dom-ready. It read `details.frame` of the frame-created event again
// at that point; Electron's getter then answers null for a frame that has moved to another document since, and logs "Frame property was
// accessed after it navigated or was destroyed" (all 18 of those lines in a 2-minute soak came from here). The frame is now read once, when it
// is created. Which frames get the script is unchanged: the getter below behaves as Electron 44's does.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createOptionalFiltering}=require('../desktop/browser-services/optional-filtering.cjs');

function rig(){
 const on={},warnings=[],listen=warning=>warnings.push(String(warning.message));
 const filters=createOptionalFiltering({ipcMain:{handle(){},on(name,fn){on[name]=fn;}},database:{policy:()=>undefined,setPolicy(){},policies:()=>[]},getOwner:()=>({profileId:'A'}),resolveContents:()=>null});
 const session={registerPreloadScript(){}};filters.attach(session,'A',false,{useBefore(){}});
 const mainFrame={url:'https://parent.example/',isDestroyed:()=>false};
 const wc=Object.assign(new EventEmitter(),{id:41,session,mainFrame,isDestroyed:()=>false,getURL:()=>mainFrame.url});
 on['acira:content-filter-stats']({sender:wc,senderFrame:mainFrame},0);   // the page's own frame script reports in: the page is followed from now on
 const frame=(url,token)=>Object.assign(new EventEmitter(),{url,frameToken:token,injected:0,isDestroyed:()=>false,executeJavaScript(){this.injected++;return Promise.resolve();}});
 // Electron's frame-created details: `frame` resolves the frame of the document it was created with, or null (and a warning) once it moved on.
 const created=item=>{const token=item.frameToken;wc.emit('frame-created',{},{get frame(){if(item.frameToken!==token){process.emitWarning('Frame property was accessed after it navigated or was destroyed. Avoid asynchronous tasks prior to indexing.','electron');return null;}return item;}});};
 process.on('warning',listen);
 return {frame,created,warnings,done:()=>process.off('warning',listen)};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a subframe that loads in the document it was created with gets the frame script, without a warning',async()=>{
 const r=rig(),child=r.frame('https://parent.example/child','T1');
 r.created(child);child.emit('dom-ready');await tick();r.done();
 assert.equal(child.injected,1);assert.deepEqual(r.warnings,[]);
});

test('a subframe that moved to another document before dom-ready logs nothing and is skipped as before',async()=>{
 const r=rig(),child=r.frame('about:blank','T1');
 r.created(child);child.frameToken='T2';child.url='https://other.example/ad';child.emit('dom-ready');await tick();r.done();
 assert.deepEqual(r.warnings,[]);
 assert.equal(child.injected,0,'unchanged: cross-site iframes are not filtered (open question for the founder)');
});
