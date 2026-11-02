// R3-44 rows "HTTPS-only upgrade" and "Third-party cookies blocked". Real app, isolated profile, one instance, closed in finally.
//   node qa/r3-proof/local-privacy.mjs      (cwd = worktree root; a local TLS fixture + loopback names; two public sites for the HTTPS-only part)
// Test names are mapped to this PC with --host-resolver-rules; the fixture's self-signed certificate is trusted only inside this test process, for these names.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, httpsFixture, poll} from '../d-harness.mjs';
import {probe, withSlot, sleep, capturePage} from './lib.mjs';

const P = probe('local-privacy');
const PART = process.env.PROOF_PART || ''; // 'https' or 'cookies' runs one half (the suite runs them as two rows); empty runs both
const root = path.resolve('.qa-profiles/r3-proof-local-privacy');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const NAMES = ['first.acira-a.test', 'third.acira-b.test', 'secure-only.example.test'];
const hits = [];
let TLS = 0, PLAIN = 0;
const tls = await httpsFixture(root, (req, res) => {
  const host = String(req.headers.host || '').split(':')[0]; hits.push({secure: true, host, url: req.url, cookie: req.headers.cookie || ''});
  res.setHeader('cache-control', 'no-store'); res.setHeader('content-type', 'text/html');
  if (host === 'third.acira-b.test' && req.url === '/seed') { res.setHeader('set-cookie', 'ordinary=retained; Secure; SameSite=None; Path=/'); return res.end('<title>seeded</title>seeded'); }
  if (host === 'third.acira-b.test' && req.url === '/cookies') return res.end(`<title>cookies</title><pre id=c>${req.headers.cookie || ''}</pre>`);
  if (host === 'third.acira-b.test' && req.url === '/embed') {
    res.setHeader('set-cookie', ['newordinary=embedded; Secure; SameSite=None; Path=/']);
    return res.end(`<script>parent.postMessage({header:${JSON.stringify(req.headers.cookie || '')},script:document.cookie},'*')</script>`);
  }
  if (host === 'first.acira-a.test') { res.setHeader('set-cookie', 'login=first-party; Secure; SameSite=Lax; Path=/'); return res.end(`<title>first</title><h1>First-party page</h1><iframe src="https://third.acira-b.test:${TLS}/embed"></iframe><script>window.results=[];addEventListener('message',e=>results.push(e.data))</script>`); }
  res.end('<title>Secure marker</title><h1>Secure marker</h1>');
}, {cn: 'first.acira-a.test', san: 'DNS:first.acira-a.test,DNS:third.acira-b.test,DNS:secure-only.example.test,IP:127.0.0.1'});
TLS = tls.port;
const plain = http.createServer((req, res) => { hits.push({secure: false, host: String(req.headers.host || '').split(':')[0], url: req.url}); res.setHeader('content-type', 'text/html'); res.end('<title>Plain marker</title><h1>Plain marker</h1>'); });
await new Promise(resolve => plain.listen(0, '127.0.0.1', resolve)); PLAIN = plain.address().port;

