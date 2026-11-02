import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);

test('typing a file address on the new tab page keeps the new tab page once the download starts',()=>{
  let s=apply(createInitialState(),{type:'tab.new'});const id=s.activeTabId;
  s=apply(s,{type:'tab.navigate',tabId:id,url:'https://example.com/file.zip'});
  assert.equal(s.tabs.find(t=>t.id===id)?.contentKind,'web');
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,loading:false,downloadOnly:true}});
  const tab=s.tabs.find(t=>t.id===id)!;
  assert.equal(tab.url,'acira://new');
  assert.notEqual(tab.contentKind,'web');
  assert.equal(tab.loading,false);
  assert.deepEqual(tab.history,['acira://new']);
  assert.equal(tab.historyIndex,0);
});

test('a tab opened only for a download closes without an undo toast',()=>{
  let s=apply(createInitialState(),{type:'tab.new',url:'https://example.com/file.zip'});const id=s.activeTabId,before=s.tabs.length,closed=s.closedTabs.length;
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,loading:false,downloadOnly:true}});
  assert.equal(s.tabs.length,before-1);
  assert.ok(s.tabs.some(t=>t.id===s.activeTabId));
  assert.equal(s.closedTabs.length,closed);
  assert.notEqual(s.toast?.text,'Tab closed');
});

test('a download-only event on a page that loaded leaves the tab alone',()=>{
  let s=apply(createInitialState(),{type:'tab.navigate',url:'https://example.com/'});const id=s.activeTabId;
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://example.com/',loading:false}});
  const before=s.tabs.find(t=>t.id===id)!;
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,loading:false,downloadOnly:true}});
  const after=s.tabs.find(t=>t.id===id)!;
  assert.equal(after.url,before.url);assert.equal(after.contentKind,'web');
});

test('main closes the empty view before it moves the tab back or closes it',()=>{
  const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  assert.match(main,/downloadOnly:true/);
  assert.match(main,/!wc\.getURL\(\)/);
});
