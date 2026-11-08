// Body for ev.sh: one memory table. Returns per-process rows (type, pid, working set, private, footprint) with what each one hosts, plus main's memoryUsage.
// footprint (macOS phys_footprint, what Activity Monitor shows) is read for every pid; privateBytes is zero on macOS in this Electron, so footprint is the private figure there.
const r = await app.evaluate(async ({app, webContents}) => {
  const cp = process.mainModule.require('node:child_process');
  const metrics = app.getAppMetrics();
  const hosts = {};
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    let pid = 0; try { pid = wc.getOSProcessId(); } catch {}
    let url = ''; try { url = wc.getURL(); } catch {}
    (hosts[pid] ||= []).push({id: wc.id, type: wc.getType(), url: url.slice(0, 70)});
  }
  const pids = metrics.map(m => m.pid);
  let foot = {};
  try {
    // one call per process: a multi-process footprint report mixes a group total into the first block
    for (const p of pids) { try { const out = cp.execFileSync('/usr/bin/footprint', ['-p', String(p)], {encoding: 'utf8', timeout: 15000, maxBuffer: 20e6}); const f = out.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/); if (f) foot[p] = Number(f[1]) * ({KB: 1 / 1024, MB: 1, GB: 1024}[f[2]]); } catch {} }
  } catch (e) { foot._error = String(e).slice(0, 200); }
  let rss = {};
  try { for (const line of cp.execFileSync('/bin/ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], {encoding: 'utf8'}).trim().split('\n')) { const [p, k] = line.trim().split(/\s+/); rss[p] = Number(k) / 1024; } } catch {}
  const mu = process.memoryUsage();
  return {
    main: {rss: mu.rss / 1048576, heapUsed: mu.heapUsed / 1048576, heapTotal: mu.heapTotal / 1048576, external: mu.external / 1048576, arrayBuffers: mu.arrayBuffers / 1048576},
    rows: metrics.map(m => ({pid: m.pid, type: m.type, name: m.name || m.serviceName || '', ws: Math.round(m.memory.workingSetSize / 1024 * 10) / 10, privKB: Math.round((m.memory.privateBytes || 0) / 1024), footprint: Math.round((foot[m.pid] || 0) * 10) / 10, rss: Math.round((rss[m.pid] || 0) * 10) / 10, hosts: hosts[m.pid] || []})),
    foot_error: foot._error, errors: globalThis.__rigErrors,
  };
});
const totals = {ws: 0, footprint: 0, rss: 0}; for (const x of r.rows) { totals.ws += x.ws; totals.footprint += x.footprint; totals.rss += x.rss; }
r.totals = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)]));
return r;
