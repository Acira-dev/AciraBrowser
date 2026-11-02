import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {resolveNavigation} from '../src/runtime/navigation';
import {defaultSearchProviders} from '../src/runtime/searchProviders';
import {asBrowserSearch,googleHl,isGoogleSearch,withSearchLanguage,setWebsiteLanguageSource,websiteLanguageFor} from '../src/runtime/searchLanguage';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
const require=createRequire(import.meta.url);

// R4 leftovers: Google's page language (hl) is the profile's first website language; since R6 the network hook adds it, for typed and pasted searches alike.
test('hl is the website language: region only where Google needs it, nothing for an unusable tag',()=>{
 assert.deepEqual(['en-US','en','fr-CA','pt-BR','pt-PT','pt','zh-CN','zh-TW','ar-SA','tr','ja','es-419'].map(googleHl),['en','en','fr','pt-BR','pt-PT','pt','zh-CN','zh-TW','ar','tr','ja','es']);
 for(const bad of ['','x','123','a_b',null,undefined,{},42])assert.equal(googleHl(bad),'',String(bad));
 // The network hook for direct visits answers the same way.
 const hook=require('../desktop/browser-services/google-language.cjs');
 for(const tag of ['en-US','fr-CA','pt-BR','zh-TW','ar-SA','ja','','x','es-419'])assert.equal(googleHl(tag),hook.hlFor(tag),tag);
});

// R6 (P0): typed "youtube" showed YouTube channel cards first while pasting Chrome's own search URL into the same profile showed https://www.youtube.com
// and its sitelinks. Typed searches forced hl past the person's own Google choice and lacked Chromium's sourceid/ie, so the two asked Google different
// things. Now a typed Google search is Chromium's URL, and hl comes only from the network hook, under the same rules for typed and pasted searches.
const CHROME_OMNIBOX='https://www.google.com/search?q=youtube&oq=youtube&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIHCAEQABiPAjIHCAIQABiPAtIBCDEyMjZqMGo3qAIAsAIA&sourceid=chrome&source=chrome.ob&ie=UTF-8';
test('typed Google searches are Chromium\'s own Google URL; the search text is not re-encoded and no language is forced',()=>{
 assert.equal(resolveNavigation('youtube','google',undefined,'en-US').url,'https://www.google.com/search?q=youtube&sourceid=chrome&ie=UTF-8');
 assert.equal(resolveNavigation('cafe au lait & more','google',undefined,'fr-CA').url,'https://www.google.com/search?q=cafe+au+lait+%26+more&sourceid=chrome&ie=UTF-8');
 const providers=defaultSearchProviders();
 assert.equal(resolveNavigation('a b ü',  'google',providers,'en-US').url,'https://www.google.com/search?q=a%20b%20%C3%BC&sourceid=chrome&ie=UTF-8','provider template: the query keeps its own encoding');
 assert.equal(resolveNavigation('!img red fox','google',providers,'pt-BR').url,'https://www.google.com/search?tbm=isch&q=red%20fox&sourceid=chrome&ie=UTF-8','Google Images is Google search too');
 assert.equal(resolveNavigation('!g cats','google',undefined,'de-DE').url,'https://www.google.com/search?q=cats&sourceid=chrome&ie=UTF-8','a !g shortcut');
 assert.equal(resolveNavigation('hl=fr cats','google',undefined,'en').url,'https://www.google.com/search?q=hl%3Dfr+cats&sourceid=chrome&ie=UTF-8','text that looks like a parameter is only text');
 assert.equal(asBrowserSearch('https://www.google.com/search?q=x&sourceid=navclient'),'https://www.google.com/search?q=x&sourceid=navclient','a URL that names its source keeps it');
 assert.equal(asBrowserSearch(asBrowserSearch('https://www.google.com/search?q=x')),'https://www.google.com/search?q=x&sourceid=chrome&ie=UTF-8','added once');
 assert.equal(withSearchLanguage('https://www.google.com/search?q=x&hl=fr','en'),'https://www.google.com/search?q=x&hl=fr','a language already in the URL wins');
});

