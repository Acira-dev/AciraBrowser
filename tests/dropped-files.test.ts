import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,reduceBrowser,persistedSnapshot} from '../src/runtime/core';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r/g,'');

test('a dropped file becomes a web tab on its file address, next to the current tab, and is selected',()=>{
  let s=createInitialState();const first=s.tabs[0].id;
  s=reduceBrowser(s,{type:'tab.open-file',url:'file:///C:/Users/me/Documents/notes.txt',title:'notes.txt'});
  const tab=s.tabs.find(t=>t.id===s.activeTabId)!;
  assert.equal(tab.id!==first,true);
  assert.equal(tab.url,'file:///C:/Users/me/Documents/notes.txt');
  assert.equal(tab.contentKind,'web');
  assert.equal(tab.title,'notes.txt');
  assert.equal(tab.error,null);
  assert.deepEqual(tab.history,[tab.url]);
  assert.equal(s.tabs.indexOf(tab),1);
});

test('only file addresses make a file tab; anything else is ignored',()=>{
  const s=createInitialState();
  for(const url of ['https://example.com/','javascript:alert(1)','file://server/share/x.txt','data:text/html,x','acira://settings'])
    assert.equal(reduceBrowser(s,{type:'tab.open-file',url}).tabs.length,s.tabs.length,url);
});

test('the renderer cannot ask for a file tab: it is not one of the actions the bridge accepts',()=>{
  const main=read('desktop/main.cjs'),names=main.match(/const actionNames=new Set\(\[[^\]]*\]\)/)?.[0]||'';
  assert.ok(!/tab\.open-file/.test(read('desktop/validation.cjs')),'validation has no tab.open-file case');
  assert.ok(!/tab\.open-file/.test(names));
});

test('which files may be opened, and only by a drop the browser started',()=>{
  const main=read('desktop/main.cjs');
  // the one list of kinds lives in accounts/open-files.cjs (the drop, Open a file, and a file named in a Windows or Linux command line all use it)
  assert.match(main,/const droppedFileKinds=require\('\.\/accounts\/open-files\.cjs'\)\.FILE_KINDS;/);
  const kinds=read('desktop/accounts/open-files.cjs').match(/const FILE_KINDS = new Set\(\[([^\]]*)\]\)/)?.[1]||'';
  for(const kind of ['.pdf','.png','.jpg','.txt','.html','.mp3','.mp4','.webm'])assert.ok(kinds.includes('"'+kind+'"'),kind+' is allowed');
  for(const kind of ['.exe','.bat','.cmd','.ps1','.js','.vbs','.msi','.lnk','.scr','.dll','.jar','.reg','.url'])assert.ok(!kinds.includes('"'+kind+'"'),kind+' is not allowed');
  const open=main.slice(main.indexOf('function openDroppedFile(address)'),main.indexOf('function openDroppedFile(address)')+900);
  assert.match(open,/url\.protocol!=='file:'\|\|url\.hostname\|\|url\.username\|\|url\.password/,'no network shares, no credentials');
  assert.match(open,/realpathSync/);
  assert.match(open,/info\.isFile\(\)/);
  // A page's own navigation (it has an initiator) is refused; a page already showing a file cannot open another.
  assert.match(main,/if\(!event\.initiator&&!wc\.getURL\(\)\.startsWith\('file:'\)\)\{openDroppedFile\(url\);return;\}/);
});

test('a file page cannot read or embed other files',()=>{
  const blocking=read('desktop/content-blocking.cjs');
  assert.match(blocking,/\/\^file:\/i\.test\(details\.url\)&&\['subFrame','xhr','ping','cspReport','webSocket'\]\.includes\(details\.resourceType\)\?\{cancel:true\}/);
});

test('files dropped from private or Tor tabs keep their privacy and never enter saved sessions',()=>{
 for(const privacy of ['private','tor'] as const){
  let s=reduceBrowser(createInitialState(),{type:'tab.new',url:'https://owned.test/',privacy});
  s=reduceBrowser(s,{type:'tab.open-file',url:'file:///tmp/owned-private.txt',title:'Owned private file'});
  const id=s.activeTabId;assert.equal(s.tabs.find(t=>t.id===id)!.privacy,privacy);
  assert(!persistedSnapshot(s).tabs.some(t=>t.id===id));
  s=reduceBrowser(s,{type:'tab.close',id});assert(!s.closedTabs.some(t=>t.id===id));
 }
});
