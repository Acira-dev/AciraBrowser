'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createTabMru,partnerTab,toggleSplit,splitLink}=require('../desktop/rewind/split-commands.cjs');
const {createShortcutRegistry}=require('../desktop/shortcut-registry.cjs');
const {createNativeCore}=require('../desktop/native-core.cjs');
const {resolveShortcut}=require('../desktop/shortcuts.cjs');
const open=urls=>urls.reduce((s,url)=>reduceBrowser(s,{type:'tab.new',url}),createInitialState());
const host=state=>{const h={state,dispatch:a=>{h.state=reduceBrowser(h.state,a);return h.state;}};return h;};

test('MRU follows activations per window and drops closed tabs',()=>{
 const mru=createTabMru();let s=open(['https://a.test/','https://b.test/','https://c.test/']);
 const [home,a,b]=s.tabs.map(t=>t.id);
 for(const id of [a,b,home]){const next=reduceBrowser(s,{type:'tab.select',id});mru.note('w1',s,next);s=next;}
 assert.deepEqual(mru.order('w1').slice(0,3),[home,b,a]);
 const closed=reduceBrowser(s,{type:'tab.close',id:b});mru.note('w1',s,closed);
 assert.equal(mru.order('w1').includes(b),false);assert.deepEqual(mru.order('w2'),[]);
});

test('split view shortcut pairs the current tab with the most recent other tab, and closes an open split',()=>{
 let s=open(['https://a.test/','https://b.test/','https://c.test/']);const [,a,b,c]=s.tabs.map(t=>t.id);
 s=reduceBrowser(s,{type:'tab.select',id:c});
 assert.equal(partnerTab(s,[c,a,b]),a,'most recent other tab');
 assert.equal(partnerTab(s,[]),b,'no history: neighbour (right, else left)');
 const h=host(s);assert.deepEqual(toggleSplit(h.state,h.dispatch,[c,a]),{split:true,tabIds:[c,a]});
 assert.deepEqual(h.state.windowUi.split.tabIds,[c,a]);
 toggleSplit(h.state,h.dispatch,[c,a]);assert.equal(h.state.windowUi.split,null,'second press closes');
 const lone=host(createInitialState());assert.equal(toggleSplit(lone.state,lone.dispatch,[]).reason,'no-partner');
 assert.equal(lone.state.toast.text,'Open another tab to use split view.');
});

test('Alt+click split opens the link beside its page; unsafe links do nothing',()=>{
 let s=open(['https://a.test/','https://b.test/']);const source=s.tabs[1].id;
 const h=host(s),state=()=>h.state;
 for(const bad of ['javascript:alert(1)','file:///C:/x','https://user:pw@x.test/','not a url',`https://x.test/${'a'.repeat(5000)}`,42])assert.equal(splitLink(source,bad,state,h.dispatch),null);
 assert.equal(h.state,s,'nothing changed');
 const fresh=splitLink(source,'https://docs.test/page?q=1',state,h.dispatch);
 const index=h.state.tabs.findIndex(t=>t.id===source);
 assert.equal(h.state.tabs[index+1].id,fresh);assert.equal(h.state.tabs[index+1].url,'https://docs.test/page?q=1');
 assert.deepEqual(h.state.windowUi.split.tabIds,[source,fresh]);assert.equal(h.state.activeTabId,source);
 assert.equal(splitLink('missing','https://x.test/',state,h.dispatch),null);
});

test('Ctrl+Shift+S is split view by default, Ctrl+S still saves the page',()=>{
 const registry=createShortcutRegistry({platform:'win32'});
 const key=(k,shift)=>registry.resolve({type:'keyDown',control:true,shift,key:k},resolveShortcut,input=>input.key);
 assert.deepEqual(key('s',true),{action:'split-view'});assert.deepEqual(key('s',false),{action:'save-page'});
 assert.equal(registry.list().find(c=>c.id==='split-view').display[0],'Ctrl + Shift + S');
});

