import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser,bulkCloseTargets,restoreSnapshot,persistedSnapshot,settingsFor,snapshotForProfile} from '../src/runtime/core';
import {scopedSettingAction,profileScopeAction} from '../src/ui/profileScope';
import {sharedProviderList,sharedProvidersConfigured,currentSearchProviders} from '../src/ui/searchSettings';
import {groupShortcutCommands,asksForMediaKey} from '../src/ui/shortcutGroups';
import type {ShortcutCommand} from '../src/runtime/nativeCore';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);

test('arbitrary profile provider changes preserve shared defaults, legacy isolation and restart behavior',()=>{
 let state=run(createInitialState(),{type:'browser.profile.create',name:'Work'});const work=state.browserProfiles[1].id;
 const list=defaultSearchProviders();list.engines.push({id:'custom',name:'Custom',keyword:'custom',template:'https://custom.example/?q=%s'});
 state=run(state,{type:'settings.update',patch:{searchProviders:list}},{type:'browser.profile.settings',id:work,patch:{searchEngine:'duckduckgo'}});
 const renderer={...snapshotForProfile({...state,activeBrowserProfileId:work}),sharedSearchProviderId:'google',sharedSearchProvidersConfigured:true};
 const action=scopedSettingAction(renderer,'searchProviderId','custom');assert(action);state=run(state,action);
 assert.deepEqual(state.browserProfiles.find(profile=>profile.id===work)!.settings,{searchProviderId:'custom'});
 assert.equal(state.settings.searchProviders?.defaultId,'google');assert.equal(settingsFor(state,'profile-personal').searchProviders?.defaultId,'google');
 const selected=settingsFor(state,work);assert.equal(selected.searchProviders?.defaultId,'custom');assert.equal(resolveNavigation('tea',selected.searchEngine,selected.searchProviders).url,'https://custom.example/?q=tea');
 const restarted=restoreSnapshot(persistedSnapshot(state));assert.equal(settingsFor(restarted,work).searchProviders?.defaultId,'custom');
 const outgoing={...snapshotForProfile({...restarted,activeBrowserProfileId:work}),sharedSearchProviderId:'google',sharedSearchProvidersConfigured:true};
 const nextList=sharedProviderList(outgoing,outgoing.settings.searchProviders!.engines.filter(engine=>engine.id!=='custom'));
 assert.equal(nextList.defaultId,'google');state=run(restarted,{type:'settings.update',patch:{searchProviders:nextList}});
 assert.equal(settingsFor(state,work).searchProviders?.defaultId,'google','deleted own provider follows shared default');
 assert.equal(state.browserProfiles.find(profile=>profile.id===work)!.settings?.searchProviderId,'custom','stale choice never becomes an unrelated legacy override');
});

test('search scope migrates legacy ownership, follows all profiles and still edits a lone own profile',()=>{
 let state=createInitialState();const id=state.activeBrowserProfileId;
 state=run(state,{type:'browser.profile.settings',id,patch:{searchEngine:'duckduckgo'}});
 const renderer=snapshotForProfile(state),action=scopedSettingAction(renderer,'searchProviderId','bing');assert(action);state=run(state,action);
 assert.deepEqual(state.browserProfiles[0].settings,{searchProviderId:'bing'});assert.equal(state.settings.searchEngine,'google');
 const all=profileScopeAction(snapshotForProfile(state),'searchProviderId',false);assert(all);state=run(state,all);
 assert.equal(state.browserProfiles[0].settings,undefined);assert.equal(scopedSettingAction(state,'searchProviderId','bing'),null);
 const own=profileScopeAction(state,'searchProviderId',true);assert(own);state=run(state,own);assert.deepEqual(state.browserProfiles[0].settings,{searchProviderId:'google'});
});

