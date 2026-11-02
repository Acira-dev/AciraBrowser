// Which requests did the blocker cancel, and did the page paint its images? Loads one page in the real app (isolated profile) and prints every
// failed request (full URL, type, error) plus images that never loaded, then saves a screenshot after the page settled.
//   cd <app root>; node qa/native-slot.mjs adblock-failed -- node qa/adblock-failed-requests.mjs <url> <label> [out dir]
import fs from 'node:fs';
import path from 'node:path';
import {startApp, poll, sleep, finaleEnded} from './d-harness.mjs';

const url = process.argv[2] || 'https://www.foxnews.com/', label = process.argv[3] || 'run', out = path.resolve(process.argv[4] || `C:/ae/r11-proof/failed-${label}`);
fs.mkdirSync(out, {recursive: true});
const app = await startApp({root: `.qa-profiles/adfail-${label}`, skipSetup: false, args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']});
try {
  try { const skip = app.ui.getByRole('button', {name: 'Skip setup'}); await skip.waitFor({timeout: 5000}); await skip.click(); await sleep(600); await finaleEnded(app.ui); } catch { /* past setup */ }
  await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; if (win) { win.setBounds({x: -3200, y: 0, width: 1280, height: 900}); win.showInactive(); } });
  const failed = [];
  app.context.on('requestfailed', r => { try { failed.push({url: r.url().slice(0, 180), type: r.resourceType(), error: r.failure()?.errorText || ''}); } catch { /* page gone */ } });
  const before = new Set(app.context.pages());
  await app.act({type: 'tab.new', url});
  const page = await poll(async () => app.context.pages().find(p => !before.has(p) && !/^acira-browser-ui:/.test(p.url())), Boolean, 'page', 20000);
  await page.waitForLoadState('load', {timeout: 25000}).catch(() => {});
  await sleep(12000);
  await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {}); await sleep(2500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {}); await sleep(2000);
  const images = await page.evaluate(() => [...document.images].filter(i => i.getBoundingClientRect().width > 20).map(i => ({src: (i.currentSrc || i.src || '').slice(0, 120), ok: i.complete && i.naturalWidth > 0, w: Math.round(i.getBoundingClientRect().width)})).filter(i => !i.ok).slice(0, 25)).catch(() => []);
  await page.screenshot({path: path.join(out, 'page.png'), timeout: 20000}).catch(() => {});
  const result = {url, label, failed, imagesNotLoaded: images};
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({failed: failed.length, byError: failed.reduce((m, f) => (m[f.error] = (m[f.error] || 0) + 1, m), {}), imagesNotLoaded: images.length}));
  for (const f of failed.filter(f => f.type === 'image' || /\.(png|jpe?g|svg|webp|gif)/.test(f.url))) console.log('FAILED IMG', f.type, f.error, f.url);
  for (const i of images) console.log('IMG NOT LOADED', i.w, i.src);
} finally { await app.close?.().catch?.(() => {}); }
