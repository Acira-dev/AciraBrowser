// A split pane that was closed comes back with Reopen closed tab (Cmd+Shift+T) or Undo into its split. If its partner moved to another workspace in the
// meantime (Move to workspace, "New workspace with this tab"), the pane used to rejoin it anyway: one split across two workspaces. The open workspace's
// interface cannot show a split with a pane in another workspace, so the page area showed one page full width while main still held the other pane
// "on screen" (kept awake, never put to sleep). A split never spans workspaces: the tab comes back on its own.
import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser,workspaceIdOf} from '../src/runtime/core';
import type {BrowserAction,BrowserSnapshot} from '../src/runtime/types';
const run=(s:BrowserSnapshot,...actions:BrowserAction[])=>actions.reduce(reduceBrowser,s);
const scenario=()=>{
 let s=run(createInitialState(),{type:'tab.new',url:'https://a.test/'});
 const [home,partner]=[s.tabs[0].id,s.tabs[1].id];
 s=run(s,{type:'split.open',tabIds:[partner,home],layout:'columns'});
 assert.ok(s.windowUi.split);
 return {s,home,partner};
};
const spans=(s:BrowserSnapshot)=>[s.windowUi.split?.tabIds,...(s.windowUi.splitGroups??[]).map(g=>g.tabIds)].filter(Boolean).some(ids=>new Set(ids!.map(id=>workspaceIdOf(s,s.tabs.find(t=>t.id===id)!))).size>1);

test('Reopen closed tab does not put a split pane back beside a partner that is in another workspace',()=>{
 let {s,home,partner}=scenario();
 s=run(s,{type:'tab.close',id:home},{type:'workspace.create',name:'Two',tabs:'current'});
 assert.ok(s.workspaces!.length===2&&s.tabs.find(t=>t.id===partner)?.workspaceId===s.workspaces![1].id,'the partner went along to the new workspace');
 s=run(s,{type:'tab.restore'});
 assert.ok(s.tabs.some(t=>t.id===home),'the tab itself is back');
 assert.equal(spans(s),false,'no split across workspaces');
 assert.equal(s.windowUi.split,null);assert.deepEqual(s.windowUi.splitGroups??[],[]);
});

test('Undo of the close does the same',()=>{
 let {s,home,partner}=scenario();
 s=run(s,{type:'tab.close',id:home});const undo=s.toast!.action!.command;
 s=run(s,{type:'workspace.create',name:'Two',tabs:'current'});
 s=run(s,{type:'tab.restore.batch',id:(undo as {id:string}).id});
 assert.ok(s.tabs.some(t=>t.id===home));assert.equal(spans(s),false);
});

test('in the same workspace the pane still rejoins its split',()=>{
 let {s,home,partner}=scenario();
 s=run(s,{type:'tab.close',id:home});
 s=run(s,{type:'tab.restore'});
 assert.ok(s.windowUi.split);assert.deepEqual([...s.windowUi.split!.tabIds].sort(),[home,partner].sort());
});