test('shortcuts.run executes a registry entry through the window context, refusing unknown and keyboard-only ids',()=>{
 const registry=createShortcutRegistry({platform:'win32'});
 registry.setDynamic('routine:',[{id:'routine:rt-0123456789abcdef',label:'Run routine: Morning',category:'Routines',action:{action:'routine',id:'rt-0123456789abcdef'}}]);
 const core=createNativeCore({shortcutRegistry:registry});const ran=[];const context={runCommand:action=>ran.push(action)};
 assert.deepEqual(core.handle({type:'shortcuts.run',id:'split-view'},context).shortcuts,{ok:true,ran:'split-view'});
 assert.deepEqual(core.handle({type:'shortcuts.run',id:'routine:rt-0123456789abcdef'},context).shortcuts.ran,'routine:rt-0123456789abcdef');
 assert.deepEqual(ran,[{action:'split-view'},{action:'routine',id:'rt-0123456789abcdef'}]);
 assert.equal(core.handle({type:'shortcuts.run',id:'nope'},context).shortcuts.code,'unknown');
 assert.equal(core.handle({type:'shortcuts.run',id:'tab-switcher'},context).shortcuts.code,'keyboard-only');
 assert.equal(core.handle({type:'shortcuts.run',id:'split-view'},{}).shortcuts.code,'unavailable');
 assert.throws(()=>core.handle({type:'shortcuts.run',id:'split-view',extra:1},context));
 ran[0].action='mutated';assert.equal(registry.commands.find(c=>c.id==='split-view').action.action,'split-view','registry action not shared');
});

test('layout shortcuts open or reshape the split with recent tabs; pane shortcuts focus, swap, close and exit',()=>{
 const {useLayout,paneCommand,runSplitCommand}=require('../desktop/rewind/split-commands.cjs');
 let s=open(['https://a.test/','https://b.test/','https://c.test/','https://d.test/']);const [home,a,b,c,d]=s.tabs.map(t=>t.id);
 s=reduceBrowser(s,{type:'tab.select',id:a});const h=host(s);
 assert.equal(useLayout(h.state,h.dispatch,[a,c,b],'three-columns').ok,true);
 assert.deepEqual([h.state.windowUi.split.tabIds,h.state.windowUi.split.layout],[[a,c,b],'three-columns'],'current tab first, then the most recent');
 useLayout(h.state,h.dispatch,[a,c,b,d],'grid');assert.deepEqual([h.state.windowUi.split.tabIds.length,h.state.windowUi.split.layout],[4,'grid'],'growing adds a recent tab');
 useLayout(h.state,h.dispatch,[],'rows');assert.deepEqual([h.state.windowUi.split.tabIds,h.state.windowUi.split.layout],[[a,c],'rows'],'shrinking lets the last panes go, never the current tab');
 useLayout(h.state,h.dispatch,[],'columns');assert.equal(h.state.windowUi.split.layout,'columns','same count: just the layout');
 // Pane commands.
 runSplitCommand({action:'split-focus',direction:1},h.state,h.dispatch);assert.equal(h.state.activeTabId,c);
 runSplitCommand({action:'split-focus',direction:1},h.state,h.dispatch);assert.equal(h.state.activeTabId,a,'wraps around');
 runSplitCommand({action:'split-focus',direction:-1},h.state,h.dispatch);assert.equal(h.state.activeTabId,c);
 runSplitCommand({action:'split-swap'},h.state,h.dispatch);assert.deepEqual(h.state.windowUi.split.tabIds,[c,a],'the current pane swaps with the next');
 runSplitCommand({action:'split-close-pane'},h.state,h.dispatch);assert.equal(h.state.windowUi.split,null,'closing one of two panes ends the split');
 assert.ok(h.state.tabs.some(t=>t.id===c),'the tab of a closed pane stays open');
 assert.equal(paneCommand(h.state,h.dispatch,{action:'split-exit'}).ok,false,'pane commands do nothing outside a split');
 useLayout(h.state,h.dispatch,[],'grid');runSplitCommand({action:'split-exit'},h.state,h.dispatch);assert.equal(h.state.windowUi.split,null);
 // Not enough tabs: a plain notice, nothing opens.
 const few=host(reduceBrowser(open(['https://x.test/']),{type:'tab.select',id:open(['https://x.test/']).tabs[1].id}));
 assert.equal(useLayout(few.state,few.dispatch,[],'grid').reason,'not-enough-tabs');assert.match(few.state.toast.text,/Open 2 more tabs for this layout/);
 assert.equal(useLayout(few.state,few.dispatch,[],'nonsense').ok,false);
});

