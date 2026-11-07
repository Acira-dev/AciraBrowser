'use strict';
// Match my system theme: what the Linux desktop says, from any platform. Every desktop below is a made-up input, not a read of this machine.
const test=require('node:test'),assert=require('node:assert/strict');
const lt=require('../desktop/linux-theme.cjs');

test('Electron hands the accent over as #RRGGBBAA; empty, partial or fully transparent is no accent',()=>{
 assert.equal(lt.accentFromHex('#9141ACFF'),'#9141ac');
 assert.equal(lt.accentFromHex('9141AC'),'#9141ac');
 assert.equal(lt.accentFromHex('#9141AC00'),null);
 for(const bad of ['','#fff','#9141A','zzzzzz',null,undefined,42])assert.equal(lt.accentFromHex(bad),null);
});

test('the portal accent is an (ddd) tuple in [0,1]; out of range means unset',()=>{
 assert.equal(lt.accentFromPortal([0.5686,0.2549,0.6745]),'#9141ac');
 assert.equal(lt.accentFromPortal([0,0,0]),'#000000');
 for(const bad of [[1.01,0,0],[-0.1,0,0],[0.5,0.5],[NaN,0,0],'#fff',null])assert.equal(lt.accentFromPortal(bad),null);
});

test('portal color-scheme: 1 dark, 2 light, 0 and unknown values are no preference',()=>{
 assert.equal(lt.schemeFromPortal(1),'dark');assert.equal(lt.schemeFromPortal(2),'light');
 for(const v of [0,3,-1,'1',null,undefined])assert.equal(lt.schemeFromPortal(v),null);
});

const BREEZE=`# Plasma 5.27 with the stock Breeze scheme
[ColorEffects:Disabled]
Color=56,56,56
[Colors:Selection]
BackgroundNormal=61,174,233
ForegroundNormal=255,255,255
[Colors:View]
DecorationFocus=61,174,233
DecorationHover=147,206,233
[General]
ColorScheme=BreezeLight
`;
const PLASMA6_ORANGE=`[General]
AccentColor=246,116,0
ColorScheme=BreezeDark
[Colors:View]
DecorationFocus=61,174,233
`;

test('kdeglobals: Plasma 6 AccentColor wins, then the scheme highlight; bad values are skipped',()=>{
 assert.equal(lt.accentFromKdeglobals(PLASMA6_ORANGE),'#f67400');
 assert.equal(lt.accentFromKdeglobals(BREEZE),'#3daee9');
 assert.equal(lt.accentFromKdeglobals('[General]\nAccentColor=300,0,0\n[Colors:View]\nDecorationFocus=1,2,3\n'),'#010203');
 assert.equal(lt.accentFromKdeglobals('[General]\nAccentColor=61,174,233,128\n'),'#3daee9');
 assert.equal(lt.accentFromKdeglobals(''),null);
 assert.equal(lt.accentFromKdeglobals(undefined),null);
 assert.equal(lt.accentFromKdeglobals('garbage without sections\n=\nkey'),null);
});

test('the desktop family comes from XDG_CURRENT_DESKTOP',()=>{
 assert.equal(lt.desktopFamily({XDG_CURRENT_DESKTOP:'KDE'}),'kde');
 assert.equal(lt.desktopFamily({XDG_CURRENT_DESKTOP:'GNOME'}),'gnome');
 assert.equal(lt.desktopFamily({XDG_CURRENT_DESKTOP:'ubuntu:GNOME'}),'gnome');
 assert.equal(lt.desktopFamily({XDG_CURRENT_DESKTOP:'X-Cinnamon'}),'other');
 assert.equal(lt.desktopFamily({}),'other');
});

test('a grey is no accent; a colour with a hue is',()=>{
 assert.equal(lt.usableAccent('#808080'),null);
 assert.equal(lt.usableAccent('#8a8a8c'),null);
 assert.equal(lt.usableAccent('#9141AC'),'#9141ac');
 assert.equal(lt.usableAccent('purple'),null);
 assert.equal(lt.usableAccent(null),null);
});

test('GNOME 47+, dark, purple accent from the portal',()=>{
 const r=lt.resolveSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'GNOME'},dark:true,electronAccent:'#9141ACFF'});
 assert.deepEqual(r,{supported:true,dark:true,accent:'#9141ac',accentSource:'portal',desktop:'gnome'});
});

