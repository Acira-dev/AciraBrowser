// Windows release check (run by qa/release-package-launch.mjs on a Windows PC): sign-ins survive the cookie encryption fuse
// (packaging/fuses.cjs). Up to beta.9 Windows shipped Electron's default fuses, so cookies were plain rows on disk; beta.10 encrypts them.
//   1. Stock Electron writes a persistent cookie into the profile's website session, as beta.9 did (a plain row).
//   2. The fused program reads it, then sets its own persistent cookie.
//   3. The fused program, relaunched, reads both.
//   4. On disk, the stock cookie is the plain row it was, and the fused program's own cookie is encrypted.
// Stock first: the other way round, stock Electron would drop rows it cannot decrypt (a downgrade, not the upgrade people make).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const host = path.resolve('qa/release-fused-cookie-host.cjs');
const read = app => (partition, url) => app.evaluate(async ({session}, [partition, url]) => (await session.fromPartition(partition).cookies.get({url})).map(cookie => ({name: cookie.name, value: cookie.value, session: cookie.session})), [partition, url]);
/** launch(): starts the fused program on `data` (Playwright's ElectronApplication); stockElectron: a stock Electron of the same version; partition: the
 *  active profile's website session (state.browserProfiles[...].partition); url: an http address on a local fixture. Returns the report entry. */
export async function checkFusedCookies({launch, stockElectron, stockArgs = [], data, partition, url}) {
  const out = {partition};
  const env = {...process.env, ACIRA_FUSED_COOKIE_DATA: data, ACIRA_FUSED_COOKIE_PARTITION: partition, ACIRA_FUSED_COOKIE_URL: url};
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_OVERRIDE_DIST_PATH']) delete env[name];
  out.stock = await new Promise((resolve, reject) => {
    const child = spawn(stockElectron, [...stockArgs, host], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}); let text = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('stock Electron never answered: ' + text.slice(-400))); }, 60000);
    child.stdout.on('data', chunk => { text += chunk; const line = /STOCK (.*)\n/.exec(text); if (line) { clearTimeout(timer); resolve(JSON.parse(line[1])); } });
    child.once('exit', code => { if (!/STOCK /.test(text)) { clearTimeout(timer); reject(new Error('stock Electron exited ' + code + ': ' + text.slice(-400))); } });
  });
  assert.equal(out.stock.ok, true, 'stock Electron wrote its cookie: ' + out.stock.error);
  let app = await launch();
  try {
    out.firstRun = await read(app)(partition, url);
    assert.ok(out.firstRun.some(cookie => cookie.name === 'acira_stock' && cookie.value === 'set-by-stock-electron'), 'the fused program reads a cookie stock Electron wrote: ' + JSON.stringify(out.firstRun));
    await app.evaluate(async ({session}, [partition, url]) => { const ses = session.fromPartition(partition); await ses.cookies.set({url, name: 'acira_fused', value: 'set-by-fused-program', expirationDate: Math.floor(Date.now() / 1000) + 3600}); await ses.cookies.flushStore(); }, [partition, url]);
  } finally { await app.close(); }
  app = await launch();
  try { out.relaunch = await read(app)(partition, url); } finally { await app.close(); }
  for (const [name, value] of [['acira_stock', 'set-by-stock-electron'], ['acira_fused', 'set-by-fused-program']]) assert.ok(out.relaunch.some(cookie => cookie.name === name && cookie.value === value && !cookie.session), `${name} is still there after a relaunch: ${JSON.stringify(out.relaunch)}`);
  // On disk: Chromium keeps a plain row as it is, and writes its own cookies encrypted ("v10"/"v11" in encrypted_value, value empty).
  try {
    const {DatabaseSync} = await import('node:sqlite'), files = []; const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.name === 'Cookies') files.push(file); } }; walk(data);
    out.onDisk = {};
    for (const file of files) { const db = new DatabaseSync(file, {readOnly: true}); try { for (const row of db.prepare("SELECT name, value, encrypted_value FROM cookies WHERE name IN ('acira_stock','acira_fused')").all()) out.onDisk[row.name] = {file: path.relative(data, file), plain: row.value !== '', encrypted: Buffer.from(row.encrypted_value).subarray(0, 3).toString()}; } finally { db.close(); } }
    assert.equal(out.onDisk.acira_fused?.plain, false, 'the fused program writes cookies encrypted'); assert.match(out.onDisk.acira_fused?.encrypted || '', /^v1\d$/);
    assert.equal(out.onDisk.acira_stock?.plain, true, 'the stock cookie was a plain row');
  } catch (error) { if (error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE') out.onDisk = 'not checked: this Node has no node:sqlite'; else throw error; }
  return out;
}
