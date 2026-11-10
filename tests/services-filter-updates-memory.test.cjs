'use strict';
// 13.5: the running filter lists do not keep their raw text in the main process (about 10 MB of strings; EasyList and the uBlock lists are two-byte strings).
// The text is read back from the cache file (or the bundled files) only while a swap, a refresh or a rollback needs it, and the pop-up rules get just the lines that name "popu".
// Everything here runs on real files in a temporary folder; the only fake is the network (an injected download). The behaviour tests also pass on the old code, on purpose:
// they pin what must not change (the files written, the engine built, the events), the memory tests and the pop-up test are the ones that fail there.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),v8=require('node:v8'),vm=require('node:vm');
const {ElectronBlocker}=require('@ghostery/adblocker-electron'),{Request}=require('@ghostery/adblocker');
const {createFilterUpdates,validateList,SOURCES}=require('../desktop/browser-services/filter-updates.cjs'),{popupRules}=require('../desktop/browser-services/popup-policy.cjs');
v8.setFlagsFromString('--expose-gc');const collect=vm.runInNewContext('gc');
const heapUsed=()=>{collect();collect();return process.memoryUsage().heapUsed;};
const MB=1048576;

// One list: its title line (with an en dash, like uBlock's, so it is a two-byte string), a note, padding, and `rows` rules named after `tag`.
const body=(source,tag,rows=3)=>`! Title: ${source.match||source.title} – fixture\n! reviewed fixture padding é\n`+'! reviewed fixture padding\n'.repeat(55)+Array.from({length:rows},(_,i)=>`||${tag}-${source.id.replace(/\W/g,'')}-${i}.example^`).join('\n')+'\n';
const blocks=(engine,tag,source)=>engine.match(Request.fromRawDetails({url:`https://${tag}-${source.id.replace(/\W/g,'')}-0.example/x.js`,sourceUrl:'https://page.example/',type:'script'})).match;
const parse=text=>ElectronBlocker.parse(text,{loadNetworkFilters:true,loadCosmeticFilters:true});

