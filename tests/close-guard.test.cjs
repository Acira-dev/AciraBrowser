'use strict';
// R4-35 / R4-36: what is asked before work is thrown away (desktop/close-guard.cjs). The decision logic is pure; the coordinator
// is driven here with fake windows, so the whole matrix (tab, several tabs, window, last window, quit, setting off, Cancel,
// Don't ask again, a quit that was already decided) is covered without an app.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {createCloseGuard,closePrompt,shouldConfirm,tally,siteOf,probePage,unsavedRows,openSites,PROBE_SCRIPT,LISTED,APPROVAL_MS,QUIT_WINDOW_MS}=require('../desktop/close-guard.cjs');

const strings=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n/en.json'),'utf8'));
/** English with the real catalog; plurals only for the two words the cards use. */
const say=(id,params={})=>{
  let text=strings[id];if(text===undefined)return id;
  text=text.replace(/\{(\w+), plural, one \{# (\w+)\} other \{# (\w+)\}\}/g,(_,name,one,other)=>`${params[name]} ${params[name]===1?one:other}`);
  return text.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]));
};
const tab=(url='https://one.test/')=>({url});
const win=(...urls)=>({tabs:urls.map(url=>tab(url))});

test('the card asks only for two or more tabs, never for a blank one, and only with the setting on',()=>{
  const blank='acira://new';
  assert.equal(shouldConfirm({windows:[win(blank)]}),false,'a single blank tab');
  assert.equal(shouldConfirm({windows:[win('https://a.test/')]}),false,'a single tab');
  assert.equal(shouldConfirm({windows:[win(blank,blank,blank)]}),false,'only blank tabs: nothing to lose');
  assert.equal(shouldConfirm({windows:[win('https://a.test/',blank)]}),true,'two tabs, one of them a page');
  assert.equal(shouldConfirm({windows:[win('https://a.test/'),win('https://b.test/')]}),true,'one tab in each of two windows');
  assert.equal(shouldConfirm({enabled:false,windows:[win('https://a.test/','https://b.test/')]}),false,'turned off in Settings');
  assert.equal(shouldConfirm({enabled:undefined,windows:[win('https://a.test/','https://b.test/')]}),true,'on by default');
  assert.deepEqual(tally([win('https://a.test/','https://b.test/'),win(blank)]),{tabs:3,real:2,windows:2});
});

test('"Close Acira?" names the tabs and windows; Enter closes, Esc cancels',()=>{
  const prompt=closePrompt({scope:'quit',confirm:true,tabs:6,windows:2},say);
  assert.equal(prompt.message,'Close Acira?');assert.equal(prompt.detail,'6 tabs in 2 windows');
  assert.deepEqual(prompt.buttons,['Close Acira','Cancel']);assert.equal(prompt.defaultId,0,'Enter = Close');assert.equal(prompt.cancelId,1,'Esc = Cancel');
  assert.equal(closePrompt({scope:'quit',confirm:true,tabs:2,windows:1},say).detail,'2 tabs in 1 window');
  assert.equal(prompt.site.centered,true);assert.equal(prompt.site.app,true,'the Acira mark, not a site');
});

test('unsaved work (R4-49): a short human title, the site as a tidy row, one line of body copy, Keep editing is what Enter does',()=>{
  const one=closePrompt({scope:'tab',unsaved:[{id:'a',host:'docs.example.com'}]},say);
  assert.equal(one.message,'Leave without saving?');assert.equal(one.detail,'');
  assert.deepEqual(one.site.list,{hosts:['docs.example.com'],more:0},'the site is a row (icon + readable name), not the title');
  assert.equal(one.site.body,'Changes you made may not be saved.');
  assert.deepEqual(one.buttons,['Close anyway','Keep editing']);assert.equal(one.defaultId,1,'Enter keeps editing');assert.equal(one.cancelId,1,'Esc keeps editing');
  assert.equal(one.site.top,true,'a tab or a window with unsaved work asks up by the tab strip, not in the middle');
  assert.equal(one.site.app,true);assert.equal(one.site.variant,'close');assert.equal(one.site.host,'');
  assert.equal(closePrompt({scope:'window',unsaved:[{id:'a',host:'docs.example.com'}]},say).site.top,true);
  assert.equal(closePrompt({scope:'tabs',unsaved:[{id:'a',host:'x.test'}]},say).site.top,true);
  assert.equal(closePrompt({scope:'quit',unsaved:[{id:'a',host:'x.test'}]},say).site.top,undefined,'a quit stays in the middle');
  const many=closePrompt({scope:'tabs',unsaved:[{id:'a',host:'docs.example.com'},{id:'b',host:'mail.example.com'},{id:'c',host:'docs.example.com'}]},say);
  assert.equal(many.message,'Some tabs have unsaved changes');assert.equal(many.detail,'');
  assert.deepEqual(many.site.list,{hosts:['docs.example.com','mail.example.com'],more:0},'a site with two tabs is one row');
  assert.equal(closePrompt({scope:'tab',unsaved:[{id:'a',host:''}]},say).site.list.hosts[0],'This page','an address without a host');
});

