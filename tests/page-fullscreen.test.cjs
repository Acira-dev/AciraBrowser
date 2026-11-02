'use strict';
// HTML fullscreen (a video's full-screen button): the page fills the screen from the first frame of macOS's transition, not the
// window's old size in a corner on black (founder, 30 Oct), and takes the window's exact size once the transition ends.
const test=require('node:test'),assert=require('node:assert/strict');
const {createPageFullscreen}=require('../desktop/page-fullscreen.cjs');

test('entering page fullscreen sizes the page to the screen at once, then to the window once full screen',()=>{
 const listeners={},placed=[];let full=false,content=[1200,800];
 const window={isDestroyed:()=>false,isFullScreen:()=>full,setFullScreen:on=>{full=on;},getContentSize:()=>content,once:(name,fn)=>{listeners[name]=fn;},contentView:{addChildView(){}}};
 const contents={isDestroyed:()=>false,getURL:()=>'https://video.example/watch'};
 const entry={view:{webContents:contents,getVisible:()=>true,setVisible(){},setBorderRadius(){}}},pages=new Map([['t',entry]]);
 const state={activeTabId:'t',tabs:[{id:'t',contentKind:'web'}]};
 let api;
 api=createPageFullscreen({getWindow:()=>window,getChrome:()=>null,getState:()=>state,pages,render:()=>api.present(),hideFloating(){},placeBounds:(_entry,bounds)=>placed.push(bounds),focus(){},screenSize:()=>({width:1728,height:1117})});
 assert.equal(api.enter('t',entry),true);
 assert.deepEqual(placed.at(-1),{x:0,y:0,width:1728,height:1117},'the screen at once');
 content=[1728,1085];listeners['enter-full-screen']();
 assert.deepEqual(placed.at(-1),{x:0,y:0,width:1728,height:1085},'the window once full screen');
});

test('leaving fullscreen when the page has already been destroyed does not throw',()=>{
 let full=false,rendered=0,chromeShown=0;
 const window={isDestroyed:()=>false,isFullScreen:()=>full,setFullScreen:on=>{full=on;},getContentSize:()=>[1200,800],once(){},contentView:{addChildView(){}}};
 const entry={view:{webContents:{isDestroyed:()=>false,getURL:()=>'https://video.example/watch'},getVisible:()=>true,setVisible(){},setBorderRadius(){}}},pages=new Map([['t',entry]]);
 const state={activeTabId:'t',tabs:[{id:'t',contentKind:'web'}]};
 const api=createPageFullscreen({getWindow:()=>window,getChrome:()=>({webContents:{isDestroyed:()=>false},setVisible:()=>{chromeShown++;}}),getState:()=>state,pages,render:()=>{rendered++;},hideFloating(){},placeBounds(){},focus(){}});
 assert.equal(api.enter('t',entry),true);
 /* Electron hands back no webContents for a destroyed view: the page's 'destroyed' listener must still restore the window, or the tab's close never finishes. */
 entry.view.webContents=undefined;
 assert.doesNotThrow(()=>api.leave(entry));
 assert.equal(full,false,'the window leaves fullscreen');
 assert.equal(chromeShown,1,'the browser chrome returns');
});