test('stock arbitrary own providers materialize only the effective list and metadata never enters persistence',()=>{
 let state=createInitialState();state=run(state,{type:'browser.profile.settings',id:state.activeBrowserProfileId,patch:{searchProviderId:'wikipedia'}});
 const renderer={...snapshotForProfile(state),windowId:'one-lifetime:main',sharedSearchProviderId:'google',sharedSearchProvidersConfigured:false};
 assert.equal(currentSearchProviders(renderer).defaultId,'wikipedia');assert.equal(sharedProvidersConfigured(renderer),false);assert.equal(state.settings.searchProviders,undefined);
 const list=sharedProviderList(renderer,[...currentSearchProviders(renderer).engines,{id:'custom',name:'Custom',keyword:'custom',template:'https://custom.example/?q=%s'}]);assert.equal(list.defaultId,'google');
 const publicState=persistedSnapshot(renderer);for(const key of ['windowId','sharedSearchProviderId','sharedSearchProvidersConfigured'])assert(!Object.hasOwn(publicState,key));
 const legacy=effectiveSettings(createInitialState().settings,{searchEngine:'duckduckgo'});assert.equal(legacy.searchEngine,'duckduckgo');assert.equal(legacy.searchProviders,undefined);
 const stale=effectiveSettings(createInitialState().settings,{searchProviderId:'deleted',searchEngine:'duckduckgo'});assert.equal(stale.searchEngine,'google');
});

test('shortcut groups reflect actual assignment, preserve registry identities and keep Unassigned last',()=>{
 const command=(id:string,category:string,bindings:string[],defaults:string[],customized=false):ShortcutCommand=>({id,label:id,category,bindings,defaults,defaultsDisplay:defaults,display:bindings,customized,unbound:!bindings.length});
 const cleared=command('cleared','Tabs',[],['Ctrl+T'],true),assigned=command('assigned','Navigation',['Ctrl+Y'],[],true),browser=command('browser','Browser',['Ctrl+B'],['Ctrl+B']),dynamic=command('dynamic','Tab sets',['Ctrl+D'],[]),unset=command('unset','Browser',[],[]);
 const commands=[cleared,browser,assigned,dynamic,unset],before=structuredClone(commands),groups=groupShortcutCommands(commands);
 assert.deepEqual(groups.map(([name])=>name),['Navigation','Browser','Tab sets','Unassigned']);assert.deepEqual(groups.at(-1)![1],[cleared,unset]);assert.equal(groups[0][1][0],assigned);assert.equal(groups.at(-1)![1][0],cleared);assert.deepEqual(commands,before);
 assert.deepEqual(groupShortcutCommands(commands,item=>item.customized).map(([name,list])=>[name,list.map(item=>item.id)]),[['Navigation',['assigned']],['Unassigned',['cleared']]]);
 assert.deepEqual(groupShortcutCommands(commands,item=>item.id==='unset'),[['Unassigned',[unset]]]);assert.deepEqual(groupShortcutCommands(commands,()=>false),[]);
});

test('extension commands stay together under Extensions, set or not, after Browser and before Unassigned',()=>{
 const command=(id:string,category:string,bindings:string[]):ShortcutCommand=>({id,label:id,category,bindings,defaults:bindings,defaultsDisplay:bindings,display:bindings,customized:false,unbound:!bindings.length});
 const bound=command('ext:p:a:go','Extensions',['Ctrl+Shift+Y']),unset=command('ext:p:a:lock','Extensions',[]),browser=command('settings','Browser',['Ctrl+,']),free=command('duplicate-tab','Tabs',[]);
 const groups=groupShortcutCommands([unset,free,bound,browser]);
 assert.deepEqual(groups.map(([name,list])=>[name,list.map(item=>item.id)]),[['Browser',['settings']],['Extensions',['ext:p:a:lock','ext:p:a:go']],['Unassigned',['duplicate-tab']]]);
 assert.deepEqual(groupShortcutCommands([unset],()=>true).map(([name])=>name),['Extensions'],'an extension with no key at all still has its group');
});

test('an extension that asked for a media key is told apart by its note, nothing else',()=>{
 assert.equal(asksForMediaKey({note:'media-key'}),true);
 for(const note of [undefined,'','media','Media-key'])assert.equal(asksForMediaKey({note}),false,String(note));
});

