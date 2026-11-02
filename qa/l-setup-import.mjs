// Stream L: first-run setup with Import on a fresh profile, then web tabs straight away. M saw it once: after "Done" the web
// tabs never opened (no page view was created). Capped: at most 5 fresh-profile runs, at most 5 tabs in each, one Electron
// instance at a time (closed in finally). Each run waits a different time after setup closes (0, 0, 300, 1000, 2500 ms).
//   node qa/l-setup-import.mjs [--runs=5] [--visible]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { _electron } from 'playwright';

const root = process.cwd();
const runs = Math.min(Number((process.argv.find(a => a.startsWith('--runs=')) || '--runs=5').slice(7)) || 5, 5);
const visible = process.argv.includes('--visible');
const delays = [0, 0, 300, 1000, 2500];
const fixture = path.join(root, '.qa-profiles/import-fixture'), seed = path.join(root, '.qa-profiles/first-run-seed');
const wait = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const results = [];

async function oneRun(index) {
  const data = path.join(root, `.qa-profiles/l-setup-${Date.now()}-${index}`);
  await fs.cp(seed, data, { recursive: true, filter: source => !/lockfile$|Singleton/.test(source) });
  const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: fixture, ACIRA_TEST_APP_DIALOG: '1', ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(root, 'desktop/main.cjs')], env, timeout: 40000 });
  const log = [];
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { for (const line of String(chunk).split(String.fromCharCode(10))) if (line.trim() && log.length < 40) log.push(line.trim().slice(0, 200)); });
  const result = { run: index + 1, delay: delays[index], ok: false, detail: '' };
  try {
    let page = null;
    for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html') || null; if (!page) await wait(200); }
    if (!page) throw Error('browser view not found');
    await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1440, height: 900 }); if (visible) w.focus(); else w.showInactive(); }, visible);
    await page.waitForSelector('.fr-welcome [data-onboarding-next]', { timeout: 20000 });
    await wait(1500);
    await page.locator('.fr-welcome [data-onboarding-next]').click();
    await page.waitForSelector('.fr-import-list .fr-pick', { timeout: 15000 });
    await wait(800);
    // Choose the first source and import.
    const rowsSeen = await page.locator('.fr-import-list .fr-row').count();
    await page.locator('.fr-import-list .fr-row').first().click();
    await wait(500);
    if (await page.locator('[data-onboarding-import]').isDisabled()) { await page.locator('.fr-import-list input').first().check({ force: true }).catch(() => {}); await wait(400); }
    if (await page.locator('[data-onboarding-import]').isDisabled()) throw Error('Import stays disabled; source rows: ' + rowsSeen);
    const title = await page.locator('.fr-card-title').getAttribute('aria-label');
    await page.locator('[data-onboarding-import]').click();
    for (let i = 0; i < 80 && (await page.locator('.fr-card-title').getAttribute('aria-label').catch(() => null)) === title; i++) await wait(250);
    // The remaining steps, then Done (bounded).
    for (let i = 0; i < 8 && (await page.locator('.setup-dialog [data-onboarding-next]').count()); i++) { await page.locator('.setup-dialog [data-onboarding-next]').first().click(); await wait(700); }
    await page.waitForSelector('.fr-yours-panel', { timeout: 8000 }).catch(() => {});
    if (await page.locator('[data-yours-done]').count()) await page.locator('[data-yours-done]').click();
    await wait(delays[index]);
    // Web tabs, at most 5, each checked.
    const states = [];
    for (let i = 0; i < 5; i++) {
      const before = (await page.evaluate(() => window.acira.getSnapshot())).tabs.length;
      const url = `${base}/run${index + 1}-tab${i + 1}`;
      await page.evaluate(u => window.acira.dispatch({ type: 'tab.new', url: u }), url);
      let opened = false;
      for (let k = 0; k < 20 && !opened; k++) {
        await wait(300);
        opened = await app.evaluate(({ BaseWindow }, u) => BaseWindow.getAllWindows()[0].contentView.children.some(v => v.webContents && v.webContents.getURL() === u), url);
      }
      const snap = await page.evaluate(() => window.acira.getSnapshot());
      states.push({ url: url.slice(-12), tabs: `${before}->${snap.tabs.length}`, opened });
      if (!opened) break;
    }
    const snap = await page.evaluate(() => window.acira.getSnapshot());
    const failed = states.find(s => !s.opened);
    if (failed) {
      const gate = await page.evaluate(async () => { try { return await window.acira.service({ type: 'cleanup.gate' }); } catch (e) { return String(e.message || e).slice(-120); } });
      const cleanup = await page.evaluate(async () => { try { return await window.acira.service({ type: 'cleanup.status' }); } catch (e) { return String(e.message || e).slice(-120); } });
      result.detail = JSON.stringify({ states, profiles: snap.browserProfiles.map(p => p.name + ':' + p.id.slice(-6)), activeProfile: snap.activeBrowserProfileId.slice(-6), onboardingComplete: snap.settings.onboardingComplete, zoomTarget: snap.windowUi.zoomTargetTabId || null, toast: snap.toast?.text || null, gate, cleanup, main: log.slice(-6) }).slice(0, 1600);
    } else {
      result.ok = true; result.detail = states.map(s => s.tabs).join(' ') + '; profiles: ' + snap.browserProfiles.map(p => p.name).join(', ');
    }
  } catch (error) {
    result.detail = 'threw: ' + String(error.message || error).slice(0, 300);
  } finally {
    await Promise.race([app.close(), wait(8000)]).catch(() => {});
    try { app.process().kill(); } catch {}
    await fs.rm(data, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

for (let i = 0; i < runs; i++) {
  const r = await oneRun(i); results.push(r);
  console.log((r.ok ? 'PASS' : 'FAIL') + ` run ${r.run} (wait ${r.delay} ms after Done) — ${r.detail}`);
}
server.close();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} runs opened every web tab`);
process.exit(bad.length ? 1 : 0);
