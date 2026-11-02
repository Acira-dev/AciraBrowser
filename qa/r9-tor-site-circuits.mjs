// Per-site circuits inside ONE Tor window (TOR_HARDENING.md §2): two sites open in two tabs of the same Tor window both load the same
// third party. Each must reach it over its own connection (Chromium's sockets partitioned by top-level site, engine-features.cjs) and
// on its own circuit (tor-isolation.cjs claims → SOCKS username = the first party). Proof from three places: the relay's record of
// which site each CONNECT rode, Chromium's sockets (two CONNECTs, not one reused socket), and tor itself over its control port
// (GETINFO stream-status / circuit-status: the third party's streams sit on different circuits, each built for its own site).
// One app, one Tor window, 2 tabs, native slot held, closed in finally.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';
const require = createRequire(import.meta.url);
const {connectControl} = require('../desktop/browser-services/tor-engine.cjs');

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
// Two plain sites with no Content-Security-Policy (a site's CSP could refuse the probe), and a third party that is neither.
const SITE_A = 'https://example.org/', SITE_B = 'https://example.net/', THIRD = 'example.com', FIRST_A = 'example.org', FIRST_B = 'example.net';
const root = path.resolve(`.qa-profiles/r9-tor-site-circuits-${Date.now()}`);

await withSlot('r9-tor-site-circuits', async () => {
  const app = await startApp({root, env: {ACIRA_TEST_QUIET_NETWORK: '1'}});
  try {
    const before = new Set(app.context.pages());
    await app.ui.evaluate(() => window.acira.openWindow('tor'));
    const torUi = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor window ui', 30000);
    await poll(() => torUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'tor window acira', 30000);
    const open = async (url, first) => {
      await torUi.evaluate(([url, first]) => window.acira.dispatch(first ? {type: 'tab.navigate', url} : {type: 'tab.new', url}), [url, first]);
      const host = new URL(url).host, page = await poll(() => app.web(u => u.includes(host)), Boolean, 'page ' + host, 300000);
      await poll(() => page.evaluate(() => document.readyState), s => s === 'complete', 'load ' + host, 180000);
      return page;
    };
    const a = await open(SITE_A, true);
    const b = await open(SITE_B, false);
    console.log('both sites loaded in one Tor window');
    // tor's own view, live: every STREAM event (which circuit carries it) and every circuit's SOCKS username (the site it was built for).
    const run = path.join(root, 'tor', 'run'), events = [];
    const control = await connectControl(Number(/:(\d+)/.exec(fs.readFileSync(path.join(run, 'controlport'), 'latin1'))[1]), {onEvent: line => events.push(line)});
    await control.send('AUTHENTICATE ' + fs.readFileSync(path.join(run, 'control_auth_cookie')).toString('hex'));
    await control.send('SETEVENTS STREAM CIRC');
    // The same third party from each site, one after the other (a shared pool would reuse A's socket for B).
    const load = page => page.evaluate(async host => { const started = Date.now(); try { await fetch(`https://${host}/?r9=${Math.random()}`, {mode: 'no-cors', cache: 'no-store'}); return {ok: true, ms: Date.now() - started}; } catch (error) { return {ok: false, error: String(error)}; } }, THIRD);
    const fromA = await load(a); await sleep(1500); const fromB = await load(b);
    console.log('third-party loads', JSON.stringify({fromA, fromB}));
    check(fromA.ok && fromB.ok, `both sites loaded ${THIRD} through Tor`);
    const streams = (await app.main(() => globalThis.__aciraTorIsolation.streams())).filter(s => s.host === THIRD && s.port === 443);
    console.log('relay streams to the third party', JSON.stringify(streams));
    const sites = [...new Set(streams.map(s => s.site))];
    check(streams.length >= 2, `Chromium opened a separate connection to ${THIRD} for each site (${streams.length} CONNECTs, not one shared socket)`);
    check(sites.includes(FIRST_A) && sites.includes(FIRST_B) && !sites.includes('--isolated--'), `the relay put each connection on its own site's circuit: ${sites.join(', ')}`);
    try {
      await sleep(500);
      const circuits = new Map(), add = line => { const m = /^(?:CIRC |circuit-status=)?(\d+) (?:BUILT|EXTENDED|LAUNCHED)\b.*SOCKS_USERNAME="([^"]*)"/.exec(line); if (m) circuits.set(m[1], m[2]); };
      for (const line of events) add(line);
      for (const line of await control.send('GETINFO circuit-status')) add(line);
      // SENTCONNECT names the circuit a stream was attached to, with the stream's own SOCKS username (passwords are never printed).
      const third = []; for (const line of events) { const m = /^STREAM (\d+) SENTCONNECT (\d+) (\S+):443 .*SOCKS_USERNAME="([^"]*)"/.exec(line); if (m && m[3] === THIRD) third.push({stream: m[1], circuit: m[2], user: m[4], circuitBuiltFor: circuits.get(m[2]) || '?'}); }
      console.log('tor streams to the third party', JSON.stringify(third));
      const byUser = new Map(third.map(s => [s.user, s.circuit]));
      const ok = byUser.get(FIRST_A) && byUser.get(FIRST_B) && byUser.get(FIRST_A) !== byUser.get(FIRST_B);
      check(Boolean(ok), `tor: the ${THIRD} streams ride different circuits, one built for ${FIRST_A} (circuit ${byUser.get(FIRST_A) || '?'}) and one for ${FIRST_B} (circuit ${byUser.get(FIRST_B) || '?'})`);
    } finally { control.close(); }
  } finally { await app.close(); }
});
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