test('every split shortcut has a valid, unclashing default the user can change',()=>{
 const reg=createShortcutRegistry({file:require('node:path').join(require('node:os').tmpdir(),`acira-split-keys-${Date.now()}.json`),platform:'win32'});
 const split=reg.list().filter(c=>c.category==='Split view');
 assert.deepEqual(split.map(c=>c.id),['split-view','split-layout-columns','split-layout-rows','split-layout-three-columns','split-layout-top-two-bottom-one','split-layout-left-one-right-two','split-layout-grid','split-focus-next','split-focus-prev','split-swap','split-close-pane','split-exit']);
 const all=new Map();for(const c of reg.list())for(const key of c.defaults||[]){assert.equal(all.has(key),false,`${key} is a default of both ${all.get(key)} and ${c.id}`);all.set(key,c.id);}
 for(const c of split){assert.equal(c.defaults.length,1,c.id);const probe=reg.describe(c.defaults[0].replace('Mod','Ctrl'),c.id);assert.equal(probe.valid,true,`${c.id}: ${probe.reason}`);assert.equal(probe.conflict,null,c.id);}
 // The user can rebind one; taking another's key asks first.
 const taken=reg.set('split-exit','Ctrl+Shift+S');assert.equal(taken.code,'conflict');assert.match(taken.message,/Split view/);
assert.equal(reg.set('split-exit','Ctrl+Shift+F9').ok,true,'a free key is taken at once');
});

test('the stock resolver answers the split keys (and leaves Ctrl+F4, Ctrl+0 and plain F6 as they were)',()=>{
 const {resolveDefaultShortcut}=require('../desktop/shortcuts.cjs');
 const k=(key,code,mods={})=>resolveDefaultShortcut({type:'keyDown',key,code,...mods},'win32');
 const layouts=['columns','rows','three-columns','top-two-bottom-one','left-one-right-two','grid'];
 for(let i=1;i<=6;i++)assert.deepEqual(k(String(i),`Digit${i}`,{control:true,shift:true}),{action:'split-layout',layout:layouts[i-1]});
 assert.deepEqual(k(')','Digit0',{control:true,shift:true}),{action:'split-exit'},'Shift turns 0 into ) on US keyboards; the physical key counts');
 assert.deepEqual(k('F6','F6',{control:true}),{action:'split-focus',direction:1});
 assert.deepEqual(k('F6','F6',{control:true,shift:true}),{action:'split-focus',direction:-1});
 assert.deepEqual(k('F6','F6',{control:true,alt:true}),{action:'split-swap'});
 assert.deepEqual(k('F4','F4',{control:true,shift:true}),{action:'split-close-pane'});
 assert.deepEqual(k('F4','F4',{control:true}),{action:'close-tab'});assert.deepEqual(k('0','Digit0',{control:true}),{action:'zoom',change:0});
 assert.deepEqual(k('F6','F6'),{action:'address'});assert.deepEqual(k('1','Digit1',{control:true}),{action:'select-tab',index:0});
 // Every registry default of a split command resolves to that command's action.
 const reg=createShortcutRegistry({file:require('node:path').join(require('node:os').tmpdir(),`acira-split-res-${Date.now()}.json`),platform:'win32'});
 const toInput=accel=>{const parts=accel.replace('Mod','Ctrl').split('+'),key=parts.at(-1);return {type:'keyDown',key,code:/^\d$/.test(key)?`Digit${key}`:key,control:parts.includes('Ctrl'),shift:parts.includes('Shift'),alt:parts.includes('Alt')};};
 for(const c of reg.list().filter(c=>c.category==='Split view'))assert.deepEqual(resolveDefaultShortcut(toInput(c.defaults[0]),'win32'),reg.commands.find(x=>x.id===c.id).action,c.id);
});
