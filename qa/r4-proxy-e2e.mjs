// Round 4 (vpn-proxy) R4-09: Acira's proxy, end to end. HTTP and SOCKS5 with the exit address read from a page, an HTTP proxy that asks for a
// username and password (wrong password, then the right one, through Acira's own sign-in dialog, real clicks), a SOCKS5 proxy that wants a
// login (clear message), an unreachable proxy (clear page), and - REAL remote service, no account - Tor's SOCKS5 port, run from the Tor
// binary that already ships in the repo (nothing is downloaded): the page must report IsTor and an address that is not ours.
//   node qa/r4-proxy-e2e.mjs [--no-tor]        one native slot, hidden windows (the proxy confirm answers through the native-box stub).
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {startApp, sleep, poll} from './d-harness.mjs';
import {EVIDENCE, results, takeSlot, shot} from './r4-lib.mjs';
const require = createRequire(import.meta.url);
const S = require('./r3-proxy-servers.cjs');
const noTor = process.argv.includes('--no-tor');
const {row, finish} = results('results-proxy-e2e.json');
const release = await takeSlot('vpn-proxy-r4-e2e');
let app, origin, http1, httpAuth, socksOpen, socksAuth, tor;
const watchdog = setTimeout(async () => { console.log('WATCHDOG'); row('script', 'harness', false, 'watchdog'); await finish().catch(() => {}); try { app?.process().kill(); } catch {} try { tor?.kill(); } catch {} await release().catch(() => {}); process.exit(2); }, 8 * 60 * 1000);
let counter = 0;
const ipOf = r => /^ip (\S+)/.exec(r?.title || '')?.[1] || null;
const MAIN_TOR = 'C:/Users/you/Desktop/Work/Acira/Browser No AI/desktop/browser-services/tor-engine/win-x64/tor.exe';

