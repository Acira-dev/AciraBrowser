'use strict';
// A link click on a page with a beforeunload handler raised the native macOS alert ("Changes on this website may not be saved."),
// while a typed address and a tab close used the in-window card. The page-input preload now reports a plain link click's address
// (peek-trigger.test.cjs); will-prevent-unload uses it to ask in the card, and Leave repeats the click with the page's prompt waived.
// 13.5: the cases that used to keep the blocking system box (a reload, Back, a form, a script's navigation) ask without blocking too (leave-gate.test.cjs).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('main keeps the last link click of the top page, web addresses only',()=>{
 const at=main.indexOf("pageBridge.on('acira:link-intent'"),block=main.slice(at,main.indexOf('});',at)+3);
 assert.ok(at>0);
 assert.ok(block.includes('event.senderFrame===event.sender.mainFrame'),'top page only');
 assert.ok(block.includes("/^https?:\\/\\//i.test(url)"),'http and https only');
 assert.ok(block.includes('entry.linkIntent={url:url.slice(0,4096),at:Date.now()}'));
});

test('will-prevent-unload hands the page to the leave gate; nothing in that path blocks the process any more',()=>{
 const at=main.indexOf("wc.on('will-prevent-unload'"),block=main.slice(main.lastIndexOf('const leaveGate=require',at),main.indexOf("wc.on('did-fail-load'",at));
 assert.ok(at>0);
 assert.ok(block.includes("leaveGate.guardUnload(wc,entry)"),'Acira\'s own reload and history steps are put on the record');
 assert.ok(block.includes('createLeaveGate({entry,contents:wc,'),'one gate per page');
 assert.ok(block.includes("wc.on('will-prevent-unload',event=>unloadGate.handle(event));"));
 assert.ok(block.includes('ask:intent=>askToLeave(wc,tab,intent)'));
 assert.ok(block.includes("if(intent.kind==='close'){wc.close({waitForBeforeUnload:true});return;}"),'Leave closes the page again with its prompt waived');
 assert.ok(block.includes("dispatch({type:'tab.navigate',tabId:tab.id,url:intent.url})"),'Leave goes to the address');
 assert.ok(block.includes("intent.kind==='reload'||intent.kind==='history'"),'Leave repeats a reload or a history step');
 assert.ok(!/showMessageBoxSync\(/.test(block),'no blocking box in the page handler');
 assert.ok(block.includes('keepClosing'),'a close stays open while the question is up');
});

test('the question is asked with the card, or with the system sheet attached to the window, never with a blocking box',()=>{
 const at=main.indexOf('function askToLeave('),body=main.slice(at,main.indexOf('function closePage(',at));
 assert.ok(at>0);
 assert.ok(!/showMessageBoxSync\(/.test(body),'asking never blocks');
 assert.ok(body.includes('dialog.showMessageBox(mainWindow,options)'),'the sheet is attached to the window and asynchronous');
 assert.ok(body.includes("tm(\"main.leaveThisWebsite\")")&&body.includes("tm(\"main.changesOnThisWebsiteMay\")"),'the sheet keeps its words');
 assert.ok(body.includes('buttons:[tm("main.stay"),tm("main.leave")],defaultId:0,cancelId:0'),'Stay is the default');
 assert.ok(body.includes('windowClosing||!appDialog.available(mainWindow)'),'a closing window and a hidden test window use the sheet');
 assert.ok(body.includes("closing?closePrompt({scope:'tab'"),'a tab close keeps its card');
});

test('main keeps the address the page reports for its own navigations, web addresses only',()=>{
 const at=main.indexOf("pageBridge.on('acira:nav-intent'"),block=main.slice(at,main.indexOf("pageBridge.on('acira:link-intent'",at));
 assert.ok(at>0);
 assert.ok(block.includes('event.senderFrame===event.sender.mainFrame'),'top page only');
 assert.ok(block.includes('/^https?:\\/\\//i.test(payload.url)'),'http and https only');
 assert.ok(block.includes('entry.navIntent={url:payload.url.slice(0,4096)'));
});

test('the page preload reports full-page web navigations the page starts, before its own prompt',()=>{
 const preload=fs.readFileSync(path.join(__dirname,'../desktop/page-input-preload.cjs'),'utf8');
 const at=preload.indexOf("window.navigation.addEventListener('navigate'"),block=preload.slice(at,preload.indexOf('});',at)+3);
 assert.ok(at>0);
 assert.ok(preload.slice(at-1400,at).includes('if(process.isMainFrame){'),'top page only');
 assert.ok(preload.includes("ipcRenderer.on('acira:replay-submit'")&&preload.includes('requestSubmit('),'a posting form is submitted again after Leave');
 assert.ok(block.includes('event.isTrusted'));assert.ok(block.includes('destination.sameDocument'),'same-document steps never ask');
 assert.ok(block.includes('event.downloadRequest'));assert.ok(block.includes('^https?:'));
 assert.ok(block.includes("ipcRenderer.send('acira:nav-intent'"));
});

test('closing a popup window asks without blocking too',()=>{
 assert.ok(!/closeOwnedWindow\(popup,window=>dialog\.showMessageBoxSync/.test(main),'the popup question is not a blocking box');
 assert.ok(/closeOwnedWindow\(popup,window=>dialog\.showMessageBox\(window,\{[^}]*\}\)\.then\(result=>result\.response===1\)\)/.test(main));
});
