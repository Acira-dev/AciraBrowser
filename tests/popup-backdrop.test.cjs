const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {PopupBackdropBroker}=require('../desktop/popup-backdrop.cjs');
function fixture(){
 const session={setPermissionCheckHandler(fn){this.check=fn;},setPermissionRequestHandler(fn){this.request=fn;},setDisplayMediaRequestHandler(fn){this.display=fn;}};
 const source={mainFrame:{name:'owned page'},isDestroyed:()=>false};
 const wc=Object.assign(new EventEmitter(),{id:7,session,mainFrame:{name:'popup'},isDestroyed:()=>false});
 let active=3,sources=[{key:'page:1',contents:source,bounds:{x:0,y:40,width:800,height:600},radius:10}];
 const broker=new PopupBackdropBroker(frame=>frame===wc.mainFrame?wc:null);broker.register(wc,{currentId:()=>active,sources:()=>sources});
 const display=(frame=wc.mainFrame,extra={})=>new Promise(resolve=>session.display({frame,videoRequested:true,audioRequested:false,...extra},resolve));
 return {session,source,wc,broker,display,close(){active=null;},remove(){sources=[];}};
}
test('material broker exposes geometry only and denies unarmed or foreign requests',async()=>{
 const f=fixture();assert.deepEqual(f.broker.metadata(f.wc,3),{id:3,sources:[{key:'page:1',bounds:{x:0,y:40,width:800,height:600},radius:10}]});
 assert.throws(()=>f.broker.metadata({...f.wc,id:99},3));assert.throws(()=>f.broker.metadata(f.wc,2));
 assert.equal(await f.display(),null);assert.equal(f.session.check(f.wc,'display-capture'),false);assert.equal(f.session.check(f.wc,'media'),false);
 assert.equal(await f.broker.start(f.wc,3,'desktop:any'),false);await assert.rejects(f.broker.start(f.wc,3,{key:'page:1'}));assert.equal(f.broker.pending.size,0);
});
test('only one armed exact main frame can capture its owned source without audio',async()=>{
 const f=fixture();f.wc.executeJavaScript=async(script,userGesture)=>{
  assert.equal(userGesture,true);assert.ok(script.includes('window.__aciraPopupCapture(3,"page:1")'));
  assert.equal(f.session.check(f.wc,'display-capture'),true);
  const request=details=>new Promise(resolve=>f.session.request(f.wc,'media',resolve,details));
  assert.equal(await request({isMainFrame:true,mediaTypes:[]}),true);
  assert.equal(await request({isMainFrame:true,mediaTypes:['video']}),false);
  assert.equal(await request({isMainFrame:true,mediaTypes:['audio']}),false);
  assert.equal(await request({isMainFrame:false,mediaTypes:[]}),false);
  assert.equal(await f.display({},{}),null);assert.equal(await f.display(f.wc.mainFrame,{audioRequested:true}),null);
  assert.equal(await f.display(f.wc.mainFrame,{videoRequested:false}),null);
  assert.deepEqual(await f.display(),{video:f.source.mainFrame});assert.equal(await f.display(),null);
 };
 assert.equal(await f.broker.start(f.wc,3,'page:1'),true);assert.equal(await f.display(),null);assert.equal(f.broker.pending.size,0);
});
test('closed, removed, expired and destroyed ownership cannot grant capture; failures clear authorization',async()=>{
 for(const change of [f=>f.close(),f=>f.remove(),f=>f.broker.pending.get(7).until=0,f=>f.source.isDestroyed=()=>true]){
  const f=fixture();f.wc.executeJavaScript=async()=>{change(f);assert.equal(await f.display(),null);throw Error('cancelled');};
  assert.equal(await f.broker.start(f.wc,3,'page:1'),false);assert.equal(f.broker.pending.size,0);
 }
 const f=fixture();f.wc.executeJavaScript=async()=>{f.wc.emit('destroyed');assert.equal(await f.display(),null);throw Error('gone');};
 assert.equal(await f.broker.start(f.wc,3,'page:1'),false);assert.equal(f.broker.owners.size,0);
});
test('a stalled material request times out and cannot leave a grant',async()=>{
 const f=fixture();f.wc.executeJavaScript=()=>new Promise(()=>{});const request=f.broker.start(f.wc,3,'page:1');assert.equal(await f.broker.start(f.wc,3,'page:1'),false,'a second request while the grant is out');assert.equal(await request,false,'timed out');assert.equal(f.broker.pending.size,0);assert.equal(await f.display(),null);
});