await withSlot('proof-local-privacy', async () => {
  const rules = [...NAMES, 'plain-only.example.test'].map(n => `MAP ${n} 127.0.0.1`).join(', ');
  const app = await startApp({root, args: [`--host-resolver-rules=${rules}`]});
  try {
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setFocusable(false); win.setSkipTaskbar(true); win.setBounds({x: -20000, y: -20000, width: 1440, height: 900}); win.showInactive(); });
    const state = await app.state(), profile = state.browserProfiles.find(p => p.id === state.activeBrowserProfileId);
    await app.main(({session}, [partition, names]) => { session.fromPartition(partition).setCertificateVerifyProc((request, callback) => callback(names.includes(request.hostname) ? 0 : -3)); }, [profile.partition, NAMES]);
    await app.main(({dialog}) => { globalThis.__answer = 0; globalThis.__prompts = []; dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; globalThis.__prompts.push({title: o.title, message: o.message, buttons: o.buttons}); return {response: globalThis.__answer, checkboxChecked: false}; }; }); // the Allow-HTTP review is a native question: the test answers it (first Cancel, then Allow)
    const active = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
    const go = async (url, until, label) => { await app.act({type: 'tab.navigate', url}); return poll(active, t => t && until(t), label, 25000); };

    let before, tab;
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}});
    // ---------------- HTTPS-only
    if (!PART || PART === 'https') {
    const off = (await app.svc({type: 'https.status'})).https.profile;
    P.check('HTTPS-only is off by default (an http:// address stays http://)', off.enabled === false, JSON.stringify(off));
    // Control: off, the plain server answers over http.
    before = hits.length;
    tab = await go(`http://plain-only.example.test:${PLAIN}/`, t => t.url.startsWith('http://plain-only') && !t.loading && /Plain/.test(t.title || ''), 'plain loads with the switch off');
    P.check('control: with HTTPS-only off, a plain http site loads over http', hits.slice(before).some(h => !h.secure && h.host === 'plain-only.example.test'), `tab ${tab.url} "${tab.title}"`);
    await app.svc({type: 'https.set', enabled: true});
    P.check('HTTPS-only turns on', (await app.svc({type: 'https.status'})).https.profile.enabled === true);
    // TLS-only server: the address is typed with http://, only an upgraded request can reach it.
    before = hits.length;
    tab = await go(`http://secure-only.example.test:${TLS}/`, t => t.url.startsWith('https://secure-only') && !t.loading && /Secure marker/.test(t.title || ''), 'upgrade to https');
    await sleep(400);
    await capturePage(app, 'secure-only.example.test', P.shot('https-only-upgraded.png'));
    P.check('an http:// address is upgraded to https:// before any request goes out', tab.url === `https://secure-only.example.test:${TLS}/` && hits.slice(before).every(h => h.secure), `typed http://secure-only.example.test:${TLS}/ -> ${tab.url}; requests ${JSON.stringify(hits.slice(before).map(h => (h.secure ? 'https ' : 'http ') + h.url))}`, P.shot('https-only-upgraded.png'));
    // A site with no HTTPS: the product asks (native prompt). Answered "Cancel": nothing is downgraded, no http request is sent.
    before = hits.length;
    await app.act({type: 'tab.navigate', url: `http://plain-only.example.test:${PLAIN}/second`});
    const prompts = () => app.main(() => globalThis.__prompts);
    await poll(prompts, list => list.length >= 1, 'Allow-HTTP prompt', 25000);
    await sleep(1200);
    const asked = (await prompts())[0];
    const failedTab = await active();
    const status = (await app.svc({type: 'https.status', tabId: failedTab.id})).https;
    P.check('a site that cannot do HTTPS makes the product ask before any http request ("Allow HTTP for this site?")', /plain-only\.example\.test/.test(asked.message || '') && asked.buttons?.length === 2, JSON.stringify(asked));
    P.check('answered Cancel: no http request was sent and the page did not load over http', hits.slice(before).every(h => h.secure !== false) && !status.temporaryHTTP && !/Plain/.test(failedTab.title || ''), `plain requests ${hits.slice(before).filter(h => !h.secure).length}; tab "${failedTab.title}" error ${JSON.stringify(failedTab.error || null)}; grant ${JSON.stringify(status.temporaryHTTP)}`);
    P.check('the failure ticket is kept so the person can still choose Allow HTTP', status.upgradeFailure?.canAllowHTTP === true, JSON.stringify(status.upgradeFailure && {error: status.upgradeFailure.error, canAllowHTTP: status.upgradeFailure.canAllowHTTP}));
    await app.main(() => { globalThis.__answer = 1; });
    const allowed = await app.svc({type: 'https.allow', tabId: failedTab.id, ticketId: status.upgradeFailure.ticketId});
    tab = await poll(active, t => t.url.startsWith('http://plain-only') && !t.loading && /Plain/.test(t.title || ''), 'plain loads after allow', 20000).catch(() => active());
    P.check('answered Allow: that one site then loads over http', /Plain/.test(tab.title || '') && hits.slice(before).some(h => !h.secure && h.host === 'plain-only.example.test'), `allow -> ${JSON.stringify(allowed).slice(0, 140)}; tab ${tab.url} "${tab.title}"`);
    // Real public sites.
    const real = await go('http://example.org/', t => t.url.startsWith('https://') && !t.loading, 'example.org upgraded').catch(() => active());
    await capturePage(app, 'example.org', P.shot('https-only-example-org.png'));
    P.check('a real public site typed with http:// ends on https://', real.url.startsWith('https://example.org') || real.url.startsWith('https://www.example.org'), real.url, P.shot('https-only-example-org.png'));
    await app.svc({type: 'https.set', enabled: false});
    P.check('HTTPS-only turns off again', (await app.svc({type: 'https.status'})).https.profile.enabled === false);

    }
    // ---------------- Third-party cookies
    if (!PART || PART === 'cookies') {
    const net = (await app.svc({type: 'network.status'})).network;
    P.check('the engine reports third-party cookies blocked on every website', net.engine?.thirdPartyCookies === 'block', JSON.stringify(net.engine));
    await go(`https://third.acira-b.test:${TLS}/seed`, t => t.url.includes('/seed') && !t.loading, 'seed cookie');
    before = hits.length;
    await go(`https://first.acira-a.test:${TLS}/top`, t => t.url.includes('first.acira-a.test') && !t.loading, 'first-party page');
    const page = await app.waitWeb(u => u.startsWith('https://first.acira-a.test'), 'first-party page');
    const got = await poll(() => page.evaluate(() => ({results: window.results || [], cookie: document.cookie})), v => v.results.length > 0, 'iframe message', 15000);
    const embedHit = hits.slice(before).find(h => h.url === '/embed');
    P.check('the first-party cookie works on the first-party page', got.cookie.includes('login=first-party'), got.cookie);
    P.check('control: the third-party iframe really loaded (the server answered /embed)', Boolean(embedHit), JSON.stringify(embedHit || null));
    P.check('a cookie another site set is NOT sent to the third-party iframe and not readable in it', !/ordinary=/.test(got.results[0].header) && !/ordinary=/.test(got.results[0].script), `iframe request cookie header "${got.results[0].header}", document.cookie "${got.results[0].script}"`);
    await go(`https://third.acira-b.test:${TLS}/cookies`, t => t.url.includes('/cookies') && !t.loading, 'cookies as first party');
    const seen = await (await app.waitWeb(u => u.includes('third.acira-b.test') && u.includes('/cookies'), 'cookies page')).evaluate(() => document.getElementById('c').textContent);
    await capturePage(app, 'third.acira-b.test', P.shot('third-party-cookie-result.png'));
    P.check('the same site as a first party still has its own cookie, but the cookie its iframe tried to set was refused', /ordinary=retained/.test(seen) && !/newordinary/.test(seen), `cookies the site sees when opened itself: "${seen}"`, P.shot('third-party-cookie-result.png'));
    }
  } finally {
    await app.close();
  }
});
await tls.close(); plain.close();
P.finish({hits: hits.length});
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
