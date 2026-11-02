// Real-app proof for the per-site relay (tor-isolation.cjs): a Tor tab loads check.torproject.org through it ("Congratulations"),
// tor sees each first party as its own SOCKS username, the page sees UTC / en-US, nothing is resolved by the OS (NetLog: no
// SYSTEM host-resolver task for the probe names), and Electron's own processes hold no non-loopback TCP connection while the
// Tor tab loads (tor.exe is the only process that talks to the network). One app, ≤3 tabs, slot held, closed in finally.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const token = 'r9' + randomUUID().replace(/-/g, '').slice(0, 12);
await withSlot('r9-tor-relay', async () => {
  const root = path.resolve('.qa-profiles/r9-tor-relay-' + Date.now());
  // This process-level socket assertion must measure Tor page traffic. The
  // ordinary browser's public threat-list refresh uses direct HTTPS by design
  // and otherwise races this observation. Disable that refresh only in this
  // owned profile; production defaults and the Tor request gate are untouched.
  await fs.mkdir(root, {recursive: true});
  await fs.writeFile(path.join(root, 'privacy-plus.json'), JSON.stringify({version: 1, choice: {phishingLists: false}}));
  console.log('Scope: owned profile with background threat-list refresh disabled; actual Tor engine, session, relay and page requests.');
  const app = await startApp({root, env: {ACIRA_TEST_QUIET_NETWORK: '1'}, ...(process.platform === 'darwin' ? {main: path.resolve('qa/mac-interface-entry.cjs')} : {})});
  const netlog = path.join(root, `netlog-${token}.json`);
  try {
    await app.main(async ({netLog}, file) => { await netLog.startLogging(file, {captureMode: 'default'}); }, netlog);
    await app.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/'});
    const page = await poll(() => app.web('https://check.torproject.org'), Boolean, 'check page (waits for Tor)', 300000);
    const verdict = await poll(() => page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'verdict', 120000);
    check(/Congratulations/.test(verdict), `Tor tab through the relay: check.torproject.org says "${verdict.replace(/\s+/g, ' ')}"`);
    const env = await page.evaluate(() => ({tz: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date().getTimezoneOffset(), lang: navigator.language, langs: navigator.languages, ua: navigator.userAgent}));
    console.log('page sees', JSON.stringify(env));
    check(env.tz === 'UTC' && env.offset === 0, `Tor page time zone is UTC (${env.tz}, offset ${env.offset})`);
    check(env.lang === 'en-US', `Tor page language is en-US (${env.lang} ${JSON.stringify(env.langs)})`);
    // Probes: a dns-prefetch hint and a third-party fetch by unique names; then the streams tor saw.
    await page.evaluate(token => { const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = `//${token}-prefetch.example`; document.head.append(l);
      fetch(`https://${token}-third.example/x`, {mode: 'no-cors'}).catch(() => {}); }, token);
    await sleep(6000);
    // Electron processes (everything but tor.exe) must hold no TCP connection to a non-loopback address.
    const pid = app.app.process().pid;
    const ps = `$root=${pid};$all=Get-CimInstance Win32_Process;$ids=@($root);for($i=0;$i -lt 6;$i++){$ids+=($all|?{$ids -contains $_.ParentProcessId -and $_.Name -ne 'tor.exe'}).ProcessId;$ids=$ids|Select -Unique};Get-NetTCPConnection -State Established,SynSent -ErrorAction SilentlyContinue|?{$ids -contains $_.OwningProcess -and $_.RemoteAddress -notmatch '^(127\\.|::1)'}|%{"$($_.OwningProcess) $($_.RemoteAddress):$($_.RemotePort)"}`;
    let outside;
    if (process.platform === 'darwin') {
      const ids = await app.main(({app}) => app.getAppMetrics().map(item => item.pid));
      let sockets = '';
      try { sockets = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', ids.join(','), '-iTCP', '-sTCP:ESTABLISHED', '-Fn'], {encoding: 'utf8'}); }
      catch (error) { if (error.status !== 1) throw error; sockets = String(error.stdout || ''); }
      outside = sockets.split('\n').filter(line => line.startsWith('n') && line.includes('->') && !/->(?:127\.|\[::1\]:)/.test(line)).join('\n');
    } else outside = execFileSync('powershell', ['-NoProfile', '-Command', ps], {encoding: 'utf8'}).trim();
    check(!outside, `no Electron process has a non-loopback TCP connection while the Tor tab loads (${outside || 'none'})`);
    const streams = await app.main(() => globalThis.__aciraTorIsolation?.streams() || null);
    if (streams) { const sites = [...new Set(streams.map(s => s.site))]; console.log('tor streams by site', JSON.stringify(sites));
      check(streams.some(s => s.host.startsWith(token + '-third')) && streams.filter(s => s.host.startsWith(token)).every(s => s.site === 'torproject.org'), 'a third-party request rides its page’s circuit (username torproject.org), by name'); }
    await app.main(async ({netLog}) => { await netLog.stopLogging(); });
    const log = JSON.parse(await fs.readFile(netlog, 'utf8'));
    // NetLog stores numeric event IDs; matching event-name strings in raw
    // event lines silently misses every lookup. Resolve the recorded constants
    // and require the probe itself to be present before accepting the result.
    const systemType = log.constants?.logEventTypes?.HOST_RESOLVER_SYSTEM_TASK;
    const probes = log.events.filter(event => JSON.stringify(event.params || {}).includes(token));
    const system = log.events.filter(event => event.type === systemType);
    check(Number.isInteger(systemType) && probes.length > 0 && system.length === 0,
      `NetLog: no system DNS task during the isolated Tor probe (${system.length}; ${probes.length} probe events recorded)`);
  } finally { await app.close(); }
});
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
