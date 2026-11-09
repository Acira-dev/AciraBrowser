import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {carriesHttpsFirst,httpsFirstHint,resolveNavigation} from '../src/runtime/navigation';
import {addressSuggestionAction} from '../src/ui/addressSuggestions';
import type {AddressSuggestion} from '../src/ui/addressSuggestions';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction} from '../src/runtime/types';
const {validateAction}=createRequire(import.meta.url)('../desktop/validation.cjs');
const snapshot=createInitialState();

// The interface resolves what is typed and hands the reducer the resolved address ("example.com" arrives as "https://example.com/"), so the reducer
// could no longer tell a typed address from a pasted https link, and a typed address never got the "Continue over http" offer when the site has no
// secure endpoint. The hint `httpsFirst` carries that one fact across.
const active=(s:ReturnType<typeof createInitialState>)=>s.tabs.find(t=>t.id===s.activeTabId)!;
const row=(url:string,kind:AddressSuggestion['kind']='url'):AddressSuggestion=>({id:`${kind}:${url}`,kind,title:url,url,detail:''});

test('a typed address is the https the browser chose; text typed with https://, another address or a search is not',()=>{
 const typed=resolveNavigation('neverssl.com');
 assert.equal(carriesHttpsFirst(typed,'https://neverssl.com/'),true);
 assert.equal(carriesHttpsFirst(typed,'https://neverssl.com/other'),false,'a row for another address');
 assert.equal(carriesHttpsFirst(resolveNavigation('https://neverssl.com'),'https://neverssl.com/'),false,'typed with https:// keeps its error');
 assert.equal(carriesHttpsFirst(resolveNavigation('localhost:3000'),'http://localhost:3000/'),false,'no https try for local addresses');
 assert.equal(carriesHttpsFirst(resolveNavigation('hello world'),resolveNavigation('hello world').url),false,'a search');
});

test('the reducer keeps the hint for a web https address only',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://neverssl.com/',httpsFirst:true});
 assert.equal(active(s).httpsFirst,true,'tab.new with the hint');
 s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://neverssl.com/'});
 assert.equal(active(s).httpsFirst,undefined,'a pasted https link has no http offer');
 s=reduceBrowser(createInitialState(),{type:'tab.new',url:'http://neverssl.com/',httpsFirst:true});
 assert.equal(active(s).httpsFirst,undefined,'an http address cannot carry it');
 s=reduceBrowser(createInitialState(),{type:'tab.new'});
 s=reduceBrowser(s,{type:'tab.navigate',url:'https://neverssl.com/',httpsFirst:true});
 assert.equal(active(s).httpsFirst,true,'tab.navigate with the hint');
 s=reduceBrowser(s,{type:'tab.navigate',url:'https://example.org/'});
 assert.equal(active(s).httpsFirst,undefined,'the next address without it drops it');
 s=reduceBrowser(s,{type:'tab.navigate',url:'acira://settings',httpsFirst:true});
 assert.equal(active(s).httpsFirst,undefined,'an Acira page never carries it');
 assert.equal(httpsFirstHint(true,resolveNavigation('hello world')),true,'(a search URL is https: the offer only ever shows for a failed secure connection to the typed address)');
 assert.equal(httpsFirstHint('yes',resolveNavigation('neverssl.com')),false,'only true counts');
});

test('a chosen row carries the hint only when it is what the typed text resolves to',()=>{
 const action=(url:string,typed:string|undefined)=>addressSuggestionAction(row(url),false,'tab-1',typed) as Extract<BrowserAction,{type:'tab.navigate'}>;
 assert.equal(action('https://neverssl.com/','neverssl.com').httpsFirst,true);
 assert.equal(action('https://neverssl.com/','neverssl.co').httpsFirst,undefined,'a different address than the typed one');
 assert.equal(action('https://neverssl.com/','https://neverssl.com').httpsFirst,undefined,'typed with https://');
 assert.equal(action('https://neverssl.com/',undefined).httpsFirst,undefined,'no typed text');
 assert.equal(action('https://neverssl.com/','neverssl.com').tabId,'tab-1');
});

test('the bridge accepts the hint on tab.navigate and tab.new, as a boolean only',()=>{
 assert.doesNotThrow(()=>validateAction({type:'tab.navigate',url:'https://neverssl.com/',httpsFirst:true},snapshot));
 assert.doesNotThrow(()=>validateAction({type:'tab.new',url:'https://neverssl.com/',httpsFirst:true},snapshot));
 assert.throws(()=>validateAction({type:'tab.navigate',url:'https://neverssl.com/',httpsFirst:'yes'},snapshot),/boolean/i);
 assert.throws(()=>validateAction({type:'tab.new',url:'https://neverssl.com/',httpsFirst:1},snapshot),/boolean/i);
});

test('every place that opens what was typed tells the reducer: address field, chosen row, Alt+Enter, command palette, new-tab search box',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),newTab=readFileSync(new URL('../src/features/newtab/NewTabPage.tsx',import.meta.url),'utf8');
 assert.ok(app.includes("carriesHttpsFirst(typed === undefined ? target : resolveNavigation(typed"),'navigate(): the typed text, or the text a chosen row stands for');
 assert.ok(app.includes("navigate(item.url, tab.id, address)"),'a chosen row says what was typed');
 assert.ok(app.includes("type: 'tab.new', url: target.url, ...(carriesHttpsFirst(target, target.url)"),'Alt+Enter');
 assert.ok(app.includes("addressSuggestionAction(item, switchToTab, state.activeTabId, query)"),'a row clicked in the popup list');
 assert.ok(/else\s+onNavigate\(query\);/.test(app),'the command palette hands on what was typed, not its resolved address');
 assert.ok(newTab.includes("type: 'tab.new', url: target.url, ...(carriesHttpsFirst(target, target.url)"),'the new-tab search box, Alt+Enter');
});
