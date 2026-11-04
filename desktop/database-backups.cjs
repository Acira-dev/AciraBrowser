'use strict';
// Rolling copies of the profile database (browser.sqlite) in backups/ next to it, so a damaged file can be replaced by a recent day's copy
// (database-open.cjs offers it) instead of the person losing their tabs, bookmarks and history.
// - At most one a day, taken at a clean start (the database opened and passed its check, and was not just restored), the last KEEP kept.
// - A copy holds exactly what browser.sqlite holds: ordinary profiles. Private and Tor windows never write to it, so no copy carries them.
// - Clearing history or downloads, or removing a profile, replaces every copy with a fresh one taken from the cleaned database (refresh):
//   what someone cleared must not come back from a backup, and there is still a backup to go back to. The fresh copy is written first and the old ones
//   go after it; when it cannot be written (a full disk), the old ones still go and it is tried once more in the room they free. "Every copy" includes
//   the copy taken before a layout update (backups/browser-before-v<N>.sqlite) and half copies an interrupted copy left (backups/*.next,
//   browser.sqlite.restoring). The files set aside as browser.sqlite.damaged-<time> or .newer-<time> are not copies: they may be the only place the
//   person's old data is (no daily copy yet, or a file a newer Acira can still read), and the question that set them aside said nothing is deleted.
// - A copy is only offered when it opens, passes SQLite's check, and was written by a version this Acira understands.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const KEEP=3,NAME=/^browser-(\d{4}-\d{2}-\d{2})\.sqlite$/;
const pad=value=>String(value).padStart(2,'0');
/** The local calendar day, as the copies are named. */
const dayOf=time=>{const date=new Date(time);return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());};
const folderOf=file=>path.join(path.dirname(file),'backups');

/** The copies of `file`, newest first. */
function list(file){
 let names=[];try{names=fs.readdirSync(folderOf(file));}catch{return [];}
 return names.map(name=>NAME.exec(name)).filter(Boolean).map(match=>({day:match[1],file:path.join(folderOf(file),match[0])})).sort((a,b)=>a.day<b.day?1:a.day>b.day?-1:0);
}

/** Opens `file` read-only for `read`. A read-only look at a file in WAL mode makes empty -wal/-shm companions and leaves them behind; the ones this look
 *  made are removed again, so looking changes nothing next to the file. */
function lookAt(file,read){
 const had=new Set(['-wal','-shm'].filter(suffix=>fs.existsSync(file+suffix)));let db;
 try{db=new DatabaseSync(file,{readOnly:true});return read(db);}
 finally{try{db?.close();}catch{}for(const suffix of ['-wal','-shm'])if(!had.has(suffix))try{fs.rmSync(file+suffix,{force:true});}catch{}}
}

/** The highest schema version the file says it has, or null when it cannot be read at all. Both the raw header (bytes 60-63, readable when the rest of the
 *  file is damaged) and SQLite's own answer (which includes a write-ahead log a newer Acira may not have folded in yet) are read. Nothing is written. */
function fileVersion(file){
 const found=[];
 try{const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(64);if(fs.readSync(fd,header,0,64,0)===64&&header.subarray(0,16).toString('latin1')==='SQLite format 3\0')found.push(header.readUInt32BE(60));}finally{fs.closeSync(fd);}}catch{}
 try{found.push(lookAt(file,db=>db.prepare('PRAGMA user_version').get().user_version));}catch{}
 return found.length?Math.max(...found):null;
}

/** A copy that opens, passes quick_check and has a schema between 1 and `supported`. */
function usable(entry,{supported}){
 try{
  return lookAt(entry.file,db=>{
   const version=db.prepare('PRAGMA user_version').get().user_version;if(!(version>=1&&version<=supported))return false;
   return Object.values(db.prepare('PRAGMA quick_check').get())[0]==='ok';
  });
 }catch{return false;}
}

/** The newest copy that can be put back, or null. */
function newestUsable(file,{supported}){return list(file).find(entry=>usable(entry,{supported}))||null;}

/** Today's copy, unless there is one already; then only the newest KEEP are kept. Returns the new copy, or null when none was due. */
function take(database,{now=Date.now(),keep=KEEP}={}){
 const file=database.filename,day=dayOf(now),target=path.join(folderOf(file),'browser-'+day+'.sqlite');
 if(list(file).some(entry=>entry.day===day))return null;
 fs.mkdirSync(folderOf(file),{recursive:true,mode:0o700});
 database.backup(target);
 try{fs.chmodSync(target,0o600);}catch{}
 for(const old of list(file).slice(keep))try{fs.rmSync(old.file,{force:true});}catch{}
 return {day,file:target};
}

/** Deletes every copy: the daily ones (but `except`), the one before a layout update, and half copies an interrupted copy left. Never the damaged or newer
 *  files set aside beside the database. */
