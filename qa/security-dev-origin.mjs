// The browser interface trusted http://127.0.0.1:5194 (the Vite dev server) in every build, and its view was allowed to navigate there.
// Any program on the computer that listened on that port got Acira's whole browser bridge (state, actions, services) once the interface
// view went to it. Now the origin counts only in a development run (ACIRA_DEV=1, which a real packaged build drops).
//   node qa/security-dev-origin.mjs <throwaway profile folder>      (ACIRA_REPO=<checkout> runs another checkout's desktop/main.cjs)
// Prints one JSON line: {navigated, bridge, requests}. Before the fix: navigated true, bridge "ok". After: navigated false, no requests.
import {_electron} from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';

const profile = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !profile.startsWith('/tmp/') && !profile.startsWith('/private/tmp/')) throw new Error('Pass a throwaway profile folder under /tmp');
await fs.rm(profile, {recursive: true, force: true}); await fs.mkdir(profile, {recursive: true});
const repo = path.resolve(process.env.ACIRA_REPO || '.');
const requests = [];
// Stands in for any local program on the dev server's port: its page reports whether it got Acira's bridge.
const server = http.createServer((request, response) => {
  requests.push(request.url);
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><title>waiting</title><script>
    (async () => { try { const s = await window.acira.getSnapshot(); document.title = 'bridge:' + (Array.isArray(s?.tabs) ? 'ok' : 'none'); } catch (e) { document.title = 'bridge:refused ' + e.message; } })();
    if (!window.acira) document.title = 'bridge:absent';
  </script>`);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5194, '127.0.0.1', resolve); });
const env = {...process.env, ACIRA_BROWSER_TEST_DATA: profile, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_QA_RUN: '1'};
delete env.ACIRA_DEV; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({args: [path.join(repo, 'desktop/main.cjs'), '--use-mock-keychain'], env, timeout: 40000});
let result;
try {
  if (!(await app.evaluate(({app}) => app.commandLine.hasSwitch('use-mock-keychain')))) throw new Error('mock keychain is not on');
  const deadline = Date.now() + 30000;
  let ui;
  while (!ui && Date.now() < deadline) { ui = app.windows().find(page => page.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await new Promise(r => setTimeout(r, 200)); }
  if (!ui) throw new Error('no interface page');
  const userData = await app.evaluate(({app}) => app.getPath('userData'));
  if (!path.resolve(userData).startsWith(profile)) throw new Error('userData is not the throwaway profile: ' + userData);
  await ui.evaluate(() => { location.href = 'http://127.0.0.1:5194/'; });
  await new Promise(r => setTimeout(r, 3000));
  const url = ui.url(), title = await ui.title().catch(() => '');
  result = {navigated: url.startsWith('http://127.0.0.1:5194/'), url, bridge: title.startsWith('bridge:') ? title.slice(7) : null, requests};
} finally { await app.close().catch(() => {}); server.close(); }
console.log(JSON.stringify(result));
await fs.rm(profile, {recursive: true, force: true});