test('a popup that moves on cancels its material quietly; a real capture failure is logged once',async()=>{
 const warned=[],warn=console.warn;console.warn=(...args)=>warned.push(args.join(' '));
 try{
  // Esc or a blur while the stream was being acquired: the UI drops the request on purpose.
  for(const message of ['Error: Material request cancelled','Error: Stale material request']){
   const f=fixture();f.wc.executeJavaScript=async()=>{throw new Error(message);};
   assert.equal(await f.broker.start(f.wc,3,'page:1'),false);assert.equal(f.broker.pending.size,0);
  }
  // The popup closed before main was asked, or while the request was out.
  {const f=fixture();f.close();assert.equal(await f.broker.start(f.wc,3,'page:1'),false);}
  {const f=fixture();f.wc.executeJavaScript=async()=>{f.close();throw new Error('NotReadableError: Could not start video source');};assert.equal(await f.broker.start(f.wc,3,'page:1'),false);}
  assert.deepEqual(warned,[],'no log for a cancellation');
  // The same popup still open and the system refusing the capture: one line however often it happens.
  const f=fixture();f.wc.executeJavaScript=async()=>{throw new Error('Error: NotReadableError: Could not start video source');};
  for(let i=0;i<5;i++)assert.equal(await f.broker.start(f.wc,3,'page:1'),false);
  assert.equal(warned.length,1);assert.match(warned[0],/Could not start video source/);assert.equal(f.broker.pending.size,0);assert.equal(await f.display(),null);
 }finally{console.warn=warn;}
});

const {LIMITS,snapshotPlan,snapshotRegion,encodeSnapshot,popupBackdropPageOwned}=require('../desktop/popup-snapshot.cjs');
const pngHeader=Buffer.from([137,80,78,71,13,10,26,10]);
function fakeImage({size={width:700,height:400},bytes=40,empty=false,encoded=()=>{}}={}){
 return {isEmpty:()=>empty,getSize:()=>size,resize:options=>fakeImage({size:options,bytes,encoded}),toPNG:()=>{encoded();return Buffer.concat([pngHeader,Buffer.alloc(bytes-8)]);}};
}
function snapshotFixture(){
 const session={setPermissionCheckHandler(){},setPermissionRequestHandler(){},setDisplayMediaRequestHandler(){}},calls=[];
 let id=9,context={generation:{},context:'current-owned-tab',scale:1,target:{x:600,y:100,width:200,height:200},trigger:{x:720,y:20,width:24,height:24}},capture=()=>Promise.resolve(fakeImage());
 const source=(key,bounds)=>({key,bounds,radius:key==='chrome'?0:12,contents:Object.assign(new EventEmitter(),{id:key,mainFrame:{},getURL:()=>key==='chrome'?'acira-browser-ui://ui/index.html':'https://synthetic.invalid/',isDestroyed:()=>false,isLoadingMainFrame:()=>false,capturePage:(rect,options)=>{calls.push({key,rect,options});return capture();}})});
 let sources=[source('chrome',{x:0,y:0,width:800,height:600}),source('page:owned',{x:100,y:80,width:600,height:480})];
 const wc=Object.assign(new EventEmitter(),{id:41,mainFrame:{},session,isDestroyed:()=>false}),broker=new PopupBackdropBroker(()=>null);
 broker.register(wc,{currentId:()=>id,sources:()=>sources,snapshotContext:()=>context});
 return {wc,broker,calls,get sources(){return sources;},get context(){return context;},setContext:value=>{context=value;},setId:value=>{id=value;},setSources:value=>{sources=value;},setCapture:value=>{capture=value;},source};
}