test('typed "youtube" asks Google what Chrome\'s omnibox asks, without its suggestion statistics, and the hook treats typed and pasted alike',()=>{
 const typed=new URL(resolveNavigation('youtube','google',undefined,'en-US').url),chrome=new URL(CHROME_OMNIBOX);
 for(const [key,value] of typed.searchParams)assert.equal(chrome.searchParams.get(key),value,key);
 assert.deepEqual([...chrome.searchParams.keys()].filter(key=>!typed.searchParams.has(key)),['oq','gs_lcrp','source'],'only Chrome\'s suggestion statistics and its own source tag are left out');
 assert.equal(typed.searchParams.has('hl'),false,'no forced page language: the hook decides, as for a pasted link');
 assert.equal(require('../desktop/browser-services/context-commands.cjs').selectionURL('youtube','google'),typed.href,'"Search Google for" on selected text sends the same search');
 assert.equal(require('../desktop/browser-services/context-commands.cjs').selectionURL('youtube','bing'),'https://www.bing.com/search?q=youtube','other engines are untouched');
 const hook=require('../desktop/browser-services/google-language.cjs');
 assert.equal(hook.target(typed.href,'en'),typed.href+'&hl=en','a profile where the person has not chosen still gets its website language (no Spanish or Arabic page by IP)');
 assert.equal(hook.target(CHROME_OMNIBOX,'en'),CHROME_OMNIBOX+'&hl=en','the pasted Chrome URL gets exactly the same treatment');
 assert.equal(hook.hasOwnChoice([{name:'PREF',value:'tz=Asia.Beirut&hl=ar'}]),true,'and where the person chose on Google, neither typed nor pasted searches get hl');
});

test('without a language, or for another engine or page, nothing changes',()=>{
 for(const none of [undefined,'','x','123'])assert.equal(resolveNavigation('cats','google',undefined,none as string|undefined).url,'https://www.google.com/search?q=cats&sourceid=chrome&ie=UTF-8',String(none));
 assert.equal(resolveNavigation('cats','duckduckgo',undefined,'en-US').url,'https://duckduckgo.com/?q=cats');
 assert.equal(resolveNavigation('cats','bing',undefined,'en-US').url,'https://www.bing.com/search?q=cats');
 const providers=defaultSearchProviders();
 for(const [shortcut,url] of [['!d cats','https://duckduckgo.com/?q=cats'],['!b cats','https://www.bing.com/search?q=cats'],['!yt cats','https://www.youtube.com/results?search_query=cats'],['!maps cats','https://www.google.com/maps/search/cats'],['!news cats','https://news.google.com/search?q=cats'],['!translate cats','https://translate.google.com/?sl=auto&op=translate&text=cats'],['!gm cats','https://mail.google.com/mail/u/0/#search/cats']])
  assert.equal(resolveNavigation(shortcut,'google',providers,'en-US').url,url,shortcut);
 // Addresses the person types or opens are never rewritten, Google ones included.
 for(const address of ['https://www.google.com/search?q=cats','google.com','www.google.com/search?q=cats','https://www.google.com/','http://www.google.com/search?q=a','https://mail.google.com/'])
  assert.equal(resolveNavigation(address,'google',undefined,'en-US').url,resolveNavigation(address).url,address);
});

test('only https google results pages on Google hosts are recognised',()=>{
 for(const yes of ['https://www.google.com/search?q=a','https://google.com/search?q=a','https://www.google.co.uk/search?q=a','https://www.google.com.lb/search?tbm=isch&q=a'])assert.equal(isGoogleSearch(yes),true,yes);
 for(const no of ['https://www.google.com/search?q=a&hl=en','http://www.google.com/search?q=a','https://news.google.com/search?q=a','https://www.google.com/maps/search/a','https://www.google.com.evil.example/search?q=a','https://notgoogle.com/search?q=a','https://www.google.com:8443/search?q=a','https://user:pw@www.google.com/search?q=a','https://www.google.com/','not a url',''])assert.equal(isGoogleSearch(no),false,no);
});

