const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{BrowserDatabase}=require('../desktop/database.cjs'),{createImporter}=require('../desktop/imports.cjs'),{createInitialState}=require('../desktop/runtime.cjs');

// Settings > Import & export: the preview said "8 bookmarks" and "5 history entries" for a Chrome profile, the import then brought 7 and 3
// (a page saved twice, file: and javascript: rows). The preview now counts what the import adds and says what it leaves out and why.
const chromeTime=ms=>(BigInt(ms)+11644473600000n)*1000n;
function chromeFixture(root){
 const source=path.join(root,'Chrome','Default');fs.mkdirSync(source,{recursive:true});
 const url=(name,u)=>({type:'url',name,url:u});
 fs.writeFileSync(path.join(source,'Bookmarks'),JSON.stringify({roots:{
  bookmark_bar:{name:'Bookmarks bar',children:[url('Example','https://example.com/'),url('Unsafe','javascript:alert(1)'),url('Dupe','https://example.com/'),url('Local','file:///etc/hosts'),{type:'folder',name:'Reading',children:[url('Post','https://blog.example.org/post'),url('Mine already','https://own.example.net/')]}]},
  other:{name:'Other bookmarks',children:[url('Other','https://other.example.com/')]}}}));
 const history=new DatabaseSync(path.join(source,'History'));history.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,last_visit_time INTEGER)');
 [['https://example.com/','Example',5],['https://news.example.net/a','News',60],['file:///etc/passwd','local',10],['javascript:1','x',11],['chrome://settings/','Settings',12]].forEach(([u,t,age],i)=>history.prepare('INSERT INTO urls VALUES(?,?,?,?)').run(i+1,u,t,chromeTime(Date.now()-age*60000)));
 history.close();
}
function firefoxFixture(home){
 const location=path.join(home,'Profiles','qa.default');fs.mkdirSync(location,{recursive:true});
 fs.writeFileSync(path.join(home,'profiles.ini'),'[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/qa.default\nDefault=1\n');
 const places=new DatabaseSync(path.join(location,'places.sqlite'));
 places.exec('CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER)');
 const now=BigInt(Date.now())*1000n;
 [['https://developer.mozilla.org/','MDN'],['file:///Users/someone/notes.txt','notes'],['https://www.wikipedia.org/','Wikipedia']].forEach(([u,t],i)=>places.prepare('INSERT INTO moz_places VALUES(?,?,?,?,0)').run(i+1,u,t,now-BigInt(i)*3600000000n));
 const mark=places.prepare('INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?,?,0)');
 mark.run(1,2,null,0,0,'','root________');mark.run(2,2,null,1,0,'toolbar','toolbar_____');mark.run(10,1,1,2,0,'MDN','qaFox0000001');mark.run(11,1,3,2,1,'Wikipedia','qaFox0000002');mark.run(12,1,1,2,2,'MDN again','qaFox0000003');
 places.close();
}
const make=(root,options)=>{const database=new BrowserDatabase(path.join(root,'acira.sqlite'));let state=createInitialState();state.bookmarkNodes=[{id:'own',title:'Mine',url:'https://own.example.net/',browserProfileId:'profile-personal',parentId:null,position:0,createdAt:1}];const importer=createImporter({database,getState:()=>state,commit:next=>{state=next;},...options});return {importer,state:()=>state,close:()=>database.close()};};

test('the Chrome preview counts what the import adds, and says what it leaves out and why',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-preview-'));chromeFixture(root);
 const {importer,state,close}=make(root,{roots:[['Chrome',path.join(root,'Chrome')]]});
 const [source]=importer.discover(),preview=importer.preview(source.id);
 // Bookmarks: 7 addresses in the file; javascript: and file: are not web pages; example.com is there twice and own.example.net is already saved.
 assert.equal(preview.bookmarks,3);
 assert.deepEqual(preview.skipped.bookmarks,{duplicates:2,notWeb:2});
 // History: 5 rows; file:, javascript: and chrome:// are not web pages.
 assert.equal(preview.history,2);
 assert.deepEqual(preview.skipped.history,{duplicates:0,notWeb:3});
 const batch=importer.run(source.id,['bookmarks','history']),[bookmarks,history]=batch.results;
 assert.equal(bookmarks.count,preview.bookmarks,'the preview number is the result');
 assert.equal(bookmarks.folders,preview.folders);
 assert.equal(bookmarks.skipped,4,'the receipt counts what was left out');
 assert.equal(history.count,preview.history);
 assert.equal(history.skipped,3);
 assert.equal(state().bookmarkNodes.filter(n=>n.url).length,4,'3 new beside the one already saved');
 // Importing again adds nothing, and the preview says so: everything is already here.
 const again=importer.preview(source.id);
 assert.equal(again.bookmarks,0);assert.equal(again.folders,0);
 assert.deepEqual(again.skipped.bookmarks,{duplicates:5,notWeb:2});
 assert.equal(again.history,0);assert.deepEqual(again.skipped.history,{duplicates:2,notWeb:3});
 const repeat=importer.run(source.id,['bookmarks','history']);
 assert.equal(repeat.results[0].count,0);assert.equal(repeat.results[1].count,0);
 close();fs.rmSync(root,{recursive:true,force:true});
});

test('the Firefox preview counts the same way (a file: visit and a page bookmarked twice)',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-preview-ff-')),home=path.join(root,'Firefox');firefoxFixture(home);
 const {importer,close}=make(root,{roots:[],firefoxRoots:[['Firefox',home]]});
 const [source]=importer.discover(),preview=importer.preview(source.id);
 assert.equal(preview.bookmarks,2);assert.equal(preview.skipped.bookmarks.duplicates,1);
 assert.equal(preview.history,2);assert.deepEqual(preview.skipped.history,{duplicates:0,notWeb:1});
 const [bookmarks,history]=importer.run(source.id,['bookmarks','history']).results;
 assert.equal(bookmarks.count,preview.bookmarks);assert.equal(history.count,preview.history);
 close();fs.rmSync(root,{recursive:true,force:true});
});

test('the import panel shows the skipped counts beside the preview numbers',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/features/import-export/ImportPanel.tsx'),'utf8'),en=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n/en.json'),'utf8'));
 assert.match(source,/withSkipped\(countLabel\(category, preview\.bookmarks\), preview\.skipped\?\.bookmarks\)/);
 assert.match(source,/withSkipped\(countLabel\(category, preview\.history\), preview\.skipped\?\.history\)/);
 assert.equal(en['import.skip.duplicates'],'{count, plural, one {# duplicate skipped} other {# duplicates skipped}}');
 assert.equal(en['import.skip.notWeb'],'{count, plural, one {# non-web address skipped (file:, javascript:)} other {# non-web addresses skipped (file:, javascript:)}}');
});
