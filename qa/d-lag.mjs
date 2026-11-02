// Stream D: how smooth are popups, tab switches, new tabs and Settings in the real app, at display rate?
// One visible instance on a disposable profile, a handful of tabs (never more than 8), closed in finally.
//   node qa/d-lag.mjs [label] [repeats=3]      env D_APP_EXE runs it against a packaged build
// For each action it records, in wall-clock time: frames drawn by the interface page and by the popup (overlay) page (requestAnimationFrame gaps),
// stalls of the main process event loop (a 2 ms timer that arrives late), and for popups the time until the open formation reports ready.
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
process.env.D_VISIBLE = '1';
const label = process.argv[2] || 'run', repeats = Math.min(5, Number(process.argv[3] || 3)), root = `.qa-profiles/d-lag-${label}`;
await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>${req.url}</title><body style="font:16px sans-serif"><h1>${req.url}</h1>${'<p>lorem ipsum dolor sit amet</p>'.repeat(60)}`); });
const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const RECORDER = `(() => { if (window.__lag) return; const lag = window.__lag = {frames: [], readyAt: null}; const origin = performance.timeOrigin;
  const tick = t => { lag.frames.push(origin + t); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  new MutationObserver(() => { if (!lag.readyAt && document.querySelector('[data-formation-ready="true"]')) lag.readyAt = performance.timeOrigin + performance.now(); }).observe(document, {subtree: true, attributes: true, childList: true}); })()`;
const app = await startApp({root}), results = [];
try {
  const pages = () => ({ui: app.ui, overlay: app.context.pages().find(p => p.url().includes('view=overlay'))});
  await app.main(() => { const lag = globalThis.__lag = {stalls: []}; let last = performance.now(); setInterval(() => { const now = performance.now(), gap = now - last; last = now; if (gap > 10) lag.stalls.push({at: performance.timeOrigin + now, ms: Math.round(gap)}); }, 2); });
  for (const page of Object.values(pages())) if (page) await page.evaluate(RECORDER);
  for (const p of ['/a', '/b', '/c', '/d', '/e', '/f']) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}${p}`}); await sleep(500); }
  await sleep(1500);
  const measure = async (name, act, after = 1200) => {
    const {ui, overlay} = pages();
    for (const page of [ui, overlay]) if (page) await page.evaluate(() => { window.__lag.frames.length = 0; window.__lag.readyAt = null; });
    await app.main(() => { globalThis.__lag.stalls.length = 0; });
    const started = Date.now(); await act(); await sleep(after);
    const gapsOf = async page => { if (!page) return null; const {frames, readyAt} = await page.evaluate(() => ({frames: window.__lag.frames.slice(), readyAt: window.__lag.readyAt})); const inside = frames.filter(t => t >= started - 5 && t <= started + after), gaps = inside.slice(1).map((t, i) => t - inside[i]);
      return {frames: inside.length, over20: gaps.filter(g => g > 20).length, worstGap: Math.round(Math.max(0, ...gaps)), readyMs: readyAt ? Math.round(readyAt - started) : null}; };
    const stalls = (await app.main(() => globalThis.__lag.stalls)).filter(s => s.at >= started && s.at <= started + after);
    return {name, ui: await gapsOf(ui), overlay: await gapsOf(overlay), mainStalls: stalls.length, worstStall: Math.max(0, ...stalls.map(s => s.ms)), stalledMs: stalls.reduce((a, s) => a + s.ms, 0)};
  };
  const tab = async () => (await app.state()).activeTabId;
  const popup = (kind, close = 'Escape') => ({open: async () => app.cmd({type: 'ui', tabId: await tab(), action: 'open', kind}), close: async () => { const {overlay} = pages(); await overlay.keyboard.press(close); }});
  const tabIds = async () => (await app.state()).tabs.map(t => t.id);
  for (let round = 0; round < repeats; round++) {
    for (const kind of ['menu', 'tabs', 'profile', 'palette']) {
      const p = popup(kind);
      results.push({round, ...(await measure(`${kind} open`, p.open))});
      results.push({round, ...(await measure(`${kind} close`, p.close, 800))});
      await sleep(400);
    }
    const ids = await tabIds();
    for (let i = 0; i < 3; i++) results.push({round, ...(await measure('tab switch', () => app.act({type: 'tab.select', id: ids[(round * 3 + i + 1) % ids.length]}), 700))});
    results.push({round, ...(await measure('new tab', () => app.act({type: 'tab.new'}), 1500))});
    results.push({round, ...(await measure('settings open', () => app.act({type: 'tab.new', url: 'acira://settings'}), 2000))});
    // keep the tab count small
    const all = await tabIds(); for (const id of all.slice(8)) await app.act({type: 'tab.close', id});
    await sleep(500);
  }
  const names = [...new Set(results.map(r => r.name))];
  const table = names.map(name => { const rows = results.filter(r => r.name === name); const pick = side => rows.map(r => r[side]).filter(Boolean);
    return {action: name, uiOver20: median(pick('ui').map(x => x.over20)), uiWorstGap: median(pick('ui').map(x => x.worstGap)), overlayOver20: median(pick('overlay').map(x => x.over20)), overlayWorstGap: median(pick('overlay').map(x => x.worstGap)), readyMs: median(pick('overlay').map(x => x.readyMs).filter(x => x != null)), mainStalls: median(rows.map(r => r.mainStalls)), worstStallMs: median(rows.map(r => r.worstStall)), stalledMs: median(rows.map(r => r.stalledMs))}; });
  console.table(table);
  await fs.mkdir('.tmp-d', {recursive: true}); await fs.writeFile(`.tmp-d/lag-${label}.json`, JSON.stringify({label, packaged: process.env.D_APP_EXE || null, table, results}, null, 1));
} finally { await app.close(); await fx.close(); }
