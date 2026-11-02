import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,openedFile,persistedSnapshot,reduceBrowser,resolveNavigation,restoreSnapshot} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

// Stability hunt #6 (2 Nov 2026): a local file opened in a tab (Open File, a drop, the Dock, Open With) was saved with the window but
// dropped at the next start, because restoreSnapshot kept only addresses resolveNavigation accepts and that refuses file:. It now comes
// back, as in Chrome; main still loads it as before, so a file that is gone shows the page error.
const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const HTML='file:///Users/me/Documents/notes%20page.html',PDF='file:///Users/me/Documents/report.pdf';
const withFiles=()=>apply(createInitialState(),{type:'tab.navigate',url:'https://example.com/'},{type:'tab.open-file',url:HTML,title:'notes page.html'},{type:'tab.open-file',url:PDF,title:'report.pdf'});
const restart=(s:BrowserSnapshot)=>restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));

test('a file opened in a tab comes back after a restart, with its name, as a page, and still the tab on screen',()=>{
  const before=withFiles();assert.equal(before.tabs.find(t=>t.id===before.activeTabId)!.url,PDF);
  const after=restart(before);
  assert.deepEqual(after.tabs.map(t=>t.url),['https://example.com/',HTML,PDF]);
  const pdf=after.tabs.find(t=>t.url===PDF)!;
  assert.equal(after.activeTabId,pdf.id,'the PDF was on screen and still is');
  assert.equal(pdf.contentKind,'web');assert.equal(pdf.error,null);assert.equal(pdf.title,'report.pdf');assert.equal(pdf.loading,false);
  assert.deepEqual(pdf.history,[PDF]);
});

test('a typed file address is still refused; only a file Acira opened comes back',()=>{
  assert.ok(resolveNavigation('file:///etc/hosts').error,'typing a file address stays refused');
  assert.equal(openedFile(HTML),true);assert.equal(openedFile('file:///'),false,'the root is not a file');
  for(const url of ['file://server/share/a.pdf','file://user@/x.html','FILE:relative.html','javascript:alert(1)','data:text/html,x','about:blank',7,null])
    assert.equal(openedFile(url),false,String(url));
  const s=withFiles(),saved=JSON.parse(JSON.stringify(persistedSnapshot(s)));
  saved.tabs.push({...saved.tabs[1],id:'tab-share',url:'file://server/share/a.pdf'},{...saved.tabs[1],id:'tab-js',url:'javascript:alert(1)'});
  assert.deepEqual(restoreSnapshot(saved).tabs.map(t=>t.id).filter(id=>id==='tab-share'||id==='tab-js'),[],'never another host, never a script address');
});

test('private and Tor file tabs never persist, even in a hand-edited save',()=>{
  let s=apply(createInitialState(),{type:'tab.new',privacy:'private'});
  s=apply(s,{type:'tab.open-file',url:HTML,title:'notes page.html'});
  const fileTab=s.tabs.find(t=>t.url===HTML)!;assert.equal(fileTab.privacy,'private','a file opened over a private tab is private');
  const saved=JSON.parse(JSON.stringify(persistedSnapshot(s)));
  assert.equal(saved.tabs.some((t:{url:string})=>t.url===HTML),false,'not written');
  saved.tabs.push({...fileTab,id:'tab-tor',privacy:'tor'});
  assert.equal(restoreSnapshot(saved).tabs.some(t=>t.url===HTML),false,'not read back');
});
