import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {appPageOf,backReturnsToOpener} from '../src/runtime/appPages';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const {openWorkspacePage}=await import('../src/ui/workspaceView');

const playing=()=>{
 let state=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'https://video.example/watch'});
 const id=state.activeTabId;
 state=reduceBrowser(state,{type:'browser.event',event:{type:'state',tabId:id,media:'playing',audible:true}} as BrowserAction);
 return {state,id};
};
const open=(state:BrowserSnapshot,page:string)=>{let next=state;openWorkspacePage(page,state,action=>{next=reduceBrowser(next,action);});return next;};

test('Settings opens beside a website instead of replacing it',()=>{
 const {state,id}=playing();
 const next=open(state,'settings');
 const site=next.tabs.find(tab=>tab.id===id)!,settings=next.tabs.find(tab=>tab.id===next.activeTabId)!;
 assert.equal(site.url,'https://video.example/watch');
 assert.equal(site.media,'playing');
 assert.equal(settings.url,'acira://settings');
 assert.equal(settings.openerId,id);
 assert.equal(next.tabs.indexOf(settings),next.tabs.indexOf(site)+1);
 // A second request reuses that tab.
 const again=open(reduceBrowser(next,{type:'tab.select',id}),'settings');
 assert.equal(again.tabs.filter(tab=>tab.url==='acira://settings').length,1);
 assert.equal(again.activeTabId,settings.id);
});

test('an empty new tab becomes the page itself',()=>{
 const state=createInitialState(),id=state.activeTabId;
 const next=open(state,'history');
 assert.equal(next.tabs.length,state.tabs.length);
 assert.equal(next.tabs.find(tab=>tab.id===id)!.url,'acira://history');
});

test('Back on that tab closes it and returns to the website, without a closed-tab card',()=>{
 const {state,id}=playing();
 const opened=open(state,'settings'),settings=opened.tabs.find(tab=>tab.id===opened.activeTabId)!;
 assert.equal(backReturnsToOpener(opened,settings),true);
 const back=reduceBrowser(opened,{type:'tab.history',direction:-1});
 assert.equal(back.activeTabId,id);
 assert.equal(back.tabs.some(tab=>tab.id===settings.id),false);
 assert.equal(back.toast,opened.toast);
 assert.equal(back.tabs.find(tab=>tab.id===id)!.media,'playing');
});

test('Back stays an ordinary step once the tab has its own history, or when its opener is gone',()=>{
 const {state,id}=playing();
 let opened=open(state,'settings');
 opened=reduceBrowser(opened,{type:'tab.navigate',url:'acira://history'});
 const tab=opened.tabs.find(item=>item.id===opened.activeTabId)!;
 assert.equal(backReturnsToOpener(opened,tab),false);
 const back=reduceBrowser(opened,{type:'tab.history',direction:-1});
 assert.equal(back.tabs.find(item=>item.id===tab.id)!.url,'acira://settings');
 const orphan=reduceBrowser(back,{type:'tab.close',id});
 const settings=orphan.tabs.find(item=>item.url==='acira://settings')!;
 assert.equal(backReturnsToOpener(orphan,settings),false);
 assert.equal(appPageOf('acira://new'),null);
 assert.equal(appPageOf('acira://settings'),'settings');
});

test('a website left for an Acira page takes its media card with it',()=>{
 const {state,id}=playing();
 const home=reduceBrowser(state,{type:'tab.navigate',url:'acira://new',tabId:id});
 const tab=home.tabs.find(item=>item.id===id)!;
 assert.equal(tab.media,undefined);
 assert.equal(tab.audible,undefined);
});
