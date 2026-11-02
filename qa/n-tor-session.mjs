// R3-61: one Tor connection per app session, in the real app (needs internet). One instance, a handful of tabs, closed in finally.
//   node qa/n-tor-session.mjs [--fresh]     (--fresh = empty Tor data folder: a full first bootstrap, 1-2 minutes)
//  1. opening a Tor tab (no page typed) starts connecting at once: tor.exe exists and status leaves "idle" within seconds
//  2. check.torproject.org says "Congratulations" in that tab (one bootstrap)
//  3. a second Tor tab, a Tor window and a third tab never start a second tor.exe (same process id) or a second bootstrap (state stays ready)
//  4. closing every Tor tab and window keeps tor.exe (same pid); a new Tor tab is connected at once
//  5. New Tor identity (the native request) replaces the Tor tabs of every window with one fresh Tor tab each, ordinary tabs stay; Ctrl+Shift+U opens the confirmation
//  6. tor.exe ends with Acira
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/n-tor-session');
if (process.argv.includes('--fresh')) await fs.rm(root, {recursive: true, force: true});
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const ownTor = () => execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'}).split(/\r?\n/).filter(l => l.includes(root)).map(l => Number(l.split('|')[0]));

const listener = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>ordinary</title>ok'); });
const app = await startApp({root});
let closed = false;
const status = () => app.ui.evaluate(() => window.acira.native({type: 'tor.status'}).then(r => r.tor));
const torTabs = async () => (await app.state()).tabs.filter(t => t.privacy === 'tor');
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${listener.port}/normal`});
  check(ownTor().length === 0, 'no tor.exe before any Tor tab opens');

  // 1. A new Tor tab with nothing typed: connecting starts at once.
  const opened = Date.now();
  await app.act({type: 'tab.new', privacy: 'tor'});
  const started = await poll(status, s => s && s.state !== 'idle', 'tor left idle', 8000);
  check(Date.now() - opened < 8000 && ['starting', 'connecting', 'ready'].includes(started.state), `opening a Tor tab starts Tor at once, before any page is typed (state "${started.state}" after ${Date.now() - opened} ms)`);
  const pids = await poll(() => ownTor(), p => p.length >= 1, 'tor.exe running', 20000);
  check(pids.length === 1, `exactly one tor.exe for this profile (${pids.join(',')})`);
  const ready = await poll(status, s => s && s.state === 'ready', 'tor ready', 300000);
  console.log(`bootstrapped in ${Math.round((Date.now() - opened) / 1000)} s (first connection: ${started.firstConnection})`);

  // 2. check.torproject.org through that tab.
  await app.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/'});
  const page = await poll(() => app.context.pages().find(p => { try { return p.url().startsWith('https://check.torproject.org'); } catch { return false; } }), Boolean, 'check page', 120000);
  const verdict = await poll(() => page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'verdict', 90000);
  check(/Congratulations/.test(verdict), `check.torproject.org says "${verdict.replace(/\s+/g, ' ')}"`);
  const ip1 = await page.evaluate(() => (document.body.innerText.match(/IP address appears to be:\s*([\d.]+)/) || [])[1] || '').catch(() => '');

  // 3. More Tor tabs and a Tor window: no second tor.exe, no second bootstrap (status stays ready the whole time).
  const seen = new Set(); let sampling = true;
  const sampler = (async () => { for (let i = 0; i < 400 && sampling; i++) { try { const s = await status(); seen.add(s.state + ':' + s.progress); } catch {} await sleep(50); } })();
  await app.act({type: 'tab.new', privacy: 'tor'});
  await app.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/?second'});
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
  await app.ui.evaluate(() => window.acira.openWindow?.('tor')).catch(() => {});
  await sleep(7000);
  sampling = false; await sampler;
  const pidsAfter = ownTor();
  check(pidsAfter.length === 1 && pidsAfter[0] === pids[0], `more Tor tabs and a Tor window share the same tor.exe (pid ${pids[0]} -> ${pidsAfter.join(',')})`);
  check([...seen].every(s => s === 'ready:100'), `no second bootstrap: the status stayed ready:100 (${[...seen].join(', ')})`);
  const second = await poll(() => app.context.pages().find(p => { try { return p.url().includes('?second'); } catch { return false; } }), Boolean, 'second check page', 90000);
  const verdict2 = await poll(() => second.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'verdict 2', 90000);
  check(/Congratulations/.test(verdict2), `the second Tor tab also says Tor ("${verdict2.replace(/\s+/g, ' ')}")`);

  // 4. Close every Tor tab and window: tor stays; a new Tor tab is connected at once.
  const others = app.context.pages().filter(p => { try { return p.url() === 'acira-browser-ui://ui/index.html' && p !== app.ui; } catch { return false; } });
  check(others.length === 1, `the Tor window opened (${others.length} extra interface page)`);
  for (const p of others) await p.evaluate(() => window.acira.windowControl('close')).catch(() => {});
  await sleep(2500);
  for (const t of await torTabs()) await app.act({type: 'tab.close', id: t.id});
  await sleep(3000);
  const kept = ownTor();
  check(kept.length === 1 && kept[0] === pids[0], `closing every Tor tab and window keeps the same tor.exe (${kept.join(',')})`);
  const again = Date.now();
  await app.act({type: 'tab.new', privacy: 'tor'});
  const instant = await poll(status, s => s && s.state === 'ready', 'ready again', 5000);
  check(instant.state === 'ready' && Date.now() - again < 3000, `the next Tor tab is connected at once (${Date.now() - again} ms)`);

  // 5. New Tor identity from the keyboard: the confirmation opens (nothing happens until it is confirmed), then the native request replaces the Tor tabs.
  await app.act({type: 'tab.new', privacy: 'tor'});
  const before = (await torTabs()).length;
  await app.main(({webContents}) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); for (const type of ['keyDown', 'keyUp']) ui.sendInputEvent({type, keyCode: 'U', modifiers: ['control', 'shift']}); });
  const overlay = await poll(() => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'overlay page', 8000);
  const asked = await poll(() => overlay.evaluate(() => document.querySelector('.tor-popover-ask')?.textContent || ''), t => /New Tor identity\?/.test(t), 'confirmation text', 8000).catch(e => String(e.message));
  check(/New Tor identity\?/.test(asked) && /cookies/.test(asked), `Ctrl+Shift+U asks first, with what will happen ("${String(asked).slice(0, 90)}…")`);
  check((await torTabs()).length === before, 'nothing was closed before the answer');
  const result = await app.ui.evaluate(() => window.acira.native({type: 'tor.new-identity'}));
  await sleep(2000);
  const after = await app.state(), tabs = after.tabs.filter(t => t.privacy === 'tor');
  check(result?.identity?.ok === true && tabs.length === 1 && after.tabs.some(t => !t.privacy && t.url.includes('/normal')), `New Tor identity left one fresh Tor tab and the ordinary tab (${tabs.length} Tor tab(s))`);
  check(ownTor().length === 1 && ownTor()[0] === pids[0], 'New Tor identity did not restart tor.exe (same process, new circuits)');
  console.log('exit IP before/after (informational; Tor may reuse an exit):', ip1);

  // 6. Tor ends with Acira.
  await app.close(); closed = true; await sleep(4000);
  check(ownTor().length === 0, 'tor.exe ends with Acira');
} catch (error) {
  fail.push('script error: ' + String(error.message).slice(0, 300)); console.log('ERROR', error.message.slice(0, 300));
} finally {
  if (!closed) await app.close().catch(() => {});
  listener.close();
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILED:\n- ' + fail.join('\n- ')); process.exitCode = 1; }