test('one-shot snapshot crops only target plus actual trigger and blur padding inside owned source bounds',async()=>{
 const f=snapshotFixture(),result=await f.broker.snapshot(f.wc,9);
 assert.equal(result.id,9);assert.equal(result.sources.length,2);
 assert.deepEqual(f.calls,[{key:'chrome',rect:{x:536,y:0,width:264,height:364},options:{stayHidden:true,stayAwake:false}},{key:'page:owned',rect:{x:436,y:0,width:164,height:284},options:{stayHidden:true,stayAwake:false}}]);
 assert.deepEqual(result.sources[1].bounds,{x:536,y:80,width:164,height:284});assert.deepEqual(result.sources[1].sourceBounds,f.sources[1].bounds);assert.equal(result.sources[1].radius,12);
 for(const frame of result.sources){assert(frame.image.startsWith('data:image/png;base64,'));assert.deepEqual(Object.keys(frame).sort(),['bounds','image','key','radius','sourceBounds']);}
 assert.deepEqual(await f.broker.snapshot(f.wc,9),{id:9,sources:[]},'generation is consumed once; no retained image cache');assert.equal(f.calls.length,2);assert.equal(f.broker.pending.size,0,'snapshot never arms display media');assert.equal(f.broker.snapshotPending.size,0);
});

test('snapshot authorization rejects foreign/stale/hidden contexts without touching a source',async()=>{
 for(const setup of [f=>{f.setId(10);},f=>{f.setContext(null);},f=>{f.setContext({...f.context,scale:NaN});},f=>{f.setSources([]);},f=>{f.sources[1].contents.isLoadingMainFrame=()=>true;}]){
  const f=snapshotFixture();setup(f);assert.deepEqual(await f.broker.snapshot(f.wc,9),{id:9,sources:[]});assert.equal(f.calls.length,0);
 }
 const f=snapshotFixture();assert.deepEqual(await f.broker.snapshot({...f.wc},9),{id:9,sources:[]});assert.equal(f.calls.length,0);
});

test('snapshot includes only acknowledged current child bounds and allows one new frame after that native generation changes',async()=>{
 const f=snapshotFixture(),parent=await f.broker.snapshot(f.wc,9);assert.equal(parent.sources[0].bounds.x,536,'parent frame does not anticipate an adjacent child');
 f.setContext({...f.context,generation:{},auxiliary:{x:300,y:250,width:220,height:250}});
 const child=await f.broker.snapshot(f.wc,9);assert.equal(child.sources.length,2);assert.deepEqual(child.sources[0].bounds,{x:236,y:0,width:564,height:564});
 assert.deepEqual(await f.broker.snapshot(f.wc,9),{id:9,sources:[]});assert.equal(f.calls.length,4);
});

test('snapshot discards every frame on close, navigation, ownership/visibility, generation, geometry or active-context changes during capture',async()=>{
 const changes=[
  f=>f.setId(null),f=>f.setContext(null),f=>f.setContext({...f.context,generation:{}}),f=>f.setContext({...f.context,context:'another-owned-tab'}),
  f=>f.setContext({...f.context,target:{...f.context.target,y:120}}),f=>f.setContext({...f.context,auxiliary:{x:300,y:200,width:220,height:200}}),f=>f.setSources(f.sources.slice(0,1)),
  f=>{f.sources[1].bounds.x++;},f=>{f.sources[1].radius++;},f=>{f.sources[1].contents.isDestroyed=()=>true;},
  f=>{f.sources[1].contents.mainFrame={};},f=>{f.sources[1].contents.getURL=()=>'https://navigated.invalid/';},
  f=>f.sources[1].contents.emit('did-start-navigation',{isMainFrame:true}),f=>f.sources[1].contents.emit('render-process-gone'),
  f=>f.wc.emit('destroyed'),f=>f.setSources([...f.sources,f.source('page:new',{x:600,y:120,width:100,height:100})]),
 ];
 for(const change of changes){
  const f=snapshotFixture();let finish,encoded=0;
  // One held promise per source would obscure completion; share the same pending native frame.
  const pending=new Promise(resolve=>{finish=resolve;});f.setCapture(()=>pending);
  const result=f.broker.snapshot(f.wc,9);assert.equal(f.calls.length,2);change(f);finish(fakeImage({encoded:()=>{encoded++;}}));
  assert.deepEqual(await result,{id:9,sources:[]});assert.equal(encoded,0);assert.equal(f.broker.snapshotCaptures,0);
  for(const wc of [f.wc,...f.sources.map(source=>source.contents)]){assert.equal(wc.listenerCount('did-start-navigation'),0);assert.equal(wc.listenerCount('render-process-gone'),0);}
 }
});

