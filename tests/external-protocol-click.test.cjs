'use strict';
// A clicked mailto: or tel: link reaches the page's will-frame-navigate and never will-navigate, so the "Open an external application?" question
// (which listened on will-navigate) never appeared and the link did nothing. It is asked from will-frame-navigate now, and for a
// target=_blank link from the window-open handler, only after a click or key press on the page.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createPopupGate}=require('../desktop/popup-gate.cjs');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('the gate tells whether a click or key press just reached the page, without a notice',()=>{
 let clock=1000,notices=0;const gate=createPopupGate({now:()=>clock,windowMs:5000,onBlocked:()=>{notices++;}}),wc=new EventEmitter();
 gate.attach(wc);assert.equal(gate.recent(wc),false,'nothing yet');
 wc.emit('before-input-event',{},{type:'keyDown',key:'Shift'});assert.equal(gate.recent(wc),false,'a modifier alone is no gesture');
 wc.emit('before-mouse-event',{},{type:'mouseUp'});assert.equal(gate.recent(wc),true);
 clock+=4000;assert.equal(gate.recent(wc),true);clock+=1500;assert.equal(gate.recent(wc),false,'the gesture expires');
 assert.equal(notices,0,'asking never shows the pop-up notice');
 wc.emit('before-input-event',{},{type:'keyDown',key:'Enter'});assert.equal(gate.recent(wc),true);
 assert.equal(gate.recent(new EventEmitter()),false,'a page the gate never saw');
});

test('main asks from will-frame-navigate for mailto, tel and other app links, behind the gate, and never lets the page navigate away',()=>{
 const at=main.indexOf("wc.on('will-frame-navigate'"),block=main.slice(at,main.indexOf('});',at)+3);
 assert.ok(at>0);
 assert.ok(block.includes('event.preventDefault()'),'the page stays where it is');
 assert.ok(block.includes('if(popupGate.recent(wc))void externalProtocol(event.url,wc);'),'any app link, behind the gate (the module decides which schemes go on)');
});

test('a target=_blank mailto link asks too, after the gate already accepted the click',()=>{
 const at=main.indexOf("if(route.route==='deny')"),block=main.slice(at,at+400);
 assert.ok(at>0&&block.includes("if(!/^https?:/i.test(details.url))void externalProtocol(details.url,wc)"));
 assert.ok(main.indexOf('popupGate.allow(wc,details)')<at,'the click gate comes first');
});

test('main hands app links to the module with the app that handles them, never Acira itself',()=>{
 const at=main.indexOf('async function externalProtocol('),block=main.slice(at,main.indexOf('});}',at)+4);
 assert.ok(at>0&&block.includes('await openAppLink(url,{t:tm,appName:link=>{const name=app.getApplicationNameForProtocol(link);return name===app.getName()?\'\':name;}'));
 assert.ok(block.includes('open:link=>void shell.openExternal(link)')&&block.includes('.response===1'),'Open hands the link on');
});

const {openAppLink,DENIED_EXTERNAL_SCHEMES}=require('../desktop/external-protocol.cjs');
const t=(id,values={})=>({'main.openApp':`Open ${values.app}?`,'main.noAppForLinks':`No app on this computer opens ${values.scheme} links.`,'main.openAnExternalApplication':'Open an external application?'})[id];
async function click(url,{apps={},answer=true}={}){const asked=[],toasts=[],opened=[];const result=await openAppLink(url,{t,appName:link=>apps[new URL(link).protocol]||'',ask:async question=>{asked.push(question);return answer;},toast:text=>toasts.push(text),open:link=>opened.push(link)});return {result,asked,toasts,opened};}

test('a link an installed app handles asks "Open <App>?" by name, and Open hands it on',async()=>{
 const apps={'zoommtg:':'zoom.us.app','slack:':'Slack','spotify:':'Spotify','sms:':'Messages','facetime:':'FaceTime','msteams:':'Microsoft Teams','mailto:':'Mail'};
 for(const [url,name] of [['zoommtg://zoom.us/join?confno=1','zoom.us'],['slack://open','Slack'],['spotify:track:1','Spotify'],['sms:+15550100','Messages'],['facetime:+15550100','FaceTime'],['msteams:/l/meetup-join/x','Microsoft Teams'],['mailto:a@example.com','Mail']]){
  const r=await click(url,{apps});assert.equal(r.result,'opened',url);assert.deepEqual(r.asked,[{message:`Open ${name}?`,detail:url}]);assert.deepEqual(r.opened,[url]);assert.deepEqual(r.toasts,[]);
 }
 const cancelled=await click('slack://open',{apps,answer:false});assert.equal(cancelled.result,'cancelled');assert.deepEqual(cancelled.opened,[],'Cancel opens nothing');
});

test('with no app for the scheme a toast says so; mailto and tel still ask without a name',async()=>{
 const none=await click('zoommtg://zoom.us/join');assert.equal(none.result,'no-app');assert.deepEqual(none.toasts,['No app on this computer opens zoommtg: links.']);assert.deepEqual(none.asked,[]);assert.deepEqual(none.opened,[]);
 const mail=await click('mailto:a@example.com');assert.deepEqual(mail.asked.map(q=>q.message),['Open an external application?']);
});

test('the browser\'s own, in-page and code-running schemes are never handed on, even when an app claims them',async()=>{
 for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','blob:https://a.example/1','about:blank','chrome://settings','view-source:https://a.example/','acira://settings','ms-msdt:/id x','search-ms:query=x','shell:startup','vbscript:x']){
  const r=await click(url,{apps:{[new URL(url).protocol]:'Something'}});assert.equal(r.result,'denied',url);assert.deepEqual([r.asked,r.toasts,r.opened],[[],[],[]],url);
 }
 assert.ok(DENIED_EXTERNAL_SCHEMES.has('http')&&DENIED_EXTERNAL_SCHEMES.has('https'),'web addresses are never another app\'s');
 assert.equal((await click('not a url')).result,'invalid');
});
