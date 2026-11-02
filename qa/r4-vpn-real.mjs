// Round 4 (vpn-proxy) R4-09a: a REAL VPN app, driven from Acira's own controls. NOT run by the agents: installing a VPN app and signing in is the
// founder's step (docs/launch/research/VPN_INTEGRATION.md, "Founder steps"). Nothing here installs, downloads or types a credential.
//   node qa/r4-vpn-real.mjs [--provider=proton|mullvad|ivpn] [--wait=120]
// Verifies, with the app really installed: detect → connect → exit address changes → disconnect → exit address returns.
//  - mullvad / ivpn have a command line, so Acira's Connect and Disconnect buttons do it all and are clicked here.
//  - proton has no supported Windows command line: Acira offers Open app (clicked here); YOU press Connect, then Disconnect, in Proton's window
//    when this script says so. The exit address is read from a page loaded through Acira each time.
// One native slot, isolated profile, hidden window, closed in finally. Results: C:\ae\r4\vpn-proxy\evidence\results-vpn-real.json
import {startApp, sleep, poll} from './d-harness.mjs';
import {results, takeSlot} from './r4-lib.mjs';
const arg = (name, fallback) => { const hit = process.argv.find(item => item.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const provider = arg('provider', 'proton'), waitSeconds = Number(arg('wait', 120));
if (!['proton', 'mullvad', 'ivpn'].includes(provider)) throw new Error('--provider must be proton, mullvad or ivpn');
const {row, finish} = results('results-vpn-real.json');
const release = await takeSlot('vpn-proxy-r4-real');
let app;
const watchdog = setTimeout(async () => { console.log('WATCHDOG'); await finish().catch(() => {}); try { app?.process().kill(); } catch {} await release().catch(() => {}); process.exit(2); }, (waitSeconds * 2 + 240) * 1000);
const say = text => console.log('\n>>> ' + text + '\n');

try {
  app = await startApp({root: `.qa-profiles/r4-vpn-real-${Date.now()}`});
  const ui = app.ui;
  const activeTab = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
  /** Our exit address as the open internet sees it, read from a page loaded through Acira (no proxy is set in this profile). */
  const exitAddress = async n => {
    await app.act({type: 'tab.navigate', url: `https://api.ipify.org/?format=json&n=${n}`});
    await poll(async () => { const t = await activeTab(); return t && !t.loading && /api\.ipify\.org/.test(t.url); }, Boolean, 'ip page', 30000);
    const text = await app.web(u => u.startsWith('https://api.ipify.org'))?.evaluate(() => document.body.innerText).catch(() => '');
    return JSON.parse(text || '{}').ip || null;
  };
  await app.act({type: 'tab.new', url: 'about:blank'}); await sleep(500);
  const before = await exitAddress(1);
  row('Exit address before (no VPN connected)', 'real-vpn', Boolean(before), String(before));

  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
  await ui.getByRole('button', {name: 'Connection', exact: true}).click(); await sleep(800);
  const panel = ui.locator('.vpn-panel').first(), card = panel.locator(`.vpn-provider[data-provider="${provider}"]`);
  await panel.getByRole('button', {name: 'Refresh status', exact: true}).click(); await sleep(2500);
  const text = await card.innerText();
  const installed = !/Not installed/.test(text);
  row(`Settings › Connection detects ${provider} as installed`, 'real-vpn', installed, text.replace(/\s+/g, ' '));
  if (!installed) { say(`${provider} is not installed. Install and sign in yourself (see VPN_INTEGRATION.md), leave it disconnected, and run this again.`); throw 'done'; }

  if (provider === 'proton') {
    await card.getByRole('button', {name: /Configure/}).click(); await sleep(1500);
    row('Open app (Proton): Acira launched the installed app', 'real-vpn', true, 'Configure… clicked (check that the Proton VPN window opened)');
    say(`In the Proton VPN window press CONNECT now. Waiting up to ${waitSeconds} s for your exit address to change…`);
  } else {
    await card.getByRole('button', {name: 'Connect', exact: true}).click();
    await poll(() => card.innerText(), t => /reports connected/.test(t), 'provider reports connected', 90000)
      .then(t => row(`Connect (${provider}) from Acira's button`, 'real-vpn', true, t.replace(/\s+/g, ' ')), e => row(`Connect (${provider}) from Acira's button`, 'real-vpn', false, e.message));
  }
  let during = null, n = 1;
  const until = Date.now() + waitSeconds * 1000;
  while (Date.now() < until) { n += 1; during = await exitAddress(n).catch(() => null); if (during && during !== before) break; await sleep(3000); }
  row('Exit address CHANGED while the VPN is connected', 'real-vpn', Boolean(during) && during !== before, `${before} → ${during}`);

  if (provider === 'proton') say(`Now press DISCONNECT in the Proton VPN window. Waiting up to ${waitSeconds} s for your first address to return…`);
  else {
    await card.getByRole('button', {name: 'Disconnect', exact: true}).click();
    await poll(() => card.innerText(), t => /^[^\n]*\n?Disconnected/.test(t) || /Disconnected/.test(t), 'provider reports disconnected', 90000)
      .then(t => row(`Disconnect (${provider}) from Acira's button`, 'real-vpn', true, t.replace(/\s+/g, ' ')), e => row(`Disconnect (${provider}) from Acira's button`, 'real-vpn', false, e.message));
  }
  let after = null; const back = Date.now() + waitSeconds * 1000;
  while (Date.now() < back) { n += 1; after = await exitAddress(n).catch(() => null); if (after === before) break; await sleep(3000); }
  row('Exit address RETURNED after disconnecting', 'real-vpn', after === before, `${during} → ${after} (first was ${before})`);
  console.log('REAL VPN:', (await finish()) ? 'ALL PASS' : 'SOME FAIL');
} catch (error) {
  if (error !== 'done') { row('script', 'harness', false, error.stack || error.message); process.exitCode = 1; }
  await finish();
} finally {
  clearTimeout(watchdog);
  await Promise.allSettled([app?.close()]);
  await release();
}
