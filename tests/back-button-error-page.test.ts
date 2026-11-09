import test from 'node:test';import assert from 'node:assert/strict';
import {webBackDisabled,webForwardDisabled} from '../src/ui/backButton';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction} from '../src/runtime/types';

// A tab whose first page is a website (a link opened in a new tab, a restored tab) and whose next address fails: the failed address never joins the
// page's own history, so the page reports canGoBack=false, yet Back returns to the first page and the error page offers "Go back". The toolbar's Back
// stayed greyed out.
const tab=(over:object)=>({canGoBack:false,history:['https://a.test/'],historyIndex:0,error:null,...over}) as Parameters<typeof webBackDisabled>[0];

test('Back is off on a first page and on a first page that failed, on when something is behind',()=>{
 assert.equal(webBackDisabled(tab({})),true,'a first page');
 assert.equal(webBackDisabled(tab({history:['https://a.test/'],error:'ERR_CONNECTION_REFUSED (-102)'})),true,'the first page itself failed: nothing behind');
 assert.equal(webBackDisabled(tab({canGoBack:true,history:['https://a.test/','https://b.test/'],historyIndex:1})),false,'the page can go back');
 assert.equal(webBackDisabled(tab({history:['acira://new','https://a.test/'],historyIndex:1})),false,'an Acira page behind');
});

test('Back is on from an error page that has an earlier page behind it, though the page itself cannot go back',()=>{
 assert.equal(webBackDisabled(tab({history:['https://a.test/','https://b.test/'],historyIndex:1,error:'ERR_CONNECTION_REFUSED (-102)'})),false);
 assert.equal(webBackDisabled(tab({history:['https://a.test/','https://b.test/'],historyIndex:1,error:null})),true,'a loaded page the page cannot go back from stays off (a redirect it skipped)');
});

test('the state the app really reaches: a tab on page A, then a failed address',()=>{
 let s=createInitialState();
 s=reduceBrowser(s,{type:'tab.new',url:'https://a.test/'});// a link opened in a new tab: its first page is a website
 const id=s.activeTabId,get=()=>s.tabs.find(t=>t.id===id)!;
 // main reports what the page says: it is on A and cannot go back; the failed address shows the error page
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://a.test/',title:'A',loading:false,canGoBack:false,canGoForward:false}} as BrowserAction);
 s=reduceBrowser(s,{type:'tab.navigate',url:'https://b.test/'});
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://b.test/',loading:false,canGoBack:false,canGoForward:false,error:'ERR_CONNECTION_REFUSED (-102)'}} as BrowserAction);
 assert.equal(get().error?.includes('ERR_CONNECTION_REFUSED'),true);assert.equal(get().canGoBack,false);assert.equal(get().historyIndex>0,true);
 assert.equal(webBackDisabled(get()),false);
});

test('Forward is off at the last entry even when the page reports a forward that is the error page on screen',()=>{
 const fwd=(over:object)=>({canGoForward:false,history:['https://a.test/','https://b.test/'],historyIndex:1,error:null,...over}) as Parameters<typeof webForwardDisabled>[0];
 assert.equal(webForwardDisabled(fwd({})),true,'the last entry, nothing ahead');
 assert.equal(webForwardDisabled(fwd({historyIndex:0})),false,'an entry ahead in the list');
 assert.equal(webForwardDisabled(fwd({historyIndex:0,canGoForward:true})),false);
 assert.equal(webForwardDisabled(fwd({canGoForward:true})),false,'the page can go forward from a loaded last entry (unchanged)');
 assert.equal(webForwardDisabled(fwd({canGoForward:true,error:'ERR_CONNECTION_REFUSED (-102)'})),true,'the error page itself is the last entry the page counts as ahead');
});
