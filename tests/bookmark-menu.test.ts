import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkTarget,branchOf,isBarFolder,pagesIn,sortedByName } from '../src/ui/bookmarkMenu';
import type { BookmarkNode } from '../src/runtime/types';

// The shared bookmark menu (sidebar, bookmarks bar, History, Bookmarks page): what a menu ref points at, and the tree
// operations behind Open all, Sort by name and Delete + Undo.
let at=0;
const node=(id:string,title:string,parentId:string|null,url?:string,profile='p1'):BookmarkNode=>({id,browserProfileId:profile,parentId,title,...(url?{url}:{}),position:at++,createdAt:0});
const nodes=[
 node('bar','Bookmarks bar',null),node('gh','GitHub','bar','https://github.com/'),
 node('work','Work',null),node('n2','notion',  'work','https://notion.so/'),node('n10','10 tasks','work','https://linear.app/'),node('n1','Alpha','work','https://a.example/'),
 node('deep','Deep','work'),node('d1','Deep page','deep','https://deep.example/'),
 node('loose','Example',null,'https://example.com/'),node('other','Other','work','https://github.com/'),
 node('x','Elsewhere',null,'https://x.example/','p2'),
];

test('a menu ref resolves to a page, a bookmark, a folder, the bar, the zone or the new-folder form',()=>{
 assert.deepEqual(bookmarkTarget('node:root',nodes,'p1'),{kind:'root'});
 assert.equal(bookmarkTarget('node:bar',nodes,'p1')?.kind,'folder');
 assert.equal((bookmarkTarget('node:bar',nodes,'p1') as {bar:boolean}).bar,true);
 assert.equal((bookmarkTarget('node:work',nodes,'p1') as {bar:boolean}).bar,false);
 assert.equal(bookmarkTarget('node:gh',nodes,'p1')?.kind,'bookmark');
 assert.equal(bookmarkTarget('https://example.com/',nodes,'p1')?.kind,'bookmark','a URL finds its bookmark');
 assert.deepEqual(bookmarkTarget('https://new.example/',nodes,'p1'),{kind:'page',url:'https://new.example/'});
 assert.deepEqual(bookmarkTarget('node:new:work',nodes,'p1'),{kind:'new',parentId:'work'});
 assert.deepEqual(bookmarkTarget('node:new:root',nodes,'p1'),{kind:'new',parentId:null});
 assert.deepEqual(bookmarkTarget('node:new:gh',nodes,'p1'),{kind:'new',parentId:null},'a page is not a parent');
 assert.equal(bookmarkTarget('node:x',nodes,'p1'),null,'another profile\'s bookmark is not found');
 assert.equal(bookmarkTarget('',nodes,'p1'),null);
 assert.equal(isBarFolder(nodes[0]),true);
});

test('Open all takes every page under a folder once, nested folders included; Delete takes the whole branch',()=>{
 const work=nodes.find(item=>item.id==='work')!;
 assert.deepEqual(pagesIn(work,nodes),['https://notion.so/','https://linear.app/','https://a.example/','https://deep.example/','https://github.com/']);
 assert.deepEqual(branchOf(work,nodes).map(item=>item.id),['work','n2','n10','n1','deep','d1','other']);
});

test('Sort by name: folders first, then pages, A to Z with numbers in order and case ignored',()=>{
 assert.deepEqual(sortedByName('work',nodes,'p1').map(item=>item.title),['Deep','10 tasks','Alpha','notion','Other']);
 assert.deepEqual(sortedByName(null,nodes,'p1').map(item=>item.title),['Bookmarks bar','Work','Example'],'the bar stays first among folders');
});
