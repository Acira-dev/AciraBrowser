'use strict';
// chrome.tabCapture / chrome.desktopCapture: Chrome's gating, the stream-id plumbing (issue -> arm -> display-media answer), the extension
// page's getUserMedia shim, the permission engine's armed path and the share picker's plan (desktop/browser-services/media-capture.cjs,
// extension-apis.cjs, extension-apis-renderer.cjs, permission-engine.cjs, desktop/share-ui.cjs).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCaptureBroker,tabCaptureError,desktopSourcesError,streamsFor,originOf,MESSAGES,TTL}=require('../desktop/browser-services/media-capture.cjs');
const {installExtensionApis}=require('../desktop/browser-services/extension-apis.cjs');
const {patchPreload}=require('../desktop/browser-services/extension-runtime-patch.cjs');
const {createPermissions}=require('../desktop/browser-services/permission-engine.cjs');
const {plan}=require('../desktop/share-ui.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const ID='abcdefghijklmnopabcdefghijklmnop',OTHER='ponmlkjihgfedcbaponmlkjihgfedcba';

test('tabCapture needs the extension invoked on that tab, on the same site, and never a browser page',()=>{
 const tab={id:5,url:'https://meet.example/room'};
 assert.equal(tabCaptureError({tab,invoked:undefined}),MESSAGES.tabGrant,'no toolbar click yet');
 assert.equal(tabCaptureError({tab,invoked:{tabId:6,origin:'https://meet.example'}}),MESSAGES.tabGrant,'clicked on another tab');
 assert.equal(tabCaptureError({tab,invoked:{tabId:5,origin:'https://old.example'}}),MESSAGES.tabGrant,'the tab has since gone to another site');
 assert.equal(tabCaptureError({tab:{id:5,url:'acira://settings'},invoked:{tabId:5,origin:''}}),MESSAGES.tabGrant,'browser pages cannot be captured');
 assert.equal(tabCaptureError({tab,invoked:{tabId:5,origin:'https://meet.example'},busy:true}),MESSAGES.tabSame);
 assert.equal(tabCaptureError({tab:null}),MESSAGES.tabInvalid);
 assert.equal(tabCaptureError({tab,invoked:{tabId:5,origin:'https://meet.example'}}),'');
 assert.equal(originOf(`chrome-extension://${ID}/rec.html`),`chrome-extension://${ID}`);
});

test('desktopCapture.chooseDesktopMedia takes Chrome\'s source types and needs a target tab from a worker',()=>{
 assert.equal(desktopSourcesError([]),MESSAGES.sourcesEmpty);
 assert.equal(desktopSourcesError(['screen','printer']),MESSAGES.sourcesInvalid);
 assert.equal(desktopSourcesError(['audio']),MESSAGES.sourcesEmpty,'sound alone is not a source');
 assert.equal(desktopSourcesError(['screen','window'],{fromWorker:true}),MESSAGES.targetRequired);
 assert.equal(desktopSourcesError(['screen','window','tab','audio'],{fromWorker:true,targetTab:{id:3}}),'');
 assert.equal(desktopSourcesError(['window']),'');
});

test('a stream id belongs to its extension, works once, expires after 10 s, and arms only the page that used it',()=>{
 let clock=1000,n=0;const broker=createCaptureBroker({now:()=>clock,randomId:()=>'id'+(++n),uuid:()=>'cap'+n});
 const events=[];broker.subscribe((status,c)=>events.push([status,c.captureId,c.source.type]));
 const id=broker.issue({extensionId:ID,source:{type:'tab',tabId:5},audio:true,label:'Loom'});
 assert.deepEqual(broker.arm(id,{extensionId:OTHER,contentsId:40}),{error:MESSAGES.streamInvalid},'another extension cannot use it');
 assert.equal(broker.isArmed(40),false);
 assert.deepEqual(broker.arm(id,{extensionId:ID,contentsId:40}),{captureId:'cap1',audio:true,source:{type:'tab'}});
 assert.deepEqual(broker.arm(id,{extensionId:ID,contentsId:40}),{error:MESSAGES.streamInvalid},'used up');
 assert.equal(broker.isArmed(40),true);assert.equal(broker.isArmed(41),false,'only that page');
 const taken=broker.take(40);assert.equal(taken.source.tabId,5);assert.equal(broker.take(40),null,'one display request');
 assert.equal(broker.tabBusy(5),true);
 assert.deepEqual(broker.capturedTabs(ID),[{tabId:5,status:'pending',fullscreen:false}]);
 assert.equal(broker.started('cap1',OTHER),false);assert.equal(broker.started('cap1',ID),true);
 assert.deepEqual(broker.capturedTabs(ID),[{tabId:5,status:'active',fullscreen:false}]);
 broker.endFor(40);assert.deepEqual(broker.capturedTabs(ID),[]);assert.equal(broker.tabBusy(5),false);
 assert.deepEqual(events,[['pending','cap1','tab'],['active','cap1','tab'],['stopped','cap1','tab']]);
 const late=broker.issue({extensionId:ID,source:{type:'screen',id:'screen:1:0',name:'Screen 1'}});clock+=TTL+1;
 assert.deepEqual(broker.arm(late,{extensionId:ID,contentsId:40}),{error:MESSAGES.streamInvalid},'expired');
 const armedLate=broker.issue({extensionId:ID,source:{type:'screen',id:'screen:1:0',name:'Screen 1'}});broker.arm(armedLate,{extensionId:ID,contentsId:41});clock+=6000;
 assert.equal(broker.isArmed(41),false,'an armed page that never asks loses it');
});

test('the display-media answer: a tab\'s frame (and its sound), a screen with system sound on Windows, a window without sound',()=>{
 const frame={id:'main'},wc={isDestroyed:()=>false,mainFrame:frame},fromId=id=>id===5?wc:null;
 assert.deepEqual(streamsFor({type:'tab',tabId:5},{audio:true,audioRequested:true,fromId}),{video:frame,audio:frame});
 assert.deepEqual(streamsFor({type:'tab',tabId:5},{audio:true,audioRequested:false,fromId}),{video:frame},'no sound unless the page asked');
 assert.equal(streamsFor({type:'tab',tabId:9},{fromId}),null,'closed tab');
 assert.deepEqual(streamsFor({type:'screen',id:'screen:0:0',name:'Entire screen'},{audio:true,audioRequested:true,platform:'win32'}),{video:{id:'screen:0:0',name:'Entire screen'},audio:'loopback'});
 assert.deepEqual(streamsFor({type:'screen',id:'screen:0:0',name:'S'},{audio:true,audioRequested:true,platform:'darwin'}),{video:{id:'screen:0:0',name:'S'}});
 assert.deepEqual(streamsFor({type:'window',id:'window:9:0',name:'W'},{audio:true,audioRequested:true,platform:'win32'}),{video:{id:'window:9:0',name:'W'}});
 assert.deepEqual(plan({types:['screen','window','tab'],audio:true,platform:'win32'}),{groups:['screen','window','tab'],audio:{screen:true,window:false,tab:true}});
 assert.deepEqual(plan({types:['window','bogus'],audio:true,platform:'linux'}),{groups:['window'],audio:{screen:false,window:false,tab:false}});
});

function engine({pick=async()=>null}={}){
 const handlers=new Map(),sent=[],session={serviceWorkers:{getAllRunning:()=>({})}};
 handlers.set('browserAction.activate',{callback:()=>{}});
 const router={handlers,listeners:new Map(),handle(name,callback){handlers.set(name,{callback});},sendEvent(...args){sent.push(args);}};
 const tabs=new Map([[5,{id:5,session,isDestroyed:()=>false,getURL:()=>'https://meet.example/room'}],[6,{id:6,session,isDestroyed:()=>false,getURL:()=>'https://docs.example/'}]]);
 const win={id:1},store={getTabById:id=>tabs.get(id),getWindowById:()=>win,getCurrentWindow:()=>win,getActiveTabFromWindow:()=>tabs.get(5)};
 session.extensions={getExtension:()=>null,on(){}};
 let n=0;const broker=createCaptureBroker({randomId:()=>'stream'+(++n),uuid:()=>'cap'+n});
 installExtensionApis({ctx:{router,store}},{session,captureBroker:broker,pickShare:pick});
 const call=(name,manifest,event,...args)=>handlers.get(name).callback({type:'frame',sender:{id:77,isDestroyed:()=>false,executeJavaScript:async()=>undefined},...event,extension:{id:ID,name:'Recorder',manifest}},...args);
 return {handlers,sent,broker,call,tabs};
}
const TAB={manifest_version:3,permissions:['tabCapture']},DESK={manifest_version:3,permissions:['desktopCapture']};

test('tabCapture.getMediaStreamId: permission, the toolbar click on that tab, then an id the extension\'s page arms once',async()=>{
 const {handlers,sent,broker,call}=engine();
 assert.deepEqual(await call('tabCapture.getMediaStreamId',{manifest_version:3,permissions:[]},{},{}),{__acira_error:"'tabCapture' permission is required."});
 assert.deepEqual(await call('tabCapture.getMediaStreamId',TAB,{},{}),{__acira_error:MESSAGES.tabGrant},'no click yet');
 handlers.get('browserAction.activate').callback({sender:{}},{eventType:'click',extensionId:ID,tabId:5});
 assert.deepEqual(await call('tabCapture.getMediaStreamId',TAB,{},{targetTabId:6}),{__acira_error:MESSAGES.tabGrant},'clicked on another tab');
 assert.deepEqual(await call('tabCapture.getMediaStreamId',TAB,{},{targetTabId:99}),{__acira_error:MESSAGES.tabInvalid});
 assert.deepEqual(await call('tabCapture.getMediaStreamId',TAB,{},{consumerTabId:99}),{__acira_error:MESSAGES.consumerInvalid});
 const id=await call('tabCapture.getMediaStreamId',TAB,{type:'service-worker',sender:{}},{});
 assert.equal(id,'stream1','a worker may ask for the id (MV3)');
 assert.deepEqual(await call('mediaCapture.arm',TAB,{type:'service-worker',sender:{}},id),{__acira_error:MESSAGES.frameOnly},'only a page can use it');
 let gesture=null;const page={id:77,isDestroyed:()=>false,once(){},on(){},executeJavaScript:async(code,user)=>{gesture=user;}};
 assert.deepEqual(await call('mediaCapture.arm',TAB,{sender:page},id),{captureId:'cap1',audio:true,source:{type:'tab'}});
 assert.equal(gesture,true,'the page gets the user activation getDisplayMedia needs');
 assert.equal(broker.isArmed(77),true);
 assert.deepEqual(await call('mediaCapture.arm',TAB,{sender:page},id),{__acira_error:MESSAGES.streamInvalid},'works once');
 broker.take(77);await call('mediaCapture.started',TAB,{},'cap1');
 assert.deepEqual(await call('tabCapture.getCapturedTabs',TAB,{}),[{tabId:5,status:'active',fullscreen:false}]);
 assert.deepEqual(await call('tabCapture.getMediaStreamId',TAB,{},{}),{__acira_error:MESSAGES.tabSame},'one capture per tab');
 await call('mediaCapture.ended',TAB,{},'cap1');
 assert.deepEqual(sent.filter(s=>s[1]==='tabCapture.onStatusChanged').map(s=>[s[0],s[2].status,s[2].tabId]),[[ID,'pending',5],[ID,'active',5],[ID,'stopped',5]]);
 assert.deepEqual(await call('tabCapture.captureStreamId',TAB,{},{audio:false,video:false}),{__acira_error:MESSAGES.noAudioOrVideo});
 assert.equal(await call('tabCapture.captureStreamId',TAB,{},{video:true}),'stream2','capture(): the active tab again once the first capture ended');
});

test('desktopCapture.chooseDesktopMedia asks Acira\'s picker; Cancel gives an empty id; cancelChooseDesktopMedia closes it',async()=>{
 const asked=[];let answer={source:{type:'window',id:'window:42:0',name:'Acira'},audio:false};
 const pick=async options=>{asked.push({types:options.types,audio:options.audio,requester:options.requester});if(answer==='wait')return new Promise(resolve=>{options.request.cancel=()=>resolve(null);});return answer;};
 const {call,broker}=engine({pick});
 assert.deepEqual(await call('desktopCapture.chooseDesktopMedia',DESK,{type:'service-worker',sender:{}},1,['screen','window']),{__acira_error:MESSAGES.targetRequired});
 assert.deepEqual(await call('desktopCapture.chooseDesktopMedia',DESK,{},1,['screen','window'],{id:99}),{__acira_error:MESSAGES.targetInvalid});
 assert.deepEqual(await call('desktopCapture.chooseDesktopMedia',TAB,{},1,['screen']),{__acira_error:"'desktopCapture' permission is required."});
 const result=await call('desktopCapture.chooseDesktopMedia',DESK,{},2,['screen','window','tab','audio']);
 assert.deepEqual(result,{streamId:'stream1',canRequestAudioTrack:false});
 assert.deepEqual(asked[0],{types:['screen','window','tab'],audio:true,requester:'Recorder'});
 assert.deepEqual(broker.streams.get('stream1').source,{type:'window',id:'window:42:0',name:'Acira'});
 answer=null;assert.deepEqual(await call('desktopCapture.chooseDesktopMedia',DESK,{},3,['screen']),{streamId:''},'cancelled in the picker');
 answer='wait';const open=call('desktopCapture.chooseDesktopMedia',DESK,{},4,['screen']);await new Promise(r=>setImmediate(r));
 await call('desktopCapture.cancelChooseDesktopMedia',DESK,{},4);
 assert.deepEqual(await open,{streamId:''});
});

test('the permission engine answers an armed extension page\'s display request with its source, without the picker',async()=>{
 let display,request;const session={setPermissionCheckHandler(){},setPermissionRequestHandler:f=>request=f,setDevicePermissionHandler(){},setDisplayMediaRequestHandler:f=>display=f};
 const main={frameTreeNodeId:3,url:`chrome-extension://${ID}/offscreen.html`,isDestroyed:()=>false},wc={id:77,mainFrame:main,isDestroyed:()=>false,getURL:()=>main.url};
 let picked=0,armed=true;
 const permissions=createPermissions({database:{permission(){},setPermission(){},permissions:()=>[]},dialog:{},getWindow:()=>null,ownsContents:()=>false,pickDisplay:async()=>{picked++;return {};},getFrameOwner:()=>wc,isArmed:c=>c===wc&&armed,takeArmed:(c,r)=>({video:{id:'window:42:0',name:'Acira'},seen:r.audioRequested})});
 permissions.attach(session,'p');
 const answer=await new Promise(resolve=>request(wc,'media',resolve,{mediaTypes:[],requestingUrl:main.url}));
 assert.equal(answer,true,'the armed page may ask for its display stream');
 const reply=await new Promise(resolve=>display({frame:main,audioRequested:true},resolve));
 assert.deepEqual(reply,{video:{id:'window:42:0',name:'Acira'},seen:true});assert.equal(picked,0);
 armed=false;
 assert.equal(await new Promise(resolve=>request(wc,'media',resolve,{mediaTypes:[],requestingUrl:main.url})),false,'not armed: an extension page gets nothing');
 assert.deepEqual(await new Promise(resolve=>display({frame:main},resolve)),{});
 const child={frameTreeNodeId:9,url:'https://ads.example/',isDestroyed:()=>false};armed=true;
 assert.deepEqual(await new Promise(resolve=>display({frame:child},resolve)),{},'a frame inside the page cannot take it');
});

/** The patched engine preload as an extension page sees it, with a fake navigator.mediaDevices and main-process answers. */
function extensionPage(manifest,answer){
 const text=patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'),'utf8'),{});
 const calls=[],media=[];
 const track=(kind)=>{const listeners={};const t={kind,stopped:false,stop(){t.stopped=true;},addEventListener:(name,fn)=>{listeners[name]=fn;},dispatchEvent:event=>{listeners[event.type]?.(event);return true;},applied:null,applyConstraints:async c=>{t.applied=c;}};return t;};
 const stream=tracks=>({getTracks:()=>tracks.slice(),getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),removeTrack:t=>tracks.splice(tracks.indexOf(t),1)});
 const mediaDevices={getUserMedia:async c=>{media.push(['user',c]);return stream([track('video')]);},getDisplayMedia:async c=>{media.push(['display',c]);return stream([track('video'),...(c.audio?[track('audio')]:[])]);}};
 const electron={ipcRenderer:{invoke:async(channel,extensionId,name,...args)=>{calls.push([name,...args]);return answer(name,args);},send(){},addListener(){},on(){},once(){},off(){},removeListener(){}},contextBridge:{executeInMainWorld:({func})=>func()},webFrame:{}};
 const chrome={runtime:{id:ID,getManifest:()=>manifest},i18n:{getMessage:n=>n}};
 const context={require:name=>{if(name==='electron')return electron;throw new Error(name);},process:{type:'renderer',contextIsolated:false},location:{href:`chrome-extension://${ID}/offscreen.html`},
  console:{log(){},warn(){},error(){},debug(){}},URL,Promise,queueMicrotask,Symbol,Event:class{constructor(type){this.type=type;}},crypto:{randomUUID:()=>'0'},chrome,navigator:{mediaDevices}};
 context.document={};context.window=context;   // an extension page (no document means a service worker: Chrome has no tabCapture.capture there)
 context.globalThis=context;vm.createContext(context);vm.runInContext(text,context);
 return {chrome:context.chrome,navigator:context.navigator,calls,media};
}