test('profile rename trims, recolours and rejects blank names',()=>{
 let s=run(createInitialState(),{type:'browser.profile.create',name:'Work'});
 const id=s.browserProfiles[1].id;
 s=run(s,{type:'browser.profile.rename',id,name:'  Studio ',color:'#336699'});
 assert.deepEqual([s.browserProfiles[1].name,s.browserProfiles[1].color],['Studio','#336699']);
 s=run(s,{type:'browser.profile.rename',id,name:'   '});
 assert.equal(s.browserProfiles[1].name,'Studio');
 const unchanged=run(s,{type:'browser.profile.rename',id:'missing',name:'x'});
 assert.equal(unchanged.browserProfiles.length,2);
});

test('profile removal drops tabs, bookmarks, history, downloads and zoom of that profile only',()=>{
 let s=run(createInitialState(),{type:'browser.profile.create',name:'Work'});
 const work=s.browserProfiles[1].id;
 s=run(s,{type:'tab.new',url:'https://a.test/',browserProfileId:work},{type:'bookmark.toggle',url:'https://a.test/'});
 s.browsingHistory.push({id:'h1',title:'A',url:'https://a.test/',time:'',profileId:'',browserProfileId:work},{id:'h2',title:'P',url:'https://p.test/',time:'',profileId:'',browserProfileId:'profile-personal'});
 s.downloads.push({id:'d1',browserProfileId:work,name:'a',size:'1',status:'Ready'});
 s.originZooms[work]={'https://a.test':150};
 assert.ok(s.tabs.some(t=>t.browserProfileId===work));
 s=run(s,{type:'browser.profile.remove',id:work});
 assert.equal(s.browserProfiles.length,1);
 assert.ok(s.tabs.length>0&&s.tabs.every(t=>t.browserProfileId==='profile-personal'));
 assert.ok(s.bookmarkNodes.every(b=>b.browserProfileId!==work));
 assert.deepEqual(s.browsingHistory.map(h=>h.id),['h2']);
 assert.equal(s.downloads.length,0);
 assert.equal(s.originZooms[work],undefined);
 assert.equal(s.activeBrowserProfileId,'profile-personal');
});

test('the last profile cannot be removed',()=>{
 const s=run(createInitialState(),{type:'browser.profile.remove',id:'profile-personal'});
 assert.equal(s.browserProfiles.length,1);assert.match(s.toast?.text||'',/at least one profile/);
});

test('bulk close targets skip the anchor, pinned tabs and other profiles',()=>{
 let s=run(createInitialState(),{type:'browser.profile.create',name:'Work'});
 const work=s.browserProfiles[1].id;
 s=run(s,{type:'tab.new',url:'https://1.test/'},{type:'tab.new',url:'https://2.test/'},{type:'tab.new',url:'https://w.test/',browserProfileId:work},{type:'tab.new',url:'https://3.test/'});
 const ids=s.tabs.map(t=>t.id);s=run(s,{type:'tab.pin',id:ids[0]});
 const anchor=s.tabs.find(t=>t.url==='https://2.test/')!;
 const others=bulkCloseTargets(s,{type:'tab.close.others',id:anchor.id});
 assert.ok(!others.includes(anchor.id));assert.ok(!others.includes(ids[0]));
 assert.ok(others.every(id=>s.tabs.find(t=>t.id===id)!.browserProfileId==='profile-personal'));
 const index=s.tabs.indexOf(anchor);
 assert.deepEqual(bulkCloseTargets(s,{type:'tab.close.left',id:anchor.id}).every(id=>s.tabs.findIndex(t=>t.id===id)<index),true);
 assert.deepEqual(bulkCloseTargets(s,{type:'tab.close.right',id:anchor.id}).every(id=>s.tabs.findIndex(t=>t.id===id)>index),true);
});

import {resolveNavigation} from '../src/runtime/navigation';
import {defaultSearchProviders} from '../src/runtime/searchProviders';
import {effectiveSettings} from '../src/runtime/profileSettings';
const providers=()=>{const value=defaultSearchProviders();value.engines.push({id:'wiki',name:'Wikipedia',keyword:'w',template:'https://en.wikipedia.org/wiki/Special:Search?search=%s'});return value;};

