// Real-app import from a synthetic Chrome profile held open by a second
// process. Never discover or read the founder's installed browser profiles.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {startApp} from './d-harness.mjs';
const root = path.resolve('.qa-profiles', 'd-import-running-' + Date.now());
const local = path.join(root, 'fixture-local'), roaming = path.join(root, 'fixture-roaming');
const userData = path.join(local, 'Google', 'Chrome', 'User Data'), location = path.join(userData, 'Default');
await fs.mkdir(location, {recursive: true}); await fs.mkdir(roaming, {recursive: true});
await fs.writeFile(path.join(userData, 'Local State'), JSON.stringify({profile: {info_cache: {Default: {name: 'QA locked Chrome'}}}}));
await fs.writeFile(path.join(location, 'Bookmarks'), JSON.stringify({roots: {bookmark_bar: {name: 'Bookmarks bar', children: [{type: 'url', name: 'QA page', url: 'https://example.org/import-fixture', guid: 'qa-import'}]}}}));
const chromeTime = ms => (BigInt(ms) + 11644473600000n) * 1000n;
const db = new DatabaseSync(path.join(location, 'History'));
db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');
const insert = db.prepare('INSERT INTO urls VALUES(?,?,?)');
for (let i = 0; i < 3; i++) insert.run(`https://example.org/locked-${i}`, `QA visit ${i}`, chromeTime(Date.now() - i * 60000));
db.close();
const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA locking_mode=EXCLUSIVE');db.exec("INSERT INTO urls VALUES('https://example.org/latest','Latest',${chromeTime(Date.now())})");console.log('locked');process.stdin.resume();process.stdin.on('end',()=>{db.close();process.exit(0)});`;
const holder = spawn(process.execPath, ['--no-warnings', '-e', code, path.join(location, 'History')], {windowsHide: true, stdio: ['pipe', 'pipe', 'inherit']});
const hash = async () => Object.fromEntries(await Promise.all((await fs.readdir(location)).sort().map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(location, name))).digest('hex')])));
let app; const report = [];
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic browser did not lock History')), 10000);
    holder.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    holder.once('error', error => { clearTimeout(timer); reject(error); });
    holder.once('exit', code => { clearTimeout(timer); reject(Error('Synthetic browser exited ' + code)); });
  });
  const originals = await hash();
  app = await startApp({root, env: {APPDATA: roaming, LOCALAPPDATA: local}});
  const {sources} = await app.svc({type: 'imports.discover'});
  const source = sources.find(s => s.browser === 'Chrome' && s.available.history);
  assert.ok(source, 'synthetic Chrome profile discovered');
  assert.equal(sources.filter(s => s.available.history).length, 1, 'only synthetic history discovered');
  const {preview} = await app.svc({type: 'imports.preview', sourceId: source.id});
  assert.ok(preview.history >= 3, 'locked history preview reads committed rows');
  assert.ok(!/ERR_|SQLITE|locked/i.test(JSON.stringify(preview.warnings)));
  const {batch} = await app.svc({type: 'imports.run', sourceId: source.id, categories: ['bookmarks', 'history']});
  const history = batch.results.find(r => r.category === 'history');
  assert.equal(history.status, 'imported', JSON.stringify(batch.results)); assert.ok(history.count >= 3);
  assert.equal((await app.state()).browsingHistory.filter(v => v.importBatchId === batch.id).length, history.count);
  assert.deepEqual(await hash(), originals, 'source files unchanged while locked');
  await app.svc({type: 'imports.undo', batchId: batch.id});
  assert.equal((await app.state()).browsingHistory.filter(v => v.importBatchId === batch.id).length, 0);
  report.push(`Imported ${history.count} locked fixture entries, source unchanged, undo verified`);
} finally {
  try { await app?.close(); } finally {
    holder.stdin.end();
    if (holder.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { holder.kill(); resolve(); }, 3000);
      holder.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
console.log(JSON.stringify({ok: true, report}, null, 1));