test('snapshot enforces bounded source area/count/bytes and cleanly falls back on unavailable images',async()=>{
 for(const setup of [
  f=>{f.setContext({...f.context,target:{x:0,y:0,width:3000,height:3000}});f.setSources([f.source('chrome',{x:0,y:0,width:3000,height:3000})]);},
  f=>f.setSources(Array.from({length:6},(_,index)=>f.source('page:'+index,{x:500,y:0,width:200,height:400}))),
  f=>f.setCapture(async()=>fakeImage({bytes:LIMITS.maxFrameBytes+1})),f=>f.setCapture(async()=>fakeImage({empty:true})),
  f=>f.setCapture(async()=>{throw Error('Synthetic protected/unavailable capture');}),
  f=>{f.setSources(Array.from({length:3},(_,index)=>f.source('page:'+index,{x:500,y:0,width:200,height:400})));f.setCapture(async()=>fakeImage({bytes:800000}));},
 ]){const f=snapshotFixture();setup(f);const result=await f.broker.snapshot(f.wc,9);assert.deepEqual(result,{id:9,sources:[]});assert.equal(f.broker.pending.size,0);assert.equal(f.broker.snapshotCaptures,0);}
 const f=snapshotFixture();f.setCapture(async()=>fakeImage({size:{width:4000,height:2000}}));assert.equal((await f.broker.snapshot(f.wc,9)).sources.length,2,'large native bitmap is reduced to a bounded PNG');
});

test('native crop planning respects interface scale and clamps fractionally to the permitted intersection',()=>{
 const context={scale:1.5,target:{x:100.2,y:80.2,width:100.2,height:100.2},trigger:{x:80.2,y:60.2,width:10,height:10}};
 const source={key:'chrome',bounds:{x:20,y:30,width:500,height:500},radius:0,contents:{isDestroyed:()=>false,capturePage(){}}},region=snapshotRegion(context),[plan]=snapshotPlan(context,[source]);
 assert(plan);for(const edge of ['x','y'])assert(plan.bounds[edge]>=Math.max(region[edge],source.bounds[edge]));
 assert(plan.bounds.x+plan.bounds.width<=Math.min(region.x+region.width,source.bounds.x+source.bounds.width));
 assert.equal(plan.capture.x,Math.ceil((Math.max(region.x,source.bounds.x)-source.bounds.x)*1.5));
});

test('snapshot timeout discards late native images before encoding and blocks repeated in-flight work',async()=>{
 const f=snapshotFixture();let finish,encoded=0;const native=new Promise(resolve=>{finish=resolve;});f.setCapture(()=>native);
 const request=f.broker.snapshot(f.wc,9);assert.deepEqual(await f.broker.snapshot(f.wc,9),{id:9,sources:[]});
 assert.deepEqual(await request,{id:9,sources:[]});assert.equal(f.broker.snapshotPending.size,1,'only a cancellation token remains while native call is pending');
 f.setId(10);assert.deepEqual(await f.broker.snapshot(f.wc,10),{id:10,sources:[]});assert.equal(f.calls.length,2);
 finish(fakeImage({encoded:()=>{encoded++;}}));await new Promise(setImmediate);assert.equal(encoded,0);assert.equal(f.broker.snapshotPending.size,0);assert.equal(f.broker.snapshotCaptures,0);
});

