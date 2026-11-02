// Stream N: the Tor chip opens a small panel (not a tab). One instance, ≤3 tabs, closed in finally; needs internet.
// D_VISIBLE=1 node qa/n-tor-popover.mjs → qa/artifacts/n-tor/popover-*.png (real composited pixels via desktopCapturer)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve('qa/artifacts/n-tor'); await fs.mkdir(out, {recursive: true});
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const app = await startApp({root: path.resolve('.qa-profiles/n-tor-popover')});
const capture = async name => {
  const png = await app.main(async ({BaseWindow, desktopCapturer}) => {
    const w = BaseWindow.getAllWindows().find(x => x.getTitle().includes('Tor')) || BaseWindow.getAllWindows()[0], b = w.getBounds();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}});
    const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : '';
  });
  if (png) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64')); console.log(png ? 'shot' : 'shot FAILED', name);
};
try {
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) w.minimize(); });
  const before = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const tor = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor ui', 30000);
  await poll(() => tor.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000);
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) if (w.getTitle().includes('Tor')) { w.setBounds({x: 40, y: 40, width: 1100, height: 700}); w.show(); w.focus(); } });
  const tabsBefore = (await tor.evaluate(() => window.acira.getSnapshot())).tabs.length;
  const openPanel = async () => { await tor.evaluate(() => document.querySelector('.tor-chip')?.click()); await sleep(1400); };
  const panelText = () => app.context.pages().filter(p => { try { return p.url().includes('overlay'); } catch { return false; } });
  await capture('page-connecting');
  await openPanel();
  const pages = panelText(); let text = '';
  for (const p of pages) { try { text += await p.evaluate(() => document.querySelector('.tor-popover')?.innerText || ''); } catch {} }
  check(/Connect/.test(text) && /New Tor identity|Try again/.test(text) && /Learn more/.test(text), `chip opens the Tor panel (${JSON.stringify(text.slice(0, 90))})`);
  check((await tor.evaluate(() => window.acira.getSnapshot())).tabs.length === tabsBefore, 'clicking the chip opens no tab');
  await capture('popover-connecting');
  await tor.keyboard.press('Escape'); await sleep(600);
  await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), r => r?.tor?.state === 'ready', 'ready', 240000);
  for (const appearance of ['light', 'dark']) {
    await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance}); await sleep(900);
    await capture(`page-ready-${appearance}`);
    await openPanel(); await capture(`popover-ready-${appearance}`);
    const height = await (async () => { for (const p of panelText()) { try { const h = await p.evaluate(() => document.querySelector('.tor-popover')?.parentElement?.scrollHeight || 0); if (h) return h; } catch {} } return 0; })();
    console.log('content height', appearance, height);
    await tor.keyboard.press('Escape'); await sleep(600);
  }
  // Learn more is the only thing that opens a tab.
  await openPanel();
  await tor.evaluate(() => { const rows = [...document.querySelectorAll('.tor-popover .acira-menu-row')]; return rows.length; }).catch(() => 0);
  for (const p of panelText()) { try { await p.evaluate(() => [...document.querySelectorAll('.tor-popover .acira-menu-row')].find(b => /Learn more/.test(b.textContent))?.click()); } catch {} }
  await sleep(1200);
  check((await tor.evaluate(() => window.acira.getSnapshot())).tabs.length === tabsBefore + 1, 'Learn more opens exactly one new tab');
} finally { await app.close().catch(() => {}); }
console.log(`\n${report.length} passed, ${fail.length} failed`); if (fail.length) process.exitCode = 1;