test('a long list stops after four sites and says how many more',()=>{
  const unsaved=Array.from({length:9},(_,i)=>({id:'t'+i,host:`site${i}.test`}));
  const rows=unsavedRows(unsaved,say);
  assert.equal(LISTED,4);assert.equal(rows.hosts.length,4);assert.equal(rows.hosts[3],'site3.test');assert.equal(rows.more,5,'the card says "and 5 more"');
});

test('Close Acira and unsaved work together are ONE centred card, without the Don\'t-ask box',async()=>{
  const prompt=closePrompt({scope:'quit',confirm:true,unsaved:[{id:'a',host:'docs.example.com'}],tabs:4,windows:2},say);
  assert.equal(prompt.message,'Close Acira?');assert.equal(prompt.detail,'4 tabs in 2 windows');
  assert.deepEqual(prompt.buttons,['Close anyway','Keep editing']);assert.equal(prompt.defaultId,1);assert.equal(prompt.cancelId,1);
  assert.deepEqual(prompt.site.list,{hosts:['docs.example.com'],more:0});assert.equal(prompt.site.body,'Changes you made may not be saved.');
  assert.equal(prompt.site.top,undefined,'a quit stays in the middle');assert.equal(prompt.site.caption,'','one site needs no caption');assert.equal(prompt.site.app,true,'the Acira mark');
  const several=closePrompt({scope:'quit',confirm:true,unsaved:[{id:'a',host:'a.test'},{id:'b',host:'b.test'}],tabs:5,windows:1},say);
  assert.equal(several.detail,'5 tabs in 1 window');assert.deepEqual(several.site.list,{hosts:['a.test','b.test'],more:0});assert.equal(several.site.caption,'Some tabs have unsaved changes');
});

test('siteOf reads the site as a person would: no www, no port',()=>{
  assert.equal(siteOf('https://www.docs.example.com/a?b#c'),'docs.example.com');
  assert.equal(siteOf('http://127.0.0.1:8080/x'),'127.0.0.1');
  assert.equal(siteOf('file:///C:/a.html'),'');assert.equal(siteOf('not a url'),'');assert.equal(siteOf(undefined),'');
});

test('the probe asks the page in place, never throws, and treats a silent page as quiet',async()=>{
  const page=(url,run)=>({isDestroyed:()=>false,getURL:()=>url,executeJavaScript:(code,gesture)=>{page.code=code;page.gesture=gesture;return run();}});
  assert.equal(await probePage(page('https://a.test/',()=>Promise.resolve(true))),true);
  assert.equal(await probePage(page('https://a.test/',()=>Promise.resolve(false))),false);
  assert.equal(await probePage(page('https://a.test/',()=>Promise.resolve('yes'))),false,'only a real true counts');
  assert.equal(await probePage(page('https://a.test/',()=>Promise.reject(new Error('gone')))),false);
  assert.equal(await probePage(page('https://a.test/',()=>new Promise(()=>{})),{timeout:20}),false,'a page that never answers');
  assert.equal(await probePage({isDestroyed:()=>true,getURL:()=>'https://a.test/'}),false);
  assert.equal(await probePage(page('acira://settings',()=>Promise.resolve(true))),false,'Acira\'s own pages have nothing to lose');
  assert.equal(await probePage(page('https://a.test/',()=>Promise.resolve(true))),true);
  assert.equal(page.code,PROBE_SCRIPT);assert.equal(page.gesture,false,'no user gesture is claimed');
  assert.match(PROBE_SCRIPT,/BeforeUnloadEvent/);assert.match(PROBE_SCRIPT,/defaultPrevented/);
});

