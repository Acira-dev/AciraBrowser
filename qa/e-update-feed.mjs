// Stream E: the installed (packaged) app updates from a feed. Serves a folder holding a higher version's latest.yml + setup exe,
// starts the INSTALLED older build against it, checks for an update, waits for the verified download, switches channel.
//   D_APP_EXE=C:\ae\inst\AciraBrowser.exe node qa/e-update-feed.mjs <folder with latest.yml> [--install]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
const folder = path.resolve(process.argv[2] || ''); if (!process.env.D_APP_EXE) throw new Error('set D_APP_EXE to the installed AciraBrowser.exe');
const served = [];
const server = http.createServer((q, s) => { const file = path.join(folder, decodeURIComponent(q.url.split('?')[0])); served.push(q.url); if (!file.startsWith(folder) || !fs.existsSync(file)) { s.statusCode = 404; return s.end(); } s.writeHead(200, {'content-length': fs.statSync(file).size}); fs.createReadStream(file).pipe(s); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const feed = `http://127.0.0.1:${server.address().port}`;
const app = await startApp({root: '.qa-profiles/e-update-feed', env: {ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_FEED: feed}}); const out = {};
try {
  const svc = req => app.svc(req).then(r => r.update);
  fs.copyFileSync(path.join(folder, 'latest.yml'), path.join(folder, 'beta.yml')); // a Beta-channel app reads beta.yml (release.mjs publishes both)
  out.before = await svc({type: 'update.status'});
  out.afterCheck = await svc({type: 'update.check'});
  for (let i = 0; i < 90 && !['ready', 'error', 'current'].includes((await svc({type: 'update.status'})).status); i++) await sleep(2000);
  out.final = await svc({type: 'update.status'});
  out.stable = await svc({type: 'update.channel', channel: 'stable'}); out.beta = await svc({type: 'update.channel', channel: 'beta'});
  out.served = served.map(u => u.slice(0, 80));
  console.log(JSON.stringify(out, null, 1));
  if (out.final.status !== 'ready') process.exitCode = 1;
} finally { await app.close(); server.close(); }