test('bang shortcuts pick an engine without any saved providers',()=>{
 assert.equal(resolveNavigation('!d private browsers').url,'https://duckduckgo.com/?q=private%20browsers');
 assert.equal(resolveNavigation('!b cats','google').url,'https://www.bing.com/search?q=cats');
 assert.equal(resolveNavigation('plain words').url,'https://www.google.com/search?q=plain+words&sourceid=chrome&ie=UTF-8','stock searches keep their original encoding');
 assert.equal(resolveNavigation('!important notice').url,'https://www.google.com/search?q=%21important+notice&sourceid=chrome&ie=UTF-8');
 assert.match(resolveNavigation('!d').error||'',/after the search shortcut/);
});

test('custom providers: default engine, keyword, escaping and fallbacks',()=>{
 const saved=providers();
 assert.equal(resolveNavigation('!w ada lovelace','google',saved).url,'https://en.wikipedia.org/wiki/Special:Search?search=ada%20lovelace');
 assert.equal(resolveNavigation('a&b=c d','google',{...saved,defaultId:'wiki'}).url,'https://en.wikipedia.org/wiki/Special:Search?search=a%26b%3Dc%20d');
 assert.equal(resolveNavigation('x','google',{defaultId:'gone',engines:[]} as never).url,'https://www.google.com/search?q=x&sourceid=chrome&ie=UTF-8','a broken saved list falls back to stock engines');
 assert.equal(resolveNavigation('example.com/path','google',saved).url,'https://example.com/path','addresses are never searched');
 assert.equal(resolveNavigation('localhost:3000','google',saved).url,'http://localhost:3000/');
});

test('settings keep the legacy engine and the provider default in step',()=>{
 let s=reduceBrowser(createInitialState(),{type:'settings.update',patch:{searchProviders:{...providers(),defaultId:'bing'}}});
 assert.equal(s.settings.searchEngine,'bing');
 s=reduceBrowser(s,{type:'settings.update',patch:{searchEngine:'duckduckgo'}});
 assert.equal(s.settings.searchProviders?.defaultId,'duckduckgo');
 s=reduceBrowser(s,{type:'tab.navigate',url:'!w tea'});
 assert.match(s.tabs.find(t=>t.id===s.activeTabId)!.url,/wikipedia\.org\/wiki\/Special:Search\?search=tea/);
 s=reduceBrowser(s,{type:'settings.update',patch:{searchProviders:null}});
 assert.equal(s.settings.searchProviders,undefined);
});

test('a removed profile search engine keeps the remaining saved default and custom shortcuts',()=>{
 const saved=providers();
 saved.engines=saved.engines.filter(engine=>engine.id!=='duckduckgo');
 saved.defaultId='wiki';
 const settings={...createInitialState().settings,searchProviders:saved};
 const effective=effectiveSettings(settings,{searchEngine:'duckduckgo'});
 assert.equal(effective.searchProviders?.defaultId,'wiki');
 assert.match(resolveNavigation('tea time',effective.searchEngine,effective.searchProviders).url,/wikipedia\.org\/wiki\/Special:Search\?search=tea%20time/);
 assert.equal(resolveNavigation('!b tea',effective.searchEngine,effective.searchProviders).url,'https://www.bing.com/search?q=tea');
 assert.equal(saved.defaultId,'wiki','the saved list stays unchanged');
});

test('an available profile search engine still overrides a saved default without changing other profiles',()=>{
 const saved=providers();
 saved.defaultId='wiki';
 const settings={...createInitialState().settings,searchProviders:saved};
 const effective=effectiveSettings(settings,{searchEngine:'duckduckgo'});
 assert.equal(effective.searchProviders?.defaultId,'duckduckgo');
 assert.equal(resolveNavigation('tea',effective.searchEngine,effective.searchProviders).url,'https://duckduckgo.com/?q=tea');
 assert.equal(saved.defaultId,'wiki');
 assert.equal(effectiveSettings(settings).searchProviders?.defaultId,'wiki');
});

