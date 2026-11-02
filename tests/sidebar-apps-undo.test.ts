import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addSidebarApp,noteReleasedTab,readSidebarApps,removeSidebarAppWithUndo,restoreSidebarApp } from '../src/ui/sidebarApps';

// Edit favorite (Round 2, A): removing a favorite shows the shared Undo toast; Undo puts it back where it was.
const store=new Map<string,string>();
Object.assign(globalThis,{
 localStorage:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,String(value));},removeItem:(key:string)=>{store.delete(key);}},
 window:{dispatchEvent:()=>true,addEventListener:()=>{},removeEventListener:()=>{}},
});
const seed=(profile:string)=>store.set('acira-sidebar-apps:'+profile,JSON.stringify({seeded:true,hidden:false,apps:[{id:'a',url:'https://a.example/',title:'A'},{id:'b',url:'https://b.example/',title:'B'},{id:'c',url:'https://c.example/',title:'C'}]}));
const titles=(profile:string,privateMode=false)=>readSidebarApps(profile,privateMode).apps.map(app=>app.title);

test('remove returns an Undo toast whose token restores the favorite at its place, once',()=>{
 seed('p1');
 const toast=removeSidebarAppWithUndo('p1',false,'b');
 assert.ok(toast&&toast.type==='toast');
 assert.equal(toast.text,'B removed from Favorites');
 const command=toast.action?.command;
 assert.ok(command&&command.type==='favorite.restore');
 assert.match(command.token,/^f[a-z0-9]{4,24}$/,'the token passes main\'s toast validation');
 assert.deepEqual(titles('p1'),['A','C']);
 assert.equal(restoreSidebarApp(command.token),true);
 assert.deepEqual(titles('p1'),['A','B','C']);
 assert.equal(restoreSidebarApp(command.token),false,'a spent token does nothing');
 assert.deepEqual(titles('p1'),['A','B','C']);
});

test('Undo does not duplicate a favorite that was added again meanwhile',()=>{
 seed('p2');
 const toast=removeSidebarAppWithUndo('p2',false,'a');
 assert.ok(toast&&toast.type==='toast');
 const command=toast.action?.command;
 assert.ok(command&&command.type==='favorite.restore');
 store.set('acira-sidebar-apps:p2',JSON.stringify({seeded:true,hidden:false,apps:[{id:'b',url:'https://b.example/',title:'B'},{id:'c',url:'https://c.example/',title:'C'},{id:'z',url:'https://a.example/',title:'A again'}]}));
 assert.equal(restoreSidebarApp(command.token),true);
 assert.deepEqual(titles('p2'),['B','C','A again']);
});

test('a private window removes without Undo and never writes the favorite to storage',()=>{
 const added=addSidebarApp('p3',true,{url:'https://private.example/',title:'Secret'});
 assert.ok(typeof added!=='string');
 const before=store.get('acira-sidebar-apps-undo');
 const toast=removeSidebarAppWithUndo('p3',true,added.id);
 assert.ok(toast&&toast.type==='toast');
 assert.equal(toast.text,'Secret removed from Favorites');
 assert.equal(toast.action,undefined,'no Undo in a private window');
 assert.deepEqual(titles('p3',true),[]);
 assert.equal(store.get('acira-sidebar-apps-undo'),before);
 assert.ok(![...store.values()].some(value=>value.includes('private.example')),'nothing private reached storage');
});

test('removing an unknown favorite does nothing',()=>{
 seed('p4');
 assert.equal(removeSidebarAppWithUndo('p4',false,'nope'),null);
 assert.deepEqual(titles('p4'),['A','B','C']);
});

test('Undo brings the favorite back with the live tab it handed to the tab list, from any view (the note is on the Undo entry)',()=>{
 seed('p5');
 const toast=removeSidebarAppWithUndo('p5',false,'b');
 const command=toast?.type==='toast'?toast.action?.command:undefined;
 assert.ok(command&&command.type==='favorite.restore');
 noteReleasedTab('b','tab-live');// what the sidebar does when it hands the tab back
 noteReleasedTab('b','tab-live');
 assert.match(store.get('acira-sidebar-apps-undo')??'',/"tabIds":\["tab-live"\]/,'kept in storage, so the overlay\'s toast can read it');
 const restored:[string,string[]][]=[];
 assert.equal(restoreSidebarApp(command.token,(id,tabs)=>restored.push([id,tabs])),true);
 assert.deepEqual(restored,[['b',['tab-live']]]);
 noteReleasedTab('zz','tab-x');// no Undo entry: nothing to note
 const client=readFileSync(new URL('../src/runtime/client.ts',import.meta.url),'utf8');
 assert.match(client,/restoreSidebarApp\(action\.token,\(appId,tabIds\)=>\{const tab=latest\.current\.tabs\.find\(tab=>tabIds\.includes\(tab\.id\)&&!tab\.favoriteId\);if\(tab\)dispatch\(\{type:'tab\.favorite',id:tab\.id,favoriteId:appId\}\)/);
});
