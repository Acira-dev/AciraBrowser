// Stream E: the site panel's single "Protection · N blocked on this page" row (switch on the right, row opens the detail list).
// Captures real window pixels in light and dark, closed and open, and checks the switch does not toggle the disclosure.
// node qa/e-shields-row.mjs   (writes qa/artifacts/e-shields-row-*/)
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = '.qa-profiles/e-shields-row'; await fs.rm(root, {recursive: true, force: true});
const out = path.join('qa/artifacts', 'e-shields-row-' + Date.now()); await fs.mkdir(out, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Fixture</title><body style="font:16px system-ui"><h1>Fixture</h1></body>'); });
const base = `http://127.0.0.1:${fx.port}/`;
const app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
const shot = async name => {
  let b64 = '';
  for (let i = 0; i < 10 && !b64; i++) {
    if (i) await sleep(300);
    b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
      const win = BaseWindow.getAllWindows().filter(w => w.isVisible() && !w.isMinimized()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0];
      if (!win) return '';
      const b = win.getBounds(), s = screen.getDisplayMatching(b).scaleFactor;
      const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * s), height: Math.round(b.height * s)}});
      const src = sources.find(i => i.id === win.getMediaSourceId());
      return src && !src.thumbnail.isEmpty() ? src.thumbnail.toPNG().toString('base64') : '';
    });
  }
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(b64, 'base64')); console.log('shot', name);
};
const close = async () => { for (let i = 0; i < 3; i++) { await overlay()?.keyboard.press('Escape').catch(() => {}); await sleep(300); } };
try {
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 40, width: 1100, height: 700}); w.show(); w.focus(); });
  await app.act({type: 'tab.new', url: base}); await app.waitWeb(base); await sleep(800);
  for (const theme of ['light', 'dark']) {
    await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: 100, verticalTabs: false}}); await sleep(600);
    await close();
    await app.ui.click('[aria-label="Page information"]');
    await poll(() => overlay()?.locator('.shields-main').count().then(n => n > 0), Boolean, 'shields row', 8000);
    await sleep(700);
    const row = overlay().locator('.shields-main > summary');
    console.log(theme, 'row text:', JSON.stringify(await row.innerText()));
    await shot(`${theme}-closed`);
    // the switch must not open the details
    const open = () => overlay().locator('.shields-main').evaluate(d => d.open);
    assert.equal(await open(), false);
    const sw = overlay().locator('.shields-main .shields-switch'), before = await sw.getAttribute('aria-checked');
    await sw.click(); await sleep(900); console.log('after switch', await overlay().evaluate(()=>document.body.innerText.slice(0,300)).catch(e=>String(e)));
    assert.equal(await open(), false, 'switch click opened the list');
    assert.notEqual(await sw.getAttribute('aria-checked'), before, 'switch did not flip');
    await sw.click(); await sleep(500);
    assert.equal(await sw.getAttribute('aria-checked'), before);
    await row.click({position: {x: 30, y: 12}}); await sleep(500);
    assert.equal(await open(), true, 'row click did not open the list');
    await shot(`${theme}-open`);
    await close();
  }
  console.log(JSON.stringify({ok: true, out}));
} finally { await app.close(); await fx.close(); }
