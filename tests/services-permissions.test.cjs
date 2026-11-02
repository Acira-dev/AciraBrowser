'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createPermissions}=require('../desktop/permissions.cjs');
function fixture(){const saved=new Map(),calls=[],timers=[];let response=1,dismissed=false,url='https://top.example/',frameURL='https://child.example/';const frame={get url(){return frameURL;},isDestroyed:()=>false},wc={getURL:()=>url,isDestroyed:()=>false,mainFrame:{framesInSubtree:[frame]}},session={setPermissionCheckHandler:f=>session.check=f,setPermissionRequestHandler:f=>session.request=f,setDevicePermissionHandler(){},setDisplayMediaRequestHandler(){}};const database={permission:(...v)=>saved.get(v.join('|')),setPermission:(p,r,e,n,d)=>d==='ask'?saved.delete([p,r,e,n].join('|')):saved.set([p,r,e,n].join('|'),d),permissions:p=>[...saved].filter(([k])=>k.startsWith(p+'|')).map(([k,decision])=>{const [_p,requester,embedder,permission]=k.split('|');return {requester,embedder,permission,decision};}),clearPermissions:p=>{for(const k of saved.keys())if(k.startsWith(p+'|'))saved.delete(k);}};const service=createPermissions({database,dialog:{showMessageBox:async(_w,d)=>{calls.push(d);return {response,...(dismissed?{dismissed:true}:{})};}},getWindow:()=>({}),ownsContents:w=>w===wc,isPrivate:p=>p.startsWith('private-'),setTimer:f=>(timers.push(f),{unref(){}})});service.attach(session,'A');const request=(permission,details)=>new Promise(resolve=>session.request(wc,permission,resolve,details));return {service,session,wc,saved,calls,timers,request,setResponse:(r,d=false)=>{response=r;dismissed=d;},navigate:()=>url='https://other.example/',moveFrame:()=>frameURL='https://elsewhere.example/'};}
test('microphone grant does not silently grant camera; profile/embedder/requester and revocation remain scoped',async()=>{const f=fixture();assert.equal(await f.request('media',{isMainFrame:true,requestingUrl:'https://top.example/',mediaTypes:['audio']}),true);assert.equal(f.session.check(f.wc,'media','https://top.example/',{isMainFrame:true,mediaType:'audio'}),true);assert.equal(f.session.check(f.wc,'media','https://top.example/',{isMainFrame:true,mediaType:'video'}),false);assert.equal(f.service.list('A').length,1);f.service.reset('A','https://top.example','https://top.example','media-audio');assert.equal(f.session.check(f.wc,'media','https://top.example/',{isMainFrame:true,mediaType:'audio'}),false);assert.equal(f.session.check(null,'notifications','https://top.example/',{}),false);assert.equal(await f.request('unknown',{isMainFrame:true}),false);});
test('Allow and Block are remembered per site; dismissing answers once and remembers nothing; child origins and stale frames still deny',async()=>{
  const f=fixture(),child={isMainFrame:false,requestingUrl:'https://child.example/'};
  f.setResponse(0,true);assert.equal(await f.request('geolocation',child),false,'dismissed (Esc) denies this once');assert.equal(f.saved.size,0,'and remembers nothing');
  f.setResponse(1);assert.equal(await f.request('geolocation',child),true);assert.deepEqual(f.calls.at(-1).buttons,['Block','Allow','Allow this time'],'Block, Allow, and (for a visit-long permission) Allow this time');assert.equal(f.saved.size,1,'Allow is remembered for the site');
  assert.equal(f.session.check(f.wc,'geolocation','https://child.example/',{isMainFrame:false}),true);
  const asked=f.calls.length;assert.equal(await f.request('geolocation',child),true);assert.equal(f.calls.length,asked,'a remembered Allow does not ask again');
  f.setResponse(0);assert.equal(await f.request('notifications',child),false);assert.equal([...f.saved.values()].includes('block'),true,'Block is remembered too');
  const blocked=f.calls.length;assert.equal(await f.request('notifications',child),false);assert.equal(f.calls.length,blocked,'a remembered Block does not ask again');
  f.setResponse(1);const pending=f.request('clipboard-read',child);f.moveFrame();assert.equal(await pending,false,'a frame that moved while the question was open is denied');
  assert.equal(await f.request('clipboard-sanitized-write',{isMainFrame:false}),false);assert.throws(()=>f.service.attach(f.session,'B'),/another profile/);
});
test('ask() prompts once per site for non-API questions such as several downloads, shares concurrent callers, and remembers the answer',async()=>{
  const f=fixture();f.setResponse(1);
  const [first,second]=await Promise.all([f.service.ask('A',f.wc,'multiple-downloads',{message:'wants to download several files'}),f.service.ask('A',f.wc,'multiple-downloads',{message:'wants to download several files'})]);
  assert.deepEqual([first,second],[true,true]);assert.equal(f.calls.length,1,'concurrent callers share one prompt');assert.match(f.calls[0].message,/top\.example wants to download several files/);assert.equal(f.saved.get('A|https://top.example|https://top.example|multiple-downloads'),'allow');
  assert.equal(await f.service.ask('A',f.wc,'multiple-downloads',{message:'x'}),true);assert.equal(f.calls.length,1,'remembered');
  f.service.reset('A','https://top.example','https://top.example','multiple-downloads');f.setResponse(0);assert.equal(await f.service.ask('A',f.wc,'multiple-downloads',{message:'x'}),false);assert.equal(f.saved.get('A|https://top.example|https://top.example|multiple-downloads'),'block');
  f.service.reset('A','https://top.example','https://top.example','multiple-downloads');f.setResponse(0,true);assert.equal(await f.service.ask('A',f.wc,'multiple-downloads',{message:'x'}),false);assert.equal(f.saved.size,0,'dismissing remembers nothing');
});
test('every permission prompt offers Block then Allow (and Allow this time where a visit-long yes makes sense), and Block is the safe default',async()=>{
  for(const name of ['geolocation','notifications','clipboard-read','midi','idle-detection','pointerLock']){
    const f=fixture();f.setResponse(1);
    await f.request(name,{isMainFrame:true,requestingUrl:'https://top.example/'});
    assert.equal(f.calls.length,1,`${name} asks once`);
    const call=f.calls[0];assert.deepEqual([call.buttons,call.defaultId,call.cancelId],[name==='notifications'?['Block','Allow']:['Block','Allow','Allow this time'],0,0],name);
  }
  const f=fixture();f.setResponse(1);await f.request('media',{isMainFrame:true,requestingUrl:'https://top.example/',mediaTypes:['audio','video']});
  assert.deepEqual([f.calls[0].buttons,f.calls[0].defaultId,f.calls[0].cancelId],[['Block','Allow','Allow this time'],0,0],'camera and microphone');
});
test('a page that only looks sees "prompt" for a question nobody has answered, then the real answer',async()=>{
  const f=fixture();f.wc.session=f.session;const main={url:'https://top.example/'};f.wc.mainFrame.url=main.url;
  const state=name=>f.service.stateFor(f.wc,f.wc.mainFrame,name),site={isMainFrame:true,requestingUrl:'https://top.example/'};
  for(const name of ['notifications','geolocation','camera','microphone','midi','clipboard-read'])assert.equal(state(name),'prompt',name+' is undecided');
  assert.equal(f.session.check(f.wc,'notifications','https://top.example/',site),false,'the engine own yes/no check is still no for an unanswered question');
  f.setResponse(1);await f.request('notifications',site);assert.equal(state('notifications'),'granted');assert.equal(state('geolocation'),'prompt','one answer does not decide another question');
  f.setResponse(0);await f.request('geolocation',site);assert.equal(state('geolocation'),'denied');
  f.setResponse(1);await f.request('media',{...site,mediaTypes:['audio']});assert.equal(state('microphone'),'granted');assert.equal(state('camera'),'prompt','microphone is not camera');
  for(const name of ['usb','payment','nonsense',5,undefined])assert.equal(state(name),'denied','names that are never offered read denied');
  assert.equal(f.service.stateFor({...f.wc,session:{}},f.wc.mainFrame,'notifications'),'denied','a session this profile does not own');
  f.wc.getURL=()=>'chrome://settings/';assert.equal(state('notifications'),'denied','not a website');
});

