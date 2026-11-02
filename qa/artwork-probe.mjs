// Founder (29 Oct): "the new tab artwork doesn't show". Opens a new tab in an isolated profile with artwork on and reports what
// the new tab page tried to load for it: preferences, the artwork elements, failed requests and console errors. Usage:
//   node qa/native-slot.mjs artwork -- node qa/artwork-probe.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let app;
try {
  app = await launchPreparedNative({
    executablePath: process.env.PROBE_EXE || createRequire(import.meta.url)('electron'),
    args: process.env.PROBE_EXE ? [] : [path.resolve('desktop/main.cjs')],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve(`.qa-profiles/artwork-probe-${Date.now()}`), ACIRA_BROWSER_TEST_HIDDEN: '1' },
    timeout: 60000,
  });
  const pickUi = async () => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
  let ui = await pickUi();
  const failed = [], consoleErrors = [];
  ui.on('requestfailed', r => failed.push(`${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`));
  ui.on('response', r => { if (r.status() >= 400) failed.push(`${r.url().slice(0, 140)} :: HTTP ${r.status()}`); });
  ui.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text().slice(0, 200)); });
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
  await sleep(1500); ui = await pickUi();
  if (process.env.PROBE_COLLECTION) await ui.evaluate(([c, prefix]) => { const s = window.acira.getSnapshot(); const id = s.activeBrowserProfileId; const k = prefix + id; let v = {}; try { v = JSON.parse(localStorage.getItem(k) || '{}'); } catch {} v.collection = c; v.modules = { ...(v.modules || {}), artwork: true }; localStorage.setItem(k, JSON.stringify(v)); }, [process.env.PROBE_COLLECTION, process.env.PROBE_PREFIX]);
  await ui.evaluate(() => window.acira.dispatch({ type: 'tab.new' }));
  await sleep(6000);
  const report = await ui.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => /newtab|artwork|ntp/i.test(k));
    const prefs = Object.fromEntries(keys.map(k => [k, String(localStorage.getItem(k)).slice(0, 300)]));
    const nodes = [...document.querySelectorAll('[class*="art" i], [class*="cover" i], img, canvas')].filter(n => n.getClientRects().length).slice(0, 12)
      .map(n => ({ tag: n.tagName, cls: String(n.className).slice(0, 80), src: (n.currentSrc || n.src || getComputedStyle(n).backgroundImage || '').slice(0, 160), w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height), opacity: getComputedStyle(n).opacity, complete: n.complete, natural: n.naturalWidth }));
    return { url: location.href, prefs, nodes };
  });
  console.log(JSON.stringify({ ...report, failed: failed.slice(0, 20), consoleErrors: consoleErrors.slice(0, 15) }, null, 1));
} finally {
  try { await app?.close(); } catch {}
}
