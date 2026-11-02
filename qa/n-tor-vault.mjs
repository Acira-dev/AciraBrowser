// Stream N: the Tor vault in the real app, with a disk scan of the whole profile folder.
//   run 1, vault OFF: a Tor tab with a marker address is opened and the app quits; the marker must not be anywhere on disk and no tor-vault folder exists.
//   run 2, vault ON (Windows check stood in by ACIRA_PASSWORDS_TEST_GATE=allow, a switch that only works unpackaged in a test profile): a Tor tab is
//         bookmarked and left open; after quit the files exist but no marker appears in plaintext; the vault reads it back.
//   run 3: reopen last Tor tabs, remove the bookmark, clear all; nothing of the marker is left.
// Three launches in sequence, each closed in finally; at most 4 tabs. node qa/n-tor-vault.mjs
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startApp, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/n-tor-vault'); await fs.rm(root, {recursive: true, force: true});
const marker = 'ntorvault' + randomUUID().replace(/-/g, '').slice(0, 14), url = `https://${marker}.example/page`;
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const exists = async p => fs.stat(p).then(() => true, () => false);

async function scan() {
  const hits = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      const found = await new Promise(resolve => { let tail = ''; const stream = createReadStream(file); stream.on('data', chunk => { const text = tail + chunk.toString('latin1'); if (text.includes(marker)) { resolve(true); stream.destroy(); } tail = text.slice(-64); }); stream.on('end', () => resolve(false)); stream.on('error', () => resolve(false)); });
      if (found) hits.push(path.relative(root, file));
    }
  }
  await walk(root); return hits;
}
async function torTab(app, {open = true} = {}) {
  if (open) await app.act({type: 'tab.new', privacy: 'tor', url});
  return poll(async () => (await app.state()).tabs.find(t => t.privacy === 'tor'), Boolean, 'tor tab', 20000);
}
const launch = () => startApp({root, env: {ACIRA_PASSWORDS_TEST_GATE: 'allow'}});

// run 1: OFF
let app = await launch();
try {
  const status = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-status'}));
  check(status.torVault.enabled === false, 'the Tor vault is off by default');
  await torTab(app); await sleep(1500);
  const r = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-bookmark'})).then(() => 'saved', e => String(e.message));
  check(/off|Keeping Tor items is off/i.test(r), `bookmarking while off is refused (${r.slice(-50)})`);
} finally { await app.close().catch(() => {}); }
check((await scan()).length === 0, 'run 1 (off): the Tor tab\'s address is nowhere on disk after quit');
check(!(await exists(path.join(root, 'tor-vault'))), 'run 1 (off): no tor-vault folder was created');

// run 2: ON
app = await launch();
try {
  const on = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-set', enabled: true}));
  check(on.torVault.enabled === true, 'turned on (after the Windows check)');
  await torTab(app); await sleep(1500);
  const saved = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-bookmark'}));
  check(saved.saved === 'saved', 'a Tor tab is bookmarked into the Tor vault');
  const ordinary = (await app.state()).bookmarks || [];
  check(!JSON.stringify(ordinary).includes(marker), 'the normal bookmarks never receive it');
} finally { await app.close().catch(() => {}); }
const hits2 = await scan();
check(hits2.length === 0, `run 2 (on): files exist but hold the address nowhere in plaintext (${hits2.join(', ') || 'none'})`);
check(await exists(path.join(root, 'tor-vault', 'items.vault')), 'run 2 (on): the encrypted vault file exists');

// run 3: read back, reopen, remove, clear
app = await launch();
try {
  const list = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-list'}));
  check(list.torVault.bookmarks.length === 1 && list.torVault.bookmarks[0].url.includes(marker), 'the bookmark reads back after a restart');
  const reopened = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-reopen'}));
  await sleep(1500);
  const tabs = (await app.state()).tabs.filter(t => t.privacy === 'tor');
  check(reopened.reopened >= 1 && tabs.some(t => t.url.includes(marker)), `Reopen last Tor tabs opens them as Tor tabs (${reopened.reopened})`);
  await app.ui.evaluate(id => window.acira.native({type: 'tor.vault-remove', id}), list.torVault.bookmarks[0].id);
  const after = await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-list'}));
  check(after.torVault.bookmarks.length === 0, 'a bookmark can be removed');
  await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-clear'}));
  check(!(await exists(path.join(root, 'tor-vault', 'items.vault'))) && !(await exists(path.join(root, 'tor-vault', 'master.key'))), 'clear removes the items and the key');
  await app.ui.evaluate(() => window.acira.native({type: 'tor.vault-set', enabled: false}));
} finally { await app.close().catch(() => {}); }
const hits3 = await scan();
check(hits3.length === 0, `run 3: nothing of the address is left on disk (${hits3.join(', ') || 'none'})`);
console.log(`\n${report.length} passed, ${fail.length} failed`); if (fail.length) { console.log('FAILED:\n- ' + fail.join('\n- ')); process.exitCode = 1; }
