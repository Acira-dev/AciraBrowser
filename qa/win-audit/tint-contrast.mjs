// Custom tint / accent extremes: ink against the real painted background (UI capture pixels) for the toolbar, tab row and selected tab.
import {launch, sleep, httpFixture, OUT} from './lib.mjs';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Plain page</title><body>x</body>'); });
const app = await launch({name: 'tc', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const pix = (file, x, y) => JSON.parse(execFileSync('python3', ['-c', `import sys,json;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGB');print(json.dumps(im.getpixel((int(sys.argv[2]),int(sys.argv[3])))))`, file, String(x), String(y)]).toString());
let bad = 0;
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800); await app.ui.evaluate(() => document.activeElement?.blur());
  for (const appearance of ['light', 'dark']) for (const tint of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#7f7f00', '#4d1821']) {
    await app.act({type: 'settings.update', patch: {appearance, colorPreset: 'Custom', browserTint: tint, accentColor: tint === '#ffffff' || tint === '#ffff00' ? '#000000' : '#ffffff'}}); await sleep(700);
    const file = await app.shot(`tc-${appearance}-${tint.slice(1)}`);
    const probes = await app.ui.evaluate(() => { const dpr = devicePixelRatio, pick = (sel, label) => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return {label, color: cs.color, x: Math.round((r.left + 2) * dpr), y: Math.round((r.top + r.height / 2) * dpr), w: r.width}; }; return [pick('.navigation-controls .icon-button', 'nav icon'), pick('[role=tab][aria-selected=true] , .tab[aria-selected=true]', 'selected tab text'), pick('.toolbar-menu-control', 'menu icon')].filter(Boolean); });
    for (const p of probes) { const m = p.color.match(/[\d.]+/g).map(Number); const bgPt = [p.x - 6, p.y]; const bg = pix(file, Math.max(1, bgPt[0]), bgPt[1]); const c = contrast(m.slice(0, 3), bg); if (c < 3) { bad++; console.log('LOW CONTRAST', appearance, tint, p.label, c.toFixed(2), 'ink', p.color, 'bg', JSON.stringify(bg)); } }
  }
  console.log('low-contrast findings:', bad, 'errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