test('the reducer builds the same URL for typed searches whatever language the main process knows for that profile',()=>{
 try{
  setWebsiteLanguageSource(profile=>profile==='fr-profile'?'fr-FR':'en-US');
  assert.equal(websiteLanguageFor('anything'),'en-US');
  const state=createInitialState(),first=state.tabs[0];
  const opened=reduceBrowser(state,{type:'tab.new',url:'northern lights'}),tab=opened.tabs.find(item=>item.id===opened.activeTabId)!;
  assert.equal(tab.url,'https://www.google.com/search?q=northern+lights&sourceid=chrome&ie=UTF-8');
  const navigated=reduceBrowser(opened,{type:'tab.navigate',url:'tide times',tabId:first.id});
  assert.equal(navigated.tabs.find(item=>item.id===first.id)!.url,'https://www.google.com/search?q=tide+times&sourceid=chrome&ie=UTF-8');
  // A URL the renderer already built goes through as it is, once.
  const built=reduceBrowser(opened,{type:'tab.navigate',url:'https://www.google.com/search?q=tide+times&sourceid=chrome&ie=UTF-8',tabId:first.id});
  assert.equal(built.tabs.find(item=>item.id===first.id)!.url,'https://www.google.com/search?q=tide+times&sourceid=chrome&ie=UTF-8');
  setWebsiteLanguageSource(()=>{throw new Error('profile not ready');});
  assert.equal(websiteLanguageFor('x'),'','a source that fails means no language, not a failed navigation');
  assert.equal(reduceBrowser(state,{type:'tab.navigate',url:'tide times',tabId:first.id}).tabs.find(item=>item.id===first.id)!.url,'https://www.google.com/search?q=tide+times&sourceid=chrome&ie=UTF-8');
 }finally{setWebsiteLanguageSource(null);}
 assert.equal(websiteLanguageFor('x'),'');
});

test('the main process wires the language from the profile session, and the renderer passes it where it builds a search',()=>{
 const read=(file:string)=>fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..',file),'utf8');
 const main=read('desktop/main.cjs');
 assert.match(main,/setWebsiteLanguageSource\(websiteLanguageOf\)/);
 assert.match(main,/profileWebsiteLanguage\.set\(profileId,websiteLanguagesService\(\)\.pageLanguages\(ses\)\[0\]/);
 assert.match(main,/websiteLanguage:websiteLanguageOf\(state\.activeBrowserProfileId\)/);
 assert.equal((main.match(/websiteLanguageFor\(/g)||[]).length,3,'the three main-side resolutions of a typed address agree with the reducer');
 assert.match(read('src/App.tsx'),/resolveNavigation\(input, \.\.\.searchFor\(s, state\.tabs\.find\(item => item\.id === tabId\)\?\.privacy\), state\.websiteLanguage\)/);
 assert.match(read('src/features/newtab/NewTabPage.tsx'),/state\.settings\.searchProviders \?\? undefined, state\.websiteLanguage\)/);
 assert.match(read('src/ui/addressSuggestions.ts'),/resolveNavigation\(query,engine,providers,state\.websiteLanguage\)/);
 assert.match(read('src/runtime/core.ts'),/delete s\.websiteLanguage/,'the language is never saved with the window');
});

test('an unattached profile answers with its saved choice, else the system language',()=>{
 const {createWebsiteLanguages}=require('../desktop/browser-services/website-languages.cjs');
 const policies=new Map<string,any>([['chosen',{websiteLanguages:['fr','en']}]]);
 const service=createWebsiteLanguages({database:{policy:(id:string)=>policies.get(id),setPolicy(){},transaction:(run:()=>void)=>run()},systemLanguages:()=>['ar-SA','en-US']});
 assert.equal(service.firstLanguage('chosen'),'fr');
 assert.equal(service.firstLanguage('other'),'ar-SA');
 assert.equal(createWebsiteLanguages({database:{policy:()=>undefined,setPolicy(){},transaction:(run:()=>void)=>run()},systemLanguages:()=>[]}).firstLanguage('x'),'en-US');
});
