// node qa/w-morph2.mjs <appearance> <top|sidebar> <repeats> [pairs like full:compact,compact:seamless]
import {launch, sleep, httpFixture, record} from './lib.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const [appearance = 'light', tabs = 'top', repeats = '1', only] = process.argv.slice(2);
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'm2', settings: {onboardingComplete: true, reducedMotion: false, appearance, animationSpeed: 'fast', verticalTabs: tabs === 'sidebar'}});
const views = ['full', 'compact', 'focus', 'seamless'];
const pairs = only ? only.split(',').map(p => p.split(':')) : views.flatMap(a => views.filter(b => b !== a).map(b => [a, b]));
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url);
  await app.act({type: 'ui.update', patch: {workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}}); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); }); await sleep(300);
  for (let n = 0; n < Number(repeats); n++) for (const [a, b] of pairs) {
    await app.act({type: 'ui.update', patch: {view: a}}); await sleep(1600);
    const name = `m2-${appearance}-${tabs}-${a}-${b}-${n}`;
    const r = await record(app, name, 3, async () => { await app.act({type: 'ui.update', patch: {view: b}}); await sleep(1800); });
    execFileSync('python3', [new URL('./tools/frames.py', import.meta.url).pathname, r.file, '--quiet']);
    const verdict = execFileSync('python3', [new URL('./tools/check.py', import.meta.url).pathname, r.file.replace('.mov', '.json')]).toString().trim();
    console.log(`${a}->${b} #${n}: ${verdict}`);
    if (verdict === 'monotone') { fs.rmSync(r.file.replace('.mov', ''), {recursive: true, force: true}); }
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
