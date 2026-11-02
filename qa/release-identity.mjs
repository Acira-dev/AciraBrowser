// Release gate, check 4 (live part): the running packaged app identifies itself as Acira and a test profile reaches no live metrics endpoint.
//   D_APP_EXE=<win-unpacked\AciraBrowser.exe> node qa/release-identity.mjs      prints one JSON line, exit 0 only when both hold
// User agent: read by the page (navigator.userAgent) and as the header a server actually receives; both must carry Chrome/152.0.0.0 then AciraBrowser/<version> (the real string is "... Chrome/152.0.0.0 Safari/537.36 AciraBrowser/<version>") and never name Electron.
// Metrics: with ACIRA_BROWSER_TEST_DATA set the app must have no endpoint at all (metrics.status configured:false, no host), unless QA names its own address.
import fs from 'node:fs/promises';
import {startApp, httpFixture, poll} from './d-harness.mjs';

const root = '.qa-profiles/release-identity';
await fs.rm(root, {recursive: true, force: true});
delete process.env.ACIRA_METRICS_ENDPOINT;
const seen = [], fx = await httpFixture((req, res) => { seen.push(req.headers['user-agent'] || ''); res.setHeader('content-type', 'text/html'); res.end('<title>ua</title>x'); });
const base = `http://127.0.0.1:${fx.port}/`, problems = [], facts = {};
let app;
try {
  app = await startApp({root});
  await app.act({type: 'tab.new', url: base});
  const web = await app.waitWeb(base);
  facts.pageUserAgent = await poll(() => web.evaluate(() => navigator.userAgent), Boolean, 'page user agent');
  facts.headerUserAgent = seen.find(Boolean) || '';
  const good = /Chrome\/152\.0\.0\.0 .*AciraBrowser\/\d/;
  for (const [where, ua] of [['page', facts.pageUserAgent], ['request header', facts.headerUserAgent]]) {
    if (!good.test(ua)) problems.push(`${where} user agent lacks the "Chrome/152.0.0.0" and "AciraBrowser/<version>" tokens: ${ua}`);
    if (/Electron/i.test(ua)) problems.push(`${where} user agent names Electron: ${ua}`);
  }
  const metrics = (await app.svc({type: 'metrics.status'})).metrics;
  facts.metrics = {configured: metrics.configured, endpointHost: metrics.endpointHost, enabled: metrics.enabled};
  if (metrics.configured || metrics.endpointHost) problems.push(`a test profile has a metrics endpoint (${metrics.endpointHost || 'configured'})`);
} catch (error) { problems.push('probe failed: ' + String(error?.message || error).slice(0, 240)); }
finally { try { await app?.close(); } catch {} await fx.close(); await fs.rm(root, {recursive: true, force: true}).catch(() => {}); }
console.log(JSON.stringify({ok: problems.length === 0, problems, ...facts}));
process.exit(problems.length ? 1 : 0);
