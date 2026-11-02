'use strict';
// Reusing a named window (window.open(url,'name') twice) navigated the first tab but left it in the background. A main-frame navigation
// of another tab started by the tab the person is on, after a click or key press, now brings that tab forward, as Chrome does.
// The pop-up window's size comes from window-open-policy.cjs popupBounds (window-open-policy.test.cjs), no longer a fixed 640×760.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('a navigation started from the active tab after a click selects the tab it lands in',()=>{
 const at=main.indexOf("wc.on('will-frame-navigate'"),block=main.slice(at,main.indexOf('});',main.indexOf("window.open(url,'name')",at))+3);
 assert.ok(at>0&&block.includes("window.open(url,'name')"));
 assert.ok(block.includes('if(event.isMainFrame&&event.initiator&&state.activeTabId!==tab.id)'),'only a top-level navigation of a tab that is not in front, started by another frame');
 assert.ok(block.includes('from=webContents.fromFrame(event.initiator)')&&block.includes('from!==wc?pageOwner(pages,from):null'),'the initiator is another tab of this window');
 assert.ok(block.includes("fromId===state.activeTabId&&popupGate.recent(from))dispatch({type:'tab.select',id:tab.id})"),'the person\'s tab, after a click or key press');
});

test('the pop-up window takes the size the page asked for instead of a fixed 640×760',()=>{
 assert.ok(!main.includes('autoHideMenuBar:true,width:640,height:760'));
 assert.ok(main.includes("...require('./window-open-policy.cjs').popupBounds(details.features,(()=>{try{return screen.getDisplayMatching(mainWindow.getBounds()).workArea;}catch{return null;}})())"));
});
