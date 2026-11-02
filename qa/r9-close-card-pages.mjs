// R9: the "Close Acira?" card draws Acira's own pages with their glyph (never a letter). Light/dark at 100% and 150%.
//   node qa/native-slot.mjs r9-close -- node qa/r9-close-card-pages.mjs   (evidence in C:\ae\r9\close-card)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const OUT = process.env.R9_SHOTS || 'C:/ae/r9/close-card';
const root = '.qa-profiles/r9-close-card';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Page</title><body>plain</body>'); });
let app;
const cards = () => app.context.pages().filter(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
const card = () => poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible() && /Close Acira/.test(await p.locator('#title').textContent())) return p; } catch {} } }, Boolean, 'card', 15000);
const gone = () => poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible()) return false; } catch {} } return true; }, Boolean, 'gone', 8000);
async function key(keyCode, modifiers) {
  await app.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay')); ui.focus(); ui.sendInputEvent({type: 'rawKeyDown', keyCode: a.keyCode, modifiers: a.modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers}); }, {keyCode, modifiers});
}
try {
  app = await startApp({root});
  await app.act({type: 'settings.update', patch: {language: 'en'}});
  for (const page of ['settings', 'history', 'bookmarks', 'downloads', 'rewind']) { await app.act({type: 'tab.new', url: `acira://${page}`}); await sleep(400); }
  await app.act({type: 'tab.new', url: `http://a.localhost:${fx.port}/`}); await app.waitWeb(`http://a.localhost:${fx.port}/`); await sleep(1200);
  for (const [theme, scale] of [['dark', 100], ['dark', 150], ['light', 100], ['light', 150]]) {
    await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: scale}}); await sleep(900);
    await key('Q', ['control', 'shift']); const c = await card(); await sleep(700);
    const tiles = await c.evaluate(() => [...document.querySelectorAll('#strip .tile')].map(t => ({glyph: !!t.querySelector('svg.glyph'), text: t.textContent.trim()})));
    assert.ok(tiles.filter(t => t.glyph).length >= 5, 'five Acira pages draw a glyph: ' + JSON.stringify(tiles));
    assert.ok(tiles.every(t => !t.glyph || t.text === ''), 'no letter inside a glyph tile');
    assert.ok(!tiles.some(t => /^[SHBDR]$/.test(t.text) && !t.glyph), 'no letter fallback for an Acira page');
    await c.locator('#card').screenshot({path: path.join(OUT, `${theme}-${scale}.png`)});
    await c.keyboard.press('Escape'); await gone();
  }
  console.log('ok');
} finally { await app?.close?.(); await fx.close?.(); await fs.rm(root, {recursive: true, force: true}); }
