const {test}=require('node:test'),assert=require('node:assert/strict');const {createInitialState,reduceBrowser,persistedSnapshot}=require('../desktop/runtime.cjs');
test('profiles isolate bookmarks and address history, session restore keeps tabs and groups',()=>{let s=createInitialState();s=reduceBrowser(s,{type:'bookmark.toggle',url:'https://example.org/one'});s=reduceBrowser(s,{type:'browser.profile.create',name:'Work'});const id=s.browserProfiles.at(-1).id;s=reduceBrowser(s,{type:'browser.profile.select',id});assert.deepEqual(s.bookmarks,[]);s=reduceBrowser(s,{type:'tab.new',url:'https://example.net/'});s=reduceBrowser(s,{type:'tab.group.create',tabId:s.activeTabId,name:'Research',color:'blue'});const saved=persistedSnapshot(s);assert.equal(saved.tabs.at(-1).url,'https://example.net/');assert.equal(saved.tabGroups[0].name,'Research');assert.equal(saved.bookmarkNodes[0].browserProfileId,'profile-personal');assert.equal(saved.browserProfiles.at(-1).id,id);});
test('closed tab restoration is independent of suspension and empty windows retain a usable tab',()=>{let s=createInitialState();s=reduceBrowser(s,{type:'tab.new',url:'https://example.org'});const tab=s.tabs.at(-1);s=reduceBrowser(s,{type:'tab.close',id:tab.id});assert.equal(s.closedTabs[0].id,tab.id);s=reduceBrowser(s,{type:'tab.restore'});assert.equal(s.activeTabId,tab.id);for(const t of [...s.tabs])s=reduceBrowser(s,{type:'tab.close',id:t.id});assert.equal(s.tabs.length,1);assert.equal(s.tabs[0].url,'acira://new');});
test('renderer cannot dispatch internal website events or removed product actions',()=>{const {validateAction}=require('../desktop/validation.cjs'),s=createInitialState();for(const type of ['run.start','tick','demo.scenario','browser.event'])assert.throws(()=>validateAction({type},s));assert.throws(()=>validateAction({type:'settings.update',patch:{aiEnabled:true}},s));});
const {restoreSnapshot}=require('../desktop/runtime.cjs');
test('legacy layout combinations migrate to one effective choice without losing sidebar intent',()=>{
 for(const automaticCompact of [false,true])for(const pinExpanded of [false,true]){
  const old=createInitialState();delete old.settings.toolbarLayout;Object.assign(old.settings,{automaticCompact,pinExpanded});old.windowUi.workspaceOpen=false;old.windowUi.webWorkspaceOpen=false;
  const restored=restoreSnapshot(old);assert.equal(restored.settings.toolbarLayout,automaticCompact&&!pinExpanded?'automatic':'expanded');assert.equal('automaticCompact' in restored.settings,false);assert.equal('pinExpanded' in restored.settings,false);assert.equal(restored.windowUi.workspaceOpen,pinExpanded);
  const closed=reduceBrowser(restored,{type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});assert.equal(closed.windowUi.workspaceOpen,false);
 }
});
test('custom material settings are bounded at the native boundary and recover safely from invalid storage',()=>{
 const {validateAction,validateLayout}=require('../desktop/validation.cjs'),s=createInitialState();
 for(const value of [39,101,NaN,Infinity,'70'])assert.throws(()=>validateAction({type:'settings.update',patch:{glassOpacity:value}},s));
 for(const value of ['red','#fff','#12345678','url(file:///x)'])assert.throws(()=>validateAction({type:'settings.update',patch:{sidebarColor:value}},s));
 for(const patch of [{glassOpacity:40},{toolbarColor:'#24364f'},{glassOpacity:60,surfaceColor:'#1200ff'},{glassOpacity:88,tabColor:undefined},{toolbarLayout:'automatic'}])assert.doesNotThrow(()=>validateAction({type:'settings.update',patch},s));
 assert.throws(()=>validateAction({type:'settings.update',patch:{pinExpanded:true}},s));
 const restored=restoreSnapshot({...s,settings:{...s.settings,glassOpacity:Infinity,tabColor:'url(x)'}});assert.equal(restored.settings.glassOpacity,64);assert.equal(restored.settings.tabColor,undefined);
});

