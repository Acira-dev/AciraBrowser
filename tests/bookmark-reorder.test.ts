import test from 'node:test';
import assert from 'node:assert/strict';
import type { BookmarkNode } from '../src/runtime/types';
import { createInitialState,reduceBrowser } from '../src/runtime/core';
import { bookmarkPlace,bookmarkStep,displayOrder } from '../src/ui/bookmarkMenu';

// R3-52: drag to reorder in the sidebar, and Move up / Move down. The placements are run through the real reducer.
type State=ReturnType<typeof createInitialState>;
function tree(){
 let state=createInitialState();const profile=state.activeBrowserProfileId;let position=0;
 const make=(id:string,title:string,parentId:string|null,url?:string):BookmarkNode=>({id,browserProfileId:profile,parentId,title,...(url?{url}:{}),position:position++,createdAt:0});
 // Positions are deliberately not in display order: a folder added last has the highest position, as in a real profile.
 state={...state,bookmarkNodes:[make('bar','Bookmarks bar',null),make('b1','One','bar','https://1.example/'),make('b2','Two','bar','https://2.example/'),
  make('l1','Loose A',null,'https://la.example/'),make('l2','Loose B',null,'https://lb.example/'),make('f1','Reading',null),make('r1','Read 1','f1','https://r1.example/'),make('r2','Read 2','f1','https://r2.example/'),make('f2','Archive',null),make('l3','Loose C',null,'https://lc.example/')]};
 return {state,profile};
}
const titles=(state:State,profile:string,parent:string|null)=>displayOrder(state.bookmarkNodes,profile,parent).map(item=>item.title);
const move=(state:State,id:string,place:{parentId:string|null;index:number}|null)=>{assert.ok(place,'the drop can land');return reduceBrowser(state,{type:'bookmark.move',id,parentId:place.parentId,index:place.index});};

test('the root reads Bookmarks bar, then folders, then loose bookmarks, whatever their positions',()=>{
 const {state,profile}=tree();
 assert.deepEqual(titles(state,profile,null),['Bookmarks bar','Reading','Archive','Loose A','Loose B','Loose C']);
});

test('dropping before or after a sibling puts the bookmark there, also inside a folder',()=>{
 let {state,profile}=tree();
 state=move(state,'l3',bookmarkPlace(state.bookmarkNodes,profile,'l3','l1','before'));
 assert.deepEqual(titles(state,profile,null),['Bookmarks bar','Reading','Archive','Loose C','Loose A','Loose B']);
 state=move(state,'l3',bookmarkPlace(state.bookmarkNodes,profile,'l3','l2','after'));
 assert.deepEqual(titles(state,profile,null).slice(3),['Loose A','Loose B','Loose C']);
 state=move(state,'r2',bookmarkPlace(state.bookmarkNodes,profile,'r2','r1','before'));
 assert.deepEqual(titles(state,profile,'f1'),['Read 2','Read 1']);
});

test('dropping into a folder puts the bookmark at its end; out of a folder onto a root bookmark brings it back to the root',()=>{
 let {state,profile}=tree();
 state=move(state,'l1',bookmarkPlace(state.bookmarkNodes,profile,'l1','f1','into'));
 assert.deepEqual(titles(state,profile,'f1'),['Read 1','Read 2','Loose A']);
 assert.deepEqual(titles(state,profile,null),['Bookmarks bar','Reading','Archive','Loose B','Loose C']);
 state=move(state,'r1',bookmarkPlace(state.bookmarkNodes,profile,'r1','l3','before'));
 assert.ok(titles(state,profile,null).includes('Read 1'));
 assert.deepEqual(titles(state,profile,'f1'),['Read 2','Loose A']);
 state=move(state,'l2',bookmarkPlace(state.bookmarkNodes,profile,'l2','bar','into'));
 assert.deepEqual(titles(state,profile,'bar'),['One','Two','Loose B'],'into the Bookmarks bar folder');
});

test('a drop that cannot land is refused: onto itself, into a page, a folder into its own branch, the bar anywhere, across the root order',()=>{
 const {state,profile}=tree(),nodes=state.bookmarkNodes;
 assert.equal(bookmarkPlace(nodes,profile,'l1','l1','before'),null);
 assert.equal(bookmarkPlace(nodes,profile,'l1','l2','into'),null,'a page is not a folder');
 assert.equal(bookmarkPlace(nodes,profile,'f1','r1','before'),null,'a folder before its own page');
 assert.equal(bookmarkPlace(nodes,profile,'bar','f1','after'),null,'the Bookmarks bar stays first');
 assert.equal(bookmarkPlace(nodes,profile,'l1','f1','before'),null,'a bookmark cannot sit above folders at the root');
 assert.equal(bookmarkPlace(nodes,profile,'f2','l1','after'),null,'nor a folder below bookmarks');
 assert.notEqual(bookmarkPlace(nodes,profile,'f2','f1','before'),null,'folders reorder among folders');
 assert.equal(bookmarkPlace(nodes,'another-profile','l1','l2','before'),null);
});

test('Move up and Move down step one place among the siblings as shown, and stop at the ends',()=>{
 let {state,profile}=tree();
 assert.equal(bookmarkStep(state.bookmarkNodes,profile,'l1',-1),null,'the first loose bookmark has no bookmark above it');
 assert.equal(bookmarkStep(state.bookmarkNodes,profile,'l3',1),null,'the last has none below');
 assert.equal(bookmarkStep(state.bookmarkNodes,profile,'bar',1),null,'the Bookmarks bar does not move');
 state=move(state,'l1',bookmarkStep(state.bookmarkNodes,profile,'l1',1));
 assert.deepEqual(titles(state,profile,null).slice(3),['Loose B','Loose A','Loose C']);
 state=move(state,'l3',bookmarkStep(state.bookmarkNodes,profile,'l3',-1));
 assert.deepEqual(titles(state,profile,null).slice(3),['Loose B','Loose C','Loose A']);
 state=move(state,'f2',bookmarkStep(state.bookmarkNodes,profile,'f2',-1));
 assert.deepEqual(titles(state,profile,null).slice(1,3),['Archive','Reading'],'folders step among folders');
 state=move(state,'r1',bookmarkStep(state.bookmarkNodes,profile,'r1',1));
 assert.deepEqual(titles(state,profile,'f1'),['Read 2','Read 1']);
});
