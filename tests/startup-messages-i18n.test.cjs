'use strict';
// The messages of the damaged-database restore and of a failed start come from the catalog (founder's decision: translated like the rest), in the
// system's language: the profile's own language setting is inside the file that could not be opened.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BrowserDatabase,SCHEMA}=require('../desktop/database.cjs'),{openBrowserDatabase}=require('../desktop/database-open.cjs'),backups=require('../desktop/database-backups.cjs');
const {startupFailed}=require('../desktop/process-errors.cjs');
const KEYS=['main.dataOpenTitle','main.dataNothingChanged','main.dataRestoreQuestion','main.dataRestoreButton','main.dataQuitButton','main.dataRestoreFailed','main.startupFailedTitle','main.startupFailedText','main.secureStartFailedTitle','main.secureStartFailedText','main.secureStartLinksText'];
const LOCALES=['en','es','fr','de','pt-BR','it','ja','zh-CN','ar','tr','ru','ko','hi'];
const marker=(id,params)=>'['+id+(params?' '+JSON.stringify(params):'')+']';
function damagedWithCopy(){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'acira-startup-i18n-')),'browser.sqlite'),db=new BrowserDatabase(file);
 db.saveWindow('main',{browserProfiles:[],bookmarkNodes:[],browsingHistory:[],downloads:[],tabs:[]});backups.take(db,{now:new Date(2026,10,2,9).getTime()});db.close();
 const whole=fs.readFileSync(file);fs.writeFileSync(file,Buffer.concat([whole.subarray(0,whole.length>>1),Buffer.from('\0garbage'.repeat(50))]));return file;
}

test('every word of the restore question, its buttons and the quit message is a catalog message',()=>{
 const file=damagedWithCopy(),asked=[],errors=[];
 // data-safety-2: Quit leaves without a second message; the message still explains when the question itself could not be asked
 openBrowserDatabase({create:name=>new BrowserDatabase(name),file,backups,supported:SCHEMA,formatDay:day=>'<'+day+'>',t:marker,showError:(title,text)=>errors.push({title,text}),quit(){},warn(){},choose:question=>{asked.push(question);if(asked.length>1)throw new Error('no dialog');return 'quit';}});
 assert.deepEqual(errors,[],'Quit: no second message');
 openBrowserDatabase({create:name=>new BrowserDatabase(name),file,backups,supported:SCHEMA,formatDay:day=>'<'+day+'>',t:marker,showError:(title,text)=>errors.push({title,text}),quit(){},warn(){},choose:question=>{asked.push(question);if(asked.length>1)throw new Error('no dialog');return 'quit';}});
 assert.equal(asked[0].title,'[main.dataOpenTitle]');
 assert.equal(asked[0].restore,'[main.dataRestoreButton {"date":"<2026-11-02>"}]');assert.equal(asked[0].quit,'[main.dataQuitButton]');
 assert.ok(asked[0].text.endsWith('[main.dataRestoreQuestion '+JSON.stringify({file,date:'<2026-11-02>'})+']'),'SQLite\'s reason first, then the question');
 assert.equal(errors[0].title,'[main.dataOpenTitle]');assert.ok(errors[0].text.endsWith('[main.dataNothingChanged '+JSON.stringify({file})+']'));
 const shown=[];startupFailed(new Error('boom'),{record(){},hasWindow:()=>false,showError:(title,text)=>shown.push([title,text]),quit(){},t:marker});
 assert.deepEqual(shown,[['[main.startupFailedTitle]','boom\n\n[main.startupFailedText]']]);
 for(const name of ['database-open.cjs','process-errors.cjs'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../desktop',name),'utf8').split('\n').filter(line=>!/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n'),/Restore the backup from|Acira could not (start|open)|ask for help/,name+' keeps no English sentence of its own');
});

test('all thirteen catalogs carry the eleven messages with the English parameters',()=>{
 const read=code=>JSON.parse(fs.readFileSync(path.join(__dirname,'../src/i18n',code+'.json'),'utf8'));
 const params=text=>[...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]))].sort();
 const en=read('en');
 for(const code of LOCALES){const catalog=read(code);for(const id of KEYS){assert.equal(typeof catalog[id],'string',code+' '+id);assert.deepEqual(params(catalog[id]),params(en[id]),code+' '+id);}}
});

test('a German system gets German words and a German date',()=>{
 const i18n=require('../desktop/i18n.cjs');
 try{
  i18n.setMainLocale('system','de-DE');
  assert.equal(i18n.tm('main.dataRestoreButton',{date:backups.dayLabel('2026-11-02','de')}),'Sicherung vom 2. November 2026 wiederherstellen');
  assert.equal(i18n.tm('main.dataQuitButton'),'Beenden');
  i18n.setMainLocale('system','ja-JP');assert.equal(backups.dayLabel('2026-11-02','ja'),'2026年11月2日');
 }finally{i18n.setMainLocale('system','en-US');}
 assert.equal(backups.dayLabel('2026-11-02'),'2 November 2026','English keeps the day-month-year form');
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/formatDay:day=>databaseBackups\.dayLabel\(day,require\('\.\/browser-services\/tx\.cjs'\)\.locale\(\)\)/);
});
