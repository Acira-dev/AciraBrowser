// Stream D: tab weight. Opens 10 heavy real sites, then reports browser-wide RAM/CPU from Electron's process metrics.
// usage: node qa/d-perf.mjs <label> [idleMinutesOverrideForSweeper]
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from './d-harness.mjs';
const label = process.argv[2] || 'run', root = `.qa-profiles/d-perf-${label}`; await fs.rm(root, {recursive: true, force: true});
const sites = ['youtube.com/watch?v=jNQXAC9IVRw', 'excalidraw.com', 'x.com/explore', 'reddit.com/r/popular', 'github.com/torvalds/linux', 'en.wikipedia.org/wiki/Web_browser', 'theguardian.com/international', 'app.diagrams.net', 'notion.so/product', 'amazon.com'];
const app = await startApp({root, env: {ACIRA_PERF: '1', ...(process.env.ACIRA_MEMORY_SAVER_IDLE_MS ? {ACIRA_MEMORY_SAVER_IDLE_MS: process.env.ACIRA_MEMORY_SAVER_IDLE_MS} : {})}});
const metrics = async () => {
  const m = await app.main(({app}) => app.getAppMetrics().map(p => ({type: p.type, mb: Math.round((p.memory.workingSetSize || 0) / 1024), privateMb: Math.round((p.memory.privateBytes || 0) / 1024), cpu: p.cpu.percentCPUUsage})));
  const total = m.reduce((a, p) => a + p.mb, 0), priv = m.reduce((a, p) => a + p.privateMb, 0), cpu = Math.round(m.reduce((a, p) => a + p.cpu, 0) * 10) / 10;
  return {processes: m.length, renderers: m.filter(p => p.type === 'Tab').length, workingSetMb: total, privateMb: priv, cpuPercent: cpu};
};
const avgCpu = async (seconds = 20) => { let sum = 0, n = 0; for (let i = 0; i < seconds; i++) { sum += (await metrics()).cpuPercent; n++; await sleep(1000); } return Math.round(sum / n * 10) / 10; };
try {
  const loaded = [];
  for (const site of sites) {
    await app.act({type: 'tab.new', url: site}); const id = (await app.state()).tabs.at(-1).id;
    const t = await poll(async () => (await app.state()).tabs.find(x => x.id === id), x => x && (x.error || (!x.loading && x.title)), site, 40000).catch(() => null);
    loaded.push([site, t && !t.error ? 'ok' : 'FAIL']);
    // quiet the video like a person who paused it
    await app.web(u => u.includes('youtube.com'))?.evaluate(() => document.querySelector('video')?.pause()).catch(() => {});
  }
  await sleep(15000);
  const afterLoad = await metrics(); const cpuAfterLoad = await avgCpu(15);
  console.log(JSON.stringify({label, loaded: loaded.map(l => l.join(' ')).join('; '), afterLoad, avgCpuPercentIdleAfterLoad: cpuAfterLoad}, null, 1));
  const waitSeconds = Number(process.env.D_PERF_WAIT || 0);
  if (waitSeconds) { await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url.includes('wikipedia')).id}); for (let s = 0; s < waitSeconds; s += 30) { await sleep(30000); console.log(JSON.stringify({afterSeconds: s + 30, ...(await metrics()), sleeping: (await app.state()).tabs.filter(t => t.sleeping).length})); } console.log(JSON.stringify({avgCpuPercentIdleLater: await avgCpu(15)})); }
} finally { await app.close(); }
