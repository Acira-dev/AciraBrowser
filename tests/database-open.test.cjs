const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{DatabaseSync}=require('node:sqlite'),{BrowserDatabase}=require('../desktop/database.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-db-open-'));
function harness(file){const calls={errors:[],quits:0,splash:0,warnings:[]};return{calls,options:{create:name=>new BrowserDatabase(name),file,showError:(title,text)=>calls.errors.push({title,text}),quit:()=>{calls.quits++;},closeSplash:()=>{calls.splash++;},warn:message=>calls.warnings.push(message)}};}
test('a readable database opens with no message and no quit',()=>{
 const file=path.join(folder(),'browser.sqlite'),h=harness(file),db=openBrowserDatabase(h.options);
 assert.ok(db instanceof BrowserDatabase);assert.deepEqual(h.calls,{errors:[],quits:0,splash:0,warnings:[]});db.db.close();
});
test('a damaged database is explained and Acira quits, instead of starting to nothing; the file is left byte for byte as it was',()=>{
 const file=path.join(folder(),'browser.sqlite'),first=new BrowserDatabase(file);first.saveWindow('main',{browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[]});first.scrub();first.db.close();
 const whole=fs.readFileSync(file),damaged=Buffer.concat([whole.subarray(0,Math.floor(whole.length/2)),Buffer.from('\0garbage'.repeat(50))]);fs.writeFileSync(file,damaged);
 const h=harness(file),db=openBrowserDatabase(h.options);
 assert.equal(db,null);assert.equal(h.calls.quits,1);assert.equal(h.calls.splash,1,'the splash window is closed so the message is not hidden behind it');
 assert.equal(h.calls.errors.length,1);assert.match(h.calls.errors[0].title,/could not open/i);assert.match(h.calls.errors[0].text,/malformed|integrity|not a database/i);assert.ok(h.calls.errors[0].text.includes(file),'it names the file that was kept');
 assert.equal(h.calls.warnings.length,1);assert.deepEqual(fs.readFileSync(file),damaged);
});
test('a profile written by a newer Acira says so, and keeps its data and its version',()=>{
 const file=path.join(folder(),'browser.sqlite'),raw=new DatabaseSync(file);raw.exec('CREATE TABLE kept(value TEXT); INSERT INTO kept VALUES(\'tabs\'); PRAGMA user_version=7');raw.close();
 const h=harness(file);assert.equal(openBrowserDatabase(h.options),null);
 assert.match(h.calls.errors[0].text,/newer Acira version/);assert.equal(h.calls.quits,1);
 const again=new DatabaseSync(file);assert.equal(again.prepare('PRAGMA user_version').get().user_version,7);assert.equal(again.prepare('SELECT value FROM kept').get().value,'tabs');again.close();
});
test('a message box that fails cannot keep Acira from quitting',()=>{
 const file=path.join(folder(),'browser.sqlite');fs.writeFileSync(file,'x'.repeat(5000));let quits=0;
 const db=openBrowserDatabase({create:name=>new BrowserDatabase(name),file,showError(){throw new Error('no display');},quit:()=>{quits++;},closeSplash(){throw new Error('gone');},warn(){}});
 assert.equal(db,null);assert.equal(quits,1);
});
