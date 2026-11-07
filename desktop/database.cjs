'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const json=value=>JSON.stringify(value),parse=value=>JSON.parse(value);
/** Schema upgrades after version 1: MIGRATIONS[0] takes a version-1 file to version 2, MIGRATIONS[1] version 2 to 3, and so on, each a function of the open
 *  DatabaseSync. Before the first step a copy of the file as it is goes to backups/browser-before-v<N>.sqlite (kept, never pruned); each step runs in its
 *  own transaction, so a step that fails leaves the file at the last version that worked. Adding a table or column later is one entry here. */
const MIGRATIONS=[];
const SCHEMA=1+MIGRATIONS.length; // the newest schema this Acira understands; a file with a higher user_version was written by a newer Acira
/** What went wrong, for database-open.cjs: only a 'damaged' file may be replaced (restored or started fresh). A busy, read-only or full disk is not damage. */
const NEWER='ACIRA_NEWER_DATA',DAMAGED='ACIRA_DAMAGED_DATA',UPGRADE_FAILED='ACIRA_UPGRADE_FAILED';
const failure=(code,message)=>Object.assign(new Error(message),{code});
function kindOf(error){
 if(error?.code===NEWER||/newer Acira/i.test(String(error?.message)))return 'newer';
 if(error?.code===UPGRADE_FAILED)return 'upgrade';
 if(error?.code===DAMAGED||[11,26].includes(Number(error?.errcode)&0xff)||/malformed|not a database|integrity check failed/i.test(String(error?.message)))return 'damaged';
 return 'other';
}
/** A first, read-only look at a file that is already there. A file written by a newer Acira, or a damaged one, is then left exactly as it was, its
 *  write-ahead log included: a read-write connection that closes folds the log into the file (or drops a log it cannot use), a read-only one never does.
 *  The -wal/-shm companions the look had to make are removed again when it fails. */