import {rankAddressSuggestions} from '../src/ui/addressSuggestions';
test('address suggestions retain saved Google result-language parameters instead of rebuilding a stock search',()=>{
 const state=createInitialState(),providers=defaultSearchProviders();
 providers.engines.find(engine=>engine.id==='google')!.template='https://www.google.com/search?q=%s&hl=en&lr=lang_en';
 state.settings.searchProviders=providers;
 const suggestion=rankAddressSuggestions('youtube',state)[0];
 assert.equal(suggestion.kind,'search');assert.equal(suggestion.detail,'Search Google');
 const url=new URL(suggestion.url);assert.equal(url.searchParams.get('q'),'youtube');assert.equal(url.searchParams.get('hl'),'en');assert.equal(url.searchParams.get('lr'),'lang_en');
 assert.equal(url.searchParams.get('sourceid'),'chrome');
 assert.equal(rankAddressSuggestions('https://www.google.com/search?q=youtube&hl=fr',state)[0].url,'https://www.google.com/search?q=youtube&hl=fr','an explicit address retains its own language choice');
});
test('search suggestions follow profile provider IDs and custom shortcuts, including their displayed engine names',()=>{
 const state=createInitialState(),providers=defaultSearchProviders();
 providers.engines.push({id:'work-search',name:'Work search',keyword:'work',template:'https://search.example/find?text=%s&lang=de'});
 state.settings.searchProviders={...providers,defaultId:'work-search'};
 for(const query of ['café & tea','!work café & tea']){
  const suggestion=rankAddressSuggestions(query,state)[0],url=new URL(suggestion.url);
  assert.equal(url.origin,'https://search.example');assert.equal(url.searchParams.get('text'),'café & tea');assert.equal(url.searchParams.get('lang'),'de');assert.equal(suggestion.detail,'Search Work search');
 }
 const google=rankAddressSuggestions('!g cats',state)[0];assert.equal(new URL(google.url).hostname,'www.google.com');assert.equal(google.detail,'Search Google');
});
test('profile separation covers omnibox suggestions, history and bookmarks, not only cookies',()=>{
 let s=reduceBrowser(createInitialState(),{type:'browser.profile.create',name:'Work'});
 const work=s.browserProfiles[1].id;
 s.browsingHistory.push({id:'h1',title:'Secret salary sheet',url:'https://payroll.example/salary',time:'',profileId:'',browserProfileId:'profile-personal'});
 s=reduceBrowser(s,{type:'bookmark.toggle',url:'https://personal.example/'}); // bookmarked while in Personal
 const personal=rankAddressSuggestions('s',s).map(item=>item.url);
 assert.ok(personal.some(url=>url.includes('payroll.example')),'owner profile sees its history');
 s=reduceBrowser(s,{type:'tab.new',url:'https://work.example/',browserProfileId:work});
 const inWork=rankAddressSuggestions('s',s).map(item=>item.url);
 assert.ok(!inWork.some(url=>url.includes('payroll.example')),'work profile never suggests personal history');
 assert.ok(!inWork.some(url=>url.includes('personal.example')),'work profile never suggests personal bookmarks');
});

