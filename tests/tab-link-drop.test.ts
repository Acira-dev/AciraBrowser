import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linkDropAction,linkDropZone} from '../src/ui/useLinkDrop';

// Enough of Element for closest(): a chain of nodes, each matching the selectors it lists.
const node=(matches:string[],parent:any=null,data:Record<string,string>={}):any=>({dataset:data,parentElement:parent,matches:(s:string)=>s.split(',').some(part=>matches.includes(part.trim())),closest(s:string){let n:any=this;while(n){if(n.matches(s))return n;n=n.parentElement;}return null;}});

test('drops count on the tab strip and the sidebar tab list, not on favourites, fields or the page',()=>{
  const strip=node(['.tab-strip-container']),tab=node(['[data-tab-id]'],node(['[role=tablist]'],strip),{tabId:'tab-2'});
  assert.deepEqual(linkDropZone(tab),{tabId:'tab-2'});
  assert.deepEqual(linkDropZone(node([],strip)),{});
  const list=node(['.sb-tabs']);assert.deepEqual(linkDropZone(node(['[data-tab-id]'],list,{tabId:'tab-9'})),{tabId:'tab-9'});
  assert.deepEqual(linkDropZone(node([],list)),{});
  const sections=node(['.sb-scroll']);assert.deepEqual(linkDropZone(node([],sections)),{},'empty space under the tab list opens a new tab');
  assert.equal(linkDropZone(node([],node(['.sb-apps'],sections))),null,'favourites keep their own drops');
  assert.equal(linkDropZone(node([],node(['.sb-apps'],node(['.acira-sidebar'])))),null);
  assert.equal(linkDropZone(node(['input'],strip)),null);
  assert.equal(linkDropZone(node(['.page'])),null);
  assert.equal(linkDropZone(null),null);
});

test('on a tab the link replaces that tab; anywhere else it opens next to the current tab',()=>{
  assert.deepEqual(linkDropAction({tabId:'tab-2'},'https://example.com/','tab-1'),{type:'tab.navigate',tabId:'tab-2',url:'https://example.com/'});
  assert.deepEqual(linkDropAction({},'https://example.com/','tab-1'),{type:'tab.new',url:'https://example.com/',afterId:'tab-1'});
});

test('the hook is mounted by the browser view',()=>{
  assert.match(readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),/import \{ ?useLinkDrop ?\} from '\.\/ui\/useLinkDrop'|import \{useLinkDrop\} from '\.\/ui\/useLinkDrop'/);
});