test('snapshot budget bounds concurrent native captures across owned popup windows',async()=>{
 const first=snapshotFixture(),second=snapshotFixture();let finish;
 first.setSources(Array.from({length:5},(_,index)=>first.source('page:'+index,{x:500,y:0,width:200,height:400})));
 second.setSources(Array.from({length:4},(_,index)=>second.source('page:'+index,{x:500,y:0,width:200,height:400})));
 second.wc.id=42;first.broker.register(second.wc,{currentId:()=>9,sources:()=>second.sources,snapshotContext:()=>second.context});
 const pending=new Promise(resolve=>{finish=resolve;});first.setCapture(()=>pending);
 const running=first.broker.snapshot(first.wc,9);assert.equal(first.broker.snapshotCaptures,5);
 assert.deepEqual(await first.broker.snapshot(second.wc,9),{id:9,sources:[]});assert.equal(second.calls.length,0);
 finish(fakeImage());assert.equal((await running).sources.length,5);assert.equal(first.broker.snapshotCaptures,0);
});

test('preload snapshot contract forwards only overlay ID through the existing window-ready gate',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),calls=[];let api;
 const ipcRenderer={sendSync:()=>null,on(){},removeListener(){},setMaxListeners(){},invoke:async(channel,...args)=>{calls.push([channel,...args]);return channel==='acira:popup-backdrop-snapshot'?{id:args[0],sources:[]}:undefined;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return {ipcRenderer,contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}}};},process:{platform:'win32'},window:{addEventListener(){}}});
 const result=await api.popupBackdropSnapshot(7,{source:'foreign',rect:{x:0,y:0,width:9000,height:9000}});
 assert.equal(result.id,7);assert.equal(result.sources.length,0);assert.deepEqual(calls,[['acira:window-ready'],['acira:popup-backdrop-snapshot',7]]);
});

test('adaptive PNG encoding fits high-entropy frames with at most four resizes and no CSS crop changes',async()=>{
 const attempts=[];
 const image=size=>({isEmpty:()=>false,getSize:()=>size,resize:next=>image(next),toPNG:()=>{attempts.push(size.width);return Buffer.concat([pngHeader,Buffer.alloc(size.width>256?LIMITS.maxFrameBytes+1:100)]);}});
 assert(encodeSnapshot(image({width:1600,height:900})));assert.deepEqual(attempts,[512,384,256]);
 const f=snapshotFixture();f.setCapture(async()=>image({width:1600,height:900}));const result=await f.broker.snapshot(f.wc,9);assert.equal(result.sources.length,2);assert.deepEqual(result.sources[1].bounds,{x:536,y:80,width:164,height:284});assert.deepEqual(result.sources[1].sourceBounds,f.sources[1].bounds);
 let oversized=0;const neverFits=size=>({isEmpty:()=>false,getSize:()=>size,resize:next=>neverFits(next),toPNG:()=>{oversized++;return Buffer.concat([pngHeader,Buffer.alloc(LIMITS.maxFrameBytes)]);}});
 assert.equal(encodeSnapshot(neverFits({width:1600,height:900})),null);assert.equal(oversized,4);
 let checks=0,encoded=0;assert.equal(encodeSnapshot(fakeImage({bytes:LIMITS.maxFrameBytes+1,encoded:()=>{encoded++;}}),()=>++checks<4),null);assert.equal(encoded,1,'cancelled second attempt must not encode again');
});