test('only schemeless public addresses are marked for the https-then-http fallback',()=>{
 assert.equal(resolveNavigation('example.com').httpsFirst,true);
 assert.equal(resolveNavigation('example.com:443/x').httpsFirst,true,'443 is the https port');
 for(const typed of ['example.com:80','example.com:80/x?y=1'])assert.deepEqual([resolveNavigation(typed).url,resolveNavigation(typed).httpsFirst],[typed==='example.com:80'?'https://example.com/':'https://example.com/x?y=1',true],'port 80 is http\'s own: dropped, then https first as in Chrome');
 assert.equal(resolveNavigation('192.168.1.1:80').url,'http://192.168.1.1/','a local address on port 80 stays http');
 // Like Chrome's HTTPS-Upgrades: no https try (and so no http offer) for IP addresses, local and reserved names, and ports other than 443, where an
 // http service answers a secure connection with an error. They open over http, as typed into Chrome.
 for(const [typed,url] of [['example.com:8080/x?y=1','http://example.com:8080/x?y=1'],['0.0.0.0:8000','http://0.0.0.0:8000/'],['100.100.1.2','http://100.100.1.2/'],['100.64.0.1:3000','http://100.64.0.1:3000/'],['8.8.8.8','http://8.8.8.8/'],['[2001:db8::1]','http://[2001:db8::1]/'],['printer.lan','http://printer.lan/'],['host.internal','http://host.internal/'],['router.home.arpa','http://router.home.arpa/'],['nas.home','http://nas.home/'],['app.test:8443','http://app.test:8443/']] as const){const target=resolveNavigation(typed);assert.equal(target.httpsFirst,undefined,typed);assert.equal(target.url,url,typed);}
 for(const typed of ['https://example.com:8080/','https://8.8.8.8/','https://printer.lan/'])assert.equal(resolveNavigation(typed).url,typed,'typed https stays https: '+typed);
 assert.equal(resolveNavigation('100.128.0.1').url,'http://100.128.0.1/','outside 100.64/10 is still an IP address');
 assert.equal(resolveNavigation('nodejs.org').httpsFirst,true);assert.equal(resolveNavigation('bbc.co.uk').httpsFirst,true);
 for(const explicit of ['https://example.com','http://example.com','https://192.168.1.1/'])assert.equal(resolveNavigation(explicit).httpsFirst,undefined,explicit);
 for(const local of ['localhost:3000','127.0.0.1','192.168.1.1','[::1]:8080','router.local','plain words'])assert.equal(resolveNavigation(local).httpsFirst,undefined,local);
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'neverssl.com'});
 assert.equal(s.tabs.find(t=>t.id===s.activeTabId)!.httpsFirst,true);
 s=reduceBrowser(s,{type:'tab.navigate',url:'https://neverssl.com/'});
 assert.equal(s.tabs.find(t=>t.id===s.activeTabId)!.httpsFirst,true,'a repeat of the same address keeps the fallback');
 s=reduceBrowser(s,{type:'tab.navigate',url:'http://neverssl.com/'});
 assert.equal(s.tabs.find(t=>t.id===s.activeTabId)!.httpsFirst,undefined,'moving to an explicit address clears it');
});

test('the http offer is only for the address typed: a page that goes to another site itself drops it',()=>{
 // Before: type example.com, click a link to https://bank.example.org/login that fails with -102, and the error page offered "Continue over http" for
 // the bank (and Continue kept that choice for the bank). desktop/browser-services/https-first.cjs offered() and NavigationError's httpOffer read this flag.
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'example.com'});const id=s.activeTabId,tab=()=>s.tabs.find(t=>t.id===id)!;
 const page=(url:string,extra:object={})=>{s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,url,title:url,...extra}} as BrowserAction);};
 page('https://example.com/',{loading:false});assert.equal(tab().httpsFirst,true,'the typed site itself keeps it');
 page('https://example.com/about',{loading:false});assert.equal(tab().httpsFirst,true,'and so does another page of it');
 page('https://bank.example.org/login',{error:'ERR_CONNECTION_REFUSED (-102)',loading:false});
 assert.equal(tab().url,'https://bank.example.org/login');assert.equal(tab().httpsFirst,undefined,'a link to another site never offers http');
 s=reduceBrowser(createInitialState(),{type:'tab.new',url:'example.com'});const second=s.activeTabId;
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:second,url:'https://www.example.com/',title:'',loading:false}} as BrowserAction);
 assert.equal(s.tabs.find(t=>t.id===second)!.httpsFirst,undefined,'a redirect to another origin drops it too');
});

test('scheme typos in typed addresses are fixed, never searched',()=>{
 for(const [typed,expected] of [['http:/example.com','http://example.com/'],['https:example.com','https://example.com/'],['HTTPS:/example.com/a?b=1','https://example.com/a?b=1'],['http:localhost:3000/x','http://localhost:3000/x'],['http:/192.168.1.1','http://192.168.1.1/']])assert.equal(resolveNavigation(typed).url,expected,typed);
 assert.equal(resolveNavigation('http: not an address').query,'http: not an address');
 assert.equal(resolveNavigation('https://example.com/x').url,'https://example.com/x');
});

