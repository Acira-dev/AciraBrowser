const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createNativeNetworkPreferences}=require('../desktop/native-network-preferences.cjs');
function native(){let ready=false;const flags=new Map();return{isReady:()=>ready,makeReady:()=>{ready=true;},commandLine:{getSwitchValue:key=>flags.get(key)||'',appendSwitch:(key,value)=>flags.set(key,value),removeSwitch:key=>flags.delete(key)},configureHostResolver:value=>{}};}
test('saved network choice changes only after a new startup; strict endpoint validation protects the file',()=>{
 const base=path.resolve('.qa-profiles');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'network-preferences-')),app=native(),preferences=createNativeNetworkPreferences({directory,app});
 try{preferences.early();app.makeReady();preferences.ready();preferences.assertReady();const value={gpc:false,dns:{mode:'secure',servers:['https://resolver.example/dns-query']}};const saved=preferences.save(value);assert.equal(saved.current.dns.mode,'system');assert.equal(saved.restartRequired,true);assert.throws(()=>preferences.save({gpc:false,dns:{mode:'secure',servers:['https://user:secret@resolver.example/']}}));const restarted=createNativeNetworkPreferences({directory,app:native()});assert.deepEqual(restarted.status().current,{...value,cookies:'block'});}finally{if(!path.resolve(directory).startsWith(base+path.sep))throw Error('QA cleanup escapes profile directory');fs.rmSync(directory,{recursive:true,force:true});}
});
test('corrupt saved choice blocks browsing and stays truthful after a recovery save until restart',()=>{
 const base=path.resolve('.qa-profiles');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'network-preferences-')),app=native();try{fs.writeFileSync(path.join(directory,'native-network-preferences.json'),'{}');const preferences=createNativeNetworkPreferences({directory,app});preferences.early();app.makeReady();preferences.ready();assert.throws(()=>preferences.assertReady());const status=preferences.save({gpc:false,dns:{mode:'system',servers:[]}});assert.equal(status.restartRequired,true);assert.ok(status.error);}finally{if(!path.resolve(directory).startsWith(base+path.sep))throw Error('QA cleanup escapes profile directory');fs.rmSync(directory,{recursive:true,force:true});}
});
// Beta 14.4: Protection's Global Privacy Control switch saves {gpc} alone and Connection's Save sends {dns} alone; main merges each with what is saved, so a
// stale copy in another Settings tab never writes over the other choice. A one-key save of anything else is refused, and a whole choice still saves as before.
test('a save of one part keeps the other part as saved (two Settings tabs never overwrite each other)',()=>{
 const base=path.resolve('.qa-profiles');fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'network-preferences-')),app=native(),preferences=createNativeNetworkPreferences({directory,app});
 try{preferences.early();app.makeReady();preferences.ready();
  const dns={mode:'secure',servers:['https://resolver.example/dns-query']};
  preferences.save({dns});
  assert.deepEqual(preferences.status().saved.dns,dns,'Connection saved its DNS');
  preferences.save({gpc:true});
  assert.deepEqual(preferences.status().saved,{gpc:true,dns,cookies:'block'},'a GPC toggle leaves the DNS choice saved elsewhere untouched');
  preferences.save({dns:{mode:'off',servers:[]}});
  assert.equal(preferences.status().saved.gpc,true,'and Connection’s Save leaves GPC as Protection saved it');
  assert.deepEqual(preferences.status().saved.dns,{mode:'off',servers:[]});
  assert.throws(()=>preferences.save({cookies:'allow'}),'a one-key save of anything else is refused');
  assert.throws(()=>preferences.save({dns:{mode:'secure',servers:['https://user:secret@resolver.example/']}}),'a partial save is checked like a whole one');
  preferences.save({gpc:false,dns:{mode:'system',servers:[]}});
  assert.deepEqual(createNativeNetworkPreferences({directory,app:native()}).status().current,{gpc:false,dns:{mode:'system',servers:[]},cookies:'block'},'a whole choice still saves as before');
 }finally{if(!path.resolve(directory).startsWith(base+path.sep))throw Error('QA cleanup escapes profile directory');fs.rmSync(directory,{recursive:true,force:true});}
});
