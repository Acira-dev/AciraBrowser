// Mac only. A packaged Acira on a test profile must keep cookies with Chromium's mock keychain, not the app's Keychain key: otherwise a copy of the
// person's profile, run as a "test profile" with a debugging port, would show their cookies decrypted with no Keychain prompt (desktop/test-hooks.cjs).
// Runs the real main.cjs in a packaged-like copy of Electron (isPackaged true, the shipped Mac fuses burned in except the two asar ones, so cookies
// are encrypted), started WITHOUT --use-mock-keychain, sets a cookie from a local page, quits, and opens the cookie as stored in the profile with
// the mock keychain key.
//   node qa/r14-mock-keychain-packaged.mjs <Acira.app whose MacOS/AciraBrowser is a renamed Electron, Resources/app this checkout> <profile folder>
// Only run it on a build whose desktop/test-hooks.cjs adds the mock keychain (tests/test-hooks-keychain.test.cjs passes first): on one that does
// not, the copy would use the real Keychain. Prints one JSON line.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const [app, data] = process.argv.slice(2);
if (process.platform !== 'darwin' || !app || !data || !path.isAbsolute(data) || !data.startsWith('/tmp/acira-qa/')) { console.error('usage: node qa/r14-mock-keychain-packaged.mjs <Acira.app> </tmp/acira-qa/.../profile>'); process.exit(2); }
const exe = path.join(app, 'Contents', 'MacOS', 'AciraBrowser');
fs.rmSync(data, {recursive: true, force: true}); fs.mkdirSync(path.join(data, 'downloads'), {recursive: true}); fs.mkdirSync(path.join(path.dirname(data), 'fakehome'), {recursive: true});
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); }); });
const site = http.createServer((_request, response) => { response.setHeader('set-cookie', 'acira_check=mock-keychain; Max-Age=3600; Path=/'); response.setHeader('content-type', 'text/html'); response.end('<title>cookie set</title>'); });
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const port = await freePort(), out = {exe: path.basename(exe)};
const env = {...process.env, ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(data, 'downloads'), ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_QA_RUN: '1', HOME: path.join(path.dirname(data), 'fakehome')};
for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_OVERRIDE_DIST_PATH']) delete env[name];
const child = spawn(exe, ['--remote-debugging-port=' + port], {env, stdio: ['ignore', 'pipe', 'pipe']});
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let browser; for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); } catch { await sleep(250); } }
  if (!browser) throw new Error('no CDP on the port: ' + log.slice(-600));
  let ui; for (let i = 0; i < 120 && !ui; i++) { ui = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await sleep(250); }
  if (!ui) throw new Error('no interface page');
  await ui.waitForFunction(() => Boolean(window.acira), null, {timeout: 20000});
  try { const skip = ui.getByRole('button', {name: 'Skip setup'}); await skip.waitFor({timeout: 5000}); await skip.click(); await sleep(1500); } catch {}
  await ui.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), `http://127.0.0.1:${site.address().port}/`);
  for (let i = 0; i < 80 && !out.loaded; i++) { const tabs = await ui.evaluate(async () => (await window.acira.getSnapshot()).tabs.map(t => t.title)); out.loaded = tabs.includes('cookie set'); if (!out.loaded) await sleep(250); }
  await browser.close().catch(() => {});
} catch (error) { out.error = String(error.message || error).slice(0, 400); }
finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)), sleep(15000).then(() => child.kill('SIGKILL'))]);
  site.close();
}
// The cookie as stored: "v10" + AES-128-CBC with PBKDF2 of the Keychain password; newer Chromium puts SHA-256 of the host in front of the value.
const files = []; const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (entry.name === 'Cookies') files.push(file); } }; walk(data);
const key = crypto.pbkdf2Sync('mock_password', 'saltysalt', 1003, 16, 'sha1');
for (const file of files) {
  const db = new DatabaseSync(file, {readOnly: true});
  try { for (const row of db.prepare("SELECT host_key, encrypted_value FROM cookies WHERE name='acira_check'").all()) {
    const blob = Buffer.from(row.encrypted_value); out.stored = {file: path.relative(data, file), prefix: blob.subarray(0, 3).toString(), bytes: blob.length};
    try { const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' ')); let plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]); const hash = crypto.createHash('sha256').update(row.host_key).digest(); if (plain.length >= 32 && plain.subarray(0, 32).equals(hash)) plain = plain.subarray(32); out.openedWithMockKey = plain.toString(); } catch (error) { out.openedWithMockKey = null; out.mockKeyError = String(error.message || error); }
  } } finally { db.close(); }
}
out.ok = out.loaded === true && out.openedWithMockKey === 'mock-keychain';
console.log(JSON.stringify(out));
if (!out.ok) process.exitCode = 1;
