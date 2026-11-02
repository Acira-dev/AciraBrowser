import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,reduceBrowser,persistedSnapshot,restoreSnapshot} from '../src/runtime/core';
import {bookmarkControl} from '../src/ui/bookmarkControl';

test('internal and private stars explain unavailable state without saving',()=>{
 let state=createInitialState();
 let tab=state.tabs.find(item=>item.id===state.activeTabId)!;
 assert.deepEqual(bookmarkControl(state,tab),{available:false,reason:'internal',saved:false,tor:false});
 const count=state.bookmarkNodes.length;
 state=reduceBrowser(state,{type:'bookmark.toggle',url:tab.url});
 assert.equal(state.bookmarkNodes.length,count);
 tab={...tab,url:'https://fixture.example/',contentKind:'web',privacy:'private'};
 assert.deepEqual(bookmarkControl(state,tab),{available:false,reason:'private',saved:false,tor:false});
});

test('a Tor tab saves a Tor bookmark, apart from the ordinary bookmark of the same page',()=>{
 let state=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'https://fixture.example/onion'});
 const ordinary=state.tabs.find(item=>item.id===state.activeTabId)!;
 state=reduceBrowser(state,{type:'bookmark.toggle',url:ordinary.url});
 state={...state,tabs:state.tabs.map(item=>item.id===ordinary.id?{...item,privacy:'tor' as const}:item)};
 const tor=state.tabs.find(item=>item.id===state.activeTabId)!;
 assert.deepEqual(bookmarkControl(state,tor),{available:true,reason:null,saved:false,tor:true});
 state=reduceBrowser(state,{type:'bookmark.toggle',url:tor.url});
 assert.equal(bookmarkControl(state,tor).saved,true);
 assert.deepEqual(state.bookmarkNodes.filter(node=>node.url===tor.url).map(node=>!!node.tor).sort(),[false,true]);
 assert.deepEqual(state.bookmarks,[tor.url],'the ordinary list holds the page once, from its ordinary bookmark');
 state=restoreSnapshot(persistedSnapshot(state));
 assert.ok(state.bookmarkNodes.some(node=>node.url===tor.url&&node.tor),'the Tor flag is saved');
 state={...state,tabs:state.tabs.map(item=>item.id===tor.id?{...item,privacy:'tor' as const}:item)};
 state=reduceBrowser(state,{type:'bookmark.toggle',url:tor.url});
 assert.deepEqual(state.bookmarkNodes.filter(node=>node.url===tor.url).map(node=>!!node.tor),[false],'removing from the Tor tab leaves the ordinary bookmark');
});

test('website selected state follows persisted profile bookmark, edits and removal',()=>{
 let state=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'https://fixture.example/saved'});
 let tab=state.tabs.find(item=>item.id===state.activeTabId)!;
 assert.equal(bookmarkControl(state,tab).saved,false);
 state=reduceBrowser(state,{type:'bookmark.toggle',url:tab.url});
 assert.equal(bookmarkControl(state,tab).saved,true);
 const bookmark=state.bookmarkNodes.find(item=>item.url===tab.url)!;
 state=reduceBrowser(state,{type:'bookmark.rename',id:bookmark.id,title:'Saved fixture'});
 state=restoreSnapshot(persistedSnapshot(state));
 tab=state.tabs.find(item=>item.id===state.activeTabId)!;
 assert.equal(bookmarkControl(state,tab).saved,true);
 assert.equal(state.bookmarkNodes.find(item=>item.id===bookmark.id)?.title,'Saved fixture');
 assert.equal(bookmarkControl(state,{...tab,browserProfileId:'another-profile'}).saved,false);
 state=reduceBrowser(state,{type:'bookmark.toggle',url:tab.url});
 assert.equal(bookmarkControl(state,tab).saved,false);
});
