// Stream D: page zoom keys, per-site profile-scoped persistence, Settings sync, private isolation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-zoom'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>z</title>hello'); });
const base = `http://127.0.0.1:${fx.port}`; const report = [];
let app = await startApp({root});
const nz = (url) => app.main(({webContents}, u) => webContents.getAllWebContents().find(w => w.getURL().startsWith(u))?.getZoomFactor(), url);
const key = (k, mods) => app.main(({webContents}, [u, k, mods]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(u)); wc.focus(); wc.sendInputEvent({type: 'keyDown', keyCode: k, modifiers: mods}); wc.sendInputEvent({type: 'keyUp', keyCode: k, modifiers: mods}); }, [base, k, mods]);
const tabZoom = async () => (await app.state()).tabs.find(t => t.url.startsWith(base))?.zoom;
try {
  await app.act({type: 'tab.new', url: base + '/a'}); await app.waitWeb(base + '/a'); await sleep(600);
  await key('=', ['control']); await poll(tabZoom, z => z === 110, 'ctrl+= -> 110'); assert.ok(Math.abs(await nz(base) - 1.1) < .001);
  await key('numadd', ['control']); await poll(tabZoom, z => z === 125, 'keypad plus'); await key('-', ['control']); await poll(tabZoom, z => z === 110, 'ctrl+-'); report.push('Ctrl+/-/keypad change real page zoom');
  await key('0', ['control']); await poll(tabZoom, z => z === 100, 'ctrl+0'); report.push('Ctrl+0 resets');
  // Ctrl+wheel over the page zooms it; a plain wheel does not.
  const cdp = await app.context.newCDPSession(app.web(base + '/a')); const wheel = (dy, modifiers) => cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: dy, modifiers});
  await wheel(-100, 2); await poll(tabZoom, z => z === 110, 'ctrl+wheel up'); await sleep(150); await wheel(100, 2); await poll(tabZoom, z => z === 100, 'ctrl+wheel down'); await wheel(-100, 0); await sleep(300); assert.equal(await tabZoom(), 100); report.push('Ctrl+wheel zooms, plain wheel does not');
  await app.cmd({type: 'zoom', tabId: (await app.state()).tabs.at(-1).id, zoom: 500}); await poll(tabZoom, z => z === 500, 'max'); await key('=', ['control']); await sleep(300); assert.equal(await tabZoom(), 500); report.push('clamped at 500');
  await app.cmd({type: 'zoom', tabId: (await app.state()).tabs.at(-1).id, zoom: 150}); await poll(tabZoom, z => z === 150, '150');
  // Per-site persistence: another tab on the same origin, a reload, and a navigation keep 150.
  await app.act({type: 'tab.new', url: base + '/b'}); await app.waitWeb(base + '/b'); await sleep(800);
  assert.equal((await app.state()).tabs.at(-1).zoom, 150); assert.ok(Math.abs(await nz(base + '/b') - 1.5) < .001); report.push('same-site new tab inherits zoom');
  await app.act({type: 'tab.navigate', url: base + '/c'}); await sleep(900); assert.ok(Math.abs(await nz(base + '/c') - 1.5) < .001); report.push('navigation keeps site zoom');
  // Settings control drives the same state.
  await app.act({type: 'settings.update', patch: {zoom: 175}}); await poll(async () => (await app.state()).tabs.at(-1).zoom, z => z === 175, 'settings zoom'); assert.ok(Math.abs(await nz(base + '/c') - 1.75) < .001); report.push('Settings zoom drives page');
  // Profile scope: profile B sees 100% on the same origin.
  await app.act({type: 'browser.profile.create', name: 'B'}); const B = (await app.state()).browserProfiles.find(p => p.name === 'B');
  await app.act({type: 'tab.new', url: base + '/d', browserProfileId: B.id}); await app.waitWeb(base + '/d'); await sleep(800);
  const bTab = (await app.state()).tabs.find(t => t.browserProfileId === B.id); assert.equal(bTab.zoom, 100); assert.ok(Math.abs(await nz(base + '/d') - 1) < .001); report.push('zoom is profile scoped');
} finally { await app.close(); }
await sleep(1200);
app = await startApp({root});
try {
  const s = await app.state(); assert.equal(s.originZooms['profile-personal'][base], 175); report.push('zoom persisted across restart');
  const back = s.tabs.find(t => t.url.startsWith(base) && t.browserProfileId === 'profile-personal'); await app.act({type: 'tab.select', id: back.id}); await sleep(1200);
  assert.ok(Math.abs(await nz(base) - 1.75) < .001); report.push('restored tab renders at saved zoom');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