test('100% opacity and Reduce transparency are one atomic state with a remembered translucent value',()=>{
 let s=createInitialState();const update=patch=>s=reduceBrowser(s,{type:'settings.update',patch});
 update({glassOpacity:73});assert.equal(s.settings.reducedTransparency,false);
 update({glassOpacity:100});assert.equal(s.settings.reducedTransparency,true);assert.equal(s.settings.translucentOpacity,73);
 update({reducedTransparency:false});assert.equal(s.settings.glassOpacity,73);
 update({reducedTransparency:true});assert.equal(s.settings.glassOpacity,100);
 update({glassOpacity:99});assert.equal(s.settings.reducedTransparency,false);assert.equal(s.settings.translucentOpacity,99);
 s=restoreSnapshot(persistedSnapshot(s));assert.equal(s.settings.glassOpacity,99);
 const old=createInitialState();old.settings.glassOpacity=72;old.settings.reducedTransparency=true;delete old.settings.translucentOpacity;const migrated=restoreSnapshot(old);assert.equal(migrated.settings.glassOpacity,100);assert.equal(migrated.settings.translucentOpacity,72);
 update({glassOpacity:64,reducedTransparency:false});assert.equal(s.settings.glassOpacity,64);
});
test('Settings retains the last browsing-page zoom target while Focus stays window-owned',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'http://localhost:3333'});const id=s.activeTabId;
 s=reduceBrowser(s,{type:'tab.new',url:'acira://settings'});assert.equal(s.windowUi.zoomTargetTabId,id);
 s=reduceBrowser(s,{type:'ui.update',patch:{focusMode:true}});assert.equal(s.windowUi.focusMode,true);assert.equal(s.windowUi.zoomTargetTabId,id);
 s=restoreSnapshot(persistedSnapshot(s));assert.equal(s.windowUi.zoomTargetTabId,id);s=reduceBrowser(s,{type:'tab.close',id});assert.equal(s.windowUi.zoomTargetTabId,undefined);
});

test('page cautions belong to the current document and clear on explicit navigation',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://owned.example.test/'});const id=s.activeTabId;
 const risk={kind:'lookalike',title:'Owned page caution',detail:'Owned fixture detail'};
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,risk}});assert.equal(s.tabs.find(t=>t.id===id).risk.kind,'lookalike');
 s=reduceBrowser(s,{type:'tab.navigate',tabId:id,url:'acira://new'});assert.equal(s.tabs.find(t=>t.id===id).risk,undefined);
});
test('page cautions are not saved or trusted on session restore',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://owned.example.test/'});const id=s.activeTabId,risk={kind:'clickfix',title:'Owned caution',detail:'Owned detail'};
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,risk}});s.closedTabs=[{...s.tabs.find(t=>t.id===id),id:'owned-closed'}];
 const saved=persistedSnapshot(s);assert(saved.tabs.every(t=>!t.risk));assert(saved.closedTabs.every(t=>!t.risk));
 const restored=restoreSnapshot(s);assert(restored.tabs.every(t=>!t.risk));assert(restored.closedTabs.every(t=>!t.risk));assert(s.tabs.find(t=>t.id===id).risk,'saving does not remove the live document warning');
});
test('duplicating and reopening a tab require a fresh page caution check',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://owned.example.test/'});const id=s.activeTabId;
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,risk:{kind:'lookalike',title:'Owned caution',detail:'Owned detail'}}});
 const duplicate=reduceBrowser(s,{type:'tab.duplicate',id});assert.equal(duplicate.tabs.find(t=>t.id===duplicate.activeTabId).risk,undefined);
 s=reduceBrowser(s,{type:'tab.close',id});s=reduceBrowser(s,{type:'tab.restore'});assert.equal(s.tabs.find(t=>t.id===id).risk,undefined);
});


test('Back to an internal page clears the departed document caution',()=>{
 let s=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'https://owned.example.test/'});const id=s.activeTabId;
 s=reduceBrowser(s,{type:'browser.event',event:{type:'state',tabId:id,risk:{kind:'lookalike',title:'Owned warning',detail:'Owned fixture detail'}}});
 s=reduceBrowser(s,{type:'tab.history',direction:-1});
 assert.equal(s.tabs.find(t=>t.id===id).url,'acira://new');
 assert.equal(s.tabs.find(t=>t.id===id).risk,undefined);
});


