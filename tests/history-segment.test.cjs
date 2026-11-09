'use strict';
// A tab restored (or reopened) with an Acira page in the middle of its history came back with the earlier website pages in the list twice, and once
// more on every restart: the view was handed the website pages of the whole row, and the merge (nativeHistory) puts the view's list in place of the
// current stretch only. The view is now handed the current stretch.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {currentSegment}=require('../desktop/history-segment.cjs');
const urls=entries=>entries.map(entry=>entry.url);

test('the view is restored with the website pages of the current stretch only',()=>{
 let r=currentSegment(['https://a/','https://b/'],1);assert.deepEqual([urls(r.entries),r.index],[['https://a/','https://b/'],1],'one stretch: everything');
 r=currentSegment(['https://a/','acira://new','https://b/'],2);assert.deepEqual([urls(r.entries),r.index],[['https://b/'],0],'after an Acira page: not the page before it (the phantom copy)');
 r=currentSegment(['https://a/','acira://new','https://b/','https://c/'],3);assert.deepEqual([urls(r.entries),r.index],[['https://b/','https://c/'],1]);
 r=currentSegment(['https://a/','https://b/','acira://settings','https://c/'],1);assert.deepEqual([urls(r.entries),r.index],[['https://a/','https://b/'],1],'the earlier stretch when that is where the tab is');
 r=currentSegment(['acira://new','https://a/','https://b/','acira://history','https://c/'],2);assert.deepEqual([urls(r.entries),r.index],[['https://a/','https://b/'],1]);
 assert.deepEqual(currentSegment(['https://a/','acira://new'],1),{entries:[],index:-1},'an Acira page is not a website entry');
 assert.deepEqual(currentSegment([],0),{entries:[],index:-1});assert.deepEqual(currentSegment(['https://a/'],5),{entries:[],index:-1});assert.deepEqual(currentSegment('x',0),{entries:[],index:-1});
 assert.ok(currentSegment(['https://a/'],0).entries.every(entry=>entry.title===''));
});

test('a restored tab no longer grows its list: merging the view\'s list over the current stretch is stable',()=>{
 // What src/runtime/core.ts nativeHistory does, on the row and the view's list the restore now produces.
 const merge=(row,index,viewList,viewIndex)=>{let start=index,end=index+1;while(start>0&&!row[start-1].startsWith('acira://'))start--;while(end<row.length&&!row[end].startsWith('acira://'))end++;return {row:[...row.slice(0,start),...viewList,...row.slice(end)],index:start+viewIndex};};
 let row=['https://a/','acira://new','https://b/'],index=2;
 for(let restart=0;restart<3;restart++){const seg=currentSegment(row,index);({row,index}=merge(row,index,urls(seg.entries),seg.index));}
 assert.deepEqual([row,index],[['https://a/','acira://new','https://b/'],2],'three restarts, the same list');
});

test('loadPage hands the view the current stretch',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.ok(main.includes("const {entries,index}=require('./history-segment.cjs').currentSegment(tab.history,tab.historyIndex);if(first&&entries.length>1&&index>=0&&entries[index]?.url===tab.url)"));
 assert.equal(main.includes("const entries=tab.history.filter(url=>/^https?:\\/\\//i.test(url))"),false,'not the website pages of the whole row');
});