function fixture({rows=3,write=(source,tag)=>body(source,tag,rows),engineFactory}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-filter-memory-')),baseline=path.join(root,'baseline'),cachePath=path.join(root,'cache');fs.mkdirSync(baseline);
 for(const s of SOURCES)fs.writeFileSync(path.join(baseline,s.id),write(s,'bundled'));
 // `version[id]` is the tag the "server" answers with for that list; the etag follows it, so an unchanged list answers 304 once it has been downloaded.
 const state={version:Object.fromEntries(SOURCES.map(s=>[s.id,'v1'])),down:new Set(),calls:[],built:[],renameFail:false};
 const sourceOf=url=>SOURCES.find(s=>s.url===url||(s.mirrors||[]).includes(url));
 const download=async(url,session,validators={})=>{const s=sourceOf(url);state.calls.push(s.id);if(state.down.has(s.id))throw new Error('host down: '+s.id);const tag=state.version[s.id],etag='"'+tag+'"';if(validators.etag===etag)return {status:304,text:'',etag};return {status:200,text:write(s,tag),etag,lastModified:'Sat, 01 Nov 2026 00:00:00 GMT'};};
 const factory=engineFactory||(text=>{state.built.push(text);return parse(text);});
 const io={...fs,renameSync:(from,to)=>{if(state.renameFail&&to.endsWith('current.json'))throw new Error('injected atomic rename failure');return fs.renameSync(from,to);}};
 const options={filtersPath:baseline,cachePath,download,engineFactory:factory,io};
 return {root,baseline,cachePath,options,state,session:{isPersistent:()=>true},current:()=>path.join(cachePath,'current.json'),previous:()=>path.join(cachePath,'previous.json'),
  bundled:()=>({schema:1,retrievedAt:0,lists:SOURCES.map(s=>validateList(fs.readFileSync(path.join(baseline,s.id),'utf8'),s))}),read:file=>fs.readFileSync(file,'utf8'),cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const joined=snapshot=>snapshot.lists.map(l=>l.text).join('\n');

test('the running lists do not keep their text: start, refresh, swap and rollback each leave the heap as it was before the lists were read',async()=>{
 // 8 lists of about 1.4 MB, two-byte: 22 MB as strings. The old code kept every one of them for the life of the process (25 MB measured). What is left is about 3 MB: V8's regexp
 // cache holds on to the subject of the last match, one list. The limit sits between the two.
 const f=fixture({rows:44000,engineFactory:()=>({onBeforeRequest(){},onInjectCosmeticFilters(){},getFilters:()=>({networkFilters:[1],cosmeticFilters:[]})})});
 let base=heapUsed();
 const bulk=()=>heapUsed()-base;
 const service=createFilterUpdates(f.options);
 const start=bulk();
 f.state.version['easylist.txt']='v2';f.state.version['ubo-filters.txt']='v2';
 await service.refresh(f.session);
 const refreshed=bulk();
 service.rollback();
 const rolledBack=bulk();
 await service.refresh(f.session);
 const again=bulk();
 assert.equal(service.status().lists.length,SOURCES.length,'the service is alive while the heap is measured');
 const sizes=SOURCES.map(s=>Buffer.byteLength(validateList(fs.readFileSync(path.join(f.baseline,s.id),'utf8'),s).text));
 assert.ok(sizes.reduce((a,b)=>a+b,0)>8*MB,'the fixture lists are big enough to show a leak');
 for(const [name,held] of [['after the start',start],['after a refresh',refreshed],['after a rollback',rolledBack],['after a refresh that follows it',again]])assert.ok(held<8*MB,`${name} the service holds ${(held/MB).toFixed(1)} MB; the list text (22 MB) must not stay in memory`);
 f.cleanup();
});

test('the text is read from disk for a rebuild: the engine is built from the same lists in the same order, a restart gives the same engine input',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options),bundled=f.bundled();
 assert.equal(f.state.built.length,1);assert.equal(f.state.built[0],joined(bundled),'first start: the bundled lists, joined with a newline');
 f.state.version['easyprivacy.txt']='v2';
 await service.refresh(f.session);
 assert.equal(f.state.built.length,2);
 const written=JSON.parse(f.read(f.current()));
 assert.equal(f.state.built[1],joined(written),'the rebuild gets the text of the lists that did not change as well as the new ones');
  const restarted=createFilterUpdates(f.options);
 assert.equal(f.state.built.length,3);assert.equal(f.state.built[2],f.state.built[1],'after a restart the same text goes into the engine');
 assert.deepEqual(restarted.status().lists,service.status().lists);
 f.cleanup();
});

test('first start from the bundled lists writes no list cache; the first swap keeps the bundled lists as previous.json, exactly as before',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);
 assert.equal(service.status().source,'bundled');assert.equal(service.status().updatedAt,null);assert.equal(service.status().rollbackAvailable,false);
 assert.equal(fs.existsSync(f.current()),false);assert.equal(fs.existsSync(f.previous()),false);
 const bundled=f.bundled();
 assert.deepEqual(service.status().lists.map(l=>[l.id,l.url,l.sha256,l.bytes]),bundled.lists.map(l=>[l.id,l.url,l.sha256,Buffer.byteLength(l.text)]),'status reports hash and size of the bundled text');
 await service.refresh(f.session);
 assert.equal(service.status().source,'updated');assert.equal(service.status().rollbackAvailable,true);
 assert.equal(f.read(f.previous()),JSON.stringify(bundled),'previous.json is the bundled lists, byte for byte what the old code wrote');
 const current=JSON.parse(f.read(f.current()));
 assert.deepEqual(current.lists.map(l=>Object.keys(l)),SOURCES.map(()=>['id','url','text','sha256','via','etag','lastModified']));
 assert.deepEqual(service.status().lists.map(l=>l.sha256),current.lists.map(l=>l.sha256));
 assert.deepEqual(service.status().lists.map(l=>l.bytes),current.lists.map(l=>Buffer.byteLength(l.text)));
 f.cleanup();
});