test('an extension page\'s getUserMedia with a capture stream id goes through the armed display request; other calls are untouched',async()=>{
 const page=extensionPage(TAB,name=>name==='mediaCapture.arm'?{captureId:'cap9',audio:true,source:{type:'tab'}}:name==='tabCapture.getMediaStreamId'?'stream1':true);
 assert.equal(typeof page.chrome.tabCapture.getMediaStreamId,'function');assert.equal(page.chrome.tabCapture.TabCaptureState.ACTIVE,'active');
 assert.equal(page.chrome.desktopCapture,undefined,'only with its own permission');
 await page.navigator.mediaDevices.getUserMedia({audio:true});
 assert.deepEqual(plain(page.media.at(-1)),['user',{audio:true}],'a microphone request is the browser\'s own');
 const stream=await page.navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:'stream1'}},video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:'stream1',maxWidth:1280,maxHeight:720,maxFrameRate:30}}});
 assert.deepEqual(plain(page.media.at(-1)),['display',{video:true,audio:true}]);
 assert.deepEqual(page.calls.filter(c=>c[0].startsWith('mediaCapture.')),[['mediaCapture.arm','stream1'],['mediaCapture.started','cap9']]);
 assert.deepEqual(plain(stream.getVideoTracks()[0].applied),{width:{max:1280},height:{max:720},frameRate:{max:30}});
 // The pill's Stop: every track stops and the capture is reported ended once.
 const stop=page.navigator.mediaDevices[Symbol.for('acira.capture.stop')];
 assert.equal(stop('cap9'),true);assert.ok(stream.getTracks().every(t=>t.stopped));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(page.calls.filter(c=>c[0]==='mediaCapture.ended'),[['mediaCapture.ended','cap9']]);
 assert.equal(stop('cap9'),false);
 // Audio only: the video the display request brings is dropped.
 const sound=await page.navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:'stream2'}}});
 assert.equal(sound.getVideoTracks().length,0);assert.equal(sound.getAudioTracks().length,1);
});

