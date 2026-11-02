// Sidebar row tips open beside the row (toward the page), never over the rows below. Run via native-slot.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.SHOTS || 'C:/ae/r8/tooltip-right', root = '.qa-profiles/r8-tooltip-right';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>Acira · All browser. No AI.</title><body style="font:16px sans-serif;padding:24px;background:#fff"><h1>${req.headers.host}</h1>`); });
const url = `http://localhost:${fx.port}/`;
let app; const report = [];
const ui = fn => `acira-browser-ui://`;
const move = (x, y) => app.main(({webContents}, p) => { const w = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay')); w.sendInputEvent({type: 'mouseMove', x: p.x, y: p.y}); }, {x, y});
const card = () => app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; for (const c of win.contentView.children) { try { if (c.webContents.getURL().includes('tab-card.html') && c.getVisible()) return c.getBounds(); } catch {} } return null; });
async function shot(name) {
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 250));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const s = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = s.find(x => x.id === id); win.setAlwaysOnTop(false); return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  assert.ok(b64); await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
}
const rowBox = sel => app.ui.evaluate(s => { const r = [...document.querySelectorAll(s)].filter(n => n.getClientRects().length)[0]?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, width: r.width, height: r.height} : null; }, sel);
try {
  app = await startApp({root});
  await app.act({type: 'bookmark.add', url, title: 'Acira · All browser. No AI.', parentId: null, index: 0});
  await app.act({type: 'bookmark.add', url: url + 'two', title: 'Second saved page', parentId: null, index: 1});
  for (const scenario of [['site', true], ['ntp', false]]) for (const dark of [true, false]) for (const scale of [100, 150]) {
    const name = `${scenario[0]}-${dark ? 'dark' : 'light'}-${scale}`;
    await app.act({type: 'settings.update', patch: {appearance: dark ? 'dark' : 'light', interfaceScale: scale, language: 'en', tabHoverCard: 'preview', verticalTabs: true, windowView: 'full'}});
    await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true, view: null}});
    if (scenario[1]) { await app.act({type: 'tab.new', url}); await app.waitWeb(url); } else await app.act({type: 'tab.new'});
    await sleep(scale === 150 ? 3000 : 1500);
    // open the Bookmarks zone
    await app.ui.evaluate(() => { const z = [...document.querySelectorAll('.acira-sidebar button')].find(b => /^Bookmarks/.test(b.textContent.trim()) && b.getAttribute('aria-expanded') === 'false'); z?.click(); });
    await sleep(900);
    const scaleOf = scale / 100;
    for (const [label, sel] of [['bookmark', '.acira-sidebar .sb-bookmark[data-card-title]'], ['tab', '.acira-sidebar .sb-tab[data-tab-id]']]) {
      const box = await rowBox(sel); assert.ok(box, name + ' ' + label + ' row');
      const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
      await move(5, 5); await sleep(200); await move(Math.round((cx - 3) * scaleOf), Math.round(cy * scaleOf)); await move(Math.round(cx * scaleOf), Math.round(cy * scaleOf));
      const c = await poll(card, Boolean, name + ' ' + label + ' card', 5000);
      const row = {l: box.x * scaleOf, r: (box.x + box.width) * scaleOf, t: box.y * scaleOf, b: (box.y + box.height) * scaleOf};
      const beside = c.x >= row.r - 1 && c.y < row.b && c.y + c.height > row.t; if (!beside) report.push(`${name} ${label}: NOT beside (narrow window?)`);
      await sleep(1200); await shot(`${name}-${label}`); report.push(`${name} ${label}: card ${JSON.stringify(c)} row right ${Math.round(row.r)}`);
      await move(5, 5); await sleep(400);
    }
  }
  console.log(JSON.stringify({status: 'PASS', report}, null, 1));
} catch (e) { console.log(JSON.stringify({status: 'FAIL', error: String(e?.stack || e).slice(0, 1800), report}, null, 1)); process.exitCode = 1; }
finally { if (app) { try { await Promise.race([app.close(), sleep(12000)]); } catch {} } await fx.close().catch(() => {}); }