test('swap, partial refresh, restart and rollback write the same files the old code wrote, and block the same requests',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options),easylist=SOURCES[0],privacy=SOURCES[1];
 assert.equal(blocks(service.getEngine(),'bundled',easylist),true);assert.equal(blocks(service.getEngine(),'v1',easylist),false);
 await service.refresh(f.session);
 const afterFirst=f.read(f.current());
 assert.equal(blocks(service.getEngine(),'v1',easylist),true,'the new lists block');assert.equal(blocks(service.getEngine(),'bundled',easylist),false);
 // a partial refresh: one list changed, seven answer 304 and keep their text and validators
 f.state.version['easyprivacy.txt']='v2';f.state.calls.length=0;
 const engineBefore=service.getEngine();
 await service.refresh(f.session);
 assert.equal(f.state.calls.length,SOURCES.length);assert.notEqual(service.getEngine(),engineBefore);
 assert.equal(f.read(f.previous()),afterFirst,'previous.json is the file current.json was a moment ago, byte for byte');
 const second=JSON.parse(f.read(f.current())),first=JSON.parse(afterFirst);
 assert.deepEqual(second.lists.filter((l,i)=>i!==1),first.lists.filter((l,i)=>i!==1),'the lists that did not change are written as they were (text, hash, validators)');
 assert.notEqual(second.lists[1].sha256,first.lists[1].sha256);assert.equal(second.lists[1].etag,'"v2"');
 assert.equal(blocks(service.getEngine(),'v2',privacy),true);assert.equal(blocks(service.getEngine(),'v1',privacy),false);assert.equal(blocks(service.getEngine(),'v1',easylist),true);
 // a restart reads current.json; the next swap still writes the right previous.json
 const restarted=createFilterUpdates(f.options);
 assert.equal(restarted.status().source,'cached');assert.deepEqual(restarted.status().lists,service.status().lists);
 f.state.version['plowe.txt']='v2';
 const secondFile=f.read(f.current());
 await restarted.refresh(f.session);
 assert.equal(f.read(f.previous()),secondFile,'after a restart too');
 // rollback goes back to the lists before the last swap and swaps the two files
 const thirdFile=f.read(f.current());
 restarted.rollback();
 assert.equal(restarted.status().source,'rollback');
 assert.equal(f.read(f.current()),secondFile,'current.json is what previous.json was');
 assert.equal(f.read(f.previous()),thirdFile,'previous.json is what current.json was');
 assert.equal(blocks(restarted.getEngine(),'v1',SOURCES.find(s=>s.id==='plowe.txt')),true,'the rolled-back lists block');assert.equal(blocks(restarted.getEngine(),'v2',SOURCES.find(s=>s.id==='plowe.txt')),false);
 // and again: the rollback is its own undo
 restarted.rollback();
 assert.equal(f.read(f.current()),thirdFile);assert.equal(f.read(f.previous()),secondFile);
 assert.equal(blocks(restarted.getEngine(),'v2',SOURCES.find(s=>s.id==='plowe.txt')),true);
 f.cleanup();
});

test('a refresh that finds nothing new, and a refresh that finds only 304s, reads and writes nothing',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);await service.refresh(f.session);
 const stamp=['current','previous'].map(k=>[f[k](),fs.statSync(f[k]()).mtimeMs]),built=f.state.built.length;
 let reads=0;const counting=createFilterUpdates({...f.options,io:{...f.options.io,readFileSync:(file,...rest)=>{if(/(current|previous)\.json$/.test(String(file)))reads++;return fs.readFileSync(file,...rest);}}});
 const startReads=reads;
 await counting.refresh(f.session);await counting.refresh(f.session);
 assert.equal(reads-startReads,0,'an unchanged check does not read the cache files back');
 assert.equal(counting.status().lastError,null);
 assert.equal(f.state.built.length,built+1,'only the second service built an engine, from its own start');
 assert.deepEqual(stamp.map(([file])=>fs.statSync(file).mtimeMs),stamp.map(([,time])=>time),'nothing was rewritten');
 f.cleanup();
});

