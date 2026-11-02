// R3 tor-identity: the break-it pass for "New Tor identity" in the real app (needs internet and tor.exe). One instance, four windows, <=12 tabs, closed in finally.
//   node qa/r3-tor-identity.mjs        ACIRA_QA_TOR_CACHE=<a tor data folder> seeds tor's relay cache (a cold bootstrap takes 1-2 minutes)
// Covers: the shortcut with an ordinary tab on screen, Cancel, Confirm, the main menu row, the panel in a Tor window, two windows, a private window,
// the circuit really changing (exit IP), no second NEWNYM from the tabs the identity closes, a request while one runs, a page that keeps writing a
// cookie, a pop-up of a Tor page, a download in progress, tor.exe staying one process, the toast.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/r3-tor-identity');
await fs.rm(root, {recursive: true, force: true});
if (process.env.ACIRA_QA_TOR_CACHE) await fs.cp(process.env.ACIRA_QA_TOR_CACHE, path.join(root, 'tor', 'data'), {recursive: true});
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const {connectControl} = createRequire(import.meta.url)('../desktop/browser-services/tor-engine.cjs');
const ownTor = () => execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'}).split(/\r?\n/).filter(l => l.includes(root)).map(l => l.split('|')[0]);
const URL_BIG = 'https://dist.torproject.org/torbrowser/15.0.26/tor-expert-bundle-windows-x86_64-15.0.26.tar.gz';

