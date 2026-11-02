import {launch, sleep, httpFixture} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const reduced = process.argv[2] === 'reduced';
const app = await launch({name: 'p6', settings: {onboardingComplete: true, reducedMotion: reduced, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  const pos = async () => (await app.buttons()).map(b => `${b.x},${b.y}${b.hidden ? 'H' : ''}`).join(' ');
  for (const view of ['full', 'seamless', 'full', 'compact', 'seamless', 'compact', 'seamless', 'focus', 'seamless', 'full']) {
    await app.act({type: 'ui.update', patch: {view}});
    const samples = [];
    for (const ms of [100, 400, 1000, 2000]) { await sleep(ms - (samples.length ? samples.at(-1).ms : 0)); samples.push({ms, p: await pos()}); }
    console.log(view.padEnd(9), samples.map(s => s.ms + 'ms:' + s.p).join(' | '));
  }
} finally { await app.close(); await fixture.close(); }
