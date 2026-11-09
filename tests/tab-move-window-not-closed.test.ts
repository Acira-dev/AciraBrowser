// Move to new window (and dragging a tab out of the strip) hands the tab to another window. The source window used to close it like any
// other tab: a "Tab closed · Undo" toast, a copy in the closed list, so Undo or Cmd+Shift+T made a second copy of a tab that lives on in the
// other window. A handed-over tab is not remembered as closed.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const open=(n:number)=>{let s=createInitialState();for(let i=0;i<n;i++)s=run(s,{type:'tab.new',url:`https://site${i}.test/page`});return s;};

test('a tab handed to another window leaves no closed tab, no Undo toast and nothing for Cmd+Shift+T',()=>{
 let s=open(3);const target=s.tabs[2];
 s=run(s,{type:'tab.close',id:target.id,handedOver:true});
 assert.ok(!s.tabs.some(t=>t.id===target.id));
 assert.equal(s.closedTabs.length,0);assert.equal(s.toast,null);
 const before=s.tabs.map(t=>t.id);s=run(s,{type:'tab.restore'});
 assert.deepEqual(s.tabs.map(t=>t.id),before);
});

test('a handed-over tab still hands the selection on, and an ordinary close still raises Undo',()=>{
 let s=open(3);const a=s.tabs[1],b=s.tabs[2];
 s=run(s,{type:'tab.select',id:b.id},{type:'tab.close',id:b.id,handedOver:true});
 assert.ok(s.tabs.some(t=>t.id===s.activeTabId));assert.notEqual(s.activeTabId,b.id);
 s=run(s,{type:'tab.close',id:a.id});
 assert.equal(s.toast?.text,'Tab closed');assert.equal(s.closedTabs.length,1);
});

test('main hands the tab over with the flag when a tab moves to another window',()=>{
 const main=readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
 const at=main.indexOf("if(action.type==='tab.move-window')");assert.ok(at>0);
 assert.ok(main.slice(at,at+3500).includes("commitAction({type:'tab.close',id:moving.id,handedOver:true})"));
});
