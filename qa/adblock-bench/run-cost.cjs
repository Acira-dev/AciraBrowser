'use strict';
// node qa/adblock-bench/run-cost.cjs [runs=5]  -> median startup/memory cost per engine and list set
const { spawnSync } = require('node:child_process'), path = require('node:path');
const runs = Number(process.argv[2] || 5), rows = [];
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const lists of ['ours', 'brave']) for (const engine of ['ghostery', 'brave']) {
  const samples = [];
  for (let i = 0; i < runs; i++) { const r = spawnSync(process.execPath, ['--expose-gc', path.join(__dirname, 'cost.cjs'), '--engine=' + engine, '--lists=' + lists], { encoding: 'utf8', env: process.env }); if (r.status !== 0) { console.error(r.stderr.slice(0, 400)); break; } samples.push(JSON.parse(r.stdout.trim().split('\n').pop())); }
  if (!samples.length) continue;
  const out = { engine, lists, runs: samples.length }; for (const k of Object.keys(samples[0])) if (typeof samples[0][k] === 'number') out[k] = median(samples.map(s => s[k]));
  rows.push(out); console.log(JSON.stringify(out));
}
