// All twelve finishes x light/dark in Full: UI-layer shots (exact colours) + sampled chrome colours and text contrast.
import {launch, sleep, httpFixture, OUT} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Plain page</title><body style="margin:0;background:#fff;font:20px sans-serif">fixture</body>'); });
const app = await launch({name: 'pr', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const pal = {Porcelain: ['#1769c2', '#f8fbff'], Burgundy: ['#4d1821', '#4d1821'], 'Deep Blue': ['#47678e', '#293c55'], 'Ocean Blue': ['#266a98', '#99c9e8'], 'iPhone Blue': ['#477fb8', '#315b89'], 'Emerald Green': ['#208361', '#176b53'], 'Alpine Green': ['#487667', '#345c50'], 'Deep Purple': ['#885494', '#57345f'], 'Desert Titanium': ['#79634f', '#b5a596'], 'Natural Titanium': ['#56616d', '#bbc0c7'], Silver: ['#3d6e9c', '#f7f7f7'], 'Black Titanium': ['#65778e', '#262c33']};
const names = Object.keys(pal);
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur());
  for (const view of (process.env.VIEWS ? JSON.parse(process.env.VIEWS) : ['full', 'compact'])) for (const appearance of ['light', 'dark']) for (const name of names) {
    await app.act({type: 'settings.update', patch: {colorPreset: name, accentColor: pal[name][0], browserTint: pal[name][1], appearance}}); await app.act({type: 'ui.update', patch: {view}}); await sleep(600);
    const m = await app.ui.evaluate(() => { const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); }; const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const app = document.querySelector('.app'), cs = getComputedStyle(app); const sel = document.querySelector('.tab[aria-selected=true], [role=tab][aria-selected=true]'); const addr = document.querySelector('.address-bar input');
      const row = {finish: app.dataset.finish, theme: app.dataset.theme, frame: cs.getPropertyValue('--frame').trim(), accent: cs.getPropertyValue('--accent').trim()};
      if (sel) { const s = getComputedStyle(sel); row.tab = [s.color, s.backgroundColor]; row.tabContrast = +contrast(s.color, s.backgroundColor.startsWith('rgba(0, 0, 0, 0') ? cs.getPropertyValue('--frame').trim().startsWith('#') ? 'rgb(240,240,240)' : 'rgb(240,240,240)' : s.backgroundColor).toFixed(1); }
      if (addr) { const s = getComputedStyle(addr); row.addr = [s.color, getComputedStyle(addr.closest('.address-bar')).backgroundColor]; }
      return row; });
    if (m.finish !== name) console.log('FINISH MISMATCH wanted', name, 'got', m.finish);
    await app.shot(`pr-${view}-${appearance}-${name.replace(/ /g, '')}`);
    console.log(view, appearance, name.padEnd(16), JSON.stringify(m).slice(0, 220));
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
