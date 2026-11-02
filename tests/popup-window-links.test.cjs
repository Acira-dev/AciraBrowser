'use strict';
// A sign-in or payment window a page opened (window.open with a size) used to swallow every link that wanted a new window: Help, Privacy
// and Terms (target=_blank) did nothing. They now open as a tab beside the page that opened the window, behind the same click gate
// and pop-up ad judge as the page's own windows; the window itself still never opens windows of its own.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
const at=main.indexOf("wc.on('did-create-window'"),block=main.slice(at,main.indexOf("popup.webContents.on('will-navigate'",at));

test('a link in a pop-up window opens a tab of the opener, not nothing',()=>{
 assert.ok(at>0&&block.includes('popup.webContents.setWindowOpenHandler(details=>'),'the pop-up window has its own open handler');
 assert.ok(!block.includes("setWindowOpenHandler(()=>({action:'deny'}))"),'it no longer refuses everything');
 assert.match(block,/dispatch\(\{type:'tab\.new',url:details\.url,background:details\.disposition==='background-tab',browserProfileId:tab\.browserProfileId,afterId:tab\.id/,'the link becomes a tab beside the opener');
});

test('only web addresses behind a click and the ad judge become tabs, and the window opens no window of its own',()=>{
 assert.match(block,/!\/\^https\?:\\\/\\\/\/i\.test\(details\.url\)/,'web addresses only');
 assert.ok(block.includes('popupGate.attach(popup.webContents)')&&block.includes('popupGate.allow(popup.webContents,details)'),'a recent click or key press is needed');
 assert.ok(block.includes('contentBlocking?.popups?.judge(popup.webContents,details.url,false)'),'pop-up ads are judged as for the page');
 assert.ok(block.includes('windowClosing||entry.securedLocked'),'a closing window or a locked secured tab opens nothing');
 assert.equal((block.match(/return \{action:'allow'/g)||[]).length,0,'the pop-up never gets a window of its own');
});
