'use strict';
// Deterministic network replay: every request recorded in record.cjs --mode=none is judged by both engines on identical
// list text. Usage: node qa/adblock-bench/replay.cjs <ads-none.json> [--lists=ours|brave] [--out=file.json]
const fs = require('node:fs'), path = require('node:path');
const { listText, buildGhostery, buildBrave, BRAVE_TYPE } = require('./engines.cjs');
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), LISTS = arg('lists', 'ours'), OUT = arg('out', '');
const { Request } = require('@ghostery/adblocker');
const text = listText(LISTS), g = buildGhostery(text), b = buildBrave(text);
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
const { getDomain } = require('tldts');
const rows = [];
for (const site of input.results) for (const r of site.reqs) { if (r.type === 'mainFrame') continue; rows.push({ site: site.id, url: r.url, type: r.type, referrer: r.referrer, page: r.page || site.finalUrl, frame: r.frame }); }
const sourceFor = (row, variant) => variant === 'page' ? row.page : variant === 'raw' ? row.referrer : variant === 'frame' ? (row.frame || row.referrer || row.page) : (row.referrer || row.page);
const gDecide = (row, variant) => { const req = Request.fromRawDetails({ url: row.url, sourceUrl: sourceFor(row, variant), type: row.type }); const m = g.engine.match(req); return m.redirect ? 'redirect' : m.match ? 'block' : 'allow'; };
const bDecide = (row, variant) => { const r = b.engine.check(row.url, sourceFor(row, variant), BRAVE_TYPE[row.type] || 'other', row.method || '', true); return r.redirect || r.rewritten_url ? 'redirect' : r.should_block ? 'block' : 'allow'; };
const out = { lists: LISTS, requests: rows.length, buildMs: { ghostery: g.buildMs, brave: b.buildMs }, variants: {} };
for (const variant of ['raw', 'referrer', 'page', 'frame']) {
  const per = {}, disagree = { onlyGhostery: [], onlyBrave: [] }; let agree = 0, both = 0;
  const lat = { ghostery: [], brave: [] };
  for (const row of rows) {
    const t0 = process.hrtime.bigint(); const gd = gDecide(row, variant); const t1 = process.hrtime.bigint(); const bd = bDecide(row, variant); const t2 = process.hrtime.bigint();
    lat.ghostery.push(Number(t1 - t0) / 1e3); lat.brave.push(Number(t2 - t1) / 1e3);
    const s = per[row.site] || (per[row.site] = { requests: 0, ghostery: 0, brave: 0, both: 0, onlyGhostery: 0, onlyBrave: 0, thirdParty: 0 });
    s.requests++; const third = getDomain(hostOf(row.url)) !== getDomain(hostOf(row.page)); if (third) s.thirdParty++;
    const gb = gd !== 'allow', bb = bd !== 'allow'; if (gb) s.ghostery++; if (bb) s.brave++; if (gb && bb) { s.both++; both++; }
    if (gb === bb) agree++; else if (gb) { s.onlyGhostery++; disagree.onlyGhostery.push({ site: row.site, url: row.url.slice(0, 160), type: row.type, src: sourceFor(row, variant).slice(0, 80) }); } else { s.onlyBrave++; disagree.onlyBrave.push({ site: row.site, url: row.url.slice(0, 160), type: row.type, src: sourceFor(row, variant).slice(0, 80) }); }
  }
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  const sum = k => Object.values(per).reduce((n, s) => n + s[k], 0);
  out.variants[variant] = { agreePct: +(100 * agree / rows.length).toFixed(2), blockedGhostery: sum('ghostery'), blockedBrave: sum('brave'), both: sum('both'), onlyGhostery: sum('onlyGhostery'), onlyBrave: sum('onlyBrave'), perSite: per, latencyUs: { ghostery: { p50: pct(lat.ghostery, .5), p95: pct(lat.ghostery, .95), p99: pct(lat.ghostery, .99), mean: lat.ghostery.reduce((a, c) => a + c, 0) / lat.ghostery.length }, brave: { p50: pct(lat.brave, .5), p95: pct(lat.brave, .95), p99: pct(lat.brave, .99), mean: lat.brave.reduce((a, c) => a + c, 0) / lat.brave.length } }, samples: { onlyGhostery: disagree.onlyGhostery.slice(0, 400), onlyBrave: disagree.onlyBrave.slice(0, 400) } };
}
console.log(`lists=${LISTS} requests=${rows.length} build ms ghostery=${g.buildMs.toFixed(0)} brave=${b.buildMs.toFixed(0)}`);
for (const k of ['raw', 'referrer', 'page', 'frame']) { const x = out.variants[k]; console.log(`${k}: ghostery=${x.blockedGhostery} brave=${x.blockedBrave} both=${x.both} onlyG=${x.onlyGhostery} onlyB=${x.onlyBrave} agree=${x.agreePct}% latency µs p50 g=${x.latencyUs.ghostery.p50.toFixed(1)} b=${x.latencyUs.brave.p50.toFixed(1)} p99 g=${x.latencyUs.ghostery.p99.toFixed(1)} b=${x.latencyUs.brave.p99.toFixed(1)}`); }
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
