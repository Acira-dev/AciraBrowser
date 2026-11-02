'use strict';
// "Window closed · Undo" opens a new window whose first tab is the closed window's first tab, so Rewind adopts it instead of making it again. Pinned tabs
// sort first, so that adopted tab is the first pinned one, and it came back unpinned (only the tabs Rewind made itself were pinned).
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createRewind}=require('../desktop/rewind/rewind.cjs');
const noTimers={setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>({unref(){}}),clearInterval:()=>{}};
const windowWith=urls=>{let s=createInitialState();for(const url of urls)s=reduceBrowser(s,{type:'tab.new',url});return s;};

test('reopening a closed window pins every pinned tab again, the first one included',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-reopen-pinned-'));let opened=null;
 const make=(state,windowId)=>{const c={windowId,privateMode:false,closing:false,window:{isDestroyed:()=>false},state,get profileId(){return c.state.activeBrowserProfileId;},commitAction(a){c.state=reduceBrowser(c.state,a);return c.state;},ready:Promise.resolve(true)};return c;};
 const rw=createRewind({dir,timers:noTimers,openWindow:({initialURL})=>{let s=createInitialState();s=reduceBrowser(s,{type:'tab.navigate',tabId:s.activeTabId,url:initialURL});opened=make(s,'w3');return opened;}});
 let closing=windowWith(['https://a.test/','https://b.test/','https://c.test/','https://d.test/']);
 const id=url=>closing.tabs.find(t=>t.url===url).id;
 closing=reduceBrowser(closing,{type:'tab.pin',id:id('https://b.test/')});
 closing=reduceBrowser(closing,{type:'tab.pin',id:id('https://c.test/')});
 const order=closing.tabs.filter(t=>t.url.startsWith('https://')).map(t=>[t.url,t.pinned]);
 assert.deepEqual(order.map(([,pinned])=>pinned),[true,true,false,false],'pinned tabs lead the list');
 rw.windowClosed('w1',closing);
 await rw.reopenWindow('w1');
 assert.deepEqual(opened.state.tabs.map(t=>[t.url,t.pinned]),order,'the same tabs, the same two pinned, in the same order');
 rw.dispose();
});
