// Founder (28 Oct): the workspace title's "3 tabs" must end on the same right edge as the New tab row's count, in the same
// type, and the ⋯ button must sit where the count is (it swaps in on hover). Measures both rows in the real app at 100% and
// 150% (interface scale), light and dark, and writes a crop of the sidebar header. Usage: node qa/ws-count-align.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'C:/ae/r7/wscount'; await fs.mkdir(OUT, { recursive: true });
async function takeSlot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`ws-count ${new Date().toISOString()}\n`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
let app, lock; const results = [];
try {
  lock = await takeSlot();
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs')],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve(`.qa-profiles/ws-count-${Date.now()}`), ACIRA_BROWSER_TEST_HIDDEN: '1' },
    timeout: 60000,
  });
  const pickUi = async () => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
  let ui = await pickUi();
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
  await sleep(1200); ui = await pickUi();
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  await act({ type: 'tab.new' }); await act({ type: 'tab.new' });
  // The title shows once a window has two workspaces.
  await act({ type: 'workspace.create', name: 'Work' }); await sleep(600);
  const firstWs = await ui.evaluate(() => { const s = window.acira.getSnapshot(); return (s.workspaces || []).find(w => w.id !== s.activeWorkspaceId)?.id; });
  if (firstWs) await act({ type: 'workspace.select', id: firstWs }); await sleep(600);
  for (const [appearance, scale] of [['dark', 100], ['light', 100], ['dark', 150], ['light', 150]]) {
    await act({ type: 'settings.update', patch: { appearance, interfaceScale: scale, verticalTabs: true, windowView: 'full' } });
    await act({ type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } });
    await sleep(900);
    const m = await ui.evaluate(() => {
      const r = el => { const b = el?.getBoundingClientRect(); return b ? { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) } : null; };
      const count = document.querySelector('.sb-ws-title-count'), more = document.querySelector('.sb-ws-title-more'), newCount = document.querySelector('.sb-new-end>small');
      const cs = el => el ? { size: getComputedStyle(el).fontSize, color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight } : null;
      return { count: r(count), more: r(more), newCount: r(newCount), countStyle: cs(count), newStyle: cs(newCount), countText: count?.textContent, newText: newCount?.textContent };
    });
    const delta = m.count && m.newCount ? +(m.count.right - m.newCount.right).toFixed(1) : null;
    const moreCenter = m.more ? (m.more.left + m.more.right) / 2 : null, countCenter = m.count ? (m.count.left + m.count.right) / 2 : null;
    results.push({ appearance, scale, delta, sameType: JSON.stringify(m.countStyle) === JSON.stringify(m.newStyle), moreOverCount: moreCenter !== null && m.count && moreCenter >= m.count.left - 8 && moreCenter <= m.count.right + 8, ...m });
    const png = await app.evaluate(async ({ webContents }) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); return (await wc.capturePage({ x: 0, y: 0, width: 320, height: 140 })).toPNG().toString('base64'); });
    await fs.writeFile(path.join(OUT, `header-${appearance}-${scale}.png`), Buffer.from(png, 'base64'));
  }
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(r.appearance, r.scale, 'right-edge delta', r.delta, 'same type', r.sameType, 'more over count', r.moreOverCount, r.countText, '|', r.newText);
} finally {
  try { await app?.close(); } catch {}
  if (lock) { try { await fs.unlink(lock); } catch {} }
}