function forget(file,{except=null}={}){
 const inFolder=(dir,match)=>{try{return fs.readdirSync(dir).filter(match).map(name=>path.join(dir,name));}catch{return [];}};
 const copies=[...list(file).map(entry=>entry.file),...inFolder(folderOf(file),name=>/^browser-before-v\d+\.sqlite$/.test(name)||/\.sqlite\.next$/.test(name)),file+'.restoring'];
 for(const name of copies)if(name!==except)try{fs.rmSync(name,{force:true});}catch{}
}

/** History or downloads were cleared, or a profile was removed: today's copy is taken again from the database as it is now, and every other copy goes.
 *  The new copy is written before the old ones go, so a copy that fails never leaves none; when it fails (a full disk), the old ones still go, as what
 *  was cleared must not come back from them, and it is tried once more in the room they free (that one may throw). Call it after every window has
 *  saved, so no window's saved state still carries what was cleared. Returns the new copy. */
function refresh(database,{now=Date.now()}={}){
 const file=database.filename,day=dayOf(now),target=path.join(folderOf(file),'browser-'+day+'.sqlite');
 try{fs.mkdirSync(folderOf(file),{recursive:true,mode:0o700});database.backup(target);try{fs.chmodSync(target,0o600);}catch{}}
 catch{try{fs.rmSync(target+'.next',{force:true});}catch{}forget(file);return take(database,{now});}
 forget(file,{except:target});
 return {day,file:target};
}

/** Where setAside will move `file`: <file>.damaged-<time> (or .newer-<time> for a profile from a newer Acira), named before the question is asked. */
const asideName=(file,{now=Date.now(),label='damaged'}={})=>file+'.'+label+'-'+new Date(now).toISOString().replace(/[:.]/g,'-');
/** Moves `file` and its -wal/-shm companions to `aside` (renamed, never deleted), so a stale log is never applied to what comes next. The log goes first
 *  and the database last, so a log is never left beside a missing database (SQLite would open a new, empty one there and drop the log). All or nothing:
 *  when one cannot be moved the others are put back and the error is thrown. Returns the suffixes moved. */
function setAside(file,aside){
 const moved=[];
 try{for(const suffix of ['-wal','-shm',''])if(fs.existsSync(file+suffix)){fs.renameSync(file+suffix,aside+suffix);moved.push(suffix);}}
 catch(error){putBack(file,aside,moved);throw error;}
 return moved;
}
/** Puts what setAside moved back in place, over anything made there since, so that a log is never apart from its database: the database goes first, and
 *  when one of its logs cannot follow, the database (and what followed it) goes aside again. Returns where the old files are now: [] when everything is
 *  back, otherwise their paths, the database first. */
function putBack(file,aside,moved){
 const back=[];
 for(const suffix of ['','-wal','-shm']){
  if(!moved.includes(suffix))continue;
  try{fs.renameSync(aside+suffix,file+suffix);back.push(suffix);}
  catch{if(back.includes(''))for(const done of back.reverse())try{fs.renameSync(file+done,aside+done);}catch{}break;}
 }
 const order=['','-wal','-shm'].filter(suffix=>moved.includes(suffix));
 return order.every(suffix=>!fs.existsSync(aside+suffix))?[]:order.map(suffix=>fs.existsSync(aside+suffix)?aside+suffix:file+suffix);
}

/** Puts `entry` in place of `file`. The damaged file and its companions are set aside first. Returns where the damaged file went. If the copy cannot be
 *  written, everything is moved back and the error thrown; when something could not be moved back, the error says where the old files are (keptAt). */
function restore(file,entry,{now=Date.now()}={}){
 const aside=asideName(file,{now}),moved=setAside(file,aside);
 try{
  fs.copyFileSync(entry.file,file+'.restoring');try{fs.chmodSync(file+'.restoring',0o600);}catch{}
  fs.renameSync(file+'.restoring',file);
 }catch(error){
  try{fs.rmSync(file+'.restoring',{force:true});}catch{}
  const places=putBack(file,aside,moved);if(places.length)try{error.keptAt=places;}catch{}
  throw error;
 }
 return aside;
}

/** The day as the interface language writes it ("2 November 2026", "2. November 2026", "2026年11月2日"), for the restore message and button. */
function dayLabel(day,locale='en'){const [year,month,date]=String(day).split('-').map(Number);const value=new Date(year,month-1,date);if(!Number.isFinite(value.getTime()))return String(day);try{return value.toLocaleDateString(locale==='en'?'en-GB':locale,{day:'numeric',month:'long',year:'numeric'});}catch{return value.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});}}

module.exports={list,fileVersion,usable,newestUsable,take,forget,refresh,restore,setAside,putBack,asideName,dayOf,dayLabel,folderOf,KEEP};
