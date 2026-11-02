// Stream L: one extension from the Chrome Web Store, end to end, in the real app on an isolated profile (the founder approved store
// installs into test profiles). Dark Reader: install (Acira's own prompt), it works on a page, disable, enable, remove. The full
// matrix of fifteen extensions is docs/launch/EXTENSION_COMPATIBILITY.md (stream J).
//   node qa/l-extension-e2e.mjs [--visible]    one Electron instance, off-screen, closed in finally. Needs the network (store download).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const ID = 'eimadpbcbfnmbkopoojfekhnkhdbieeh', NAME = 'Dark Reader';
const visible = process.argv.includes('--visible');
const data = path.resolve('.qa-profiles/l-ext-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>Fixture ${req.url}</title><body style="background:#fff;color:#000;font:16px system-ui;margin:40px"><h1>Fixture ${req.url}</h1><p>Plain white page with dark text.</p>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const record = (name, ok, detail = '') => { rows.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs')],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_TEST_APP_DIALOG: '1', ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) }, timeout: 40000,
});
let exitCode = 1;
const mainLog = [];
for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { for (const line of String(chunk).split(String.fromCharCode(10))) if (/stopped|crash|gone|extension|terminat|bad message|fatal|renderer|killed/i.test(line) && mainLog.length < 60) mainLog.push(line.trim().slice(0, 240)); });
try {
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html') || null; if (!ui) await wait(100); }
  if (!ui) throw Error('browser view not found');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1400, height: 860 }); if (visible) w.focus(); else if (!process.argv.includes('--never-show')) w.showInactive(); }, visible);
  const profileId = (await ui.evaluate(() => window.acira.getSnapshot())).activeBrowserProfileId;
  const ext = request => ui.evaluate(r => window.acira.extensions(r), { profileId, ...request });
  const listed = async () => ((await ext({ type: 'list' })).extensions || []).find(e => e.id === ID);

  // Acira's own prompt window (not a system box) asks before anything is added; answer it as a person pressing the main button, and keep its words.
  if (!process.argv.includes('--no-answer')) await app.evaluate(({ webContents }) => {
    globalThis.__prompts = []; let ticks = 0;
    const timer = setInterval(async () => {
      if (++ticks > 240) return clearInterval(timer);
      const wc = webContents.getAllWebContents().find(w => w.getURL().includes('native-dialog'));
      if (!wc || wc.isDestroyed()) return;
      try {
        const info = await wc.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")];return {text:document.body.innerText.replace(/\\n+/g," | "),buttons:b.map(x=>x.textContent.trim())}})()');
        if (!info.buttons.length) return;
        globalThis.__prompts.push(info); (globalThis.__timeline ||= []).push(Date.now() % 100000 + ' dialog seen: ' + info.text.slice(0, 80));
        await wc.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")];(b.find(x=>/^(add|load|install)/i.test(x.textContent.trim()))||b[0]).click();return 1})()'); (globalThis.__timeline ||= []).push(Date.now() % 100000 + ' pressed the Add button');
      } catch {}
    }, 250);
  });

  await app.evaluate(({ app }) => { globalThis.__gone = []; app.on('render-process-gone', (_e, wc, d) => (globalThis.__timeline ||= []).push(Date.now() % 100000 + ' CRASH ' + wc.getURL().slice(0, 40) + ' ' + d.reason) && globalThis.__gone.push('renderer ' + wc.getURL().slice(0, 50) + ' ' + d.reason + ' exit ' + d.exitCode)); app.on('child-process-gone', (_e, d) => globalThis.__gone.push(d.type + ' ' + d.reason + ' exit ' + d.exitCode + ' ' + (d.name || ''))); });
  if (process.argv.includes('--no-answer')) { await app.evaluate(() => { globalThis.__prompts = ['disabled']; }); const pending = ext({ type: 'install', extensionId: ID }).catch(e => ({ error: String(e.message || e) })); for (let i = 0; i < 30; i++) { await wait(2000); const seen = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => w.getURL().slice(-40)).filter(u => /native-dialog/.test(u)).length).catch(() => -1); const gone = await app.evaluate(() => globalThis.__gone).catch(() => []); console.log('t+' + (i + 1) * 2 + 's dialog windows: ' + seen + ' process events: ' + gone.length); if (gone.length || seen > 0) break; } throw Error('no-answer probe finished'); }
  const t0 = Date.now();
  const installed = await ext({ type: 'install', extensionId: ID }).catch(e => ({ error: String(e.message || e) }));
  const entry = (installed.extensions || []).find(e => e.id === ID);
  const prompts = await app.evaluate(() => globalThis.__prompts);
  record('install from the Chrome Web Store', !!entry, entry ? `${entry.name} ${entry.version} (${((Date.now() - t0) / 1000).toFixed(1)} s)` : (installed.error || 'not listed'));
  record('Acira asks first, in its own prompt', prompts.length >= 1 && /Dark Reader/i.test(prompts[0].text), prompts[0] ? `"${prompts[0].text.slice(0, 200)}" [${prompts[0].buttons.join(' / ')}]` : 'no prompt seen');
  if (!entry) throw Error('not installed; stopping');

  const open = async url => { await ui.evaluate(u => window.acira.dispatch({ type: 'tab.new', url: u }), url); await wait(2500); return await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url)?.executeJavaScript('({sheets:document.querySelectorAll("style.darkreader").length,scheme:document.documentElement.getAttribute("data-darkreader-scheme"),mode:document.documentElement.getAttribute("data-darkreader-mode")})'), url); };
  let page = await open(base + '/enabled');
  record('it runs on a page (dark theme applied)', !!page && (page.sheets > 0 || !!page.scheme || !!page.mode), JSON.stringify(page));
  await ext({ type: 'pin', extensionId: ID, pinned: true });
  await wait(800);
  const pinnedEntry = await listed();
  const buttons = await ui.evaluate(() => { const find = root => [...root.querySelectorAll('*')].flatMap(e => [...(e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title')) ? [e.getAttribute('aria-label') || e.getAttribute('title')] : []), ...(e.shadowRoot ? find(e.shadowRoot) : [])]); return find(document).filter(l => /dark reader/i.test(l)); });
  record('pin to the toolbar: its button appears', pinnedEntry?.pinned === true && buttons.length > 0, 'pinned=' + pinnedEntry?.pinned + '; buttons: ' + (buttons.join(', ') || 'none found'));

  await ext({ type: 'disable', extensionId: ID });
  const off = await listed();
  page = await open(base + '/disabled');
  record('disable: it stops running', !!off && off.enabled === false && !!page && page.sheets === 0 && !page.scheme, `enabled=${off?.enabled}; ${JSON.stringify(page)}`);

  await ext({ type: 'enable', extensionId: ID });
  page = await open(base + '/enabled-again');
  record('enable: it runs again', (await listed())?.enabled === true && !!page && (page.sheets > 0 || !!page.scheme || !!page.mode), JSON.stringify(page));

  await ext({ type: 'remove', extensionId: ID });
  const gone = !(await listed());
  page = await open(base + '/removed');
  const registry = JSON.parse(await fs.readFile(path.join(data, 'extensions.json'), 'utf8').catch(() => '{"entries":[]}'));
  record('remove: gone from the list, the profile and the page', gone && !!page && page.sheets === 0 && !page.scheme && !(registry.entries || []).some(e => e.id === ID), `listed=${!gone}; ${JSON.stringify(page)}; saved=${(registry.entries || []).length}`);

  const failed = rows.filter(r => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} pass`);
  exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.log('STOPPED: ' + String(error.message || error).slice(0, 300));
  if (mainLog.length) console.log('main process said: ' + mainLog.join(' || '));
  try { console.log('timeline: ' + (await app.evaluate(() => globalThis.__timeline)).join(' || ')); } catch {}
  try { console.log('process events: ' + (await app.evaluate(() => globalThis.__gone)).join(' || ')); } catch {}
} finally {
  await Promise.race([app.close(), wait(8000)]).catch(() => {});
  try { app.process().kill(); } catch {}
  server.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
