import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {UNDO_BATCH_MS} from '../src/runtime/undoClose';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const open=(n:number)=>{let s=createInitialState();for(let i=0;i<n;i++)s=run(s,{type:'tab.new',url:`https://site${i}.test/page?q=${i}`});return s;};
const urls=(s:BrowserSnapshot)=>s.tabs.map(t=>t.url);

test('closing a tab raises "Tab closed · Undo" and Undo puts it back where it was, active again',()=>{
 let s=open(3);const before=urls(s),target=s.tabs[2];s=run(s,{type:'tab.select',id:target.id},{type:'tab.close',id:target.id});
 assert.equal(s.toast?.text,'Tab closed');assert.equal(s.toast?.action?.label,'Undo');
 const command=s.toast!.action!.command;assert.equal(command.type,'tab.restore.batch');
 s=run(s,command);assert.deepEqual(urls(s),before);assert.equal(s.activeTabId,target.id);assert.equal(s.toast,null);
 assert.equal(s.closedTabs.length,0);
});

test('a background close restores without stealing focus and keeps history',()=>{
 let s=open(3);const active=s.activeTabId,target=s.tabs[1];
 s=run(s,{type:'tab.navigate',tabId:target.id,url:'https://other.test/'});
 const history=s.tabs.find(t=>t.id===target.id)!.history;
 s=run(s,{type:'tab.close',id:target.id});s=run(s,s.toast!.action!.command);
 assert.equal(s.activeTabId,active);assert.deepEqual(s.tabs.find(t=>t.id===target.id)!.history,history);
});

test('closing a whole group is one batch: one toast, one Undo, order and group restored',()=>{
 let s=open(5);const members=[s.tabs[2].id,s.tabs[3].id,s.tabs[4].id];
 s=run(s,{type:'tab.group.create',tabId:members[0],name:'Research',color:'blue'});
 const group=s.tabGroups[0];s=run(s,{type:'tab.group.assign',tabIds:members,groupId:group.id});
 const before=urls(s);for(const id of members)s=run(s,{type:'tab.close',id});
 assert.equal(s.toast?.text,'Group “Research” closed');
 s=run(s,s.toast!.action!.command);assert.deepEqual(urls(s),before);
 const restored=s.tabs.filter(t=>members.includes(t.id));assert.ok(restored.every(t=>t.group==='Research'));
 assert.equal(s.tabGroups.find(g=>g.name==='Research')?.color,'blue');
});

test('closes far apart are separate batches; Undo of the latest leaves the earlier one closed',()=>{
 let s=open(3);const [a,b]=[s.tabs[1].id,s.tabs[2].id];
 s=run(s,{type:'tab.close',id:a});s.toast!.at=Date.now()-UNDO_BATCH_MS-10;
 s=run(s,{type:'tab.close',id:b});assert.equal(s.toast?.text,'Tab closed');
 s=run(s,s.toast!.action!.command);assert.ok(s.tabs.some(t=>t.id===b));assert.ok(!s.tabs.some(t=>t.id===a));
 assert.equal(s.closedTabs[0].id,a);
});

test('a quick run of closes counts up in one toast',()=>{
 let s=open(4);for(const id of [s.tabs[1].id,s.tabs[2].id])s=run(s,{type:'tab.close',id});
 assert.equal(s.toast?.text,'2 tabs closed');
});

test('a stale Undo (already restored) changes nothing',()=>{
 let s=open(2);s=run(s,{type:'tab.close',id:s.tabs[1].id});const command=s.toast!.action!.command;
 s=run(s,command);const again=run(s,command);assert.equal(again,s);
});

test('private tabs raise no undo toast and keep nothing',()=>{
 let s=createInitialState();s.browserProfiles[0].private=true;s=run(s,{type:'tab.new',url:'https://private.test/'});
 s=run(s,{type:'tab.close',id:s.tabs[1].id});assert.equal(s.toast?.action,undefined);assert.equal(s.closedTabs.length,0);
});

test('Ctrl+Shift+T (tab.restore) reopens a closed group one tab at a time, newest first; the Undo toast still brings the rest back whole',()=>{
 let s=open(4);const members=[s.tabs[2].id,s.tabs[3].id];
 s=run(s,{type:'tab.group.create',tabId:members[0],name:'Docs',color:'green'},{type:'tab.group.assign',tabIds:members,groupId:'x'} as BrowserAction);
 s=run(s,{type:'tab.group.assign',tabIds:members,groupId:s.tabGroups[0].id});const before=urls(s);
 for(const id of members)s=run(s,{type:'tab.close',id});
 const batch=s.closedTabs[0].closedBatch!;
 s=run(s,{type:'tab.restore'});
 assert.ok(s.tabs.some(t=>t.id===members[1])&&!s.tabs.some(t=>t.id===members[0]),'only the last tab closed is back');assert.equal(s.activeTabId,members[1]);assert.equal(s.closedTabs.length,1);
 assert.equal(s.toast?.text,'Tab closed','the toast follows what is still closed');assert.deepEqual(s.toast?.action?.command,{type:'tab.restore.batch',id:batch});
 s=run(s,{type:'tab.restore.batch',id:batch});
 assert.deepEqual(urls(s),before);assert.equal(s.closedTabs.length,0);assert.equal(s.toast,null);
 let both=open(4);const ids=[both.tabs[2].id,both.tabs[3].id];for(const id of ids)both=run(both,{type:'tab.close',id});
 both=run(both,{type:'tab.restore'},{type:'tab.restore'});assert.equal(both.closedTabs.length,0);assert.equal(both.toast,null,'nothing left to undo');
});