test('GNOME 46 (Ubuntu 24.04): light or dark arrives, no accent does',()=>{
 const r=lt.resolveSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'ubuntu:GNOME'},dark:true,electronAccent:''});
 assert.deepEqual(r,{supported:true,dark:true,accent:null,accentSource:null,desktop:'gnome'});
});

test('KDE Plasma 6, light, orange accent: the portal first, kdeglobals only when the portal gave none',()=>{
 const env={XDG_CURRENT_DESKTOP:'KDE'};
 assert.equal(lt.resolveSystemTheme({platform:'linux',env,dark:false,electronAccent:'#F67400FF',kdeglobals:BREEZE}).accentSource,'portal');
 const r=lt.resolveSystemTheme({platform:'linux',env,dark:false,electronAccent:'',kdeglobals:PLASMA6_ORANGE});
 assert.deepEqual(r,{supported:true,dark:false,accent:'#f67400',accentSource:'kdeglobals',desktop:'kde'});
});

test('kdeglobals is not read on other desktops (a stale file from a past KDE session says nothing)',()=>{
 const r=lt.resolveSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'GNOME'},dark:false,electronAccent:'',kdeglobals:PLASMA6_ORANGE});
 assert.equal(r.accent,null);
});

test('a grey portal accent (GNOME slate-like neutrals) is dropped, a muted blue-grey is kept',()=>{
 assert.equal(lt.resolveSystemTheme({platform:'linux',env:{},electronAccent:'#808080FF'}).accent,null);
 assert.equal(lt.resolveSystemTheme({platform:'linux',env:{},electronAccent:'#6F8396FF'}).accent,'#6f8396');
});

test('off Linux nothing is supported: the setting has no effect and never shows',()=>{
 for(const platform of ['darwin','win32','freebsd'])assert.deepEqual(lt.resolveSystemTheme({platform,dark:true,electronAccent:'#9141ACFF'}),{supported:false,dark:true,accent:null,accentSource:null,desktop:'other'});
});

test('the pretend desktop is read only inside a throwaway test profile, and only as plain data',()=>{
 const feed=JSON.stringify({dark:true,accent:'#9141ac',desktop:'gnome'});
 assert.equal(lt.simulationFrom({ACIRA_SIMULATE_SYSTEM_THEME:feed}),null,'no test profile, no simulation');
 assert.deepEqual(lt.simulationFrom({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SIMULATE_SYSTEM_THEME:feed}),{dark:true,accent:'#9141ac',desktop:'gnome'});
 assert.equal(lt.simulationFrom({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SIMULATE_SYSTEM_THEME:'{not json'}),null);
 assert.equal(lt.simulationFrom({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SIMULATE_SYSTEM_THEME:'7'}),null);
 const r=lt.resolveSystemTheme({platform:'darwin',simulate:lt.simulationFrom({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SIMULATE_SYSTEM_THEME:JSON.stringify({dark:false,accent:'#F67400'})})});
 assert.deepEqual(r,{supported:true,dark:false,accent:'#f67400',accentSource:'simulated',desktop:'other'});
});

// --- the service ------------------------------------------------------------------------------------------------------------------

function fakeElectron({dark=false,accent=''}={}){
 const handlers={nativeTheme:{},systemPreferences:{}};
 const make=(name)=>({on:(event,fn)=>{(handlers[name][event]||=new Set()).add(fn);},removeListener:(event,fn)=>handlers[name][event]?.delete(fn),emit:(event)=>[...(handlers[name][event]||[])].forEach(fn=>fn())});
 const nativeTheme={...make('nativeTheme'),shouldUseDarkColors:dark},systemPreferences={...make('systemPreferences'),getAccentColor:()=>accent};
 return {nativeTheme,systemPreferences,handlers};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('the service reports at start, and again only when something changed',async()=>{
 const electron=fakeElectron({dark:false,accent:''}),seen=[];
 const service=lt.createSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'GNOME'},electron,onChange:info=>seen.push(info)});
 assert.deepEqual(service.current(),{supported:true,dark:false,accent:null,accentSource:null,desktop:'gnome'});
 electron.nativeTheme.emit('updated');await wait(250);
 assert.equal(seen.length,0,'nothing moved: no change is announced');
 electron.nativeTheme.shouldUseDarkColors=true;electron.nativeTheme.emit('updated');await wait(250);
 assert.equal(seen.length,1);assert.equal(seen[0].dark,true);
 electron.systemPreferences.getAccentColor=()=>'#9141ACFF';electron.systemPreferences.emit('accent-color-changed');
 electron.systemPreferences.emit('accent-color-changed');await wait(250);
 assert.equal(seen.length,2,'two events in a burst give one announcement');assert.equal(seen[1].accent,'#9141ac');
 service.dispose();
 assert.equal(electron.handlers.nativeTheme.updated.size,0);assert.equal(electron.handlers.systemPreferences['accent-color-changed'].size,0);
});

