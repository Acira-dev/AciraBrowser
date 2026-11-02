// Which host names does Acira's main process hand to Node's own DNS client (c-ares: CNAME uncloaking, cname-uncloak.cjs) while
// only Tor is used? c-ares talks to the system's DNS server directly (the packet rig saw one UDP connect from the browser process to
// the router's port 53), so neither Windows' DNS client trace nor Chromium's NetLog sees these. Every Resolver call is recorded with
// the session it served (Tor or not) from the moment the app is up; a Tor tab and a Tor window then browse. Must be: none for Tor.
// One app, ≤ 4 tabs, native slot held, closed in finally.
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const root = path.resolve(`.qa-profiles/r9-tor-dns-calls-${Date.now()}`);

await withSlot('r9-tor-dns-calls', async () => {
  const app = await startApp({root, env: {ACIRA_TEST_QUIET_NETWORK: '1'}});
  try {
    await app.main(() => {
      const dns = process.mainModule.require('node:dns'), calls = globalThis.__r9DnsCalls = [];
      for (const proto of [dns.promises.Resolver.prototype, dns.Resolver.prototype]) for (const name of Object.getOwnPropertyNames(proto)) {
        if (!/^(resolve|reverse)/.test(name) || typeof proto[name] !== 'function') continue;
        const original = proto[name];
        proto[name] = function (host, ...rest) { calls.push({at: Date.now(), method: name, host: String(host), stack: new Error().stack.split('\n').slice(2, 6).map(s => s.trim()).join(' < ')}); return original.call(this, host, ...rest); };
      }
      const original = dns.lookup; dns.lookup = function (host, ...rest) { calls.push({at: Date.now(), method: 'lookup', host: String(host), stack: new Error().stack.split('\n').slice(2, 6).map(s => s.trim()).join(' < ')}); return original.call(this, host, ...rest); };
    });
    const torStarted = Date.now();
    await app.act({type: 'tab.new', privacy: 'tor', url: 'https://www.torproject.org/'});
    const tab = await poll(() => app.web('https://www.torproject.org'), Boolean, 'Tor tab page', 300000);
    await poll(() => tab.evaluate(() => document.readyState), s => s === 'complete', 'Tor tab load', 120000).catch(() => {});
    const before = new Set(app.context.pages());
    await app.ui.evaluate(() => window.acira.openWindow('tor'));
    const torUi = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor window ui', 30000);
    await poll(() => torUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'tor window acira', 30000);
    for (const [i, url] of ['https://www.digicert.com/', 'https://en.wikipedia.org/wiki/Onion_routing'].entries()) {
      await torUi.evaluate(([url, first]) => window.acira.dispatch(first ? {type: 'tab.navigate', url} : {type: 'tab.new', url}), [url, i === 0]);
      const host = new URL(url).host;
      const page = await poll(() => app.web(u => u.includes(host)), Boolean, 'page ' + host, 180000).catch(() => null);
      if (page) await poll(() => page.evaluate(() => document.readyState), s => s === 'complete', 'load ' + host, 120000).catch(() => {});
      console.log(`  ${page ? 'loaded' : 'did not load'} ${url}`);
    }
    await sleep(8000);
    // Every Tor page's session still points at its isolation relay (nothing reset it to the system proxy behind tor-window's back).
    const proxies = await app.main(async ({webContents}) => Promise.all(webContents.getAllWebContents().filter(wc => /^https:/.test(wc.getURL())).map(async wc => ({url: wc.getURL().slice(0, 50), tor: Boolean(wc.session.__aciraTor), proxy: String(await wc.session.resolveProxy('https://r9-probe.example/')).trim()}))));
    console.log('  sessions', JSON.stringify(proxies));
    check(proxies.length >= 3 && proxies.every(p => p.tor && /^SOCKS5 127\.0\.0\.1:\d+$/.test(p.proxy)), `every Tor page's session resolves to its 127.0.0.1 relay, none to the system proxy or DIRECT (${proxies.length} pages)`);
    const calls = await app.main(() => globalThis.__r9DnsCalls || []);
    // An IP literal (the relay listening on 127.0.0.1) asks no DNS server; everything else would.
    const during = calls.filter(c => c.at >= torStarted && !/^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]+\]?)$/i.test(c.host));
    for (const c of calls) console.log(`  ${c.at >= torStarted ? 'TOR ' : 'pre '} ${c.method} ${c.host}  ${c.stack.slice(0, 220)}`);
    check(during.length === 0, `no host name went to Node's DNS client (c-ares, outside Tor) while browsing in a Tor tab and a Tor window (${during.length}: ${[...new Set(during.map(c => c.host))].slice(0, 12).join(', ') || 'none'})`);
  } finally { await app.close(); }
});
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
