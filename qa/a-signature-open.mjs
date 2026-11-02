// A (round 2, founder: "the menu opening animation should be way more premium ... sequential ... vapor ... fast"). Measures
// the signature open per frame in the overlay renderer from the input: first row readable (opacity > .5), every row
// settled, the worst frame, the row count and cascade, and that each haze row sits on its sharp row. Optional capture
// strips (light and dark) of the main menu open. Isolated, one instance, showInactive, capped loops, ≤ 4 tabs.
//   node qa/a-signature-open.mjs [strips-dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const stripsDir = process.argv[2];
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><body style="font:16px system-ui;background:#f4f1ea;padding:40px"><h1>${req.url}</h1></body>`); });
const base = `http://127.0.0.1:${fx.port}/`;
const dir = '.qa-profiles/a-signature-open'; await fs.rm(dir, {recursive: true, force: true});
const app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
// Per frame: the rows' opacities (sharp content only), the haze rows' alignment, frame gaps, running animations.
const SAMPLE = () => new Promise(resolve => {
  const out = [], t0 = performance.now(); let last = t0;
  const step = now => {
    const sheet = document.querySelector('.sheet-popup'), sharp = sheet?.querySelector('.popup-sheet-plane > .popup-contents:not([data-vapor-layer])');
    const rows = sharp ? [...sharp.querySelectorAll('.menu-row,.acira-menu-row,.tab-result-row,.palette-row,[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')].filter(r => r.getClientRects().length) : [];
    // Effective opacity: the row's own times every ancestor's (the plane and the sheet), and 0 while anything is hidden.
    const op = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= +cs.opacity; } return o; };
    const haze = sheet?.querySelector('[data-vapor-layer]');
    let align = null;
    if (haze && rows.length) { const h = haze.querySelectorAll('.menu-row,.acira-menu-row,.tab-result-row,.palette-row,[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]'); const a = rows[0].getBoundingClientRect(), b = h[0]?.getBoundingClientRect(); if (b) align = Math.round(Math.abs(a.top - b.top) * 10) / 10; }
    out.push({t: now - t0, gap: now - last, shown: !!sheet, rows: rows.length, first: rows[0] ? op(rows[0]) : null, last: rows.length ? op(rows[rows.length - 1]) : null, readable: rows.filter(r => op(r) > .5).length, haze: !!haze, align, anims: sheet ? sheet.getAnimations({subtree: true}).length : 0});
    last = now;
    if (now - t0 < 600) requestAnimationFrame(step); else resolve(out);
  };
  requestAnimationFrame(step);
});
const close = async () => { for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await overlay()?.keyboard.press('Escape').catch(() => {}); await app.ui.keyboard.press('Escape').catch(() => {}); await sleep(250); } const o = (await layout())?.overlay; if (o) await app.ui.evaluate(id => window.acira.closeOverlay(id), o.id); await sleep(450); };
const results = [];
async function measure(label, open, {strip} = {}) {
  await close();
  const o = overlay(); if (!o) { console.log(label, 'no overlay renderer'); return; }
  const sampling = o.evaluate(SAMPLE);
  const shots = strip ? app.main(async ({webContents}, until) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); const out = [], t0 = Date.now(); for (let i = 0; i < 16 && Date.now() - t0 < until; i++) { const img = await wc.capturePage(); out.push({t: Date.now() - t0, png: img.toPNG().toString('base64')}); } return out; }, 330) : null;
  const tClick = Date.now(); await open();
  const rows = await sampling; const frames = shots ? await shots : [];
  const startAt = rows.findIndex(r => r.shown && r.rows), seen = rows.slice(Math.max(0, startAt)), t = r => Math.round(r.t - (seen[0]?.t ?? 0));
  const firstReadable = seen.find(r => r.first > .5), allSettled = seen.find((r, i) => i > 0 && r.readable === r.rows && r.last >= .999 && !r.haze);
  const worst = Math.max(...seen.slice(1, 25).map(r => r.gap));
  const row = {label, rows: seen.at(-1)?.rows, firstRowReadableMs: firstReadable ? t(firstReadable) : null, settledMs: allSettled ? t(allSettled) : null, worstFrameMs: Math.round(worst * 10) / 10, hazeAlignPx: seen.find(r => r.align !== null)?.align ?? null, hazeSeen: seen.some(r => r.haze)};
  results.push(row); console.log(JSON.stringify(row));
  if (process.env.A_DEBUG) console.log('   ', seen.slice(0, 18).map(r => `${t(r)}:${r.readable}/${r.rows}${r.haze ? 'h' : ''}`).join(' '));
  if (strip && frames.length) { await fs.mkdir(stripsDir, {recursive: true}); for (const [i, f] of frames.entries()) await fs.writeFile(path.join(stripsDir, `${strip}-${String(i).padStart(2, '0')}-${f.t}ms.png`), Buffer.from(f.png, 'base64')); }
}
try {
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 60, y: 40, width: 1280, height: 800}); w.showInactive(); });
  await app.act({type: 'settings.update', patch: {appearance: 'light', verticalTabs: false}});
  await app.act({type: 'tab.new', url: base + 'a'}); await app.waitWeb(base + 'a'); await sleep(500);
  for (const q of ['b', 'c']) await app.act({type: 'tab.new', url: base + q, background: true});
  await poll(overlay, Boolean, 'overlay', 15000); await sleep(800);
  const click = sel => app.ui.locator(sel).first().click();
  const menu = () => click('[aria-label="Acira menu"]');
  await measure('menu (cold, first open)', menu);
  if (process.env.A_COLD_ONLY) throw Object.assign(new Error('cold only'), {coldOnly: true});
  for (let i = 0; i < 3; i++) await measure(`menu (warm ${i + 1})`, menu);
  await measure('more tools', async () => { await menu(); await poll(async () => (await layout())?.overlay?.kind === 'menu', Boolean, 'menu', 3000); await sleep(400); await overlay().locator('.menu-row', {hasText: 'More tools'}).first().click(); });
  await measure('site information', () => click('[aria-label="Page information"]'));
  await measure('tab viewer', () => click('[aria-label^="All open tabs"]'));
  await measure('tab right-click (quick)', async () => { const t = (await app.state()).tabs.find(x => x.url === base + 'b'); await app.ui.evaluate(id => { const n = document.querySelector(`.browser-tab[data-tab-id="${id}"]`); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10})); }, t.id); });
  await measure('palette (keyboard, quick)', () => app.ui.keyboard.press('Control+Shift+K'));
  if (stripsDir) {
    await measure('menu strip light', menu, {strip: 'light'});
    await close(); await app.act({type: 'settings.update', patch: {appearance: 'dark'}}); await sleep(900);
    await measure('menu strip dark', menu, {strip: 'dark'});
  }
  await close();
} catch (error) { if (!error.coldOnly) throw error; } finally { await app.close(); fx.close?.(); }
