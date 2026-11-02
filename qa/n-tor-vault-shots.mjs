// Stream N: the Tor vault surfaces in real pixels: off (trade-off prompt), on with a bookmark list, and the chip panel's Bookmark row. Light and dark.
// One instance, ≤4 tabs, closed in finally. D_VISIBLE=1 node qa/n-tor-vault-shots.mjs → qa/artifacts/n-tor/vault-*.png
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve('qa/artifacts/n-tor'); await fs.mkdir(out, {recursive: true});
const root = path.resolve('.qa-profiles/n-tor-vault-shots'); await fs.rm(root, {recursive: true, force: true});
const READY = {state: 'ready', progress: 100, phase: 'Connected', error: null, version: '0.4.9.14', firstConnection: false};
const app = await startApp({root, env: {ACIRA_PASSWORDS_TEST_GATE: 'allow'}});
try {
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) w.minimize(); });
  const before = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const tor = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor ui', 30000);
  await poll(() => tor.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000);
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) if (w.getTitle().includes('Tor')) { w.setBounds({x: 40, y: 40, width: 1300, height: 1000}); w.show(); w.focus(); } });
  const shot = async name => {
    const png = await app.main(async ({BaseWindow, desktopCapturer}) => {
      const w = BaseWindow.getAllWindows().find(x => x.getTitle().includes('Tor')), b = w.getBounds();
      const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}});
      const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : '';
    });
    if (png) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64')); console.log(png ? 'shot' : 'FAILED', name);
  };
  const click = (page, pattern) => page.evaluate(p => [...document.querySelectorAll('button')].find(b => new RegExp(p).test(b.textContent))?.click(), pattern);
  const overlay = () => app.context.pages().filter(p => { try { return p.url().includes('overlay'); } catch { return false; } });
  await tor.evaluate(s => window.dispatchEvent(new CustomEvent('acira-tor-preview', {detail: s})), READY);
  await sleep(2500);
  for (const appearance of ['light', 'dark']) {
    await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance}); await sleep(1200);
    // off: the trade-off prompt
    if (appearance === 'light') { await click(tor, 'Keep Tor bookmarks'); await sleep(500); }
    await tor.evaluate(el => document.querySelector('.tor-panel')?.scrollIntoView({block: 'end'})); await sleep(500);
    await shot(`vault-off-prompt-${appearance}`);
    if (appearance === 'light') {
      await click(tor, '^Turn on'); await sleep(1500);
      await tor.evaluate(() => window.acira.dispatch({type: 'tab.new', url: 'https://example.org/a-rather-long-address/with/segments?query=value'})); await sleep(1200);
      await tor.evaluate(() => window.acira.native({type: 'tor.vault-bookmark'}));
      const tabs = (await tor.evaluate(() => window.acira.getSnapshot())).tabs; await tor.evaluate(id => window.acira.dispatch({type: 'tab.close', id}), tabs[tabs.length - 1].id); await sleep(700);
      await tor.evaluate(s => window.dispatchEvent(new CustomEvent('acira-tor-preview', {detail: s})), READY);
    }
    await click(tor, 'Tor bookmarks'); await sleep(900);
    await tor.evaluate(() => document.querySelector('.tor-panel')?.scrollIntoView({block: 'end'})); await sleep(500);
    await shot(`vault-on-list-${appearance}`);
    await click(tor, 'Tor bookmarks'); // collapse for the next theme
    // chip panel with the Bookmark row enabled
    await tor.evaluate(() => window.scrollTo(0, 0)); await tor.evaluate(() => document.querySelector('.tor-chip')?.click()); await sleep(1500);
    await shot(`vault-chip-panel-${appearance}`);
    await tor.keyboard.press('Escape'); await sleep(500);
  }
} finally { await app.close().catch(() => {}); }