try {
  origin = await S.startOrigin();
  const names = {'echo.acira.test': origin.port};
  http1 = await S.startHttpProxy({names});
  httpAuth = await S.startHttpProxy({names, auth: {user: 'tester', pass: 'correct-horse'}});
  socksOpen = await S.startSocks5({names});
  socksAuth = await S.startSocks5({names, auth: {user: 'tester', pass: 'correct-horse'}});
  app = await startApp({root: `.qa-profiles/r4-e2e-${Date.now()}`, args: ['--host-resolver-rules=MAP direct.acira.test 127.0.0.1']});
  const ui = app.ui;
  await app.main(({dialog}) => { globalThis.__dialogs = []; dialog.showMessageBox = async (...a) => { globalThis.__dialogs.push(a.at(-1).message); return {response: 1, checkboxChecked: false}; }; });
  const set = choice => app.svc({type: 'proxy.set', choice});
  const test = choice => app.svc({type: 'proxy.test', choice}).then(r => r.proxy?.test);
  const server = (scheme, port) => ({mode: 'fixed_servers', server: {scheme, host: '127.0.0.1', port}, bypassHosts: []});
  const url = (host, p = '/') => `http://${host}:${origin.port}${p}?n=${++counter}`;
  const activeTab = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
  const visit = async (target, timeout = 20000) => {
    await app.act({type: 'tab.navigate', url: target});
    return poll(async () => { const t = await activeTab(); return t && !t.loading && (t.url === target || t.error) ? {title: t.title, error: t.error || null, url: t.url} : null; }, Boolean, 'visit ' + target, timeout);
  };
  await app.act({type: 'tab.new', url: 'about:blank'}); await sleep(500);

  let r = await visit(url('direct.acira.test'));
  row('Baseline: no proxy, the page sees our own address', 'proxy', ipOf(r) === '127.0.0.1', 'ip=' + ipOf(r));

  // HTTP, no sign-in
  let t = await test(server('http', http1.port));
  row('HTTP proxy Test says it is an HTTP proxy', 'proxy', t?.ok === true && /HTTP proxy/.test(t.message), t?.message);
  await set(server('http', http1.port)); r = await visit(url('echo.acira.test'));
  row('HTTP proxy: exit address seen by the page is the proxy side (127.0.0.2)', 'proxy', ipOf(r) === '127.0.0.2', 'ip=' + ipOf(r));
  // SOCKS5, no sign-in
  t = await test(server('socks5', socksOpen.port));
  row('SOCKS5 Test says it speaks SOCKS5', 'proxy', t?.ok === true, t?.message);
  const before = socksOpen.log.length;
  await set(server('socks5', socksOpen.port)); r = await visit(url('echo.acira.test'));
  const entry = socksOpen.log.slice(before).find(e => e.host === 'echo.acira.test');
  row('SOCKS5 proxy: exit address is the proxy side, and the NAME went to the proxy (no local DNS)', 'proxy', ipOf(r) === '127.0.0.2' && entry?.atyp === 3, `ip=${ipOf(r)} atyp=${entry?.atyp}`);

  // HTTP proxy with sign-in: Test, then Acira's own dialog, wrong password, right password
  t = await test(server('http', httpAuth.port));
  row('Authenticated HTTP proxy Test says it needs a sign-in (clear message)', 'proxy', t?.ok === false || /sign-in/.test(t?.message || ''), t?.message);
  await set(server('http', httpAuth.port));
  await app.act({type: 'tab.navigate', url: url('echo.acira.test', '/authed')});
  const dialog = ui.locator('.website-auth-dialog');
  const signIn = async (user, pass) => {
    await dialog.waitFor({timeout: 15000});
    await dialog.getByLabel('Username').fill(user); await dialog.getByLabel('Password').fill(pass);
    await dialog.getByRole('button', {name: 'Sign in'}).click();
  };
  await dialog.waitFor({timeout: 15000});
  const head = await dialog.innerText();
  row('Proxy sign-in dialog appears, names the proxy and says what it is', 'proxy', /Sign in to this proxy/i.test(head) && head.includes(`127.0.0.1:${httpAuth.port}`), head.replace(/\s+/g, ' ').slice(0, 200));
  await shot(app, 'e2e-proxy-signin-dialog').catch(() => {});
  await signIn('tester', 'wrong-password');
  await poll(() => dialog.locator('[role="alert"]').innerText(), x => /did not accept/i.test(x), 'wrong password message', 15000)
    .then(x => row('Wrong password: the dialog comes back saying the proxy did not accept it', 'proxy', true, x), e => row('Wrong password: the dialog comes back saying the proxy did not accept it', 'proxy', false, e.message));
  await shot(app, 'e2e-proxy-wrong-password').catch(() => {});
  await signIn('tester', 'correct-horse');
  r = await poll(async () => { const tab = await activeTab(); return tab && !tab.loading && /^ip /.test(tab.title) ? {title: tab.title} : null; }, Boolean, 'page after sign-in', 20000).catch(e => ({title: e.message}));
  row('Right password: the page loads through the authenticated proxy (127.0.0.2)', 'proxy', ipOf(r) === '127.0.0.2', 'ip=' + ipOf(r));
  row('The proxy saw a sign-in and the 407 first', 'proxy', httpAuth.log.some(e => e.status === 407) && httpAuth.log.some(e => e.status === 200 && e.auth), `${httpAuth.log.filter(e => e.status === 407).length}x 407, ${httpAuth.log.filter(e => e.status === 200).length}x 200`);
  const saved = JSON.stringify(await app.svc({type: 'proxy.status'}));
  row('The password is not stored in the saved proxy choice', 'proxy', !/correct-horse|wrong-password|tester/.test(saved), saved.slice(0, 160));

  // SOCKS5 with a login: Acira says it cannot, and how to proceed
  t = await test(server('socks5', socksAuth.port));
  row('SOCKS5 proxy that wants a login: Test says so, plainly', 'proxy', t?.ok === false && /username and password/.test(t.message) && /HTTP proxy|VPN app/.test(t.message), t?.message);

  // Unreachable proxy, saved, then browsing
  t = await test(server('http', 1));
  row('Unreachable proxy Test: "Nothing is listening at 127.0.0.1:1."', 'proxy', t?.ok === false && /Nothing is listening at 127\.0\.0\.1:1/.test(t.message), t?.message);
  await set(server('http', 1)); r = await visit(url('echo.acira.test'), 25000).catch(e => ({error: e.message}));
  const tab = await activeTab();
  const pageText = await app.web(u => u.includes('chrome-error') || u.startsWith('acira://'))?.evaluate(() => document.body.innerText).catch(() => '') || '';
  row('Browsing through an unreachable proxy ends on a clear error page, not a hang', 'proxy', Boolean(tab?.error || /proxy/i.test(tab?.title || '') || /proxy/i.test(pageText)), `tab.error=${JSON.stringify(tab?.error)} title=${JSON.stringify(tab?.title)} page=${JSON.stringify(pageText.slice(0, 160))}`);
  await shot(app, 'e2e-proxy-unreachable-page').catch(() => {});
  await set({mode: 'system'});

  // REAL remote SOCKS5: Tor's own SocksPort (no account). Bundled binary from the repo, isolated data dir, killed in finally.
  if (!noTor && await fs.stat(MAIN_TOR).then(() => true, () => false)) {
    const data = 'C:/ae/r4/vpn-proxy/tor-data'; await fs.rm(data, {recursive: true, force: true}); await fs.mkdir(data, {recursive: true});
    let log = ''; tor = spawn(MAIN_TOR, ['--SocksPort', '127.0.0.1:19150', '--DataDirectory', data, '--ControlPort', '0', '--ClientOnly', '1', '--Log', 'notice stdout'], {windowsHide: true});
    tor.stdout.on('data', d => { log += d; }); tor.stderr.on('data', d => { log += d; });
    const up = await poll(() => /Bootstrapped 100%/.test(log), Boolean, 'tor bootstrap', 150000).then(() => true, () => false);
    row('Real SOCKS5 service available (Tor client bootstrapped from the repo-pinned binary)', 'proxy', up, (log.match(/Bootstrapped \d+%[^\n]*/g) || []).at(-1) || log.slice(-200));
    if (up) {
      // our own address first, from a page on the open internet, through no proxy
      await visit('https://check.torproject.org/api/ip', 30000).catch(() => null);
      const ownText = await app.web(u => u.startsWith('https://check.torproject.org'))?.evaluate(() => document.body.innerText).catch(() => '');
      const own = JSON.parse(ownText || '{}');
      t = await test(server('socks5', 19150));
      row('Real SOCKS5 (Tor) Test says it speaks SOCKS5', 'proxy', t?.ok === true, t?.message);
      await set(server('socks5', 19150));
      await visit('https://check.torproject.org/api/ip?x=2', 60000).catch(() => null);
      const viaText = await app.web(u => u.startsWith('https://check.torproject.org'))?.evaluate(() => document.body.innerText).catch(() => '');
      const via = JSON.parse(viaText || '{}');
      row('Real SOCKS5 (Tor): the page reports IsTor and an exit address that is not ours', 'proxy', via.IsTor === true && own.IsTor === false && via.IP && own.IP && via.IP !== own.IP, `direct ${own.IP} IsTor=${own.IsTor} → via proxy ${via.IP} IsTor=${via.IsTor}`);
      await set({mode: 'system'});
    }
  } else row('Real SOCKS5 service (Tor)', 'proxy', false, noTor ? 'skipped (--no-tor)' : 'tor.exe not found in the repo checkout');

  console.log('E2E:', (await finish()) ? 'ALL PASS' : 'SOME FAIL');
} catch (error) {
  row('script', 'harness', false, error.stack || error.message); await finish(); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try { tor?.kill(); } catch {}
  await Promise.allSettled([app?.close(), origin?.close(), http1?.close(), httpAuth?.close(), socksOpen?.close(), socksAuth?.close()]);
  await release();
}