test('the forty-percent glass range also accepts and restores its remembered translucent value',()=>{
 const {validateAction}=require('../desktop/validation.cjs');
 let s=createInitialState();
 assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{glassOpacity:40,translucentOpacity:40}},s));
 const {validateLayout}=require('../desktop/validation.cjs');
 assert.doesNotThrow(()=>validateLayout({views:[],visible:true,materialOpacity:.4},s));
 assert.throws(()=>validateLayout({views:[],visible:true,materialOpacity:.39},s));
 assert.throws(()=>validateAction({type:'settings.update',patch:{translucentOpacity:39}},s));
 s=reduceBrowser(s,{type:'settings.update',patch:{glassOpacity:40}});
 s=reduceBrowser(s,{type:'settings.update',patch:{reducedTransparency:true}});
 s=restoreSnapshot(persistedSnapshot(s));
 s=reduceBrowser(s,{type:'settings.update',patch:{reducedTransparency:false}});
 assert.equal(s.settings.glassOpacity,40);assert.equal(s.settings.translucentOpacity,40);
});

test("the overlay toast Undo names only its own row",()=>{const {validateCommand}=require('../desktop/validation.cjs'),{createInitialState}=require('../desktop/runtime.cjs'),s=createInitialState(),tabId=s.activeTabId;
 assert.doesNotThrow(()=>validateCommand({type:'ui',tabId,action:'toast-dismiss',toastId:3},s));assert.doesNotThrow(()=>validateCommand({type:'ui',tabId,action:'toast-dismiss'},s));
 assert.throws(()=>validateCommand({type:'ui',tabId,action:'open',kind:'menu',toastId:3},s));assert.throws(()=>validateCommand({type:'ui',tabId,action:'toast-dismiss',toastId:-1},s));assert.throws(()=>validateCommand({type:'ui',tabId,action:'toast-dismiss',toastId:'3'},s));
});

test("a link right-click menu with a row shortcut (Preview link, Shift+Click) is a valid layout",()=>{const {validateLayout}=require("../desktop/validation.cjs"),s=createInitialState();
 const layout=items=>({views:[],visible:true,overlay:{id:1,kind:"page-context",tabId:s.activeTabId,bounds:{x:10,y:10,width:260,height:100},context:{items}}});
 assert.doesNotThrow(()=>validateLayout(layout([{id:"link-peek",label:"Preview link",enabled:true,shortcut:"Shift+Click"}]),s));
 assert.throws(()=>validateLayout(layout([{id:"x",label:"X",enabled:true,shortcut:"x".repeat(41)}]),s));assert.throws(()=>validateLayout(layout([{id:"x",label:"X",enabled:true,bogus:1}]),s));
});

// Reducer-produced actions carry a translation id even after the UI resolves their label.
test('localized closed-tab Undo crosses the native overlay boundary',()=>{
 const {validateLayout}=require('../desktop/validation.cjs');let s=createInitialState();s=reduceBrowser(s,{type:'tab.new',url:'https://example.org'});s=reduceBrowser(s,{type:'tab.close',id:s.activeTabId});
 assert.equal(s.toast.action.labelId,'toast.undo');
 const row={id:s.toast.id,text:s.toast.text,action:s.toast.action};
 const layout={views:[],visible:true,overlay:{id:1,kind:'toast',tabId:s.activeTabId,bounds:{x:10,y:10,width:320,height:44},context:{toasts:[row]}}};
 assert.equal(validateLayout(layout,s).overlay.context.toasts[0].action.labelId,'toast.undo');
 for(const labelId of [7,'x'.repeat(121)])assert.throws(()=>validateLayout({...layout,overlay:{...layout.overlay,context:{toasts:[{...row,action:{...row.action,labelId}}]}}},s));
 assert.throws(()=>validateLayout({...layout,overlay:{...layout.overlay,context:{toasts:[{...row,action:{...row.action,bogus:true}}]}}},s));
});

test('setup import Undo accepts bounded translation metadata',()=>{
 const {validateAction}=require('../desktop/validation.cjs'),s=createInitialState();
 const action={type:'toast',text:'Imported 3 bookmarks',action:{label:'Undo',labelId:'toast.undo',command:{type:'import.undo',batchIds:['qa-batch']}}};
 assert.doesNotThrow(()=>validateAction(action,s));
 for(const labelId of [7,'','x'.repeat(121)])assert.throws(()=>validateAction({...action,action:{...action.action,labelId}},s));
 assert.throws(()=>validateAction({...action,action:{...action.action,bogus:true}},s));
});
