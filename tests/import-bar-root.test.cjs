// 13.8: a bookmarks bar imported from Edge ("Favorites bar") or from Chrome in another language ("Barre de favoris") arrived
// as an ordinary top-level folder, never Acira's bookmarks bar: Chromium stores the bar under its translated name and the importer
// used that name. The bar root is now taken by its KEY (roots.bookmark_bar), a bookmarks file's toolbar by PERSONAL_TOOLBAR_FOLDER,
// and a bar an earlier import brought in under another name becomes the bar when the window loads (src/runtime/bookmarkBarRoots.ts).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BrowserDatabase}=require('../desktop/database.cjs'),{createImporter}=require('../desktop/imports.cjs'),{createInitialState,restoreSnapshot}=require('../desktop/runtime.cjs');
const {parseBookmarkHTML,exportBookmarkHTML}=require('../desktop/browser-services/bookmark-exchange.cjs');
const BAR_UUID='0bc5d13f-2cba-5d74-951f-3f233fe6c908';
const page=(name,guid)=>({type:'url',name,url:`https://${name.toLowerCase().replace(/\W+/g,'-')}.example/`,...(guid?{guid}:{})});
// Edge's Bookmarks file: the bar root carries Chromium's fixed bar id; the other root is "Other favorites".
const edge={roots:{bookmark_bar:{type:'folder',name:'Favorites bar',guid:BAR_UUID,id:'1',children:[page('Inbox','e1'),{type:'folder',name:'Projects',guid:'e2',children:[page('Roadmap','e3')]}]},other:{type:'folder',name:'Other favorites',guid:'82b081ec-3dd3-529c-8475-ab6c344590dd',children:[page('Recipes','e4')]}}};
// A French Chrome's file written before roots carried a guid: only the translated name says it is the bar.
const frenchChrome={roots:{bookmark_bar:{type:'folder',name:'Barre de favoris',id:'1',children:[page('Journal'),{type:'folder',name:'Travail',children:[page('Agenda')]}]},other:{type:'folder',name:'Autres favoris',id:'2',children:[page('Cuisine')]}}};
function setUp(browsers,existing=[]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-bar-root-')),roots=[];
 for(const [browser,tree] of browsers){const source=path.join(root,browser,'Default');fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'Bookmarks'),JSON.stringify(tree));roots.push([browser,path.join(root,browser)]);}
 const database=new BrowserDatabase(path.join(root,'acira.sqlite'));let state=createInitialState();state.bookmarkNodes=existing;
 const importer=createImporter({database,getState:()=>state,commit:next=>{state=next;},roots});
 return {importer,state:()=>state,close:()=>{database.close();fs.rmSync(root,{recursive:true,force:true});}};
}
const profile=createInitialState().activeBrowserProfileId;
const top=nodes=>nodes.filter(n=>!n.parentId&&!n.url).map(n=>n.title);
const under=(nodes,title)=>{const folder=nodes.find(n=>!n.parentId&&!n.url&&n.title===title);return folder?nodes.filter(n=>n.parentId===folder.id).sort((a,b)=>a.position-b.position).map(n=>n.title):null;};

test('Edge: its "Favorites bar" is imported as the bookmarks bar, pages and folders in order; Other favorites stays a folder',()=>{
 const t=setUp([['Edge',edge]]);const [source]=t.importer.discover();t.importer.run(source.id,['bookmarks']);const nodes=t.state().bookmarkNodes;
 assert.deepEqual(under(nodes,'Bookmarks bar'),['Inbox','Projects']);
 assert.ok(!top(nodes).includes('Favorites bar'),'no ordinary "Favorites bar" folder');
 assert.ok(top(nodes).includes('Other favorites'));t.close();
});

test('French Chrome: "Barre de favoris" (no id in the file) is imported as the bookmarks bar',()=>{
 const t=setUp([['Chrome',frenchChrome]]);const [source]=t.importer.discover();t.importer.run(source.id,['bookmarks']);const nodes=t.state().bookmarkNodes;
 assert.deepEqual(under(nodes,'Bookmarks bar'),['Journal','Travail']);assert.ok(!top(nodes).includes('Barre de favoris'));t.close();
});

