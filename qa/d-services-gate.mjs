// Stream D: the window is created before the browser services, but no tab page may load before they are in place.
// The services are held back for 3 s (ACIRA_TEST_SERVICES_DELAY_MS, only honoured in an isolated test profile). During that time the window's
// interface must already be loaded, and not one request from a tab page may leave. A restored tab and a tab opened from the interface during
// the wait must both load only after content blocking, HTTPS-only and the proxy are attached to their session.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-services-gate'; await fs.rm(root, {recursive: true, force: true});
const hits = [];
const fx = await httpFixture((req, res) => { if (req.url.includes('favicon')) { res.statusCode = 404; return res.end(); } hits.push({url: req.url, at: Date.now()}); res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`, report = [], DELAY = 3000;
const trace = app => app.main(() => { const t = globalThis.__aciraStartupTrace; return t ? {marks: {...t.marks}, timeOrigin: t.timeOrigin} : null; });

// 1. a normal run leaves a saved session with one tab
let app = await startApp({root});
try { await app.act({type: 'tab.new', url: base + '/restored'}); await app.waitWeb(base + '/restored'); await sleep(1500); } finally { await app.close(); }
await sleep(1500); hits.length = 0;

// 2. restart with the services held back
const t0 = Date.now();
app = await startApp({root, skipSetup: false, env: {ACIRA_TEST_SERVICES_DELAY_MS: String(DELAY)}});
try {
  const early = await poll(async () => { const t = await trace(app); return t?.marks['ui-loaded'] ? t : null; }, Boolean, 'interface loaded', 20000);
  assert.ok(early.marks['ui-loaded'], 'the interface loaded'); assert.ok(early.marks['windows-created'], 'the window was made');
  assert.equal(early.marks['services-ready'], undefined, 'services are still starting while the interface is already loaded');
  assert.equal(early.marks['first-tab-page'], undefined, 'no tab page exists yet'); report.push('window and interface load before the services');
  const state = await app.state();
  assert.ok(state.tabs.some(t => t.url === base + '/restored'), 'the interface already shows the restored session');
  // an action taken from the interface now waits for the services instead of loading a page without them
  const pending = app.ui.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), base + '/during-wait').then(() => Date.now());
  await sleep(1200);
  assert.deepEqual(hits, [], 'no tab page has made a request during the wait: ' + JSON.stringify(hits));
  assert.equal((await trace(app)).marks['first-tab-page'], undefined); report.push('no request leaves during the wait');
  const doneAt = await pending;
  const after = await trace(app), at = name => after.timeOrigin + after.marks[name];
  for (const name of ['services-ready', 'sessions-configured', 'pages-allowed', 'first-tab-page']) assert.ok(after.marks[name], name + ' was reached');
  assert.ok(after.marks['ui-loaded'] < after.marks['services-ready'], 'interface before services');
  assert.ok(after.marks['services-ready'] <= after.marks['sessions-configured'] && after.marks['sessions-configured'] <= after.marks['pages-allowed'] && after.marks['pages-allowed'] <= after.marks['first-tab-page'], 'services, then sessions, then pages: ' + JSON.stringify(after.marks));
  assert.ok(doneAt >= at('services-ready') - 5, 'the action from the interface finished only after the services were ready');
  await poll(() => hits.length >= 2, Boolean, 'restored and new tab loaded', 20000);
  for (const hit of hits) assert.ok(hit.at >= at('sessions-configured') - 5, `${hit.url} was requested ${at('sessions-configured') - hit.at} ms before its session was configured`);
  assert.ok(hits.some(h => h.url === '/during-wait'), 'the tab opened during the wait loaded afterwards');
  report.push(`first page request ${Math.round(Math.min(...hits.map(h => h.at)) - at('sessions-configured'))} ms after the session was configured; services ready ${Math.round(after.marks['services-ready'])} ms after launch`);
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report, wall: Date.now() - t0}, null, 1));