test('a refresh that fails halfway keeps everything: failed downloads, a builder that crashes, a current.json that cannot be written',async()=>{
 // some downloads fail: the others update, the failed lists stay as they were, and the text of every list is still there for the next swap
 const f=fixture(),service=createFilterUpdates(f.options);await service.refresh(f.session);
 const downloaded=JSON.parse(f.read(f.current()));
 f.state.version['easylist.txt']='v2';f.state.down.add('easyprivacy.txt');f.state.version['easyprivacy.txt']='v2';
 await service.refresh(f.session);
 assert.match(service.status().lastError,/^1 of 8 filter sources could not be updated: host down: easyprivacy/);
 const partial=JSON.parse(f.read(f.current()));
 assert.equal(partial.lists[1].sha256,downloaded.lists[1].sha256,'the failed list stays as it was');assert.equal(partial.lists[1].text,downloaded.lists[1].text);assert.notEqual(partial.lists[0].sha256,downloaded.lists[0].sha256);
 // the builder crashes: the engine, current.json and previous.json stay as they were; the next refresh works
 const crashing=fixture();let crash=true;
 const builder=createFilterUpdates({...crashing.options,engineCache:true,buildEngine:async text=>{if(crash)throw new Error('worker crashed');return parse(text).serialize();}});
 await builder.refresh(crashing.session).catch(()=>{});
 assert.equal(builder.status().source,'bundled');
 crash=false;
 const hadFiles=[fs.existsSync(crashing.current()),fs.existsSync(crashing.previous())];
 assert.deepEqual(hadFiles,[false,false],'a failed compile writes nothing');
 const active=builder.getEngine();await builder.refresh(crashing.session);assert.notEqual(builder.getEngine(),active);assert.equal(builder.status().source,'updated');assert.equal(builder.status().lastError,null);
 assert.equal(crashing.read(crashing.previous()),JSON.stringify(crashing.bundled()));
 // current.json cannot be written (after previous.json was): the engine does not change, and the retry still has every list's text
 const broken=fixture(),service2=createFilterUpdates(broken.options);await service2.refresh(broken.session);
 const goodFile=broken.read(broken.current()),running=service2.getEngine();
 broken.state.version['unbreak.txt']='v2';broken.state.renameFail=true;
 await assert.rejects(service2.refresh(broken.session),/injected atomic rename failure/);
 assert.equal(service2.getEngine(),running);assert.equal(broken.read(broken.current()),goodFile);assert.equal(blocks(service2.getEngine(),'v1',SOURCES[0]),true);
 broken.state.renameFail=false;
 await service2.refresh(broken.session);
 assert.equal(service2.status().source,'updated');assert.equal(service2.status().lastError,null);assert.equal(broken.read(broken.previous()),goodFile,'previous.json is the lists that were running before this swap');
 const final=JSON.parse(broken.read(broken.current()));assert.equal(final.lists.length,SOURCES.length);for(const [i,l] of final.lists.entries()){assert.ok(l.text.includes('v'+(SOURCES[i].id==='unbreak.txt'?2:1)+'-'),SOURCES[i].id+' keeps its own text');}
 for(const x of [f,crashing,broken])x.cleanup();
});

test('the lists read back must be the lists that are running: a cache file that was replaced is not used, the bundled files stand in when they are the same',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);
 // Bundled start, then the cache directory gets a current.json of different lists (another instance, a restored backup): the swap must not write it as previous.json.
 const other=fixture({write:(s,t)=>body(s,'impostor-'+t)});
 const impostor=JSON.stringify((()=>{const snap=other.bundled();return {...snap,retrievedAt:Date.now()-1000,lists:snap.lists.map(l=>({...l,via:l.url,etag:undefined}))};})());
 fs.mkdirSync(f.cachePath,{recursive:true});fs.writeFileSync(f.current(),impostor);
 await service.refresh(f.session);
 assert.equal(f.read(f.previous()),JSON.stringify(f.bundled()),'previous.json holds the lists that were running (found in the bundled files), not the impostor');
 other.cleanup();f.cleanup();
});

test('the stored lists are gone: a swap does not touch the older rollback copy, the next refresh downloads every list in full and recovers',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);await service.refresh(f.session);
 fs.rmSync(f.current());fs.rmSync(f.previous());fs.rmSync(path.join(f.baseline,'easylist.txt'));
 f.state.version['easylist.txt']='v2';
 const running=service.getEngine();
 await assert.rejects(service.refresh(f.session),/stored filter lists could not be read/);
 assert.equal(service.getEngine(),running,'the running engine is untouched');assert.match(service.status().lastError,/could not be read/);
 f.state.calls.length=0;
 await service.refresh(f.session);
 assert.equal(f.state.calls.filter(id=>id==='easylist.txt').length>=1,true);assert.equal(new Set(f.state.calls).size,SOURCES.length,'every list was downloaded, unconditionally');
 assert.equal(service.status().source,'updated');assert.equal(service.status().lastError,null);
 const recovered=JSON.parse(f.read(f.current()));assert.equal(recovered.lists.length,SOURCES.length);assert.ok(recovered.lists[0].text.includes('v2-'));assert.ok(recovered.lists[1].text.includes('v1-'));
 assert.equal(fs.existsSync(f.previous()),false,'there was nothing to keep as the older copy');
 // and from there everything works again
 f.state.version['plowe.txt']='v2';await service.refresh(f.session);
 assert.equal(f.read(f.previous()),JSON.stringify(recovered),'current.json is stored again, so the next swap keeps it');
 f.cleanup();
});