function ownedPageFixture(mode='ordinary'){
 const privateMode=mode.endsWith('window'),inline=mode.startsWith('inline'),privacy=inline?mode.slice(7):undefined;
 const profile={id:'profile-current',partition:privateMode?'private-window-session':'persist:profile-current',...(privateMode?{private:true,...(mode==='tor-window'?{tor:true}:{})}:{})};
 const tab={id:'owned',browserProfileId:profile.id,contentKind:'web',...(privacy?{privacy}:{})},state={tabs:[tab],browserProfiles:[profile]},native=inline?{id:'private-tab-owned',partition:'private-tab-session',private:true,tab:tab.id}:profile;
 const session={isPersistent:()=>!native.private},entry={tabId:tab.id,tabProfileId:profile.id,profileId:native.id,profile:native,privateTab:inline,privacy,view:{webContents:{session,isDestroyed:()=>false}}};
 let allowed=true;const policy={privateMode,mayBrowse:()=>allowed,sessionFor:partition=>partition===native.partition?session:null};
 return {tab,state,entry,policy,block:()=>{allowed=false;},valid:()=>popupBackdropPageOwned(state,tab.id,entry,policy)};
}
test('shared backdrop resolver preserves real ordinary/private/Tor entry shapes and rejects stale profile/privacy/session or blocked cleanup',()=>{
 for(const mode of ['ordinary','inline-private','inline-tor','private-window','tor-window']){const f=ownedPageFixture(mode);assert(f.valid(),mode);f.block();assert.equal(f.valid(),f.policy.privateMode,'only an actual private/Tor window bypasses ordinary cleanup');}
 for(const change of [
  f=>{f.entry.tabProfileId='old';},f=>{f.entry.profileId='old';},f=>{f.entry.privateTab=true;},f=>{f.entry.privacy='tor';},f=>{f.entry.retired=true;},
  f=>{f.tab.contentKind='internal';},f=>{f.tab.browserProfileId='other';},f=>{f.tab.privacy='private';},f=>{f.entry.view.webContents.session={isPersistent:()=>true};},
  f=>{f.entry.profile={...f.entry.profile,partition:'persist:old'};},f=>f.block(),
 ]){const f=ownedPageFixture();change(f);assert.equal(f.valid(),false);}
});
test('both snapshot and GDM reject stale ownership before acquisition and after a held await',async()=>{
 const owned=ownedPageFixture(),f=snapshotFixture(),page=f.sources[1],owner=f.broker.owners.get(f.wc.id);owner.sources=()=>owned.valid()?[page]:[];
 owned.block();assert.deepEqual(f.broker.metadata(f.wc,9).sources,[]);assert.deepEqual(await f.broker.snapshot(f.wc,9),{id:9,sources:[]});assert.equal(await f.broker.start(f.wc,9,page.key),false);assert.equal(f.calls.length,0);
 for(const change of [own=>{own.tab.browserProfileId='profile-after-cleanup-gate';},own=>own.block()]){
  const owned=ownedPageFixture(),f=snapshotFixture(),page=f.sources[1],owner=f.broker.owners.get(f.wc.id);owner.sources=()=>owned.valid()?[page]:[];
  let finish,encoded=0;const pending=new Promise(resolve=>{finish=resolve;});f.setCapture(()=>pending);
  const result=f.broker.snapshot(f.wc,9);assert.equal(f.calls.length,1);change(owned);finish(fakeImage({encoded:()=>{encoded++;}}));assert.deepEqual(await result,{id:9,sources:[]});assert.equal(encoded,0);
  const live=ownedPageFixture(),g=snapshotFixture(),gowner=g.broker.owners.get(g.wc.id);gowner.sources=()=>live.valid()?[g.sources[1]]:[];
  g.wc.executeJavaScript=async()=>{assert(g.broker.allowed(g.wc));change(live);assert.equal(g.broker.allowed(g.wc),false);};assert.equal(await g.broker.start(g.wc,9,g.sources[1].key),false);assert.equal(g.broker.pending.size,0);
 }
});

// A popup that closed between the renderer's request and the main process used to answer with a thrown error, which Electron logs for
// every ipc handler ("Popup backdrop is outside the active surface") when a menu is picked and the tab changes under it.
test('the renderer descriptor request for a popup that already closed is answered empty, not with an error',()=>{
 const f=fixture();
 assert.deepEqual(f.broker.describe(f.wc,3),f.broker.metadata(f.wc,3),'the active popup keeps its descriptor');
 assert.deepEqual(f.broker.describe(f.wc,2),{id:2,sources:[]},'an older popup id is retired');
 f.close();assert.deepEqual(f.broker.describe(f.wc,3),{id:3,sources:[]},'a popup that is gone has no material');
 assert.throws(()=>f.broker.describe({...f.wc,id:99},3),'a surface that is not registered still fails');
 assert.throws(()=>f.broker.describe(f.wc,'3'),'an id that is not an integer still fails');
});
