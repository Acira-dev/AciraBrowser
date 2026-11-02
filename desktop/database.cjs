'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const json=value=>JSON.stringify(value),parse=value=>JSON.parse(value);
class BrowserDatabase{
 constructor(filename){
  fs.mkdirSync(path.dirname(filename),{recursive:true});this.filename=filename;
  this.db=new DatabaseSync(filename);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON;');
  const version=this.db.prepare('PRAGMA user_version').get().user_version;if(version>1)throw new Error('This profile was created by a newer Acira version.');
  if(version===0)this.transaction(()=>this.db.exec(`
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
  const checked=this.db.prepare('PRAGMA quick_check').get();if(Object.values(checked)[0]!=='ok')throw new Error('Browser data integrity check failed. Your data has been preserved.');
 }
 transaction(fn){if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.inTransaction=false;}}
 readWindow(id){const row=this.db.prepare('SELECT payload FROM windows WHERE id=?').get(id);return row?parse(row.payload):null;}
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
 backup(){this.db.exec('PRAGMA wal_checkpoint(FULL)');const target=this.filename+'.bak';this.db.exec(`VACUUM INTO '${target.replaceAll("'","''")}.next'`);fs.renameSync(target+'.next',target);}
 close(){this.db.close();}
}
module.exports={BrowserDatabase};
