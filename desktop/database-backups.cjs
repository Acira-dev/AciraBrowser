'use strict';
// Rolling copies of the profile database (browser.sqlite) in backups/ next to it, so a damaged file can be replaced by a recent day's copy
// (database-open.cjs offers it) instead of the person losing their tabs, bookmarks and history.
// - At most one a day, taken at a clean start (the database opened and passed its check, and was not just restored), the last KEEP kept.
// - A copy holds exactly what browser.sqlite holds: ordinary profiles. Private and Tor windows never write to it, so no copy carries them.
// - Clearing history or downloads, or removing a profile, replaces every copy with a fresh one taken from the cleaned database (refresh):
//   what someone cleared must not come back from a backup, and there is still a backup to go back to.
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

/** The highest schema version the file says it has, or null when it cannot be read at all. Both the raw header (bytes 60-63, readable when the rest of the
 *  file is damaged) and SQLite's own answer (which includes a write-ahead log a newer Acira may not have folded in yet) are read. Nothing is written. */
function fileVersion(file){
 const found=[];
 try{const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(64);if(fs.readSync(fd,header,0,64,0)===64&&header.subarray(0,16).toString('latin1')==='SQLite format 3\0')found.push(header.readUInt32BE(60));}finally{fs.closeSync(fd);}}catch{}
 let db;try{db=new DatabaseSync(file,{readOnly:true});found.push(db.prepare('PRAGMA user_version').get().user_version);}catch{}finally{try{db?.close();}catch{}}
 return found.length?Math.max(...found):null;
}

/** A copy that opens, passes quick_check and has a schema between 1 and `supported`. */
function usable(entry,{supported}){
 let db;
 try{
  db=new DatabaseSync(entry.file,{readOnly:true});
  const version=db.prepare('PRAGMA user_version').get().user_version;if(!(version>=1&&version<=supported))return false;
  return Object.values(db.prepare('PRAGMA quick_check').get())[0]==='ok';
 }catch{return false;}finally{try{db?.close();}catch{}}
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

/** Deletes every copy. */
function forget(file){for(const entry of list(file))try{fs.rmSync(entry.file,{force:true});}catch{}}

/** History or downloads were cleared, or a profile was removed: every copy goes, and today's is taken again from the database as it is now. Call it after
 *  every window has saved, so no window's saved state still carries what was cleared. Returns the new copy. */
function refresh(database,{now=Date.now()}={}){forget(database.filename);return take(database,{now});}

/** Puts `entry` in place of `file`. The damaged file and its -wal/-shm companions are moved aside (renamed, never deleted) first, so a stale log is never
 *  applied to the copy. Returns where the damaged file went. If the copy cannot be written, everything is moved back and the error thrown. */
function restore(file,entry,{now=Date.now()}={}){
 const stamp=new Date(now).toISOString().replace(/[:.]/g,'-'),aside=file+'.damaged-'+stamp,moved=[];
 try{
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(file+suffix)){fs.renameSync(file+suffix,aside+suffix);moved.push(suffix);}
  fs.copyFileSync(entry.file,file+'.restoring');try{fs.chmodSync(file+'.restoring',0o600);}catch{}
  fs.renameSync(file+'.restoring',file);
 }catch(error){
  try{fs.rmSync(file+'.restoring',{force:true});}catch{}
  for(const suffix of moved)try{if(!fs.existsSync(file+suffix))fs.renameSync(aside+suffix,file+suffix);}catch{}
  throw error;
 }
 return aside;
}

/** The day as the interface language writes it ("2 November 2026", "2. November 2026", "2026年11月2日"), for the restore message and button. */
function dayLabel(day,locale='en'){const [year,month,date]=String(day).split('-').map(Number);const value=new Date(year,month-1,date);if(!Number.isFinite(value.getTime()))return String(day);try{return value.toLocaleDateString(locale==='en'?'en-GB':locale,{day:'numeric',month:'long',year:'numeric'});}catch{return value.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});}}

module.exports={list,fileVersion,usable,newestUsable,take,forget,refresh,restore,dayOf,dayLabel,folderOf,KEEP};
