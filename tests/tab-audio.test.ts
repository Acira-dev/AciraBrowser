import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';

const apply=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
// A loaded page (no navigation pending), the state a playing site is in when it starts making sound.
const webTab=()=>{let s=apply(createInitialState(),{type:'tab.navigate',url:'https://example.com/'});const id=s.activeTabId;s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,url:'https://example.com/',title:'Example',loading:false}});s.tabs.find(t=>t.id===id)!.requestedUrl=undefined;return {s,id};};

test('a tab playing sound shows it, and muting sticks until you unmute',()=>{
  let {s,id}=webTab();
  s=apply(s,{type:'browser.event',event:{type:'state',tabId:id,audible:true}});
  assert.equal(s.tabs.find(t=>t.id===id)?.audible,true);
  s=apply(s,{type:'tab.mute',id,muted:true});
  assert.equal(s.tabs.find(t=>t.id===id)?.muted,true);
  s=apply(s,{type:'tab.mute',id,muted:false});
  assert.equal(s.tabs.find(t=>t.id===id)?.muted,false);
});

test('muting crosses the desktop bridge',()=>{
  const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8'),validation=readFileSync(new URL('../desktop/validation.cjs',import.meta.url),'utf8');
  assert.match(main,/'tab\.mute'/);assert.match(validation,/case 'tab\.mute'/);assert.match(main,/setAudioMuted/);assert.match(main,/audio-state-changed/);
});

test('a new tab can open right next to the tab you chose',()=>{
  let s=createInitialState();const first=s.tabs[0].id;
  s=apply(s,{type:'tab.new',afterId:first});
  assert.equal(s.tabs[1].id,s.activeTabId);
});
