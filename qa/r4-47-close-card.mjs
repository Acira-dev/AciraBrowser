// R4-47 live check: the redesigned "close" card (closing the browser, unsaved work) in the middle of the page, in the house style.
//   node qa/r4-47-close-card.mjs          (takes a native slot, releases it in finally; evidence in C:\ae\r4\close-prompts\evidence\after)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R4_SHOTS || 'C:/ae/r4/close-prompts/evidence/after';
const root = '.qa-profiles/r4-47-close-card';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
async function takeSlot() {
  const deadline = Date.now() + 20 * 60000;
  while (Date.now() < deadline) {
    for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`close-prompts-r4-47 ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(15000);
  }
  throw new Error('no native slot');
}
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(hex) { // a round coloured icon, 32x32
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), size = 32, rows = [];
  for (let y = 0; y < size; y++) { const row = Buffer.alloc(1 + size * 4); for (let x = 0; x < size; x++) { const o = 1 + x * 4; row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = Math.hypot(x - 15.5, y - 15.5) < 15.5 ? 255 : 0; } rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const slot = await takeSlot();
const COLORS = {a: '#e5484d', b: '#f5a524', c: '#30a46c', d: '#3b82f6', e: '#8e4ec6', f: '#12a594', g: '#ec4899', h: '#6b7280', i: '#ca8a04', j: '#0ea5e9'};
const fx = await httpFixture((req, res) => {
  const letter = (req.headers.host || 'a')[0], color = COLORS[letter] || '#888';
  if (req.url.startsWith('/favicon')) { res.setHeader('content-type', 'image/png'); res.end(png(color)); return; } // a PNG: the favicon store cannot read SVG
  res.setHeader('content-type', 'text/html');
  const dirty = req.url.startsWith('/dirty');
  res.end(`<title>${dirty ? 'Draft' : 'Page ' + letter.toUpperCase()}</title><link rel="icon" href="/favicon.png"><body style="font:16px sans-serif;padding:24px"><h1>${dirty ? 'Draft document' : 'Nothing to lose here'}</h1>${dirty ? '<textarea rows=4 cols=40>My unsaved notes</textarea><script>window.__dirty=true;addEventListener("beforeunload",e=>{if(window.__dirty){e.preventDefault();e.returnValue="";}});</script>' : ''}</body>`);
});
const base = name => `http://${name}.localhost:${fx.port}`;
let app;
const state = () => app.state();
const cards = () => app.context.pages().filter(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
async function card(label, text) {
  const page = await poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible() && await p.locator('#title').textContent()) return p; } catch {} } }, Boolean, label + ' card appears', 15000);
  await poll(() => page.locator('#title').textContent(), t => text.test(t), label + ' card text', 6000);
  await sleep(700); return page;
}
const noCard = label => poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible()) return false; } catch {} } return true; }, Boolean, label + ' card gone', 8000);
const labels = c => c.locator('button.act').allTextContents();
async function key(keyCode, modifiers = []) {
  await app.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay')); ui.focus(); ui.sendInputEvent({type: 'rawKeyDown', keyCode: a.keyCode, modifiers: a.modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers}); }, {keyCode, modifiers});
}
async function shot(name) {
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 250));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false); return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  assert.ok(b64, 'capture ' + name); await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
}
/** The card is centred in its view, and no text is within 8px of the card's edge. */
async function geometry(c, label, top = false) {
  const g = await c.evaluate(() => {
    const r = document.getElementById('card').getBoundingClientRect(), box = {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
    const texts = [...document.querySelectorAll('#title,#detail,#caption,#bodyline,.host,.more,#muteText,button.act')].filter(n => n.offsetParent).map(n => { const q = n.getBoundingClientRect(); return {l: q.left - box.left, r: box.right - q.right, t: q.top - box.top, b: box.bottom - q.bottom}; });
    return {cx: (r.left + r.right) / 2 - innerWidth / 2, cy: (r.top + r.bottom) / 2 - innerHeight / 2, edge: Math.min(...texts.flatMap(t => [t.l, t.r])), vert: Math.min(...texts.flatMap(t => [t.t, t.b])), top: r.top, title: document.getElementById('title').getBoundingClientRect().height, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight};
  });
  if (top) assert.ok(Math.abs(g.cx) <= 2 && g.top >= 8 && g.top <= 40, `${label}: the card sits up by the tab strip, centred sideways (${g.cx.toFixed(1)}, top ${g.top.toFixed(1)})`); else assert.ok(Math.abs(g.cx) <= 2 && Math.abs(g.cy) <= 2, `${label}: card is centred (${g.cx.toFixed(1)}, ${g.cy.toFixed(1)}) in ${g.iw}x${g.ih}`);
  assert.ok(g.title <= 30, `${label}: the title stays on one line (${g.title}px)`);
  assert.ok(g.edge >= 8 && g.vert >= 2, `${label}: text keeps 8px from the sides (${g.edge}) and 2px above/below (${g.vert})`); return g;
}
const clearDirty = async () => { for (const p of app.context.pages()) { try { if (/\/dirty/.test(p.url())) await p.evaluate(() => { window.__dirty = false; }); } catch {} } };
const report = [];
try {
  app = await startApp({root});
  await app.act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, language: 'en'}});
  for (const n of 'abcdefghij') { await app.act({type: 'tab.new', url: base(n) + '/clean'}); await app.waitWeb(base(n) + '/clean'); }
  await sleep(1500);
  const total = (await state()).tabs.length;

  // 1 · Close Acira? (the founder's screenshot: N tabs in 1 window)
  await key('Q', ['control', 'shift']); let c = await card('quit', /Close Acira\?/);
  assert.deepEqual(await labels(c), ['Cancel', 'Close Acira']); report.push('quit card buttons: Cancel (secondary, left), Close Acira (primary, right)');
  assert.match(await c.locator('#detail').textContent(), new RegExp(`^${total} tabs in 1 window$`));
  assert.ok(await c.locator('#strip .tile').count() >= 8, 'a row of the open sites'); report.push('icon row: ' + await c.locator('#strip .tile').count() + ' tiles, ' + (await c.locator('#strip .more').allTextContents()).join(''));
  report.push('quit geometry ' + JSON.stringify(await geometry(c, 'quit 100')));
  await shot('quit-dark-100');
  await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 150}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('quit150', /Close Acira\?/); report.push('quit 150% geometry ' + JSON.stringify(await geometry(c, 'quit 150'))); await shot('quit-dark-150'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 100, appearance: 'light'}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('quitL', /Close Acira\?/); await geometry(c, 'quit light'); await shot('quit-light-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 150}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('quitL150', /Close Acira\?/); await shot('quit-light-150'); await c.keyboard.press('Escape'); await noCard('esc');
  for (const lang of ['de', 'fr']) {
    await app.act({type: 'settings.update', patch: {language: lang, appearance: 'dark', interfaceScale: 100}}); await sleep(900);
    await key('Q', ['control', 'shift']); c = await card('quit ' + lang, /Acira/); const g = await geometry(c, 'quit ' + lang); report.push(`${lang} quit card: ${(await c.locator('#title').textContent())} / ${(await labels(c)).join(' | ')} (edge ${g.edge}px)`); await shot(`quit-${lang}-dark-100`); await c.keyboard.press('Escape'); await noCard('esc');
  }
  await app.act({type: 'settings.update', patch: {language: 'en', appearance: 'dark', interfaceScale: 100}}); await sleep(900);
  // 2 · one unsaved page (Ctrl+W): the card sits up by the tab strip, not in the middle
  await app.act({type: 'tab.new', url: base('k') + '/dirty'}); await app.waitWeb(base('k') + '/dirty'); await sleep(800);
  const dirtyTab = () => state().then(s => s.tabs.find(t => t.url === base('k') + '/dirty'));
  await key('W', ['control']); c = await card('unsaved tab', /Leave without saving\?/);
  assert.deepEqual(await labels(c), ['Close anyway', 'Keep editing']); assert.equal(await c.locator('#sites .row').count(), 1);
  assert.equal(await c.locator('#bodyline').textContent(), 'Changes you made may not be saved.'); assert.equal(await c.locator('#sites .host').first().textContent(), 'k.localhost');
  report.push('unsaved-tab geometry ' + JSON.stringify(await geometry(c, 'unsaved 100', true)));
  await shot('unsaved-tab-dark-100'); await c.keyboard.press('Escape'); await noCard('esc'); assert.ok(await dirtyTab(), 'Esc keeps editing');
  await key('W', ['control']); c = await card('unsaved tab enter', /Leave without saving\?/); await c.keyboard.press('Enter'); await noCard('enter'); assert.ok(await dirtyTab(), 'Enter keeps editing'); report.push('Enter and Esc both keep editing');
  await app.act({type: 'settings.update', patch: {interfaceScale: 150}}); await sleep(900);
  await key('W', ['control']); c = await card('unsaved tab 150', /Leave without saving\?/); await geometry(c, 'unsaved 150', true); await shot('unsaved-tab-dark-150'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 100, appearance: 'light'}}); await sleep(900);
  await key('W', ['control']); c = await card('unsaved tab light', /Leave without saving\?/); await geometry(c, 'unsaved light', true); await shot('unsaved-tab-light-100'); await c.keyboard.press('Escape'); await noCard('esc');
  for (const lang of ['de', 'fr']) {
    await app.act({type: 'settings.update', patch: {language: lang, appearance: 'dark'}}); await sleep(900);
    await key('W', ['control']); c = await card('unsaved ' + lang, /\?/); const g = await geometry(c, 'unsaved ' + lang, true);
    report.push(`${lang} unsaved card: ${await c.locator('#title').textContent()} / ${(await labels(c)).join(' | ')} / ${await c.locator('#bodyline').textContent()} (edge ${g.edge}px)`); await shot(`unsaved-tab-${lang}-dark-100`); await c.keyboard.press('Escape'); await noCard('esc');
  }
  await app.act({type: 'settings.update', patch: {language: 'en', appearance: 'dark', interfaceScale: 100}}); await sleep(900);

  // 3 · several unsaved pages: Close other tabs lists them as rows with their icons
  for (const n of 'lm') { await app.act({type: 'tab.new', url: base(n) + '/dirty'}); await app.waitWeb(base(n) + '/dirty'); }
  await sleep(800);
  const keep = (await state()).tabs.find(t => t.url === base('a') + '/clean'); await app.act({type: 'tab.select', id: keep.id}); await sleep(300);
  await app.act({type: 'tab.close.others', id: keep.id}); c = await card('unsaved many', /Some tabs have unsaved changes/);
  assert.equal(await c.locator('#sites .row').count(), 3); report.push('unsaved list rows: ' + (await c.locator('#sites .host').allTextContents()).join(', '));
  report.push('unsaved-many geometry ' + JSON.stringify(await geometry(c, 'unsaved many', true))); await shot('unsaved-many-dark-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 150}}); await sleep(900);
  await app.act({type: 'tab.close.others', id: keep.id}); c = await card('unsaved many 150', /Some tabs/); await shot('unsaved-many-dark-150'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 100}}); await sleep(900);

  // 4 · both: Close Acira? with unsaved pages stays in the middle
  await key('Q', ['control', 'shift']); c = await card('combined', /Close Acira\?/);
  assert.deepEqual(await labels(c), ['Close anyway', 'Keep editing']); assert.equal(await c.locator('#mute').isVisible(), false);
  assert.equal(await c.locator('#caption').textContent(), 'Some tabs have unsaved changes'); assert.equal(await c.locator('#sites .row').count(), 3);
  report.push('combined geometry ' + JSON.stringify(await geometry(c, 'combined 100'))); await shot('combined-dark-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 150}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('combined 150', /Close Acira\?/); await geometry(c, 'combined 150'); await shot('combined-dark-150'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {interfaceScale: 100, appearance: 'light'}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('combined light', /Close Acira\?/); await shot('combined-light-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {appearance: 'dark', language: 'de'}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('combined de', /Acira/); const gd = await geometry(c, 'combined de'); report.push(`de combined card edge ${gd.edge}px`); await shot('combined-de-dark-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {language: 'fr'}}); await sleep(900);
  await key('Q', ['control', 'shift']); c = await card('combined fr', /Acira/); const gf = await geometry(c, 'combined fr'); report.push(`fr combined card edge ${gf.edge}px`); await shot('combined-fr-dark-100'); await c.keyboard.press('Escape'); await noCard('esc');
  await app.act({type: 'settings.update', patch: {language: 'en'}});
  await app.act({type: 'settings.update', patch: {language: 'en'}});
  console.log(JSON.stringify({status: 'PASS', report}, null, 1));
} catch (error) {
  console.log(JSON.stringify({status: 'FAIL', error: String(error?.stack || error).slice(0, 1500), report}, null, 1)); process.exitCode = 1;
} finally {
  if (app) { const child = (() => { try { return app.app.process(); } catch { return null; } })(); try { await clearDirty(); } catch {} try { await Promise.race([app.close(), sleep(12000)]); } catch {} try { if (child && child.exitCode === null) child.kill(); } catch {} }
  await fx.close().catch(() => {}); await fs.unlink(slot).catch(() => {});
}
