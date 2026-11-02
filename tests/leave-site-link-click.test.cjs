'use strict';
// A link click on a page with a beforeunload handler raised the native macOS alert ("Changes on this website may not be saved."),
// while a typed address and a tab close used the in-window card. The page-input preload now reports a plain link click's address
// (peek-trigger.test.cjs); will-prevent-unload uses it to ask in the card, and Leave repeats the click with the page's prompt waived.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('main keeps the last link click of the top page, web addresses only',()=>{
 const at=main.indexOf("pageBridge.on('acira:link-intent'"),block=main.slice(at,main.indexOf('});',at)+3);
 assert.ok(at>0);
 assert.ok(block.includes('event.senderFrame===event.sender.mainFrame'),'top page only');
 assert.ok(block.includes("/^https?:\\/\\//i.test(url)"),'http and https only');
 assert.ok(block.includes('entry.linkIntent={url:url.slice(0,4096),at:Date.now()}'));
});

test('will-prevent-unload asks in the card for a recent link click and repeats it on Leave; forms and scripts keep the system box',()=>{
 const at=main.indexOf("wc.on('will-prevent-unload'"),block=main.slice(at,main.indexOf("wc.on('did-fail-load'",at));
 assert.ok(at>0);
 assert.match(block,/clicked=!closing&&!typed&&entry\.linkIntent\?\.at>now-2000\?entry\.linkIntent\.url:null,target=typed\|\|clicked;entry\.linkIntent=undefined;/,'a click within 2 s, used once');
 assert.ok(block.includes('if((closing||target)&&appDialog.available(mainWindow)){stay();'),'the card, the page stays for now');
 assert.ok(block.includes("entry.leaveApproved=Date.now()+5000;if(closing)dispatch({type:'tab.close',id:tab.id});else dispatch({type:'tab.navigate',tabId:tab.id,url:target});"),'Leave goes to the link with the prompt waived');
 assert.ok(block.includes('dialog.showMessageBoxSync('),'anything else still gets the system box');
});
