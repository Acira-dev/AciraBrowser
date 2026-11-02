// Live resize: shrink and grow the test window step by step (like a drag) and sample page/chrome bounds against the content size.
import {launch, sleep, httpFixture, place} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'rz', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  for (const tabs of ['top', 'sidebar']) for (const view of ['full', 'compact', 'focus', 'seamless']) {
    await app.act({type: 'settings.update', patch: {verticalTabs: tabs === 'sidebar'}});
    await app.act({type: 'ui.update', patch: {view, workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}});
    await place(app, {x: 20, y: 60, width: 1200, height: 700}); await sleep(900);
    const out = await app.win(async w => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)), samples = [];
      const page = () => w.contentView.children.find(v => v.webContents && !v.webContents.getURL().startsWith('acira-browser-ui://'));
      const sample = tag => { const [cw, ch] = w.getContentSize(), p = page()?.getBounds(); samples.push({tag, cw, ch, p}); };
      const steps = [];
      for (let width = 1200; width >= 900; width -= 10) steps.push([width, 700 - (1200 - width) / 3 | 0]);
      for (let width = 900; width <= 1200; width += 10) steps.push([width, 700 - (1200 - width) / 3 | 0]);
      const b = w.getBounds();
      for (const [width, height] of steps) { w.setBounds({x: b.x, y: b.y, width, height}); sample('sync'); await sleep(8); sample('8ms'); }
      await sleep(600); sample('settled');
      return samples;
    });
    // page must always reach the right/bottom content edge (minus the Seamless card's inset), and sit inside the content
    const bad = [], inset = view === 'seamless' ? 6 : 0;
    for (const s of out) { if (!s.p) continue; const rightGap = s.cw - (s.p.x + s.p.width), bottomGap = s.ch - (s.p.y + s.p.height); if (s.p.x + s.p.width > s.cw + 0.5 || s.p.y + s.p.height > s.ch + 0.5 || (s.tag === 'settled' && (Math.abs(rightGap - inset) > 1 || Math.abs(bottomGap - inset) > 1))) bad.push({...s, rightGap, bottomGap}); else if (s.tag !== 'settled' && (rightGap > 40 || bottomGap > 40 || rightGap < 0 || bottomGap < 0)) bad.push({...s, rightGap, bottomGap}); }
    const worst = out.filter(s => s.p).map(s => Math.max(Math.abs(s.cw - (s.p.x + s.p.width)), Math.abs(s.ch - (s.p.y + s.p.height))));
    console.log(tabs, view, 'samples', out.length, 'worst gap', Math.max(...worst), 'bad', bad.length, JSON.stringify(bad.slice(0, 3)));
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