// ---- the coordinator --------------------------------------------------------------------------------------------------------
function windowFake(id,urls,{unsaved=[],privateMode=false,webApp=false,focused=false,choose}={}){
  const w={windowId:id,privateMode,webApp,closing:false,state:{tabs:urls.map(url=>({id:id+':'+url,url})),settings:{askBeforeClosing:true}},asked:[],approved:[],actions:[],
    window:{isDestroyed:()=>false,isFocused:()=>focused},
    unsavedTabs:async ids=>unsaved.filter(item=>!ids||ids.includes(item.id)),
    approveLeave(ids){w.approved.push(...ids);},
    ask:async options=>{w.asked.push(options);return choose?choose(options):{response:0};},
    commitAction(action){w.actions.push(action);if(action.type==='settings.update')Object.assign(w.state.settings,action.patch);}};
  return w;
}
function guardFor(windows,clock={t:1000}){return createCloseGuard({getControllers:()=>windows,say,now:()=>clock.t});}
const PAGES=['https://one.test/','https://two.test/'];

test('the last window asks "Close Acira?"; a window with others behind it does not',async()=>{
  const a=windowFake('a',PAGES),b=windowFake('b',PAGES),guard=guardFor([a,b]);
  assert.equal(await guard.confirmWindowClose(a),true);assert.equal(a.asked.length,0,'another window stays open: only this window closes');
  b.closing=true;a.closing=false;
  const last=guardFor([a,b]);
  assert.equal(await last.confirmWindowClose(a),true);
  assert.equal(a.asked.length,1);assert.equal(a.asked[0].message,'Close Acira?');assert.equal(a.asked[0].detail,'2 tabs in 1 window');
  assert.equal(a.asked[0].checkboxLabel,"Don't ask again");assert.equal(a.asked[0].site.mute.label,"Don't ask again");
});

test('a single blank tab, or one tab, closes without a question',async()=>{
  for(const urls of [['acira://new'],['https://one.test/']]){
    const only=windowFake('a',urls);assert.equal(await guardFor([only]).confirmWindowClose(only),true);assert.equal(only.asked.length,0);
  }
});

test('Cancel leaves everything as it was; Esc (dismissed) is Cancel',async()=>{
  const cancelled=windowFake('a',PAGES,{choose:()=>({response:1})}),guard=guardFor([cancelled]);
  assert.equal(await guard.confirmWindowClose(cancelled),false);assert.deepEqual(cancelled.approved,[]);assert.equal(guard.approved(),false);
  const esc=windowFake('a',PAGES,{choose:()=>({response:1,dismissed:true})});assert.equal(await guardFor([esc]).confirmWindowClose(esc),false);
  const odd=windowFake('a',PAGES,{choose:()=>({response:0,dismissed:true})});assert.equal(await guardFor([odd]).confirmWindowClose(odd),false,'dismissed always means no');
});

test('"Don\'t ask again" turns the setting off and the next close is silent; Cancel does not',async()=>{
  const first=windowFake('a',PAGES,{choose:()=>({response:0,muted:true})}),guard=guardFor([first]);
  assert.equal(await guard.confirmWindowClose(first),true);
  assert.deepEqual(first.actions,[{type:'settings.update',patch:{askBeforeClosing:false}}]);
  assert.equal(await guardFor([first]).confirmWindowClose(first),true);assert.equal(first.asked.length,1,'off: no second card');
  const cancelled=windowFake('a',PAGES,{choose:()=>({response:1,muted:true})});await guardFor([cancelled]).confirmWindowClose(cancelled);
  assert.deepEqual(cancelled.actions,[],'ticking the box and cancelling changes nothing');
  const electron=windowFake('a',PAGES,{choose:()=>({response:0,checkboxChecked:true})});await guardFor([electron]).confirmWindowClose(electron);
  assert.equal(electron.actions.length,1,'the system dialog reports the box as checkboxChecked');
});

test('the setting is written through an ordinary window, not a private one',async()=>{
  const ordinary=windowFake('a',['https://x.test/']),priv=windowFake('p',PAGES,{privateMode:true,focused:true,choose:()=>({response:0,muted:true})});
  await guardFor([ordinary,priv]).confirmQuit();
  assert.equal(priv.asked.length,1,'asked in the window the person is using');
  assert.equal(ordinary.actions.length,1);assert.equal(priv.actions.length,0);
});

