import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {withoutCredentials} from '../src/runtime/navigation';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction} from '../src/runtime/types';

// A link (or redirect) to an address with a user name and password: Chromium loads the page, but the reducer ran its typed-address resolver over the
// page's address and that refuses credentials, so the tab kept the address of the page before while its title and content were the new page's.
const active=(s:ReturnType<typeof createInitialState>)=>s.tabs.find(t=>t.id===s.activeTabId)!;
const page=(s:ReturnType<typeof createInitialState>,event:object)=>reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:s.activeTabId,loading:false,...event}} as BrowserAction);

test('withoutCredentials drops a user name and password from an http(s) address and returns everything else untouched',()=>{
 assert.equal(withoutCredentials('http://u:p@127.0.0.1:9913/c?x=1#h'),'http://127.0.0.1:9913/c?x=1#h');
 assert.equal(withoutCredentials('https://paypal.com@evil.example/login'),'https://evil.example/login','the part before @ is a user name, not the site');
 assert.equal(withoutCredentials('https://user@example.com/'),'https://example.com/');
 for(const same of ['https://example.com/','http://example.com:8080/a b','https://example.com/@x','acira://settings','file:///a@b','about:blank',''])assert.equal(withoutCredentials(same),same,same);
 assert.equal(withoutCredentials(null),null);assert.equal(withoutCredentials(undefined),undefined);
});

test('the tab shows and keeps the address the page really has, without the credentials',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://a.test/b'});
 s=page(s,{url:'https://a.test/b',title:'B'});
 s=page(s,{url:'http://u:secret@a.test/c',title:'C',history:['https://a.test/b','http://u:secret@a.test/c'],historyIndex:1});
 const tab=active(s);
 assert.equal(tab.url,'http://a.test/c','the address bar follows the page');
 assert.equal(tab.title,'C');
 assert.ok(tab.history.every(url=>!/secret/.test(url)),'the tab history keeps no password: '+tab.history.join(' '));
 assert.equal(tab.history[tab.historyIndex],'http://a.test/c');
 assert.ok(s.browsingHistory.every(visit=>!/secret|u:/.test(visit.url)),'the saved history keeps no password');
 assert.ok(s.browsingHistory.some(visit=>visit.url==='http://a.test/c'),'the visit is kept, without it');
});

test('main does not reload a page whose address it holds with the credentials the tab no longer shows',()=>{
 const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
 assert.ok(main.includes("if(entry.loadedURL!==tab.url&&require('./runtime.cjs').withoutCredentials(entry.loadedURL)!==tab.url)void loadPage(tab,entry)"),'syncPages compares the tab with the loaded address minus credentials');
});