test('closing a tab returns to the tab it was opened from until the person picks another tab',()=>{
 let s=run(createInitialState(),{type:'tab.new',url:'https://a.test/'},{type:'tab.new',url:'https://b.test/'},{type:'tab.new',url:'https://c.test/'});
 const [home,a,b,c]=s.tabs.map(t=>t.id);
 s=run(s,{type:'tab.select',id:a},{type:'tab.new'});
 const fresh=s.activeTabId;
 assert.equal(s.tabs.at(-1)!.id,fresh,'new tab goes to the end');
 s=run(s,{type:'tab.close',id:fresh});
 assert.equal(s.activeTabId,a,'Ctrl+T then Ctrl+W lands back on the tab it came from, not the last tab');
 // a link opened next to the current tab returns to it too
 s=run(s,{type:'tab.new',url:'https://link.test/',afterId:a});
 const child=s.activeTabId;
 assert.equal(s.tabs[s.tabs.findIndex(t=>t.id===a)+1].id,child);
 s=run(s,{type:'tab.close',id:child});
 assert.equal(s.activeTabId,a);
 // once the person picks a tab by hand the opener is forgotten and the neighbour to the right is used
 s=run(s,{type:'tab.new'});
 const other=s.activeTabId;
 s=run(s,{type:'tab.select',id:b},{type:'tab.select',id:other});
 const at=s.tabs.findIndex(t=>t.id===other);
 s=run(s,{type:'tab.close',id:other});
 assert.equal(s.activeTabId,s.tabs[Math.min(at,s.tabs.length-1)].id,'falls back to the neighbour');
 // a background tab never steals the way back, and a closed opener leaves no dangling reference
 s=run(s,{type:'tab.select',id:c},{type:'tab.new',url:'https://bg.test/',background:true});
 assert.equal(s.tabs.at(-1)!.openerId,undefined);
 s=run(s,{type:'tab.select',id:home},{type:'tab.new'});
 const last=s.activeTabId;
 s=run(s,{type:'tab.close',id:home});
 assert.equal(s.tabs.find(t=>t.id===last)!.openerId,undefined);
 s=run(s,{type:'tab.close',id:last});
 assert.ok(s.tabs.some(t=>t.id===s.activeTabId));
});

test('one navigation leaves one history visit: repeats, redirects back and restored loads are not new visits',()=>{
 let s=run(createInitialState(),{type:'tab.new',url:'https://a.test/'});
 const id=s.activeTabId;
 const visit=(url:string,extra:object={})=>{s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,url,title:url,...extra}} as BrowserAction);};
 visit('https://a.test/');visit('https://a.test/');
 assert.equal(s.browsingHistory.filter(v=>v.url==='https://a.test/').length,1,'the same page reported twice is one visit');
 visit('https://b.test/');visit('https://a.test/');
 assert.equal(s.browsingHistory.filter(v=>v.url==='https://a.test/').length,1,'a redirect chain that comes back to a page within a minute does not repeat it');
 const before=s.browsingHistory.length;
 visit('https://restored.test/',{restored:true});
 assert.equal(s.browsingHistory.length,before,'loading a restored tab or waking a sleeping one is not a visit');
 assert.equal(s.tabs.find(t=>t.id===id)!.url,'https://restored.test/','the tab itself still shows the restored page');
 visit('https://c.test/');
 assert.equal(s.browsingHistory[0].url,'https://c.test/','a real navigation is still recorded');
});

test('downloads that cannot have survived a restart come back as Cancelled (never started) or Interrupted (partly saved)',()=>{
 const base=createInitialState();
 const row=(id:string,status:string,extra:object={})=>({id,browserProfileId:base.browserProfiles[0].id,name:'f.bin',path:'',receivedBytes:0,totalBytes:100,startedAt:1,url:'https://a.test/f',size:'0 KB',status,...extra});
 const saved={...base,downloads:[row('waiting','Paused'),row('partial','Downloading',{path:'C:/x/f.bin',receivedBytes:40}),row('done','Ready',{path:'C:/x/g.bin',receivedBytes:100}),row('old','Cancelled')]};
 const restored=restoreSnapshot(JSON.parse(JSON.stringify(saved)));
 const status=(id:string)=>restored.downloads.find(d=>d.id===id)!.status;
 assert.equal(status('waiting'),'Cancelled');assert.equal(status('partial'),'Interrupted');assert.equal(status('done'),'Ready');assert.equal(status('old'),'Cancelled');
});
