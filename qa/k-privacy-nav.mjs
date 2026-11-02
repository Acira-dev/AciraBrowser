// Stream K: parity audit #5 and #8 in the real isolated app, on local fixtures only.   node qa/k-privacy-nav.mjs   (cwd = worktree root)
// - tracking parameters leave cross-site navigations before the request is sent; same-site keeps them; the switch turns it off
// - an AMP page is replaced by its canonical page, with no history entry left behind
// - spelling dictionaries are requested from the configured Acira location, and the net log has no Google dictionary host
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/k-privacy-nav'); await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const netlog = path.join(root, 'netlog.json'), report = [], seen = {b: [], dict: []};
const html = body => `<!doctype html><meta charset=utf-8>${body}`;
const siteA = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html('<title>A</title><p>site A')); });
const siteB = await httpFixture((req, res) => {
  seen.b.push(req.url); res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/amp')) return res.end(`<!doctype html><html amp lang=en><head><meta charset=utf-8><title>AMP</title><link rel="canonical" href="/canonical?from=amp"></head><body>amp body</body></html>`);
  res.end(html(`<title>B ${req.url}</title><p>site B`));
});
const dictionaries = await httpFixture((req, res) => { seen.dict.push(req.url); res.statusCode = 404; res.end(); });
const A = `http://127.0.0.1:${siteA.port}`, B = `http://localhost:${siteB.port}`;

const app = await startApp({root, args: [`--log-net-log=${netlog}`], env: {ACIRA_SPELLCHECK_DICTIONARY_URL: `http://127.0.0.1:${dictionaries.port}/`}});
const tabUrl = () => app.state().then(s => s.tabs.find(t => t.id === s.activeTabId)?.url || '');
const go = async url => { await app.main(({webContents}, [from, to]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(from)); if (!wc) throw new Error('no page ' + from); return wc.executeJavaScript(`location.href=${JSON.stringify(to)}`); }, [url.from, url.to]); };
try {
  await app.act({type: 'tab.new', url: A + '/'}); await poll(tabUrl, u => u.startsWith(A), 'site A open', 20000); await sleep(800);

  // 1. Cross-site: stripped before the request is sent.
  await go({from: A, to: `${B}/landing?fbclid=abc&id=1&utm_source=mail`});
  let url = await poll(tabUrl, u => u.startsWith(B + '/landing'), 'landing', 20000);
  assert.equal(url, `${B}/landing?id=1`); assert.ok(!seen.b.some(u => /fbclid|utm_source/.test(u)), 'site B never saw the tracking parameters: ' + seen.b.join(' '));
  report.push(`cross-site link: ${B}/landing?fbclid=abc&id=1&utm_source=mail -> ${url} (server saw ${seen.b.at(-1)})`);

  // 2. Same-site keeps its parameters.
  await go({from: B, to: `${B}/same?fbclid=keep`}); url = await poll(tabUrl, u => u.includes('/same'), 'same-site', 20000);
  assert.equal(url, `${B}/same?fbclid=keep`); report.push('same-site link keeps its parameters: ' + url);

  // 3. The switch turns it off.
  await app.svc({type: 'antitracking.set', patch: {stripTrackingParams: false}});
  await go({from: B, to: `${A}/?gclid=off`}); url = await poll(tabUrl, u => u.startsWith(A), 'switch off', 20000);
  assert.equal(url, `${A}/?gclid=off`); report.push('switched off: ' + url + ' keeps gclid');
  await app.svc({type: 'antitracking.set', patch: {stripTrackingParams: true}});

  // 4. De-AMP: the AMP page is replaced by its canonical page, and Back skips it.
  await go({from: A, to: `${B}/amp?fbclid=1`}); url = await poll(tabUrl, u => u.includes('/canonical'), 'de-AMP', 20000);
  assert.equal(url, `${B}/canonical?from=amp`);
  const history = await app.main(({webContents}, from) => webContents.getAllWebContents().find(w => w.getURL().startsWith(from)).navigationHistory.getAllEntries().map(e => e.url), B + '/canonical');
  assert.ok(!history.some(u => u.includes('/amp')), 'no AMP entry in history: ' + history.join(' '));
  report.push(`AMP page -> ${url}; history ${history.map(u => u.replace(/^http:\/\/[^/]+/, '')).join(' , ')}`);
  const status = (await app.svc({type: 'antitracking.status'})).antiTracking;
  assert.equal(status.settings.stripTrackingParams, true); assert.equal(status.settings.deAmp, true);
  report.push('rows: ' + status.rows.filter(r => ['tracking-params', 'de-amp'].includes(r.id)).map(r => `${r.title} ${r.state} (${r.detail})`).join(' | '));

  // 5. Spelling: a language Windows does not have is downloaded from the configured Acira location only.
  const languages = await app.main(({webContents, session}) => {
    const sessions = new Set([session.defaultSession, ...webContents.getAllWebContents().map(w => w.session)]);
    for (const s of sessions) { s.setSpellCheckerEnabled(true); s.setSpellCheckerLanguages(['pl']); }
    return [...sessions].map(s => s.getSpellCheckerLanguages().join(','));
  });
  await poll(async () => seen.dict.length, n => n > 0, 'dictionary request', 20000);
  report.push(`spelling ${languages.join(' ')}: dictionary requested from Acira location: ${[...new Set(seen.dict)].join(' ')}`);
  console.log(report.map(r => ' - ' + r).join('\n'));
} catch (error) { console.error('FAILED', error.message); process.exitCode = 1; }
await app.close(); await sleep(1500);
try {
  const log = await fs.readFile(netlog, 'utf8');
  const hosts = [...new Set([...log.matchAll(/"(?:url|host)":"(?:https?:\/\/)?([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  const google = hosts.filter(h => /(gvt1|googleapis|google|gstatic)\./.test(h));
  console.log(' - net log hosts:', hosts.join(' ') || '(none)');
  assert.deepEqual(google, [], 'no Google host in the net log'); console.log(' - no Google host contacted (net log)');
} catch (error) { console.error('NET LOG', error.message); process.exitCode = 1; }
for (const s of [siteA, siteB, dictionaries]) await s.close();
process.exit(process.exitCode || 0);