test('KDE: a rewritten kdeglobals moves the accent when the portal has none',async()=>{
 let text=BREEZE,fire,stopped=false;const seen=[];
 const service=lt.createSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'KDE'},electron:fakeElectron({dark:false}),readFile:file=>{assert.equal(file,'/home/u/.config/kdeglobals');return text;},watch:(dir,fn)=>{assert.equal(dir,'/home/u/.config');fire=fn;return()=>{stopped=true;};},configDir:'/home/u/.config/',onChange:info=>seen.push(info)});
 assert.equal(service.current().accent,'#3daee9');
 text=PLASMA6_ORANGE;fire('kdeglobals');fire('somethingelse');await wait(250);
 assert.equal(seen.length,1);assert.equal(seen[0].accent,'#f67400');
 service.dispose();assert.equal(stopped,true);
});

test('a missing or unreadable kdeglobals is no accent, never an error',()=>{
 const service=lt.createSystemTheme({platform:'linux',env:{XDG_CURRENT_DESKTOP:'KDE'},electron:fakeElectron(),readFile:()=>{throw Object.assign(Error('gone'),{code:'ENOENT'});},watch:()=>{throw Error('no inotify');},configDir:'/x'});
 assert.equal(service.current().accent,null);assert.equal(service.current().supported,true);service.dispose();
});

test('off Linux the service reads and watches nothing and never fires',async()=>{
 const electron=fakeElectron({dark:true,accent:'#9141ACFF'});let watched=false;
 const service=lt.createSystemTheme({platform:'darwin',env:{},electron,watch:()=>{watched=true;},configDir:'/x',onChange:()=>assert.fail('no change event off Linux')});
 assert.equal(service.current().supported,false);assert.equal(watched,false);
 assert.equal(electron.handlers.nativeTheme.updated,undefined);
 electron.nativeTheme.emit('updated');await wait(200);service.dispose();
});

test('the simulated desktop works from any platform and watches nothing',()=>{
 const electron=fakeElectron({dark:false});
 const service=lt.createSystemTheme({platform:'darwin',env:{ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SIMULATE_SYSTEM_THEME:'{"dark":true,"accent":"#9141ac"}'},electron});
 assert.deepEqual(service.current(),{supported:true,dark:true,accent:'#9141ac',accentSource:'simulated',desktop:'other'});
 assert.equal(electron.handlers.nativeTheme.updated,undefined);service.dispose();
});

test('the service survives a broken Electron: a throwing getter is just no value',()=>{
 const electron={nativeTheme:{get shouldUseDarkColors(){throw Error('no theme yet');},on(){throw Error('no events');}},systemPreferences:{getAccentColor(){throw Error('no portal');}}};
 const service=lt.createSystemTheme({platform:'linux',env:{},electron});
 assert.deepEqual(service.current(),{supported:true,dark:false,accent:null,accentSource:null,desktop:'other'});service.dispose();
});

test('main-process surfaces take the desktop accent only while matching is on, as Auto, with an accent offered',()=>{
 const info={supported:true,dark:true,accent:'#9141ac',accentSource:'portal',desktop:'gnome'};
 assert.equal(lt.activeAccent({systemTheme:true,appearance:'system'},info),'#9141ac');
 assert.equal(lt.activeAccent({systemTheme:true,appearance:'dark'},info),undefined);
 assert.equal(lt.activeAccent({systemTheme:false,appearance:'system'},info),undefined);
 assert.equal(lt.activeAccent({appearance:'system'},info),undefined);
 assert.equal(lt.activeAccent({systemTheme:true,appearance:'system'},{...info,accent:null}),undefined);
 assert.equal(lt.activeAccent({systemTheme:true,appearance:'system'},{...info,supported:false}),undefined);
 assert.equal(lt.activeAccent({systemTheme:true,appearance:'system'},null),undefined);
});
