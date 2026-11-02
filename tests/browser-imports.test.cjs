const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{BrowserDatabase}=require('../desktop/database.cjs'),{createImporter}=require('../desktop/imports.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
test('import preserves folders, scopes records, deduplicates repeats, and undoes only the selected batch',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-import-')),source=path.join(root,'Chrome','Default');fs.mkdirSync(source,{recursive:true});
 fs.writeFileSync(path.join(source,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{name:'Bookmarks bar',children:[{type:'folder',name:'Research',guid:'folder-1',children:[{type:'url',name:'A useful page',url:'https://example.org/paper',guid:'link-1'}]}]}}}));
 fs.writeFileSync(path.join(source,'Preferences'),JSON.stringify({bookmark_bar:{show_on_all_tabs:true},default_search_provider:{search_url:'https://duckduckgo.com/?q={searchTerms}'}}));
 const history=new DatabaseSync(path.join(source,'History'));history.exec('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');history.prepare('INSERT INTO urls VALUES(?,?,?)').run('https://example.org/visited','Visited',(Date.now()+11644473600000)*1000);history.close();
 const database=new BrowserDatabase(path.join(root,'acira.sqlite'));let state=createInitialState();state.bookmarkNodes=[{id:'own',title:'My existing bookmark',url:'https://example.org/own',browserProfileId:'profile-personal',parentId:null,position:0,createdAt:1}];
 const importer=createImporter({database,getState:()=>state,commit:next=>{state=next;database.saveWindow('main',state);},roots:[['Chrome',path.join(root,'Chrome')]]});
 const sources=importer.discover();assert.equal(sources.length,1);assert.equal(sources[0].location,undefined);const preview=importer.preview(sources[0].id);assert.equal(preview.bookmarks,1);assert.equal(preview.history,1);
 const first=importer.run(sources[0].id,['bookmarks','history','preferences']);assert.equal(state.bookmarkNodes.length,4);assert.equal(state.browsingHistory.length,1);assert.equal(state.settings.searchEngine,'duckduckgo');const imported=state.bookmarkNodes.find(n=>n.url==='https://example.org/paper');assert.equal(state.bookmarkNodes.find(n=>n.id===imported.parentId).title,'Research');
 importer.run(sources[0].id,['bookmarks','history']);assert.equal(state.bookmarkNodes.length,4);assert.equal(state.browsingHistory.length,1);
 state.settings.searchEngine='bing';importer.undo(first.id);assert.deepEqual(state.bookmarkNodes.map(n=>n.id),['own']);assert.equal(state.browsingHistory.length,0);assert.equal(state.settings.searchEngine,'bing');database.close();
});
test('importing a second browser with the same folders and pages adds no copies',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-import-')),tree=extra=>JSON.stringify({roots:{bookmark_bar:{name:'Bookmarks bar',children:[{type:'folder',name:'Reading',children:[{type:'url',name:'Paper',url:'https://example.org/paper'},...extra]}]},other:{name:'Other bookmarks',children:[]}}});
 for(const [browser,extra] of [['Chrome',[]],['Edge',[{type:'url',name:'New one',url:'https://example.org/new'}]]]){const source=path.join(root,browser,'Default');fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'Bookmarks'),tree(extra));}
 const database=new BrowserDatabase(path.join(root,'acira.sqlite'));let state=createInitialState();state.bookmarkNodes=[];
 const importer=createImporter({database,getState:()=>state,commit:next=>{state=next;database.saveWindow('main',state);},roots:[['Chrome',path.join(root,'Chrome')],['Edge',path.join(root,'Edge')]]});
 const [chrome,edge]=importer.discover();importer.run(chrome.id,['bookmarks']);const afterChrome=state.bookmarkNodes.length;
 const second=importer.run(edge.id,['bookmarks']);
 const folders=state.bookmarkNodes.filter(n=>!n.url).map(n=>n.title).sort();assert.deepEqual(folders,['Bookmarks bar','Reading']);
 assert.equal(state.bookmarkNodes.filter(n=>n.url==='https://example.org/paper').length,1);
 const added=state.bookmarkNodes.find(n=>n.url==='https://example.org/new');assert.equal(state.bookmarkNodes.find(n=>n.id===added.parentId).title,'Reading');
 importer.undo(second.id);assert.equal(state.bookmarkNodes.length,afterChrome);database.close();
});