test('unsaved work is listed once for a window, even when it is not the last',async()=>{
  const a=windowFake('a',PAGES,{unsaved:[{id:'a:https://one.test/',url:'https://www.one.test/doc'}]}),b=windowFake('b',PAGES),guard=guardFor([a,b]);
  assert.equal(await guard.confirmWindowClose(a),true);
  assert.equal(a.asked.length,1);assert.equal(a.asked[0].message,'Leave without saving?');
  assert.deepEqual(a.asked[0].site.list,{hosts:['one.test'],more:0});assert.equal(a.asked[0].site.top,true);assert.equal(a.asked[0].site.mute,undefined,'no Don\'t-ask box on a data-loss card');
  assert.deepEqual(a.approved,['a:https://one.test/'],'Close anyway waives that page\'s own prompt');
  const cancelled=windowFake('c',PAGES,{unsaved:[{id:'c:1',url:'https://one.test/'}],choose:()=>({response:1})});
  assert.equal(await guardFor([cancelled,b]).confirmWindowClose(cancelled),false);assert.deepEqual(cancelled.approved,[]);
});

test('unsaved work and "Close Acira?" on the last window are one card',async()=>{
  const only=windowFake('a',PAGES,{unsaved:[{id:'a:1',url:'https://docs.test/x'}]}),guard=guardFor([only]);
  assert.equal(await guard.confirmWindowClose(only),true);
  assert.equal(only.asked.length,1);assert.equal(only.asked[0].message,'Close Acira?');
  assert.equal(only.asked[0].detail,'2 tabs in 1 window');assert.deepEqual(only.asked[0].site.list,{hosts:['docs.test'],more:0});
  assert.deepEqual(only.asked[0].buttons,['Close anyway','Keep editing']);
});

test('a quit that was already decided does not ask "Close Acira?" again, but still checks unsaved work',async()=>{
  const clock={t:1000},a=windowFake('a',PAGES),guard=guardFor([a],clock);
  guard.noteQuit();assert.equal(await guard.confirmWindowClose(a),true);assert.equal(a.asked.length,0,'the app is already quitting (an update, a restart)');
  const b=windowFake('b',PAGES,{unsaved:[{id:'b:1',url:'https://docs.test/'}]}),again=guardFor([b],clock);again.noteQuit();
  assert.equal(await again.confirmWindowClose(b),true);assert.equal(b.asked.length,1);assert.equal(b.asked[0].message,'Leave without saving?');
  clock.t+=QUIT_WINDOW_MS+1;
  const c=windowFake('c',PAGES);const stale=guardFor([c],clock);stale.noteQuit();clock.t+=QUIT_WINDOW_MS+1;
  assert.equal(await stale.confirmWindowClose(c),true);assert.equal(c.asked.length,1,'a quit long ago does not excuse this close');
});

test('quit: one card for every window; the windows then close without asking again',async()=>{
  const a=windowFake('a',PAGES,{focused:true,unsaved:[{id:'a:1',url:'https://docs.test/'}]}),b=windowFake('b',['https://three.test/','https://four.test/','https://five.test/','https://six.test/'],{unsaved:[{id:'b:1',url:'https://mail.test/'}]});
  const clock={t:5000},guard=guardFor([a,b],clock);
  assert.equal(await guard.confirmQuit(),true);
  assert.equal(a.asked.length,1,'asked once, in the window the person is using');assert.equal(b.asked.length,0);
  assert.equal(a.asked[0].message,'Close Acira?');assert.equal(a.asked[0].detail,'6 tabs in 2 windows');assert.deepEqual(a.asked[0].site.list,{hosts:['docs.test','mail.test'],more:0});
  assert.deepEqual(a.approved,['a:1']);assert.deepEqual(b.approved,['b:1'],'each window waives its own pages');
  assert.equal(guard.approved(),true);
  assert.equal(await guard.confirmWindowClose(a),true);assert.equal(await guard.confirmWindowClose(b),true);
  assert.equal(a.asked.length,1,'the window closes that follow ask nothing');
  clock.t+=APPROVAL_MS+1;assert.equal(guard.approved(),false,'the approval does not outlive the quit');
  guard.revoke();
});

test('quit with nothing to ask goes straight through; Cancel stops it',async()=>{
  const quiet=windowFake('a',['https://x.test/']);assert.equal(await guardFor([quiet]).confirmQuit(),true);assert.equal(quiet.asked.length,0);
  const no=windowFake('a',PAGES,{choose:()=>({response:1})}),guard=guardFor([no]);
  assert.equal(await guard.confirmQuit(),false);assert.equal(guard.approved(),false);assert.deepEqual(no.approved,[]);
  assert.equal(await guardFor([]).confirmQuit(),true,'no windows: nothing to ask');
  const off=windowFake('a',PAGES);off.state.settings.askBeforeClosing=false;assert.equal(await guardFor([off]).confirmQuit(),true);assert.equal(off.asked.length,0);
});

