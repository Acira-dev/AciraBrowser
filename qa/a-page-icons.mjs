// A (round 2, founder: Acira's pages wear informative icons; only the New tab keeps the logo). Opens every Acira page, a
// page that fails and a private new tab, then captures the tab strip, the sidebar and the tab viewer in light and dark
// at 100% and 150%. A Tor tab is not opened (it would start Tor). Isolated, one instance, showInactive, ≤ 12 tabs.
//   node qa/a-page-icons.mjs <outdir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = process.argv[2]; await fs.mkdir(out, {recursive: true});
const dir = '.qa-profiles/a-page-icons'; await fs.rm(dir, {recursive: true, force: true});
const app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
const capture = async (url, name, rect) => {
  const png = await app.main(async ({webContents}, [url, rect]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes(url)); return wc ? (await wc.capturePage(rect || undefined)).toPNG().toString('base64') : null; }, [url, rect]);
  if (png) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
  return !!png;
};
// The chrome (strip, sidebar) is captured from the whole composited window: capturePage of the UI view comes back blank
// while a website view is in front. The rect is cropped from it.
const windowShot = async (name, rect) => {
  const png = await app.main(async ({BaseWindow, desktopCapturer}, rect) => { const w = BaseWindow.getAllWindows()[0], b = w.getContentBounds(), o = w.getBounds(); const id = w.getMediaSourceId(); const src = (await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: o.width, height: o.height}})).find(s => s.id === id); if (!src || !rect) return null; const img = src.thumbnail, size = img.getSize(), top = size.height - b.height; return [img.crop({x: rect.x, y: rect.y + top, width: Math.min(rect.width, size.width - rect.x), height: Math.min(rect.height, size.height - rect.y - top)}).toPNG().toString('base64'), size.width === b.width]; }, rect);
  if (!png) return; if (!png[1]) console.log(`${name}: the window capture was scaled, not 1:1`);
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png[0], 'base64'));
};
const rectOf = (page, selector) => page.evaluate(sel => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(), z = devicePixelRatio; return {x: Math.max(0, Math.round(r.x * z)), y: Math.max(0, Math.round(r.y * z)), width: Math.round(Math.min(r.width, innerWidth - r.x) * z), height: Math.round(Math.min(r.height, innerHeight - r.y) * z)}; }, selector);
try {
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 60, y: 40, width: 1500, height: 860}); w.showInactive(); });
  for (const url of ['acira://settings', 'acira://downloads', 'acira://history', 'acira://bookmarks', 'acira://rewind', 'acira://routines', 'http://127.0.0.1:9/unreachable']) { await app.act({type: 'tab.new', url}); await sleep(450); }
  await app.act({type: 'tab.new', privacy: 'private'}).catch(e => console.log('private tab:', String(e).slice(0, 100)));
  await sleep(2500); // the unreachable page settles into its error
  console.log('tabs:', (await app.state()).tabs.map(t => `${t.url}${t.privacy ? ' (' + t.privacy + ')' : ''}${t.error ? ' [error]' : ''}`).join(' | '));
  for (const scale of [100, 150]) for (const theme of ['light', 'dark']) {
    await app.ui.emulateMedia({colorScheme: theme});
    await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: scale, verticalTabs: false}}); await sleep(1300);
    await windowShot(`strip-${theme}-${scale}`, await rectOf(app.ui, '.tab-strip-container, .tabs-strip'));
    await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(1300);
    await windowShot(`sidebar-${theme}-${scale}`, await rectOf(app.ui, '.ed-rail'));
    await app.act({type: 'settings.update', patch: {verticalTabs: false}}); await sleep(900);
    const active = (await app.state()).activeTabId;
    await app.cmd({type: 'ui', tabId: active, action: 'open', kind: 'tabs'});
    await poll(async () => (await layout())?.overlay?.kind === 'tabs', Boolean, 'tabs', 5000).catch(() => {}); await sleep(700);
    const overlayPage = app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    if (overlayPage) await capture('view=overlay', `viewer-${theme}-${scale}`, await rectOf(overlayPage, '.sheet-popup .browser-popup'));
    for (let i = 0; i < 3 && (await layout())?.overlay; i++) { await app.ui.keyboard.press('Escape'); await sleep(250); }
    const o = (await layout())?.overlay; if (o) await app.ui.evaluate(id => window.acira.closeOverlay(id), o.id);
    await sleep(500);
  }
} finally { await app.close(); }
