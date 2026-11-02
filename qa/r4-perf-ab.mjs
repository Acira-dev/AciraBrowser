// Interleaved A/B for qa/r4-perf.mjs (R4-37). One native slot is held for a series of single runs (one Electron at a time), released
// before 9 minutes and taken again if the series is longer; order alternates A B, B A, A B ... so machine drift cancels; medians reported.
//   node qa/r4-perf-ab.mjs --pairs 3 --a "--app C:/ae/r4/perf/base --label base" --b "--label change" --common "--sites real --tabs 10"
// Arguments inside the quoted groups are split on spaces (keep paths without spaces; the default --app is this worktree).
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const split = s => (s || '').split(' ').filter(Boolean);
const PAIRS = Math.min(5, Math.max(1, Number(opt('pairs', 3)))), A = split(opt('a')), B = split(opt('b')), COMMON = split(opt('common'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function takeSlot() {
  for (let round = 0; round < 45; round++) {
    for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-perf ab ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
function run(args, slot) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(HERE, 'r4-perf.mjs'), ...COMMON, ...args, '--slot-held', slot], {stdio: ['ignore', 'pipe', 'inherit'], cwd: path.join(HERE, '..')});
    let out = ''; child.stdout.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill(), 9.5 * 60 * 1000);
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out.trim().split('\n').at(-1))); } catch { resolve({status: 'INVALID', error: 'no summary: ' + out.slice(-300)}); } });
  });
}
const median = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b), m = v.length >> 1; return !v.length ? null : v.length % 2 ? v[m] : +((v[m - 1] + v[m]) / 2).toFixed(1); };
const results = {A: [], B: []};
let slot = null, held = 0;
try {
  // --runs "args || args || ...": a plain series of single runs (one Electron/Chrome at a time) under the same slot rules, no A/B.
  const series = (opt('runs') || '').split('||').map(split).filter(a => a.length);
  const order = []; if (series.length) series.forEach((_, i) => order.push(i)); else for (let i = 0; i < PAIRS; i++) order.push(...(i % 2 ? ['B', 'A'] : ['A', 'B']));
  for (const arm of order) {
    if (slot && Date.now() - held > 7.5 * 60 * 1000) { await fs.rm(slot, {force: true}); slot = null; }
    if (!slot) { slot = await takeSlot(); held = Date.now(); }
    const r = await run(typeof arm === 'number' ? series[arm] : arm === 'A' ? A : B, slot); (results[arm] ??= []).push(r);
    console.error(`[ab] ${arm} ${r.status} ${r.privateMB} MB cpu ${r.idleCpu}% load ${r.loadMedianMs} ms ${r.error || ''}`);
  }
} finally { if (slot) await fs.rm(slot, {force: true}); }
const summary = {};
for (const arm of ['A', 'B']) {
  const ok = results[arm].filter(r => r.status === 'VALID');
  const roles = new Set(ok.flatMap(r => Object.keys(r.byRole || {})));
  summary[arm] = {label: ok[0]?.label, valid: ok.length, privateMB: ok.map(r => r.privateMB), medianMB: median(ok.map(r => r.privateMB)), medianCpu: median(ok.map(r => r.idleCpu)), medianLoadMs: median(ok.map(r => r.loadMedianMs)), medianDclMs: median(ok.map(r => r.dclMedianMs)), processes: median(ok.map(r => r.processes)),
    roles: Object.fromEntries([...roles].map(role => { const vals = ok.map(r => r.byRole?.[role]).filter(Boolean); return [role, `${median(vals.map(v => Number(v.split('x')[0])))}x ${median(vals.map(v => Number(v.split(' ')[1].replace('MB', ''))))}MB`]; }))};
}
summary.deltaMB = summary.A.medianMB != null && summary.B.medianMB != null ? +(summary.B.medianMB - summary.A.medianMB).toFixed(1) : null;
summary.runs = results;
const out = path.join('C:/ae/r4/perf/runs', `ab-${summary.A.label}-vs-${summary.B.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.mkdir(path.dirname(out), {recursive: true}); await fs.writeFile(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({A: {...summary.A}, B: {...summary.B}, deltaMB: summary.deltaMB, out}));