test('web-app windows are not counted as browser windows',async()=>{
  const app=windowFake('app',PAGES,{webApp:true}),main=windowFake('a',['https://x.test/']);
  const guard=guardFor([app,main]);await guard.confirmQuit();
  assert.equal(main.asked.length+app.asked.length,0,'one browser tab: nothing to confirm');
});

test('Close other tabs lists the unsaved pages once',async()=>{
  const a=windowFake('a',PAGES,{unsaved:[{id:'a:2',url:'https://docs.test/'},{id:'a:3',url:'https://mail.test/'}]}),guard=guardFor([a]);
  assert.equal(await guard.confirmTabsClose(a,['a:2','a:3','a:4']),true);
  assert.equal(a.asked[0].message,'Some tabs have unsaved changes');assert.deepEqual(a.approved,['a:2','a:3']);
  const none=windowFake('a',PAGES);assert.equal(await guardFor([none]).confirmTabsClose(none,['a:2']),true);assert.equal(none.asked.length,0);
  const no=windowFake('a',PAGES,{unsaved:[{id:'a:2',url:'https://docs.test/'}],choose:()=>({response:1})});assert.equal(await guardFor([no]).confirmTabsClose(no,['a:2']),false);assert.deepEqual(no.approved,[]);
});

test('a second × while the card is up is ignored, and a failing card never closes anything',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});
  const a=windowFake('a',PAGES,{choose:()=>held}),guard=guardFor([a]);
  const first=guard.confirmWindowClose(a);const second=await guard.confirmWindowClose(a);
  assert.equal(second,false);release({response:0});assert.equal(await first,true);assert.equal(a.asked.length,1);
  const broken=windowFake('a',PAGES,{choose:()=>{throw new Error('card failed');}});assert.equal(await guardFor([broken]).confirmWindowClose(broken),false,'no answer is no');
});

test('main.cjs wires the guard: window close, Quit, bulk close, the page prompt, and scripted runs',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert.match(main,/closeGuard\.confirmWindowClose\(controller\)/,'the window close asks before anything is closed');
  assert.match(main,/case 'quit':void requestQuit\(\)/);assert.match(main,/closeGuard\.noteQuit\(\)/);
  assert.match(main,/openWindows\.begin\(\);[^]*app\.quit\(\)/,'the restore list is frozen again once the card is answered');
  assert.match(main,/function closePage\(id,options\)/);
  assert.match(main,/ACIRA_BROWSER_TEST_HIDDEN==='1'\)return Promise\.resolve\(\{response:0/,'hidden scripted windows never wait for a card');
  const bulk=fs.readFileSync(path.join(__dirname,'../desktop/profile-lifecycle.cjs'),'utf8');
  assert.match(bulk,/confirmTabsClose/);assert.match(bulk,/closePage\(id,\{user:true\}\)/);
  const registry=fs.readFileSync(path.join(__dirname,'../desktop/shortcut-registry.cjs'),'utf8');
  assert.match(registry,/C\('quit','Close Acira','Windows',\{action:'quit'\},\['Mod\+Shift\+Q'\],\[\]\)/);
});

test('the open sites under "Close Acira?" are distinct, in tab order, without blank tabs; the card shows eight and counts the rest',()=>{
 const hosts=['a','b','c','d','e','f','g','h','i','j','k'].map(h=>`https://${h}.test/`);
 const windows=[win('acira://new',hosts[0],hosts[1],hosts[0]),win(...hosts.slice(2))];
 const sites=openSites(windows);assert.equal(sites.length,11);assert.equal(sites[0],'a.test');assert.equal(sites[10],'k.test');
 const prompt=closePrompt({scope:'quit',confirm:true,tabs:14,windows:2,sites},say);
 assert.equal(prompt.site.variant,'close');assert.equal(prompt.site.strip.hosts.length,8);assert.equal(prompt.site.strip.more,3,'the card says +3');
 assert.deepEqual(closePrompt({scope:'quit',confirm:true,tabs:2,windows:1,sites:['a.test']},say).site.strip,{hosts:['a.test'],more:0});
});
