import {launch, sleep, httpFixture, record} from './lib.mjs';
import {execFileSync} from 'node:child_process';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const view = process.argv[2] || 'full';
const app = await launch({name: 'th', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', animationSpeed: 'fast', verticalTabs: false}, ui: {view}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  for (const [from, to] of [['light', 'dark'], ['dark', 'light']]) {
    await app.act({type: 'settings.update', patch: {appearance: from}}); await sleep(1500);
    const name = `th-${view}-${from}-${to}`;
    const r = await record(app, name, 4, async () => { await app.act({type: 'settings.update', patch: {appearance: to}}); await sleep(1500); }, {lead: 1400});
    console.log('==', name);
    console.log(execFileSync('python3', [new URL('./tools/lum.py', import.meta.url).pathname, r.file]).toString().split('\n').slice(0, 40).join('\n'));
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
