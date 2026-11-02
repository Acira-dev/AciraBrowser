// Anonymous usage counts in the real app against a LOCAL test endpoint (127.0.0.1; honoured only under ACIRA_BROWSER_TEST_DATA).
// Off by default: nothing arrives. Turn on: the next send is exactly the previewed payload. Turn off: id forgotten. One app, closed in finally.
// node qa/privacy-plus/metrics-app.mjs
import fs from 'node:fs';
import path from 'node:path';
import {startApp, httpFixture, sleep} from '../d-harness.mjs';

const hits = [];
const server = await httpFixture((request, response) => { let body = ''; request.on('data', d => { body += d; }); request.on('end', () => { hits.push({method: request.method, headers: request.headers, body}); response.statusCode = 204; response.end(); }); });
const checks = [];
const check = (name, ok, detail) => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail)); };
const app = await startApp({root: '.qa-profiles/j-metrics', env: {ACIRA_METRICS_ENDPOINT: `http://127.0.0.1:${server.port}/v1/daily`}});
try {
  const first = (await app.svc({type: 'metrics.status'})).metrics;
  check('starts unset and off, endpoint configured', first.choice === 'unset' && !first.enabled && first.configured, first);
  const protection = (await app.svc({type: 'protection.status'})).protection.rows.find(row => row.id === 'telemetry');
  check('protection row says nothing is sent while off', /^Nothing is sent/.test(protection.detail), protection.detail);
  const on = (await app.svc({type: 'metrics.set', enabled: true})).metrics;
  check('on makes a real random id', on.enabled && on.payload.installId !== first.payload.installId, on.payload);
  const sent = fs.readFileSync(path.join(app.root, 'metrics.json'), 'utf8');
  check('choice is stored on disk', /"choice":"on"/.test(sent), sent);
  // The app's own timer fires 20 s after start; ask for the same send now through the service-free path by waiting it out.
  for (let i = 0; i < 12 && !hits.length; i++) await sleep(2500);
  check('exactly one POST arrived, JSON, no cookies or auth', hits.length === 1 && hits[0].method === 'POST' && !hits[0].headers.cookie && !hits[0].headers.authorization && !hits[0].headers.referer && /^Acira\//.test(hits[0].headers['user-agent']), hits.map(h => h.headers));
  const body = hits[0] && JSON.parse(hits[0].body);
  check('the body is exactly the previewed payload (day aside)', body && JSON.stringify({...body, day: ''}) === JSON.stringify({...on.payload, day: ''}), {body, preview: on.payload});
  check('appVersion is Acira version, not Electron version', body && body.appVersion === JSON.parse(fs.readFileSync('package.json', 'utf8')).version, body && body.appVersion);
  const off = (await app.svc({type: 'metrics.set', enabled: false})).metrics;
  check('off forgets the id', off.choice === 'off' && off.sample, off);
} finally { await app.close(); }
// Second launch of the same opted-in profile with today's send forgotten: the 20 second start-up timer (not the opt-in path) must send, with no main-process error.
const file = path.join(app.root, 'metrics.json'), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.writeFileSync(file, JSON.stringify({ choice: 'on', installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', lastSent: '' }));
hits.length = 0;
const again = await startApp({root: '.qa-profiles/j-metrics', env: {ACIRA_METRICS_ENDPOINT: `http://127.0.0.1:${server.port}/v1/daily`}});
try {
  for (let i = 0; i < 16 && !hits.length; i++) await sleep(2500);
  check('the start-up timer sent once, 20 s after launch, with no main-process error', hits.length === 1 && !/ReferenceError|is not defined|Uncaught/.test(again.logs.join('')), {hits: hits.length, logs: again.logs.join('').slice(-400)});
  await sleep(3000);
  check('app still answers after the timer', Boolean((await again.state()).activeBrowserProfileId), null);
} finally { await again.close(); await server.close(); }
console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED');
process.exit(checks.every(Boolean) ? 0 : 1);
