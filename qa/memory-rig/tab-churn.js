// Body for ev.sh on the 'fixture' run: open and close N tabs (a local page each), then report what is left. N from the first line below.
const N = 40, FIX = 'http://127.0.0.1:9834';
const count = async () => app.evaluate(({webContents, app}) => ({wcs: webContents.getAllWebContents().filter(w => !w.isDestroyed()).length, procs: app.getAppMetrics().length, heap: Math.round(process.memoryUsage().heapUsed / 1048576), rss: Math.round(process.memoryUsage().rss / 1048576)}));
const before = await count();
for (let i = 0; i < N; i++) {
  await act({type: 'tab.new', url: FIX + '/plain?i=' + i}); await sleep(900);
  const s = await snap(); const t = s.tabs.find(x => x.url.includes('?i=' + i)); if (t) await act({type: 'tab.close', id: t.id}); await sleep(250);
}
await sleep(20000);
const after = await count(), s = await snap();
return {before, after, tabsLeft: s.tabs.length};
