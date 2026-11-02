// Stream N: ending tor.exe under a Tor window must show the error state, not take the app down.
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startApp, sleep, poll} from './d-harness.mjs';
const app = await startApp({root: path.resolve('.qa-profiles/n-tor-crash')});
let code = 1;
try {
  const before = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const tor = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor ui', 30000);
  await poll(() => tor.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'acira', 30000);
  await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), r => r?.tor?.state === 'ready', 'ready', 200000);
  const list = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'});
  const mine = list.split(/\r?\n/).filter(l => l.toLowerCase().includes('n-tor-crash')).map(l => l.split('|')[0]);
  for (const pid of mine) execFileSync('taskkill', ['/PID', pid, '/F']);
  await sleep(3000);
  console.log('app alive:', app.app.process().exitCode === null);
  const r = await tor.evaluate(() => window.acira.native({type: 'tor.status'})).catch(e => 'ERR ' + e.message.slice(0, 80));
  console.log('state:', JSON.stringify(r).slice(0, 120));
  const shot = async name => { const png = await app.main(async ({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { if (!w.getTitle().includes('Tor')) continue; const v = w.contentView.children.find(c => c.webContents?.getURL() === 'acira-browser-ui://ui/index.html'); if (v) return (await v.webContents.capturePage()).toPNG().toString('base64'); } return ''; }); if (png) await fs.writeFile(path.resolve('qa/artifacts/n-tor', name + '.png'), Buffer.from(png, 'base64')); console.log('shot', name, Boolean(png)); };
  await shot('v-error-light');
  await tor.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {appearance: 'dark'}); await sleep(800); await shot('v-error-dark');
  await tor.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Try again')?.click());
  const back = await poll(() => tor.evaluate(() => window.acira.native({type: 'tor.status'})), x => x?.tor?.state === 'ready', 'reconnect', 120000);
  console.log('after Try again:', back.tor.state); code = 0;
} catch (e) { console.log('FAIL', e.message.slice(0, 200)); }
finally { console.log('--- app log tail ---'); console.log(app.logs.join('').split('\n').slice(-25).join('\n').slice(-3000)); await app.close(); }
process.exit(code);
