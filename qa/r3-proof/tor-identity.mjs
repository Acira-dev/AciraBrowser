// R3-44 row "Tor": does New Tor identity really change the exit address?  Real Tor (bundled tor.exe), real network, one app, closed in finally.
//   node qa/r3-proof/tor-identity.mjs     (uses the same Tor data folder as qa/n-tor-session.mjs, so a warm start takes seconds; empty folder = full bootstrap)
// An ordinary tab and a Tor tab both ask check.torproject.org/api/ip. The Tor tab must say IsTor and show a different address from the ordinary tab;
// New Tor identity is then asked for up to three times (Tor may hand back the same exit; each ask waits out Tor's 10 s rate limit) and the address must change.
import fs from 'node:fs';
import path from 'node:path';
import {startApp, poll} from '../d-harness.mjs';
import {probe, withSlot, sleep, capturePage} from './lib.mjs';

const P = probe('tor-identity');
const root = path.resolve('.qa-profiles/n-tor-session');
fs.mkdirSync(root, {recursive: true});
const API = 'https://check.torproject.org/api/ip';

await withSlot('proof-tor-identity', async () => {
  const app = await startApp({root});
  try {
    const status = () => app.ui.evaluate(() => window.acira.native({type: 'tor.status'}).then(r => r.tor));
    const readIp = async (privacy, label) => {
      await app.act({type: 'tab.new', url: API, ...(privacy ? {privacy} : {})});
      const page = await poll(() => app.web(u => u.startsWith(API)), Boolean, label + ' page', 150000);
      const body = await poll(() => page.evaluate(() => document.body?.innerText || ''), t => /"IP"/.test(t), label + ' body', 120000);
      const png = await capturePage(app, 'check.torproject.org/api/ip', P.shot(`${label}.png`));
      const parsed = JSON.parse(body.trim());
      const tab = (await app.state()).tabs.find(t => t.url.startsWith(API) && (privacy ? t.privacy === privacy : !t.privacy));
      return {...parsed, png, tabId: tab?.id};
    };
    // Ordinary tab (the control: what the world sees without Tor).
    const clear = await readIp(null, 'ordinary');
    P.check('an ordinary tab is not Tor (control)', clear.IsTor === false && Boolean(clear.IP), JSON.stringify({IsTor: clear.IsTor, IP: clear.IP}), clear.png);
    await app.act({type: 'tab.close', id: clear.tabId});
    // Tor tab: wait for the real bootstrap.
    const opened = Date.now();
    await app.act({type: 'tab.new', privacy: 'tor'});
    const ready = await poll(status, s => s && s.state === 'ready', 'tor ready', 300000);
    P.note(`Tor ready in ${Math.round((Date.now() - opened) / 1000)} s`);
    const first = await readIp('tor', 'tor-1');
    P.check('a Tor tab reaches check.torproject.org through Tor (IsTor true)', first.IsTor === true && Boolean(first.IP), JSON.stringify({IsTor: first.IsTor, IP: first.IP}), first.png);
    P.check('the Tor exit address is not the ordinary address', first.IP !== clear.IP, `Tor ${first.IP} / ordinary ${clear.IP}`);
    // New identity, up to three times.
    let current = first, changed = null; const seen = [first.IP];
    for (let attempt = 1; attempt <= 3 && !changed; attempt++) {
      await sleep(11000);
      const result = await app.ui.evaluate(() => window.acira.native({type: 'tor.new-identity'}));
      await sleep(2500);
      const tabs = (await app.state()).tabs.filter(t => t.privacy === 'tor');
      for (const t of tabs.filter(t => t.url.startsWith(API))) await app.act({type: 'tab.close', id: t.id});
      current = await readIp('tor', `tor-identity-${attempt}`);
      seen.push(current.IP);
      P.note(`New Tor identity #${attempt}: ok=${result?.identity?.ok}, IsTor=${current.IsTor}, ${seen.slice(-2).join(' -> ')}`);
      if (result?.identity?.ok === true && current.IsTor === true && current.IP !== first.IP) changed = current;
    }
    P.check('New Tor identity changes the exit address (and the new tab is still Tor)', Boolean(changed), `addresses seen: ${seen.join(' -> ')}`, changed?.png || current.png);
    const ownTor = (await app.state()).tabs.filter(t => t.privacy === 'tor').length;
    P.check('New Tor identity leaves Tor tabs open (one fresh tab per window)', ownTor >= 1, `${ownTor} Tor tab(s)`);
    void ready;
  } finally {
    await app.close();
  }
});
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