test('a rollback while the running lists cannot be read back still rolls back, and says nothing is lost',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);await service.refresh(f.session);
 const older=f.read(f.previous());
 fs.rmSync(f.current());fs.rmSync(path.join(f.baseline,'easyprivacy.txt'));
 service.rollback();
 assert.equal(service.status().source,'rollback');assert.equal(blocks(service.getEngine(),'bundled',SOURCES[0]),true);
 assert.equal(f.read(f.current()),older);assert.equal(f.read(f.previous()),older,'the rollback copy stays as it was');
 f.cleanup();
});

test('a rollback with no rollback copy fails as before and changes nothing',()=>{
 const f=fixture(),service=createFilterUpdates(f.options),engine=service.getEngine();
 assert.throws(()=>service.rollback(),/ENOENT/);assert.equal(service.getEngine(),engine);assert.match(service.status().lastError,/ENOENT/);
 f.cleanup();
});

test('the pop-up rules come from the same lines as before: only lines that name "popu" are kept, and they give exactly the rules the whole lists gave',async()=>{
 // The real bundled lists, not a fixture.
 const filters=path.join(__dirname,'..','resources','filters');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'acira-filter-popup-')),real=createFilterUpdates({filtersPath:filters,cachePath:scratch,engineFactory:()=>({onBeforeRequest(){},onInjectCosmeticFilters(){},getFilters:()=>({networkFilters:[1],cosmeticFilters:[]})}),engineCache:false});
 const whole=SOURCES.map(s=>validateList(fs.readFileSync(path.join(filters,s.id),'utf8'),s).text);
 const expected=popupRules(whole),texts=real.popupTexts();
 assert.ok(expected.length>1000,'the bundled lists carry well over a thousand pop-up rules ('+expected.length+')');
 assert.deepEqual(popupRules(texts),expected,'same rules, same order');
 assert.equal(texts.length,whole.length,'one entry per list');
 const kept=texts.reduce((n,t)=>n+t.length,0),all=whole.reduce((n,t)=>n+t.length,0);assert.ok(kept<all/10,`the kept lines are a small part of the lists (${kept} of ${all} characters)`);
 for(const t of texts)for(const line of t.split('\n'))assert.ok(line===''||line.includes('popu'),'only pop-up lines: '+line.slice(0,60));
 assert.equal(real.listsKey(),real.status().lists.map(l=>l.sha256).join('|'));
 fs.rmSync(scratch,{recursive:true,force:true});
});

test('pop-up lines of an update: the new lists give new rules, a rollback gives the old ones back, and a list with one such line is not tied to the list text',async()=>{
 const write=(s,tag)=>body(s,tag)+(s.id==='easylist.txt'?`||${tag}-ads.example^$popup\n`:'')+(s.id==='easyprivacy.txt'?`||${tag}-under.example^$popunder,third-party\n`:'')+'! popular words here are a comment, not a rule\n';
 const f=fixture({write}),service=createFilterUpdates(f.options);
 const rules=()=>popupRules(service.popupTexts());
 assert.deepEqual(rules(),['||bundled-ads.example^$subdocument','||bundled-under.example^$third-party,subdocument']);
 const key=service.listsKey();
 await service.refresh(f.session);
 assert.notEqual(service.listsKey(),key);assert.deepEqual(rules(),['||v1-ads.example^$subdocument','||v1-under.example^$third-party,subdocument']);
 const restarted=createFilterUpdates(f.options);assert.deepEqual(popupRules(restarted.popupTexts()),rules());
 service.rollback();assert.equal(service.listsKey(),key);assert.deepEqual(rules(),['||bundled-ads.example^$subdocument','||bundled-under.example^$third-party,subdocument']);
 // one pop-up line in a list: the kept text is a copy, so it does not keep the whole list alive
 const single=service.popupTexts().find(t=>t.includes('bundled-ads'));assert.ok(single.length<2000,'a few lines, not the list');
 f.cleanup();
});
