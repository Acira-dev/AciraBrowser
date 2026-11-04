'use strict';
// Window state and settings files are written whole or not at all (desktop/atomic-file.cjs): a crash or a full disk in the middle of a save used to leave
// half a file, and the next start lost where the windows were or which settings were chosen. A window-state.json that cannot be read is kept aside.
// The "crash mid-write" here is a write that puts down the first bytes and then fails, as a full disk does.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeFileAtomic,keepDamaged}=require('../desktop/atomic-file.cjs');
const placement=require('../desktop/window-placement.cjs');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-atomic-'));
const gone=dir=>fs.rmSync(dir,{recursive:true,force:true});
const area={x:0,y:0,width:1920,height:1040},areaFor=()=>area;

/** Every write puts down its first 12 bytes and then fails with ENOSPC, the way a full disk ends a save. */
function fullDiskDuring(fn){
 const real=fs.writeFileSync;
 fs.writeFileSync=(target,data,...rest)=>{real(target,String(data).slice(0,12),...rest);throw Object.assign(new Error('ENOSPC: no space left on device, write'),{code:'ENOSPC'});};
 try{return fn();}finally{fs.writeFileSync=real;}
}

test('window-state.json: a save that dies half-way leaves the previous file whole, and no temporary file behind',()=>{
 const dir=folder();try{
  const file=path.join(dir,'window-state.json');
  placement.save(file,'main',{bounds:{x:10,y:20,width:1200,height:800}},['main']);
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>fullDiskDuring(()=>placement.save(file,'main',{bounds:{x:300,y:200,width:1000,height:700}},['main'])),/ENOSPC/);
  assert.equal(fs.readFileSync(file,'utf8'),before,'the old positions are still there, whole');
  assert.deepEqual(placement.place({file,windowId:'main',restore:true,areaFor}).bounds,{x:10,y:20,width:1200,height:800});
  assert.deepEqual(fs.readdirSync(dir),['window-state.json']);
 }finally{gone(dir);}
});

test('a damaged window-state.json is kept aside (not written over by the next save) and the window opens where a first start puts it',()=>{
 const dir=folder();try{
  const file=path.join(dir,'window-state.json'),damaged='{"bounds":{"x":0,"y":29,"';fs.writeFileSync(file,damaged);
  const placed=placement.place({file,windowId:'main',restore:true,areaFor});
  assert.equal(placed.maximized,false);
  const aside=fs.readdirSync(dir).filter(name=>name.startsWith('window-state.json.damaged-'));
  assert.equal(aside.length,1);assert.equal(fs.readFileSync(path.join(dir,aside[0]),'utf8'),damaged,'kept byte for byte');
  placement.save(file,'main',{bounds:{x:5,y:5,width:900,height:700}},['main']);
  assert.equal(fs.readFileSync(path.join(dir,aside[0]),'utf8'),damaged,'the next save leaves the copy alone');
  assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(file,'utf8')));
  // a missing file is a first start, not damage: nothing is moved
  fs.rmSync(file);placement.place({file,windowId:'main',restore:true,areaFor});
  assert.equal(fs.readdirSync(dir).filter(name=>name.startsWith('window-state.json.damaged-')).length,1);
 }finally{gone(dir);}
});

test('only the newest three damaged copies are kept, so a file that keeps breaking cannot fill the disk',()=>{
 const dir=folder();try{
  const file=path.join(dir,'window-state.json');
  for(let i=0;i<5;i++){fs.writeFileSync(file,'x'+i);assert.ok(keepDamaged(file,{now:Date.UTC(2026,10,3,10,i)}));}
  const kept=fs.readdirSync(dir).sort();assert.equal(kept.length,3);assert.deepEqual(kept.map(name=>fs.readFileSync(path.join(dir,name),'utf8')),['x2','x3','x4']);
  assert.equal(keepDamaged(path.join(dir,'missing.json')),null);
 }finally{gone(dir);}
});

test('writeFileAtomic: Windows refusing the rename for a moment (a scanner has the file open) is tried again; other errors are not',()=>{
 const dir=folder();try{
  const file=path.join(dir,'settings.json');fs.writeFileSync(file,'{"old":true}');
  const waits=[];let refusals=2;
  const busy={...fs,renameSync:(from,to)=>{if(refusals-->0)throw Object.assign(new Error('EPERM: operation not permitted, rename'),{code:'EPERM'});return fs.renameSync(from,to);}};
  writeFileAtomic(file,'{"new":true}',{fileSystem:busy,wait:ms=>waits.push(ms)});
  assert.equal(fs.readFileSync(file,'utf8'),'{"new":true}');assert.equal(waits.length,2);
  const broken={...fs,renameSync:()=>{throw Object.assign(new Error('EXDEV'),{code:'EXDEV'});}};
  assert.throws(()=>writeFileAtomic(file,'{"newer":true}',{fileSystem:broken,wait:()=>assert.fail('not retried')}),/EXDEV/);
  assert.equal(fs.readFileSync(file,'utf8'),'{"new":true}');assert.deepEqual(fs.readdirSync(dir),['settings.json'],'the temporary file is removed');
  const always={...fs,renameSync:()=>{throw Object.assign(new Error('EBUSY'),{code:'EBUSY'});}};
  assert.throws(()=>writeFileAtomic(file,'{}',{fileSystem:always,wait(){}}),/EBUSY/,'it gives up after a few tries');
  assert.deepEqual(fs.readdirSync(dir),['settings.json']);
 }finally{gone(dir);}
});

test('the small settings files that were written in place are written whole too: passwords, the Tor window and the Peek tip',()=>{
 const dir=folder();try{
  // passwords: Settings > Passwords > "Offer to save passwords"; the Tor window: its security level and download warning
  for(const [name,source] of [['passwords','../desktop/passwords/passwords.cjs'],['peek tip','../desktop/rewind/peek-hint.cjs'],['tor window','../desktop/browser-services/tor-window.cjs']]){
   const text=fs.readFileSync(path.join(__dirname,source),'utf8');
   assert.match(text,/require\('\.\.\/atomic-file\.cjs'\)\.writeFileAtomic\(/,name+' saves through writeFileAtomic');
   assert.doesNotMatch(text,/(?:fs|fsApi)\.writeFileSync\((?:settingsFile|file),JSON\.stringify/,name+' no longer writes its settings in place');
  }
  // the Peek tip end to end: a write that dies half-way leaves the old file, not half of the new one
  const {createPeekHint}=require('../desktop/rewind/peek-hint.cjs');
  const file=path.join(dir,'peek-hint.json');fs.writeFileSync(file,'{"seen":false}');
  const hint=createPeekHint({file,threshold:1});
  fullDiskDuring(()=>hint.note(()=>{}));
  assert.equal(fs.readFileSync(file,'utf8'),'{"seen":false}','a failed write leaves the old file, not half of the new one');
  assert.ok(!fs.readdirSync(dir).some(name=>name.endsWith('.tmp')));
 }finally{gone(dir);}
});