test('a profile that already has a bookmarks bar: the imported bar joins it (one bar, the person\'s items first)',()=>{
 const mine=[{id:'bar',browserProfileId:profile,parentId:null,title:'Bookmarks bar',position:0,createdAt:1},{id:'own',browserProfileId:profile,parentId:'bar',title:'Mine',url:'https://mine.example/',position:0,createdAt:1}];
 const t=setUp([['Edge',edge]],mine);const [source]=t.importer.discover();t.importer.run(source.id,['bookmarks']);const nodes=t.state().bookmarkNodes;
 assert.equal(nodes.filter(n=>!n.parentId&&!n.url&&n.title==='Bookmarks bar').length,1);assert.deepEqual(under(nodes,'Bookmarks bar'),['Mine','Inbox','Projects']);t.close();
});

test('a bookmarks file: the toolbar folder (PERSONAL_TOOLBAR_FOLDER) is the bar root, the rest stays in "Imported bookmarks"; Acira\'s export marks its bar',()=>{
 const html='<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Favorites bar</H3><DL><p><DT><A HREF="https://a.example/">A</A><DT><H3>Sub</H3><DL><p><DT><A HREF="https://b.example/">B</A></DL><p></DL><p><DT><H3>Other favorites</H3><DL><p><DT><A HREF="https://c.example/">C</A></DL><p></DL><p>';
 const {roots}=parseBookmarkHTML(html);
 assert.deepEqual(Object.keys(roots),['bookmark_bar','html']);assert.equal(roots.bookmark_bar.name,'Bookmarks bar');
 assert.deepEqual(roots.bookmark_bar.children.map(n=>n.name),['A','Sub']);assert.deepEqual(roots.html.children.map(n=>n.name),['Other favorites']);
 assert.deepEqual(Object.keys(parseBookmarkHTML('<DL><p><DT><H3>Plain</H3><DL><p><DT><A HREF="https://d.example/">D</A></DL><p></DL><p>').roots),['html'],'a file without a toolbar is as before');
 const exported=exportBookmarkHTML([{id:'b',browserProfileId:'p',parentId:null,title:'Bookmarks bar',position:0},{id:'u',browserProfileId:'p',parentId:'b',title:'U',url:'https://u.example/',position:0}],'p');
 assert.match(exported,/<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/);assert.deepEqual(parseBookmarkHTML(exported).roots.bookmark_bar.children.map(n=>n.name),['U']);
});

test('already imported before this fix: the Edge bar becomes the bookmarks bar when the window loads, once, and saves that way',()=>{
 const legacy=createInitialState();
 legacy.bookmarkNodes=[{id:'fav',browserProfileId:profile,parentId:null,title:'Favorites bar',position:0,createdAt:1,importBatchId:'import-1',importKey:'abc123:'+BAR_UUID},{id:'p1',browserProfileId:profile,parentId:'fav',title:'Inbox',url:'https://inbox.example/',position:0,createdAt:1,importBatchId:'import-1',importKey:'abc123:e1'}];
 const loaded=restoreSnapshot(JSON.parse(JSON.stringify(legacy)));
 assert.equal(loaded.bookmarkNodes.find(n=>n.id==='fav').title,'Bookmarks bar');assert.equal(loaded.bookmarkNodes.find(n=>n.id==='p1').parentId,'fav');
 const again=restoreSnapshot(JSON.parse(JSON.stringify(loaded)));assert.deepEqual(again.bookmarkNodes,loaded.bookmarkNodes,'the second load changes nothing');
});

test('Edge, then a French Chrome: one bar, the second browser\'s items after the first\'s (not interleaved by their own positions)',()=>{
 const t=setUp([['Edge',edge],['Chrome',frenchChrome]]);const sources=t.importer.discover(),bySource=name=>sources.find(s=>s.browser===name);
 t.importer.run(bySource('Edge').id,['bookmarks']);t.importer.run(bySource('Chrome').id,['bookmarks']);const nodes=t.state().bookmarkNodes;
 assert.equal(nodes.filter(n=>!n.parentId&&!n.url&&n.title==='Bookmarks bar').length,1);
 assert.deepEqual(under(nodes,'Bookmarks bar'),['Inbox','Projects','Journal','Travail']);t.close();
});