function inspect(filename,latest){
 if(!fs.existsSync(filename))return;
 const had=new Set(['-wal','-shm'].filter(suffix=>fs.existsSync(filename+suffix)));let db=null,fine=false;
 try{
  db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA busy_timeout=3000;');
  if(db.prepare('PRAGMA user_version').get().user_version>latest)throw failure(NEWER,'This profile was created by a newer Acira version.');
  if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw failure(DAMAGED,'Browser data integrity check failed. Your data has been preserved.');
  fine=true;
 }catch(error){
  // only a newer or damaged file stops here; anything a read-only look cannot do (roll back a journal left by a crash, make a -shm in a read-only
  // folder) is left to the ordinary open below, as before
  if(kindOf(error)==='newer'||kindOf(error)==='damaged')throw error;
 }finally{try{db?.close();}catch{}if(!fine)for(const suffix of ['-wal','-shm'])if(!had.has(suffix))try{fs.rmSync(filename+suffix,{force:true});}catch{}}
}
class BrowserDatabase{
 constructor(filename,{migrations=MIGRATIONS}={}){
  fs.mkdirSync(path.dirname(filename),{recursive:true});this.filename=filename;
  inspect(filename,1+migrations.length);
  this.db=new DatabaseSync(filename);
  try {
  this.db.exec('PRAGMA busy_timeout=3000;');
  // the version is read before anything is set: a profile from a newer Acira is left exactly as it was (not even switched to WAL)
  const latest=1+migrations.length;let version=this.db.prepare('PRAGMA user_version').get().user_version;if(version>latest){try{this.db.close();}catch{}throw failure(NEWER,'This profile was created by a newer Acira version.');}
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
  const created=version===0;
  if(created)this.transaction(()=>this.db.exec(`
   CREATE TABLE profiles(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE bookmarks(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,parent_id TEXT,position INTEGER NOT NULL,payload TEXT NOT NULL);
   CREATE INDEX bookmarks_profile ON bookmarks(profile_id,parent_id,position);
   CREATE TABLE history(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,visited_at TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE INDEX history_profile ON history(profile_id,visited_at);
   CREATE TABLE downloads(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE windows(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE permissions(profile_id TEXT NOT NULL,requester TEXT NOT NULL,embedder TEXT NOT NULL,permission TEXT NOT NULL,decision TEXT NOT NULL,PRIMARY KEY(profile_id,requester,embedder,permission));
   CREATE TABLE policies(profile_id TEXT NOT NULL,site TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(profile_id,site));
   CREATE TABLE imports(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   PRAGMA user_version=1;
  `));
  if(created)version=1;
  if(version<latest){
   // a new profile has nothing to keep; an existing one is copied whole before its first change
   if(!created)try{const folder=path.join(path.dirname(filename),'backups');fs.mkdirSync(folder,{recursive:true,mode:0o700});const target=path.join(folder,'browser-before-v'+latest+'.sqlite');if(!fs.existsSync(target)){this.backup(target);try{fs.chmodSync(target,0o600);}catch{}}}catch(error){throw failure(UPGRADE_FAILED,'Your saved data could not be copied before it was updated, so it was left as it was ('+error.message+').');}
   for(let at=version;at<latest;at++){try{this.transaction(()=>{migrations[at-1](this.db);this.db.exec('PRAGMA user_version='+(at+1));});}catch(error){throw failure(UPGRADE_FAILED,'Your saved data could not be updated to version '+(at+1)+' ('+error.message+'). It is still at version '+at+'.');}}
  }
  } catch (error) {
   // Windows cannot move a damaged database aside while the failed open still owns its handle.
   try { this.db.close(); } catch {}
   throw error;
  }
 }
 transaction(fn){if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){try{this.db.exec('ROLLBACK');}catch{/* SQLite already ended it (a full disk does); the caller needs the real error */}throw error;}finally{this.inTransaction=false;}}
 readWindow(id){const row=this.db.prepare('SELECT payload FROM windows WHERE id=?').get(id);return row?parse(row.payload):null;}
 /** A window record nothing can open again (profiles as spaces: a profile window joined into another): it goes, with the copy of history and bookmarks it carried. */
 deleteWindow(id){this.db.prepare('DELETE FROM windows WHERE id=?').run(id);}
 saveWindow(id,snapshot){this.transaction(()=>{
  this.db.prepare('INSERT INTO windows VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(id,json(snapshot),Date.now());
  const profiles=new Set(snapshot.browserProfiles.filter(p=>!p.private).map(p=>p.id));
  const profile=this.db.prepare('INSERT INTO profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');for(const p of snapshot.browserProfiles)if(profiles.has(p.id))profile.run(p.id,json(p));
  const bookmark=this.db.prepare('INSERT INTO bookmarks VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,parent_id=excluded.parent_id,position=excluded.position,payload=excluded.payload');
  const visit=this.db.prepare('INSERT INTO history VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const download=this.db.prepare('INSERT INTO downloads VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  // Browser-owned collections are committed with window metadata. Private entries are never serialized.
  for(const p of profiles){this.db.prepare('DELETE FROM bookmarks WHERE profile_id=?').run(p);this.db.prepare('DELETE FROM history WHERE profile_id=?').run(p);this.db.prepare('DELETE FROM downloads WHERE profile_id=?').run(p);}
  for(const b of snapshot.bookmarkNodes)if(profiles.has(b.browserProfileId))bookmark.run(b.id,b.browserProfileId,b.parentId,b.position,json(b));
  for(const h of snapshot.browsingHistory)if(profiles.has(h.browserProfileId))visit.run(h.id,h.browserProfileId,h.time,json(h));
  for(const d of snapshot.downloads)if(profiles.has(d.browserProfileId))download.run(d.id,d.browserProfileId,json(d));
 });}
 permission(profile,requester,embedder,permission){return this.db.prepare('SELECT decision FROM permissions WHERE profile_id=? AND requester=? AND embedder=? AND permission=?').get(profile,requester,embedder,permission)?.decision;}
 setPermission(profile,requester,embedder,permission,decision){if(decision==='ask')this.db.prepare('DELETE FROM permissions WHERE profile_id=? AND requester=? AND embedder=? AND permission=?').run(profile,requester,embedder,permission);else this.db.prepare('INSERT INTO permissions VALUES(?,?,?,?,?) ON CONFLICT(profile_id,requester,embedder,permission) DO UPDATE SET decision=excluded.decision').run(profile,requester,embedder,permission,decision);}
 permissions(profile){return this.db.prepare('SELECT requester,embedder,permission,decision FROM permissions WHERE profile_id=?').all(profile);}
 setPolicy(profile,site,value){this.db.prepare('INSERT INTO policies VALUES(?,?,?) ON CONFLICT(profile_id,site) DO UPDATE SET payload=excluded.payload').run(profile,site,json(value));}
 deletePolicy(profile,site){this.db.prepare('DELETE FROM policies WHERE profile_id=? AND site=?').run(profile,site);}
 policy(profile,site){const row=this.db.prepare('SELECT payload FROM policies WHERE profile_id=? AND site=?').get(profile,site);return row?parse(row.payload):null;}
 policies(profile){return this.db.prepare('SELECT site,payload FROM policies WHERE profile_id=?').all(profile).map(row=>({site:row.site,...parse(row.payload)}));}
 recordImport(batch){this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(batch.id,batch.profileId,json(batch));}
 updateImport(batch){this.db.prepare('UPDATE imports SET payload=? WHERE id=? AND profile_id=?').run(json(batch),batch.id,batch.profileId);}
 clearPermissions(profile,site){if(site)this.db.prepare('DELETE FROM permissions WHERE profile_id=? AND (requester=? OR embedder=?)').run(profile,site,site);else this.db.prepare('DELETE FROM permissions WHERE profile_id=?').run(profile);}
 imports(profile){return this.db.prepare('SELECT payload FROM imports WHERE profile_id=?').all(profile).map(r=>parse(r.payload));}
 removeProfile(profile){this.transaction(()=>{for(const table of ['bookmarks','history','downloads','permissions','policies','imports'])this.db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(profile);this.db.prepare('DELETE FROM profiles WHERE id=?').run(profile);});}
 getMetadata(key){return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value??null;}
 setMetadata(key,value){this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
 /** Folds the write-ahead log into the database and empties it, so rows deleted a moment ago (cleared history) are not left in the -wal file. */
 scrub(){this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
 /** A complete, compacted copy at `target` (database-backups.cjs keeps the daily ones). Written beside it first and renamed, so a copy is never half there. */
 backup(target=this.filename+'.bak'){this.db.exec('PRAGMA wal_checkpoint(FULL)');fs.rmSync(target+'.next',{force:true});this.db.exec(`VACUUM INTO '${target.replaceAll("'","''")}.next'`);fs.renameSync(target+'.next',target);}
 close(){this.db.close();}
}
module.exports={BrowserDatabase,SCHEMA,MIGRATIONS,kindOf,NEWER,DAMAGED,UPGRADE_FAILED};
