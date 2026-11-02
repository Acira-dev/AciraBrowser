// Round 10 hunt: Settings > Privacy > Clear browsing data really clears what it says (isolated profile, hidden window, one instance).
// Seeds history, a bookmark, a cookie, localStorage, an HTTP-cached file and a closed tab, then clears one category at a time.
import fs from 'node:fs/promises';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
let failed = 0; const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
let hits = 0;
const fx = await httpFixture((req, res) => {
  if (req.url === '/asset.txt') { hits++; res.writeHead(200, {'content-type': 'text/plain', 'cache-control': 'max-age=3600'}); return res.end('cached ' + hits); }
  res.writeHead(200, {'content-type': 'text/html', 'set-cookie': 'seed=1; Path=/; Max-Age=3600'});
  res.end(`<!doctype html><title>Seed ${req.url}</title><script>localStorage.setItem('seed','1');indexedDB.open('seed').onsuccess=e=>e.target.result.close();fetch('/asset.txt').then(r=>r.text())</script><h1>${req.url}</h1>`);
});
const root = '.qa-profiles/r10-clear-data'; await fs.rm(root, {recursive: true, force: true});
const app = await startApp({root});
const clear = (categories, range = 'all') => app.ui.evaluate(([categories, range]) => window.acira.service({type: 'data.clear', categories, range}).then(r => ({ok: true, r}), e => ({ok: false, e: String(e?.message || e)})), [categories, range]);
const stores = () => app.main(async ({session}, partition) => {
  const ses = session.fromPartition(partition);
  const cookies = (await ses.cookies.get({})).length;
  const dir = ses.storagePath; return {cookies, dir};
}, null);
try {
  const base = `http://127.0.0.1:${fx.port}`;
  const profile = (await app.state()).browserProfiles.find(p => !p.private);
  const partition = profile.partition;
  const seed = async () => {
    for (const p of ['/one', '/two']) { await app.act({type: 'tab.new', url: base + p}); await sleep(900); }
    await sleep(800);
  };
  const cookieCount = () => app.main(async ({session}, partition) => (await session.fromPartition(partition).cookies.get({})).length, partition);
  const local = async () => { const page = app.web(u => u.startsWith(base)); return page ? page.evaluate(() => localStorage.getItem('seed')) : 'no-page'; };
  const cacheSize = () => app.main(async ({session}, partition) => session.fromPartition(partition).getCacheSize(), partition);
  await seed();
  await app.act({type: 'bookmark.toggle', url: base + '/one'});
  let s = await app.state();
  check(s.browsingHistory.length >= 2, 'seeded history: ' + s.browsingHistory.length);
  check(await cookieCount() >= 1, 'seeded cookie: ' + await cookieCount());
  check(await local() === '1', 'seeded localStorage');
  check(await cacheSize() > 0, 'seeded cache: ' + await cacheSize());
  // close a tab so there is an undo/closed-tab entry for a page in history
  const two = s.tabs.find(t => t.url.endsWith('/two')); await app.act({type: 'tab.close', id: two.id}); await sleep(500);
  check((await app.state()).closedTabs?.length >= 1, 'closed tab recorded');

  // a short range with all-time-only categories must be refused, not silently widened
  const refused = await clear(['cookies'], 'hour'); check(!refused.ok && /all time/i.test(refused.e), 'cookies + last hour refused: ' + refused.e);
  check(await cookieCount() >= 1, 'refused request cleared nothing');

  // cache only
  const c = await clear(['cache']); check(c.ok, 'clear cache ok ' + (c.e || '')); await sleep(300);
  check(await cacheSize() < 200, 'cache emptied (an empty index stays): ' + await cacheSize());
  check(await cookieCount() >= 1 && (await app.state()).browsingHistory.length >= 2, 'cache clear leaves cookies and history');

  // cookies only
  const k = await clear(['cookies']); check(k.ok, 'clear cookies ok ' + (k.e || '')); await sleep(300);
  check(await cookieCount() === 0, 'cookies gone: ' + await cookieCount());
  check(await local() === '1', 'cookie clear leaves localStorage (control)');

  // site storage
  const st = await clear(['storage']); check(st.ok, 'clear storage ok ' + (st.e || '')); await sleep(500);
  const page = app.web(u => u.startsWith(base)); const left = page ? await page.evaluate(async () => ({ls: localStorage.getItem('seed'), dbs: (await indexedDB.databases()).length})).catch(e => ({err: String(e)})) : null;
  check(left && !left.ls && left.dbs === 0, 'storage cleared in the open page: ' + JSON.stringify(left));

  // history + downloads
  s = await app.state(); check(s.bookmarks?.length >= 1 || s.bookmarks === undefined, 'bookmark exists before history clear: ' + s.bookmarks?.length);
  const h = await clear(['history', 'downloads']); check(h.ok, 'clear history ok ' + (h.e || '')); await sleep(400);
  s = await app.state();
  check(s.browsingHistory.filter(v => v.browserProfileId === profile.id).length === 0, 'history empty: ' + s.browsingHistory.length);
  check(!s.closedTabs.some(t => t.url.startsWith(base)), 'closed tabs for cleared pages are forgotten: ' + s.closedTabs.length);
  check(s.bookmarks?.length >= 1, 'bookmarks untouched by clearing: ' + s.bookmarks?.length);
  check(!JSON.stringify(s.toast || {}).includes('Undo') || !s.toast?.action?.command?.type?.includes('restore'), 'no stale Undo-restore toast: ' + JSON.stringify(s.toast));
  const ntp = await app.ui.evaluate(() => window.acira.getSnapshot().then(x => x.recent ?? null)).catch(() => null);
  console.log('note: snapshot recent =', JSON.stringify(ntp)?.slice(0, 120));
  const list = await fs.readdir(root, {recursive: true}).catch(() => []);
  console.log('profile files:', list.length);
  // what is on disk afterwards: does the history marker still exist anywhere in the profile?
  let found = [];
  for (const f of list) { const p = `${root}/${f}`; try { const st2 = await fs.stat(p); if (!st2.isFile() || st2.size > 40e6) continue; const buf = await fs.readFile(p); if (buf.includes(Buffer.from(`127.0.0.1:${fx.port}/two`))) found.push(f); } catch {} }
  console.log('files still naming /two after clear:', JSON.stringify(found.slice(0, 12)));
  check(!found.some(f => /browser.sqlite/.test(f)), 'cleared history is not left in browser.sqlite or its -wal: ' + JSON.stringify(found.filter(f => /browser.sqlite/.test(f))));
} finally { await app.close(); await fx.close(); }
console.log(failed ? `FAILED ${failed}` : 'ALL OK'); process.exit(failed ? 1 : 0);
