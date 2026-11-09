// "Close other tabs" on a big window (or closing a big group) closes the tabs one by one; the closed list keeps 50, and it cut the batch that was
// still closing: the toast said "50 tabs closed" and Undo brought back 50 of 80. The batch being closed is never cut.
import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const open=(n:number)=>{let s=createInitialState();for(let i=0;i<n;i++)s=run(s,{type:'tab.new',url:`https://site${i}.test/`,background:true});return s;};

test('closing 79 of 80 tabs at once: the toast counts them all and Undo brings every one back, in order',()=>{
 let s=open(79);const before=s.tabs.map(t=>t.url),keep=s.tabs[0].id;
 for(const tab of s.tabs.slice(1))s=run(s,{type:'tab.close',id:tab.id});
 assert.equal(s.tabs.length,1);assert.equal(s.closedTabs.length,79);assert.equal(s.toast?.text,'79 tabs closed');
 s=run(s,s.toast!.action!.command);
 assert.deepEqual(s.tabs.map(t=>t.url),before);assert.equal(s.closedTabs.length,0);assert.ok(s.tabs.some(t=>t.id===keep));
});

test('the cap is still 50 for closes that are not one batch, and the next close trims a big batch back to 50',()=>{
 let s=open(60);
 for(const tab of [...s.tabs].slice(0,55)){s=run(s,{type:'tab.close',id:tab.id});if(s.toast)s.toast.at=Date.now()-5000;}   // far apart: one batch each
 assert.equal(s.closedTabs.length,50);
 let big=open(70);for(const tab of big.tabs.slice(1))big=run(big,{type:'tab.close',id:tab.id});assert.equal(big.closedTabs.length,70);
 big.toast!.at=Date.now()-5000;big=run(big,{type:'tab.new',url:'https://later.test/'});big=run(big,{type:'tab.close',id:big.tabs.at(-1)!.id});
 assert.equal(big.closedTabs.length,50,'a later, separate close brings the list back to 50');
});
