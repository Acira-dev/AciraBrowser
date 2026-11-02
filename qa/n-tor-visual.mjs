// Stream N: screenshots of the Tor window surfaces (chip + Tor page) in light/dark at 100% and 150%, plus the
// connecting and error states. Visible window; needs internet. The error state comes from ending this run's own
// tor.exe (matched by its --DataDirectory under .qa-profiles/n-tor-visual), never another tor.exe on the machine.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {startApp, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/n-tor-visual'), out = path.resolve('qa/artifacts/n-tor');
await fs.mkdir(out, {recursive: true});
const app = await startApp({root});
// Occluded or background windows stop painting: bring the Tor window to the front before each shot.
const front = () => app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) if (w.getTitle().includes('Tor')) { w.show(); w.moveTop(); w.focus(); } });
// capturePage on the Tor window's own chrome view (Playwright screenshots stall after appearance/scale changes).
const shot = async (page, name) => { await front(); await sleep(1200); const file = path.join(out, name + '.png');
  const png = await app.main(async ({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { if (!w.getTitle().includes('Tor')) continue; const views = w.contentView.children.filter(v => v.webContents && v.webContents.getURL() === 'acira-browser-ui://ui/index.html'); if (!views.length) return ''; return (await views[0].webContents.capturePage()).toPNG().toString('base64'); } return ''; });
  if (png) await fs.writeFile(file, Buffer.from(png, 'base64')); console.log(png ? 'shot' : 'shot failed', name); };
try {
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) w.minimize(); });
  const before = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const tor = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor ui', 30000);
  await poll(() => tor.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000);
  await app.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) if (w.getTitle().includes('Tor')) w.setBounds({x: 40, y: 40, width: 1280, height: 820}); });
  await shot(tor, 'v-connecting-light');
  await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), r => ['ready', 'error'].includes(r?.tor?.state), 'ready', 300000);
  for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
    await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance, interfaceScale: scale});
    await shot(tor, `v-ready-${appearance}-${scale}`);
  }
  await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance: 'light', interfaceScale: 100});
  await tor.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(), "New Tor identity…"); await shot(tor, 'v-identity-confirm');
  await tor.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(), "Cancel");
  // Error state: end this run's tor.exe only.
  const list = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'});
  const mine = list.split(/\r?\n/).filter(line => line.toLowerCase().includes('n-tor-visual')).map(line => line.split('|')[0]);
  console.log('own tor.exe:', mine.join(','));
  for (const pid of mine) execFileSync('taskkill', ['/PID', pid, '/F']);
  await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), r => r?.tor?.state === 'error', 'error state', 20000);
  await shot(tor, 'v-error-light');
  await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance: 'dark'}); await shot(tor, 'v-error-dark');
  await tor.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(), "Try again");
  const back = await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), r => r?.tor?.state === 'ready', 'reconnect', 120000);
  console.log('reconnected after Try again:', back.tor.state);
} finally { await app.close(); }
