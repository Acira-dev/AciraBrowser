const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BrowserDatabase}=require('../desktop/database.cjs'),{createImporter}=require('../desktop/imports.cjs'),{exportAciraData}=require('../desktop/browser-services/bookmark-exchange.cjs'),{createInitialState}=require('../desktop/runtime.cjs');

// Settings > Import & export could export a profile as JSON but not bring it back: the file chooser took HTML only, and a JSON file
// forced through it imported 0 bookmarks. Acira's own export now imports through the same chooser, merge and Undo.
const P='profile-personal';
const node=(id,title,parentId,url,position=0)=>({id,browserProfileId:P,parentId,title,...(url?{url}:{}),position,createdAt:1});
function exported(){
 const state=createInitialState();
 state.bookmarkNodes=[node('bar','Bookmarks bar',null),node('gh','GitHub','bar','https://github.com/',0),node('read','Reading','bar',undefined,1),node('post','A post','read','https://blog.example.org/post'),
  node('other','Other bookmarks',null,undefined,1),node('loose','Loose page',null,'https://loose.example.com/',2),node('bad','Script','other','javascript:alert(1)')];
 state.browsingHistory=[{id:'v1',browserProfileId:P,profileId:'',url:'https://github.com/',title:'GitHub',time:'2026-11-01T10:00:00.000Z'},{id:'v2',browserProfileId:P,profileId:'',url:'file:///etc/hosts',title:'hosts',time:'2026-11-01T09:00:00.000Z'}];
 return JSON.stringify(exportAciraData(state,P,{history:true}),null,2);
}
function setup(content,{name='Acira-data.json',state:initial}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-json-')),file=path.join(root,name);fs.writeFileSync(file,content);
 const database=new BrowserDatabase(path.join(root,'db.sqlite'));let state=initial||createInitialState();state.bookmarkNodes??=[];const calls=[];
 const dialog={showOpenDialog:async(_window,options)=>{calls.push(options);return {canceled:false,filePaths:[file]};}};
 const importer=createImporter({database,getState:()=>state,commit:next=>{state=next;},dialog,getWindow:()=>null,roots:[]});
 return {importer,calls,state:()=>state,done:()=>{database.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('a profile exported from Acira imports back: folders, top level, history, and the file chooser offers it',async()=>{
 const f=setup(exported(),{state:Object.assign(createInitialState(),{bookmarkNodes:[],browsingHistory:[]})});
 const {batch}=await f.importer.importHTML();
 assert.deepEqual(f.calls[0].filters,[{name:'Bookmark HTML or Acira data',extensions:['html','htm','json']}]);
 assert.equal(batch.browser,'Acira');assert.equal(batch.name,'Acira-data.json');
 const [bookmarks,history]=batch.results;
 assert.deepEqual([bookmarks.category,bookmarks.count,bookmarks.folders,bookmarks.skipped],['bookmarks',3,3,1],'GitHub, A post, Loose page; three folders; the javascript: row skipped');
 assert.deepEqual([history.category,history.count,history.skipped],['history',1,1],'the file: visit skipped');
 const nodes=f.state().bookmarkNodes,byTitle=title=>nodes.find(n=>n.title===title);
 assert.equal(byTitle('Bookmarks bar').parentId,null,'the bar stays a top-level folder (placeFolder finds it by name)');
 assert.equal(byTitle('Other bookmarks').parentId,null);
 assert.equal(byTitle('Loose page').parentId,null,'a top-level page stays at the top');
 assert.equal(byTitle('GitHub').parentId,byTitle('Bookmarks bar').id);
 assert.equal(byTitle('A post').parentId,byTitle('Reading').id);
 assert.equal(byTitle('Reading').parentId,byTitle('Bookmarks bar').id);
 assert.equal(f.state().browsingHistory.length,1);assert.equal(f.state().browsingHistory[0].time,'2026-11-01T10:00:00.000Z');
 // Again: nothing new; the receipt says so.
 const again=(await f.importer.importHTML()).batch;
 assert.equal(again.results[0].count,0);assert.equal(again.results[0].folders,0);assert.equal(again.results[1].count,0);
 assert.equal(f.state().bookmarkNodes.length,nodes.length);
 // Undo of the first import removes what it brought.
 f.importer.undo(batch.id);
 assert.equal(f.state().bookmarkNodes.length,0);assert.equal(f.state().browsingHistory.length,0);
 f.done();
});

test('into a profile that already has a Bookmarks bar, the file merges into it and adds only new pages',async()=>{
 const state=createInitialState();state.bookmarkNodes=[node('mine','Bookmarks bar',null),node('gh2','GitHub','mine','https://github.com/')];
 const f=setup(exported(),{state});
 const {batch}=await f.importer.importHTML(),nodes=f.state().bookmarkNodes;
 assert.equal(nodes.filter(n=>n.title==='Bookmarks bar').length,1,'one Bookmarks bar');
 assert.equal(nodes.filter(n=>n.url==='https://github.com/').length,1,'GitHub not twice');
 assert.equal(nodes.find(n=>n.title==='Reading').parentId,'mine');
 assert.equal(batch.results[0].count,2);assert.equal(batch.results[0].skipped,2,'one duplicate, one javascript:');
 f.done();
});

test('a JSON file that is not an Acira export is refused, and the HTML import is unchanged',async()=>{
 for(const content of ['{"roots":{}}','not json','{"format":"acira-local-data","version":2,"bookmarks":[]}']){const f=setup(content);await assert.rejects(f.importer.importHTML(),/not a profile exported from Acira/);f.done();}
 const cycle=JSON.stringify({format:'acira-local-data',version:1,bookmarks:[{id:'a',parentId:'b',title:'A'},{id:'b',parentId:'a',title:'B'},{id:'c',parentId:'c',title:'Self',url:'https://self.example/'}]});
 const f=setup(cycle);const {batch}=await f.importer.importHTML();assert.equal(batch.results[0].count,1,'a parent loop does not hang or duplicate');f.done();
 const html=setup('<DL><p><DT><A HREF="https://example.org/">Example</A><DT><A HREF="javascript:1">x</A></DL>',{name:'b.html'});
 const htmlBatch=(await html.importer.importHTML()).batch;
 assert.equal(htmlBatch.browser,'HTML');assert.equal(htmlBatch.results.length,1);assert.equal(htmlBatch.results[0].skipped,1,'HTML still counts its unusable entries');
 html.done();
});

test('the Import & export row and setup name the new file and count only bookmarks as bookmarks',()=>{
 const en=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n/en.json'),'utf8'));
 assert.equal(en['import.importBookmarksBtn'],'Import bookmarks file…');
 assert.match(en['import.importBookmarksDesc'],/profile JSON exported from Acira/);
 assert.match(fs.readFileSync(path.join(__dirname,'../src/features/onboarding/steps.tsx'),'utf8'),/item\.status === "imported" && item\.category === "bookmarks"/);
 assert.match(fs.readFileSync(path.join(__dirname,'../src/features/import-export/ImportPanel.tsx'),'utf8'),/const fromFile = \(browser: string\) => browser === 'HTML' \|\| browser === 'Acira';/);
});

test('an Acira export re-saved with a byte-order mark (Notepad, a script) still imports',async()=>{
 const f=setup('﻿'+exported(),{state:Object.assign(createInitialState(),{bookmarkNodes:[],browsingHistory:[]})});
 try{
  const {batch}=await f.importer.importHTML();
  assert.equal(batch.browser,'Acira');
  assert.equal(batch.results[0].count,3);
 }finally{f.done();}
});
