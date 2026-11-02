'use strict';
// Digest of record.cjs outputs.  node qa/adblock-bench/report.cjs <dir>   (expects ads-none/ghostery/brave.json, normal-none/ghostery/brave/farble-*.json)
const fs = require('node:fs'), path = require('node:path');
const dir = process.argv[2] || '.scratch-src/out';
const load = name => { try { return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')); } catch { return null; } };
const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) || 0), 0);
const ads = { none: load('ads-none'), ghostery: load('ads-ghostery'), brave: load('ads-brave') };
if (ads.ghostery && ads.brave) {
  const ids = ads.ghostery.results.map(r => r.id).filter(id => ads.brave.results.some(r => r.id === id));
  const pick = d => ids.map(id => d.results.find(r => r.id === id));
  console.log('LIVE ad pages (' + ids.length + ' of the 25, run in Electron with each engine in the request path)');
  console.log('site'.padEnd(16), 'none req', 'G blk', 'B blk', 'G vis-ads', 'B vis-ads', 'none vis-ads', 'G css', 'B css', 'G scr', 'B scr');
  for (const id of ids) { const n = ads.none.results.find(r => r.id === id), g = ads.ghostery.results.find(r => r.id === id), b = ads.brave.results.find(r => r.id === id); const v = r => r.residual && r.residual.visibleAdBoxes != null ? r.residual.visibleAdBoxes : 'n/a'; console.log(id.padEnd(16), String(n.stat.total).padStart(8), String(g.stat.blocked + g.stat.redirected).padStart(5), String(b.stat.blocked + b.stat.redirected).padStart(5), String(v(g)).padStart(9), String(v(b)).padStart(9), String(v(n)).padStart(12), String(g.cosmetic && g.cosmetic.styleBytes).padStart(5), String(b.cosmetic && b.cosmetic.cssSelectors).padStart(5), String(g.cosmetic && g.cosmetic.scripts).padStart(5), String(b.cosmetic && b.cosmetic.scripts).padStart(5)); }
  for (const [label, d] of [['ghostery', ads.ghostery], ['brave', ads.brave]]) { const rows = pick(d); console.log(label, 'totals: blocked+redirected', sum(rows, r => r.stat.blocked + r.stat.redirected), 'requests', sum(rows, r => r.stat.total), 'MB transferred', (sum(rows, r => r.bytes) / 1048576).toFixed(1), 'visible ad boxes', sum(rows, r => r.residual && r.residual.visibleAdBoxes), 'ad labels shown', sum(rows, r => r.residual && r.residual.adLabelsShown)); }
  const none = pick(ads.none); console.log('none totals: requests', sum(none, r => r.stat.total), 'MB', (sum(none, r => r.bytes) / 1048576).toFixed(1), 'visible ad boxes', sum(none, r => r.residual && r.residual.visibleAdBoxes));
  for (const label of ['none', 'ghostery', 'brave']) { const r = ads[label].results.find(x => x.id === 'youtube-ads'); if (r) console.log('youtube-ads', label, JSON.stringify({ adShowing: r.yt && r.yt.adShowing, videoTime: r.yt && r.yt.videoTime, later: r.yt && r.yt.later && { adShowing: r.yt.later.adShowing, videoTime: r.yt.later.videoTime } })); }
}
const normal = { none: load('normal-none'), ghostery: load('normal-ghostery'), brave: load('normal-brave'), 'ghostery-page': load('normal-ghostery-pagesource'), 'farble-standard': load('normal-farble-standard'), 'farble-strict': load('normal-farble-strict') };
if (normal.none) {
  console.log('\nBREAKAGE (15 normal sites; probe = login field / results / video playing / checkout frame)');
  const modes = Object.keys(normal).filter(m => normal[m]);
  console.log('site'.padEnd(18), modes.map(m => m.padEnd(16)).join(''));
  for (const site of normal.none.results) { console.log(site.id.padEnd(18), modes.map(m => { const r = normal[m].results.find(x => x.id === site.id); return (r ? (r.probe ? (r.probe.pass ? 'pass' : 'FAIL') : '-') + ' ' + (r.stat.blocked + r.stat.redirected) + 'b' : 'n/a').padEnd(16); }).join('')); }
  const base = new Set(normal.none.results.filter(r => r.probe && r.probe.pass).map(r => r.id));
  console.log('probes that pass without any blocking:', [...base].join(', '));
  for (const m of modes.filter(m => m !== 'none')) { const broken = normal[m].results.filter(r => base.has(r.id) && !(r.probe && r.probe.pass)).map(r => r.id); console.log(m.padEnd(16), 'regressions vs no blocking:', broken.length ? broken.join(', ') : 'none', '| blocked', sum(normal[m].results, r => r.stat.blocked + r.stat.redirected), 'of', sum(normal[m].results, r => r.stat.total)); }
}
