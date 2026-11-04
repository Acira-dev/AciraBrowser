'use strict';
// Small files that must never be half-written (window-state.json, settings). writeFileAtomic writes beside the file, flushes it to disk and renames it
// over the old one in one step, so a crash, a power cut or a full disk mid-write leaves the old file or the new one, never a mix of both. Windows can
// refuse the rename for a moment while a virus scanner or the search indexer has the file open (EPERM, EACCES, EBUSY): it is tried again twice, at most
// 30 ms on the main thread, then the old file stays and the error is thrown. A temporary file an earlier run left (a crash between writing and renaming,
// or one the scanner still held) is removed the first time this run writes that file.
// keepDamaged puts a file that could not be read aside (renamed, never deleted) before Acira starts that part fresh, so the next save cannot write
// over the only copy; the newest few copies are kept. readJsonFile does that for the small JSON settings files.
const fs=require('node:fs');
const BUSY=new Set(['EPERM','EACCES','EBUSY']),TRIES=3,KEEP_DAMAGED=3,KEEP_SETTINGS=2;
const pause=ms=>{try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}catch{}};
let serial=0;const swept=new Set();

/** Removes `<file>.<pid>-<n>.tmp` left by another run (another process id). */
function sweep(file,fileSystem){
 if(swept.has(file))return;swept.add(file);
 try{
  const path=require('node:path'),dir=path.dirname(file),base=path.basename(file),pattern=/^\.(\d+)-\d+\.tmp$/;
  for(const name of fileSystem.readdirSync(dir)){if(!name.startsWith(base))continue;const match=pattern.exec(name.slice(base.length));if(match&&Number(match[1])!==process.pid)try{fileSystem.rmSync(path.join(dir,name),{force:true});}catch{}}
 }catch{}
}

function writeFileAtomic(file,data,{mode,fileSystem=fs,wait=pause}={}){
 sweep(file,fileSystem);
 const temporary=`${file}.${process.pid}-${++serial}.tmp`;let fd=null;
 try{
  fd=fileSystem.openSync(temporary,'w',mode);
  fileSystem.writeFileSync(fd,data);
  try{fileSystem.fsyncSync(fd);}catch{/* a network share may not flush; the rename still keeps the old file whole */}
  fileSystem.closeSync(fd);fd=null;
  for(let attempt=1;;attempt++){
   try{fileSystem.renameSync(temporary,file);break;}
   catch(error){if(!BUSY.has(error?.code)||attempt>=TRIES)throw error;wait(attempt*10);}
  }
 }catch(error){
  if(fd!==null)try{fileSystem.closeSync(fd);}catch{}
  try{fileSystem.rmSync(temporary,{force:true});}catch{}
  throw error;
 }
}

const stampOf=time=>new Date(time).toISOString().replace(/[:.]/g,'-');
/** Renames `file` to `<file>.damaged-<time>` and keeps `keep` such copies: the one just made and the newest others. Returns the new name, or null when the
 *  file could not be moved. The others are sorted by the time in their names; the new copy is never among those removed, even when the clock is behind
 *  an older copy's time (a reset clock, a date changed by hand), where it would sort as the oldest. */
function keepDamaged(file,{now=Date.now(),keep=KEEP_DAMAGED,fileSystem=fs}={}){
 const aside=file+'.damaged-'+stampOf(now);
 try{fileSystem.renameSync(file,aside);}catch{return null;}
 try{
  const path=require('node:path'),dir=path.dirname(file),prefix=path.basename(file)+'.damaged-',made=path.basename(aside);
  const others=fileSystem.readdirSync(dir).filter(name=>name.startsWith(prefix)&&name!==made).sort().reverse();
  for(const old of others.slice(Math.max(0,keep-1)))try{fileSystem.rmSync(path.join(dir,old),{force:true});}catch{}
 }catch{}
 return aside;
}

/** Reads a small JSON settings file (shortcuts.json, privacy-plus.json…) and returns its object, or undefined when there is none to use; the caller then
 *  takes its defaults. A file that is there but damaged (cut off, empty, not JSON, not an object, larger than `maxBytes`) is first kept aside with
 *  keepDamaged (the newest `keep`), so the next save of the defaults cannot write over the only copy. An object the caller then refuses (perhaps written
 *  by a newer Acira) and a file that could not be read just now (missing, locked, no permission) are left where they are. A byte-order mark at the start
 *  (Notepad and other editors save UTF-8 with one) is not damage. Never throws. */
function readJsonFile(file,{maxBytes=Infinity,keep=KEEP_SETTINGS,fileSystem=fs,now=Date.now,warn=message=>console.warn(message)}={}){
 let text=null;
 try{if(!(Number.isFinite(maxBytes)&&fileSystem.statSync(file).size>maxBytes))text=fileSystem.readFileSync(file,'utf8');}catch{return undefined;}
 if(text!==null)try{const value=JSON.parse(text.charCodeAt(0)===0xFEFF?text.slice(1):text);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}
 const aside=keepDamaged(file,{now:now(),keep,fileSystem});
 if(aside)try{const path=require('node:path');warn(path.basename(file)+' could not be read; it was kept as '+path.basename(aside)+' and the defaults are used.');}catch{}
 return undefined;
}

module.exports={writeFileAtomic,keepDamaged,readJsonFile,stampOf};