test('chrome.desktopCapture.chooseDesktopMedia returns a request id at once and calls back with the stream id; tabCapture.capture gives a stream',async()=>{
 const page=extensionPage({manifest_version:3,permissions:['desktopCapture','tabCapture']},name=>name==='desktopCapture.chooseDesktopMedia'?{streamId:'s1',canRequestAudioTrack:true}:name==='tabCapture.captureStreamId'?'s2':name==='mediaCapture.arm'?{captureId:'c',audio:false,source:{type:'tab'}}:undefined);
 const got=await new Promise(resolve=>{const requestId=page.chrome.desktopCapture.chooseDesktopMedia(['screen','audio'],(id,options)=>resolve({requestId,id,options}));assert.equal(requestId,1);});
 assert.deepEqual(plain({id:got.id,options:got.options}),{id:'s1',options:{canRequestAudioTrack:true}});
 assert.equal(page.chrome.desktopCapture.DesktopCaptureSourceType.SCREEN,'screen');
 const stream=await new Promise(resolve=>page.chrome.tabCapture.capture({video:true,audio:false},resolve));
 assert.equal(stream.getVideoTracks().length,1);
 assert.deepEqual(plain(page.calls.find(c=>c[0]==='tabCapture.captureStreamId')),['tabCapture.captureStreamId',{audio:false,video:true}]);
 assert.deepEqual(page.calls.find(c=>c[0]==='mediaCapture.arm'),['mediaCapture.arm','s2']);
});

test('the pill shortens only the sharer\'s name; "is sharing a tab" always shows whole, in any word order',()=>{
 const {pillParts}=require('../desktop/share-ui.cjs');
 const catalog={'main.sharingTab':'{name} is sharing a tab','ko.tab':'{name}에서 탭을 공유하는 중','plain':'Sharing'};
 const tm=(id,p)=>catalog[id].replace('{name}',p?.name??'');
 assert.deepEqual(pillParts(tm,'main.sharingTab','Loom'),{label:'Loom is sharing a tab',before:'',name:'Loom',after:' is sharing a tab'});
 assert.deepEqual(pillParts(tm,'ko.tab','Loom'),{label:'Loom에서 탭을 공유하는 중',before:'',name:'Loom',after:'에서 탭을 공유하는 중'});
 assert.deepEqual(pillParts(tm,'plain','Loom'),{label:'Sharing',before:'Sharing',name:'',after:''});
});