test('R3-73: the card is told whose request it is; Allow this time answers yes for this visit only and writes nothing',async()=>{
  const f=fixture(),listeners=[];f.wc.session=f.session;f.wc.mainFrame.url='https://top.example/';f.wc.on=(name,fn)=>{if(name==='did-start-navigation')listeners.push(fn);};f.wc.once=()=>{};
  const site={isMainFrame:true,requestingUrl:'https://top.example/'};
  f.setResponse(2);assert.equal(await f.request('geolocation',site),true,'Allow this time lets the request through');
  const meta=f.calls[0].site;assert.deepEqual([meta.host,meta.contents===f.wc,meta.manage,meta.private],['top.example',true,true,false],'the card shows the site, binds to the page and offers Manage');
  assert.equal(f.saved.size,0,'nothing is remembered for a one-visit yes');
  assert.equal(f.session.check(f.wc,'geolocation','https://top.example/',site),true,'the page may use it while it stays');
  assert.equal(f.service.stateFor(f.wc,f.wc.mainFrame,'geolocation'),'granted');
  const asked=f.calls.length;assert.equal(await f.request('geolocation',site),true);assert.equal(f.calls.length,asked,'no second question during the visit');
  assert.equal(meta.stale(),false);f.navigate();assert.equal(meta.stale(),true,'a page that moved on makes its request stale (the card drops it)');
  for(const fn of listeners)fn({isMainFrame:true,isSameDocument:false});
  f.setResponse(0);assert.equal(await f.request('geolocation',{isMainFrame:true,requestingUrl:'https://other.example/'}),false);
});
test('R3-73: Allow this time is not offered for a notification (an ongoing relationship); a private profile tells the card nothing is kept',async()=>{
  const f=fixture();f.setResponse(1);
  await f.request('notifications',{isMainFrame:true,requestingUrl:'https://top.example/'});assert.deepEqual(f.calls[0].buttons,['Block','Allow']);
  const p=fixture(),other={...p.session};let handler;other.setPermissionRequestHandler=h=>{handler=h;};other.setPermissionCheckHandler=()=>{};
  const again=createPermissions({database:{permission:()=>undefined,setPermission(){}},dialog:{showMessageBox:async(_w,options)=>{p.calls.push(options);return {response:1};}},getWindow:()=>({}),ownsContents:()=>true,isPrivate:id=>id.startsWith('private-')});
  again.attach(other,'private-1');await new Promise(resolve=>handler(p.wc,'notifications',resolve,{isMainFrame:true,requestingUrl:'https://top.example/'}));
  assert.equal(p.calls[0].site.private,true,'the card shows the "forgotten when the window closes" note');
});
test('R3-73: a request is asked in the window of the page that made it',async()=>{
  const asked=[];const wc={getURL:()=>'https://top.example/',isDestroyed:()=>false,mainFrame:{framesInSubtree:[]}};let handler;
  const session={setPermissionCheckHandler(){},setPermissionRequestHandler:f=>{handler=f;},setDevicePermissionHandler(){},setDisplayMediaRequestHandler(){}};
  const owner={id:'owner'};
  const service=createPermissions({database:{permission:()=>undefined,setPermission(){},permissions:()=>[],clearPermissions(){}},dialog:{showMessageBox:async(window,options)=>{asked.push([window,options.site.contents]);return {response:1};}},getWindow:contents=>contents===wc?owner:{id:'focused'},ownsContents:()=>true});
  service.attach(session,'A');
  await new Promise(resolve=>handler(wc,'notifications',resolve,{isMainFrame:true,requestingUrl:'https://top.example/'}));
  assert.equal(asked[0][0],owner,'the owner window of the requesting page, not whichever window has focus');assert.equal(asked[0][1],wc);
});
test('clipboard writes never ask, as in Chrome; reads still ask, and a saved Block on writes still holds',async()=>{
  const f=fixture(),top={isMainFrame:true,requestingUrl:'https://top.example/'};
  assert.equal(await f.request('clipboard-sanitized-write',top),true);assert.equal(f.calls.length,0,'no question for a write');assert.equal(f.saved.size,0,'and nothing is written down');
  assert.equal(f.session.check(f.wc,'clipboard-sanitized-write','https://top.example/',top),true,'the page sees clipboard-write as granted');
  f.setResponse(0);assert.equal(await f.request('clipboard-read',top),false);assert.equal(f.calls.length,1,'a read still asks');
  f.saved.set('A|https://top.example|https://top.example|clipboard-sanitized-write','block');
  assert.equal(await f.request('clipboard-sanitized-write',top),false,'a Block chosen earlier holds');assert.equal(f.session.check(f.wc,'clipboard-sanitized-write','https://top.example/',top),false);assert.equal(f.calls.length,1);
  assert.equal(await f.request('clipboard-sanitized-write',{isMainFrame:false}),false,'a frame that is not on the page is still refused');
});
