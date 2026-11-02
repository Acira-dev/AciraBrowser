'use strict';
// New Tor circuit for this site (Tor Browser's button and Ctrl+Shift+L): the request names its tab or acts on the current one, a fresh
// circuit password for that site only, its sockets dropped, its page reloaded; the key, the menus and the site panel all reach it.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTorWindows}=require('../desktop/browser-services/tor-window.cjs');
const {COMMANDS}=require('../desktop/shortcut-registry.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function fakeEngine(state='ready'){return {status:()=>({state,progress:100,socksPort:9150,error:null,version:'0.4.9.14'}),onStatus(){return()=>{};},acquire(){return async()=>{};},retry(){},async newIdentity(){return {ok:true};}};}
function torPage(url){
 const session={[Symbol.for('acira.tor.session')]:true,closed:0,async closeAllConnections(){session.closed++;}};
 const wc={session,reloads:0,isDestroyed:()=>false,getURL:()=>url,reloadIgnoringCache(){wc.reloads++;}};
 return wc;
}

test('the named tab gets a fresh circuit for its own site and reloads; the current tab is the default',async()=>{
 const tor=createTorWindows({engine:fakeEngine(),userData:''}),renewed=[];
 const original=tor.isolation.newCircuit;tor.isolation.newCircuit=site=>{renewed.push(site);return original(site);};
 const current=torPage('https://www.example.com/a'),other=torPage('https://news.example.org/b');
 const tabs={current:{isTor:true,webContents:current},other:{isTor:true,webContents:other}};
 const ctx={inTor:true,activeTab:()=>tabs.current,tabById:id=>tabs[id]};
 const first=await tor.handle({type:'tor.new-circuit'},ctx);
 assert.equal(first.circuit.site,'example.com');assert.equal(current.reloads,1);assert.equal(current.session.closed,1);
 const second=await tor.handle({type:'tor.new-circuit',tabId:'other'},ctx);
 assert.equal(second.circuit.site,'example.org');assert.equal(other.reloads,1);assert.equal(current.reloads,1,'the current tab is left alone');
 assert.deepEqual(renewed,['example.com','example.org']);
});

test('no circuit is renewed for a tab without a website, an ordinary tab, or while Tor is not connected',async()=>{
 const tor=createTorWindows({engine:fakeEngine(),userData:''});
 await assert.rejects(tor.handle({type:'tor.new-circuit'},{inTor:true,activeTab:()=>({isTor:true,webContents:torPage('about:blank')})}),/Open a site/);
 await assert.rejects(tor.handle({type:'tor.new-circuit'},{inTor:true,activeTab:()=>({isTor:false,webContents:torPage('https://a.example/')})}),/Open a site/);
 const offline=createTorWindows({engine:fakeEngine('connecting'),userData:''});
 await assert.rejects(offline.handle({type:'tor.new-circuit'},{inTor:true,activeTab:()=>({isTor:true,webContents:torPage('https://a.example/')})}));
});

test('Ctrl+Shift+L: Seamless view keeps its key, and in a Tor tab or window that key is New Tor circuit (unless the command has a key of its own)',()=>{
 const circuit=COMMANDS.find(c=>c.id==='tor-circuit'),seamless=COMMANDS.find(c=>c.id==='seamless-mode');
 assert.ok(circuit);assert.deepEqual(circuit.defaults,[],'no second owner for Ctrl+Shift+L in the registry');assert.equal(circuit.action.action,'tor-circuit');
 assert.deepEqual(seamless.defaults,['Mod+Shift+L']);
 const main=read('desktop/main.cjs');
 assert.match(main,/tor:request=>\{if\(!bundledTorSupported\(\)\)/,'Mac/Linux support guard remains ahead of the Tor command');
 assert.match(main,/resolved\?\.action==='seamless-mode'&&origin==='key'&&\(torMode\|\|active\?\.privacy==='tor'\)&&!shortcutRegistry\?\.menuKey\('tor-circuit'\)\?\{action:'tor-circuit'\}:resolved/);
 assert.match(main,/case 'tor-circuit':if\(torMode\|\|active\.privacy==='tor'\)void runTorCircuit\(active\.id\);break;/);
 assert.match(main,/return torWindows\(\)\.handle\(request,\{windowId,activeTab:\(\)=>torTabView\(state\.activeTabId\),tabById:torTabView,/);
});

test('the row is in the Acira menu, a Tor tab’s own menu and the Tor site panel, in every language',()=>{
 const menu=read('src/components/BrowserMenu.tsx'),app=read('src/App.tsx'),panel=read('src/features/tor/TorSitePanel.tsx');
 assert.match(menu,/torCircuit&&row\(t\("tor\.circuit\.new"\),TorCircuitGlyph,torCircuit,torCircuitKey\)/);
 assert.match(app,/isTorSite\(state, tab\) \? \{ torCircuit: \(\) => \{ void runTorCircuit\(dispatch, tab\.id\); close\(\); \}/);
 assert.match(app,/isTorSite\(state, context\) && row\(tr\("tor\.circuit\.new"\), TorCircuitGlyph, \(\) => \{ void runTorCircuit\(dispatch, context\.id\)/);
 assert.match(app,/\{isTorSite\(state, tab\) && <TorSitePanel /);
 assert.match(panel,/runTorCircuit\(dispatch, tab\.id\)/);
 for(const locale of ['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','hi','ko','ru','tr']){const catalog=JSON.parse(read(`src/i18n/${locale}.json`));
  for(const id of ['tor.circuit.new','tor.circuit.done','tor.circuit.title','shortcutCmd.tor-circuit'])assert.ok(catalog[id],`${locale} ${id}`);
  assert.match(catalog['tor.circuit.done'],/\{site\}/,locale);}
});
