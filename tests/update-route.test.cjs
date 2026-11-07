'use strict';
// The update check and Acira's update download leave by the profile's route (its proxy, or an extension's while one controls it), through
// electron-updater's own session, instead of going direct around it (the co-founder's 0a2e4407 and 9858901e, on Acira's design). The shared state is built from main.cjs's own sharedFields,
// so a route that reads a per-window field (the first version of the co-founder's read one and blocked every check) cannot pass here.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createUpdateRoute,UNCONFIRMED}=require('../desktop/browser-services/update-route.cjs');
const {nativeProxy,proxyChoice}=require('../desktop/browser-services/proxy-settings.cjs');
const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');

const sharedFields=JSON.parse(main.match(/const sharedFields=(\[[^\]]*\]);/)[1].replace(/'/g,'"'));
/** The shared state as main carries it: only sharedFields, each as a window publishes it. */
function sharedState({profiles,defaultProfileId}){
 const full={browserProfiles:profiles,bookmarkNodes:[],browsingHistory:[],downloads:[],settings:{defaultProfileId},workspaces:[],originZooms:{},activeBrowserProfileId:'NOT SHARED',activeTabId:'NOT SHARED'};
 return Object.fromEntries(sharedFields.map(key=>[key,full[key]]));
}
const fixed={mode:'fixed_servers',server:{scheme:'socks5',host:'127.0.0.1',port:1080},bypassHosts:[]};
function rig({profiles,defaultProfileId,last,live={},saved={},forced={}}){
 const calls=[],session={setProxy:async config=>{calls.push(['setProxy',config]);},closeAllConnections:async()=>{calls.push(['close']);}};
 const known=profile=>{if(!(profile.id in live))throw new Error('Unknown native browsing session.');return live[profile.id];};
 const route=createUpdateRoute({session,getSharedState:()=>sharedState({profiles,defaultProfileId}),getLastProfileId:()=>last,
  liveStatus:known,liveRoute:profile=>forced[profile.id]||nativeProxy(known(profile).choice),
  savedChoice:profile=>proxyChoice(saved[profile.id]||{mode:'system'}),toNative:nativeProxy});
 return {route,calls};
}
const profiles=[{id:'p-work',partition:'persist:work'},{id:'p-home',partition:'persist:home'},{id:'p-secret',partition:'private-1',private:true}];
const ok=choice=>({choice,applied:true,busy:false,error:null});

test('the route reads only what main shares',()=>{
 assert.ok(sharedFields.includes('browserProfiles')&&sharedFields.includes('settings'));
 assert.equal(sharedFields.includes('activeBrowserProfileId'),false,'a per-window field, never in the shared state');
});

test('a fixed proxy on the profile is set on the updater\'s session before anything leaves',async()=>{
 const {route,calls}=rig({profiles,defaultProfileId:'p-work',live:{'p-work':ok(fixed)}});
 await route();
 assert.deepEqual(calls,[['setProxy',{mode:'fixed_servers',proxyRules:'socks5://127.0.0.1:1080',proxyBypassRules:''}],['close']]);
 await route();assert.equal(calls.length,2,'the same route is not set again');
});

test('the profile is the default one, else the last ordinary window\'s, else the first; never a private one',async()=>{
 const pick=async options=>{const {route,calls}=rig({profiles,live:{'p-work':ok({mode:'system'}),'p-home':ok(fixed),'p-secret':ok({mode:'direct'})},...options});await route();return calls[0]?.[1].mode;};
 assert.equal(await pick({defaultProfileId:'p-home',last:'p-work'}),'fixed_servers','the default profile');
 assert.equal(await pick({defaultProfileId:'gone',last:'p-home'}),'fixed_servers','a default that no longer exists: the last window\'s');
 assert.equal(await pick({defaultProfileId:'p-secret',last:'p-secret'}),'system','a private profile is never the route: the first ordinary one');
});

test('a profile with no open session follows its saved choice',async()=>{
 const {route,calls}=rig({profiles,defaultProfileId:'p-home',live:{},saved:{'p-home':fixed}});
 await route();assert.equal(calls[0][1].proxyRules,'socks5://127.0.0.1:1080');
});

test('a route that is not confirmed sends nothing; no profile keeps the system route',async()=>{
 for(const status of [{choice:fixed,applied:false,busy:false,error:null},{choice:fixed,applied:true,busy:true,error:null},{choice:fixed,applied:true,busy:false,error:'proxy failed'}]){
  const {route,calls}=rig({profiles,defaultProfileId:'p-work',live:{'p-work':status}});
  await assert.rejects(route(),new RegExp(UNCONFIRMED.slice(0,40)));assert.deepEqual(calls,[]);
 }
 const {route,calls}=rig({profiles:[]});await route();assert.deepEqual(calls,[],'nothing to follow: electron-updater\'s session is left as it is');
});

test('main routes the updater through electron-updater\'s session, the one Acira\'s own download uses too',()=>{
 const call=main.slice(main.indexOf("createAppUpdater({app,"),main.indexOf('setupGate.after(()=>appUpdater.start());'));
 assert.ok(call.length>0&&call.length<400&&call.endsWith('beforeInstall:flushForUpdate,route:updateRoute()});'),'the updater is given the route');
 const fn=main.slice(main.indexOf('function updateRoute(){'),main.indexOf('\n',main.indexOf('function updateRoute(){')));
 assert.match(fn,/session\.fromPartition\('electron-updater',\{cache:false\}\)/);
 assert.match(fn,/getLastProfileId:\(\)=>lastNormalController\?\.profileId/);
 assert.match(fn,/liveRoute:profile=>contentBlocking\.proxy\.nativeRoute\(session\.fromPartition\(profile\.partition\)\)/,'the effective route, an extension\'s included');
 assert.match(fn,/defaultProfileId|getSharedState:\(\)=>sharedState/);
 const updater=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','app-updater.cjs'),'utf8');
 assert.match(updater,/session\.fromPartition\('electron-updater',\{cache:false\}\)/,'Acira\'s own download goes through the same session');
 const http=fs.readFileSync(require.resolve('electron-updater/out/electronHttpExecutor.js'),'utf8');
 assert.match(http,/NET_SESSION_NAME = "electron-updater"/,'and so does electron-updater\'s check');
});

test('an extension that controls the profile\'s proxy (chrome.proxy) is followed: the update traffic leaves where the pages do',async()=>{
 const vpn={mode:'fixed_servers',proxyRules:'https://proxy.example.net:443',proxyBypassRules:''};
 const controlled={choice:{mode:'system'},applied:true,busy:false,error:null,effectiveMode:'fixed_servers',controlledBy:{extensionId:'a'.repeat(32),name:'Fast VPN',mode:'fixed_servers'}};
 const {route,calls}=rig({profiles,defaultProfileId:'p-work',live:{'p-work':controlled},forced:{'p-work':vpn}});
 await route();
 assert.deepEqual(calls[0],['setProxy',vpn],'the extension\'s route, not the person\'s "System" underneath it');
 const pac={mode:'pac_script',pacScript:'https://pac.example/p.pac'};
 const other=rig({profiles,defaultProfileId:'p-work',live:{'p-work':{...controlled,effectiveMode:'pac_script'}},forced:{'p-work':pac}});
 await other.route();assert.deepEqual(other.calls[0],['setProxy',pac],'any route an extension can set, as the pages get it');
});

test('proxy-settings.cjs says which route a session runs with: the extension\'s while it holds the proxy, else the person\'s',async()=>{
 const {createProxySettings}=require('../desktop/browser-services/proxy-settings.cjs');
 const {world,manifest,A}=require('./fixtures/ext-api-proxy/harness.cjs');
 const w=world({extensions:{[A]:{name:'Fast VPN',manifest:manifest(['proxy'])}},storeKey:'p1'});
 try{
  const service=createProxySettings({database:{policy:()=>null,setPolicy(){}},getContext(){},getWindow(){},dialog:{showMessageBox:async()=>({response:1})}});
  await service.attach(w.session,'p1',false);
  assert.deepEqual(service.nativeRoute(w.session),{mode:'system'});
  await w.call(A,'proxy.settings.set',{value:{mode:'fixed_servers',rules:{singleProxy:{scheme:'https',host:'proxy.example.net',port:443}}}});
  assert.deepEqual(service.nativeRoute(w.session),w.session.calls.filter(c=>c[0]==='setProxy').pop()[1],'exactly what the profile\'s session was given');
  assert.equal(service.nativeRoute(w.session).proxyRules,'https://proxy.example.net:443');
  await w.call(A,'proxy.settings.clear',{});
  assert.deepEqual(service.nativeRoute(w.session),{mode:'system'});
 }finally{w.dispose();}
});