const listener = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>ordinary</title>ordinary page'); });
const app = await startApp({root, env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(root, 'dl')}});
let control = null;
const UI = 'acira-browser-ui://ui/index.html';
const uiPages = () => app.context.pages().filter(p => { try { return p.url() === UI; } catch { return false; } });
const win = page => ({page, act: a => page.evaluate(a => window.acira.dispatch(a), a), state: () => page.evaluate(() => window.acira.getSnapshot()), native: r => page.evaluate(r => window.acira.native(r), r)});
const askOverlay = (timeout = 8000) => poll(async () => { for (const p of app.context.pages()) { try { if (p.url().includes('view=overlay') && await p.locator('.tor-popover-ask').count()) return p; } catch {} } }, Boolean, 'the New Tor identity question', timeout);
const askByShortcut = async () => { for (let attempt = 0; attempt < 3; attempt++) { await key(0, 'U', ['control', 'shift']); try { return await askOverlay(3500); } catch {} } return askOverlay(); };
const key = (index, keyCode, modifiers) => app.main(({webContents}, [index, keyCode, modifiers]) => { const ui = webContents.getAllWebContents().filter(w => w.getURL() === 'acira-browser-ui://ui/index.html').sort((a, b) => a.id - b.id)[index]; ui.focus(); for (const type of ['keyDown', 'keyUp']) ui.sendInputEvent({type, keyCode, modifiers}); }, [index, keyCode, modifiers]);
const openWindow = async (kind, count) => { await w1.page.evaluate(k => window.acira.openWindow(k), kind); const page = await poll(() => uiPages().length > count ? uiPages().at(-1) : null, Boolean, kind + ' window', 30000); await poll(() => page.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000); return win(page); };
const torTabs = async w => (await w.state()).tabs.filter(t => t.privacy === 'tor');
const webPage = match => app.context.pages().find(p => { try { return p.url().startsWith(match); } catch { return false; } });
const ipFrom = async url => { await w1.act({type: 'tab.new', privacy: 'tor', url}); const p = await poll(() => webPage(url), Boolean, 'page ' + url, 120000); const body = await poll(() => p.evaluate(() => document.body.innerText), t => /IP/.test(t), 'ip body', 60000); return /"IP":"([^"]+)"/.exec(body)?.[1] || body; };
const w1 = win(await poll(() => uiPages()[0], Boolean, 'ui page', 30000));
try {
  await w1.act({type: 'tab.new', url: `http://127.0.0.1:${listener.port}/w1`});
  await w1.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/api/ip?t1'});
  await poll(() => w1.native({type: 'tor.status'}).then(r => r.tor), s => s && s.state === 'ready', 'tor ready', 300000);
  const pid = ownTor();
  const t1 = await poll(() => webPage('https://check.torproject.org/api/ip?t1'), Boolean, 'tor page', 120000);
  const ip1 = await poll(() => t1.evaluate(() => document.body.innerText), t => /IP/.test(t), 'ip body', 60000).then(b => /"IP":"([^"]+)"/.exec(b)?.[1]);
  const w2 = await openWindow('normal', 1);
  await w2.act({type: 'tab.new', url: `http://127.0.0.1:${listener.port}/w2`});
  await w2.act({type: 'tab.new', privacy: 'tor'});
  const s2 = await w2.state(); await w2.act({type: 'tab.select', id: s2.tabs.find(t => !t.privacy && /\/w2/.test(t.url)).id});
  const w3 = await openWindow('private', 2);
  await w3.act({type: 'tab.new', url: `http://127.0.0.1:${listener.port}/private`});
  const s1 = await w1.state(), normal1 = s1.tabs.find(t => !t.privacy && /\/w1/.test(t.url)); await w1.act({type: 'tab.select', id: normal1.id});
  const before = {w1: (await torTabs(w1)).map(t => t.id), w2: (await torTabs(w2)).map(t => t.id), w3: (await w3.state()).tabs.map(t => t.id)};
  const activeW2 = (await w2.state()).activeTabId;

  // tor's own view of NEWNYM: a second control connection counts the signals it really applied.
  const port = Number(/PORT=127\.0\.0\.1:(\d+)/.exec(await fs.readFile(path.join(root, 'tor', 'run', 'controlport'), 'latin1'))[1]), cookie = (await fs.readFile(path.join(root, 'tor', 'run', 'control_auth_cookie'))).toString('hex');
  let applied = 0; control = await connectControl(port, {onEvent: line => { if (/^SIGNAL NEWNYM/.test(line)) applied++; }}); await control.send('AUTHENTICATE ' + cookie); await control.send('SETEVENTS SIGNAL');

  // 1. Ctrl+Shift+U with an ordinary tab on screen asks first; Cancel changes nothing.
  let ask = await askByShortcut();
  const text = await ask.evaluate(() => document.querySelector('.tor-popover-ask').textContent);
  check(/every window/.test(text) && /Other tabs aren’t touched/.test(text), `the question says what happens ("${text.replace(/\s+/g, ' ').slice(0, 110)}…")`);
  await ask.getByRole('button', {name: 'Cancel'}).click(); await sleep(700);
  check(JSON.stringify((await torTabs(w1)).map(t => t.id)) === JSON.stringify(before.w1), 'Cancel closes nothing');

  // 2. Confirm: every window with Tor tabs gets one fresh Tor tab; nobody on an ordinary tab is moved; the private window is untouched.
  ask = await askByShortcut();
  const started = Date.now(); await ask.getByRole('button', {name: /New identity|Renewing/}).click();
  await poll(async () => { const t = await torTabs(w1), u = await torTabs(w2); return t.length === 1 && u.length === 1 && !before.w1.includes(t[0].id) && !before.w2.includes(u[0].id); }, Boolean, 'fresh Tor tabs', 40000);
  console.log('identity took', Date.now() - started, 'ms');
  const after1 = await w1.state(), after2 = await w2.state(), after3 = await w3.state();
  check(after1.activeTabId === normal1.id, 'window 1: the ordinary tab that was on screen stays on screen');
  check(after2.activeTabId === activeW2, 'window 2: its ordinary tab stays on screen too');
  check(JSON.stringify(after3.tabs.map(t => t.id)) === JSON.stringify(before.w3), 'the private window is untouched');
  check(after1.tabs.filter(t => !t.privacy && t.url.includes('/w1')).length === 1, 'ordinary tabs are all still there');
  await sleep(1500);
  const toast1 = (await w1.state()).toast?.text || '', toast2 = (await w2.state()).toast?.text || '';
  check(/^New Tor identity\. Earlier tabs and site data are gone\.$/.test(toast1) && /^New Tor identity\./.test(toast2), `the toast tells the truth ("${toast1}")`);
  check(JSON.stringify(ownTor()) === JSON.stringify(pid), `still the one tor.exe (${ownTor().join(',')})`);

  // 3. The circuit changed: a new Tor tab shows another exit than the one before (tor may rarely reuse one; then a second identity decides).
  let ip2 = await ipFrom('https://check.torproject.org/api/ip?t2');
  if (ip2 === ip1) { await sleep(10500); await w1.native({type: 'tor.new-identity'}); ip2 = await ipFrom('https://check.torproject.org/api/ip?t2b'); }
  check(ip2 !== ip1, `the exit IP changed (${ip1} -> ${ip2})`);

  // 4. Two identities in a row: the second waits for tor to apply it, and nothing else asks tor for new circuits.
  await sleep(10500); applied = 0;
  await w1.native({type: 'tor.new-identity'});
  const second = Date.now(); const result = await w1.native({type: 'tor.new-identity'});
  console.log('second identity took', Date.now() - second, 'ms', JSON.stringify(result.identity));
  check(result.identity.delayed === true && Date.now() - second > 3000, 'the second identity inside tor’s 10 s limit waited for tor to apply it');
  await sleep(12000);
  check(applied === 2, `tor applied exactly two NEWNYMs for two identities, none from the tabs they closed (${applied})`);
  check((await torTabs(w1)).length === 1, 'two identities leave one fresh Tor tab');

  // 5. The menu row asks (it used to open the status panel instead).
  const torTab = (await torTabs(w1))[0]; await w1.act({type: 'tab.select', id: torTab.id}); await sleep(500);
  await w1.page.getByRole('button', {name: 'Acira menu'}).first().click(); await sleep(900);
  const menu = await poll(() => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'menu overlay', 8000);
  await menu.getByRole('button', {name: /New Tor identity/}).click();
  ask = await askOverlay().catch(() => null);
  check(Boolean(ask), 'the main menu row opens the question, not the status panel');
  if (ask) await ask.getByRole('button', {name: 'Cancel'}).click();
  await sleep(500);

  // 6. A Tor window: a page that keeps writing a cookie, and a pop-up, then the identity from the pill.
  const w4 = await openWindow('tor', 3);
  await poll(() => w4.native({type: 'tor.status'}).then(r => r.tor), s => s && s.state === 'ready', 'tor window ready', 120000);
  await w4.act({type: 'tab.new', url: 'https://check.torproject.org/api/ip?w4'});
  const p4 = await poll(() => webPage('https://check.torproject.org/api/ip?w4'), Boolean, 'w4 page', 120000);
  await poll(() => p4.evaluate(() => document.body.innerText), t => /IP/.test(t), 'w4 body', 60000);
  await p4.evaluate(() => { document.cookie = 'ident=one; path=/; max-age=3600'; window.__tick = setInterval(() => { document.cookie = 'tick=' + Date.now() + '; path=/; max-age=3600'; localStorage.setItem('tick', String(Date.now())); }, 10); const b = document.createElement('button'); b.id = 'pop'; b.textContent = 'popup'; b.style.cssText = 'position:fixed;left:20px;top:20px;width:200px;height:60px;z-index:99999'; b.onclick = () => window.open('https://check.torproject.org/api/ip?popup', '_blank', 'popup,width=400,height=300'); document.body.appendChild(b); });
  await p4.click('#pop'); await sleep(5000);
  const windowsBefore = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
  await w4.page.locator('.tor-chip').click(); await sleep(900);
  const panel = await poll(() => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'tor panel', 8000);
  await panel.getByRole('button', {name: /New Tor identity/}).click(); await sleep(600);
  ask = await askOverlay(); await ask.getByRole('button', {name: 'New identity'}).click();
  await poll(async () => (await w4.state()).tabs.length === 1 && !(await w4.state()).tabs[0].url.startsWith('https:'), Boolean, 'tor window reset', 40000);
  await sleep(2500);
  const windowsAfter = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
  check(windowsAfter === windowsBefore - 1, `the pop-up of the Tor page closed with the identity (${windowsBefore} -> ${windowsAfter} windows)`);
  await w4.act({type: 'tab.new', url: 'https://check.torproject.org/api/ip?w4b'});
  const p4b = await poll(() => webPage('https://check.torproject.org/api/ip?w4b'), Boolean, 'w4b page', 120000);
  await poll(() => p4b.evaluate(() => document.body.innerText), t => /IP/.test(t), 'w4b body', 60000);
  const left = await p4b.evaluate(() => document.cookie + '|' + localStorage.getItem('tick') + '|' + localStorage.getItem('ident'));
  check(left === '|null|null', `a page that kept writing a cookie left nothing behind (${left})`);
  const toast4 = (await w4.state()).toast?.text || '';
  check(!/Private cleanup/.test(toast4) && !/Private cleanup/.test((await w1.state()).toast?.text || ''), `no "Private cleanup is still finishing" toast (${toast4})`);

  // 7. A download in progress: the question says it will stop; it does, and its name does not stay in the list.
  await w1.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/api/ip?dl'});
  const pd = await poll(() => webPage('https://check.torproject.org/api/ip?dl'), Boolean, 'dl page', 120000);
  await poll(() => pd.evaluate(() => document.body.innerText), t => /IP/.test(t), 'dl body', 60000);
  await pd.evaluate(u => { const a = document.createElement('a'); a.id = 'dlink'; a.href = u; a.textContent = 'download'; a.style.cssText = 'position:fixed;left:20px;top:20px;width:200px;height:60px;z-index:99999;background:#fff'; document.body.appendChild(a); }, URL_BIG);
  await pd.click('#dlink');
  await poll(async () => (await w1.state()).downloads.some(d => d.status === 'Downloading'), Boolean, 'download running', 60000);
  await sleep(1500);
  ask = await askByShortcut();
  check(/download in progress will stop/.test(await ask.evaluate(() => document.querySelector('.tor-popover-ask').textContent)), 'the question warns that a download in progress will stop');
  await ask.getByRole('button', {name: 'New identity'}).click();
  await poll(async () => !(await w1.state()).downloads.some(d => /tor-expert-bundle/.test(d.name)), Boolean, 'download gone from the list', 20000);
  check(true, 'the cut-short download is gone from the Downloads list');
  const files = await fs.readdir(path.join(root, 'dl')).catch(() => []);
  check(!files.some(f => /tar\.gz$/.test(f) && !/crdownload/.test(f)), 'no half-written file is left behind as if finished');
} catch (error) {
  fail.push('script error: ' + String(error.message).slice(0, 300)); console.log('ERROR', error.stack?.slice(0, 600));
} finally {
  try { control?.close(); } catch {}
  await app.close().catch(() => {}); listener.close();
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILED:\n- ' + fail.join('\n- ')); process.exitCode = 1; }
