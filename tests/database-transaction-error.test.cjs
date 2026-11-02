const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{BrowserDatabase}=require('../desktop/database.cjs');
const open=()=>new BrowserDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'acira-db-tx-')),'browser.sqlite'));
test('when SQLite has already ended the transaction (a full disk does this), the caller sees the real error, not "cannot rollback"',()=>{
 const database=open();
 assert.throws(()=>database.transaction(()=>{database.db.exec('ROLLBACK');throw new Error('database or disk is full');}),/database or disk is full/);
 database.db.close();
});
test('the transaction flag is clear afterwards, so the next save works',()=>{
 const database=open();
 assert.throws(()=>database.transaction(()=>{database.db.exec('ROLLBACK');throw new Error('disk full');}),/disk full/);
 assert.equal(database.inTransaction,false);
 database.transaction(()=>database.setMetadata('after','ok'));assert.equal(database.getMetadata('after'),'ok');
 database.db.close();
});
test('an ordinary failure still rolls the whole transaction back',()=>{
 const database=open();
 assert.throws(()=>database.transaction(()=>{database.setMetadata('half','written');throw new Error('boom');}),/boom/);
 assert.equal(database.getMetadata('half'),null);database.db.close();
});
