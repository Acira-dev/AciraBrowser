// Body for ev.sh: navigate the first tab through 7 articles of one site (browser-initiated, like clicking links), then report that renderer's memory and
// whether Back restores from the back/forward cache (pageshow.persisted). Needs tab 'pin0' (Wikipedia) to be the one on screen.
const pages = ['Firefox','Safari_(web_browser)','Opera_(web_browser)','Chromium_(web_browser)','Internet_Explorer','Netscape_Navigator','Brave_(web_browser)'];
const out = await app.evaluate(async ({webContents, app: electronApp}, pages) => {
  const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && /wikipedia\.org/.test(w.getURL()));
  const pid = wc.getOSProcessId();
  const mem = async () => { const m = electronApp.getAppMetrics().find(x => x.pid === pid); return Math.round(m.memory.workingSetSize / 1024); };
  const log = [{step: 'start', ws: await mem()}];
  const listen = () => wc.executeJavaScript(`globalThis.__ps = []; addEventListener('pageshow', e => __ps.push(e.persisted)); 1`).catch(() => {});
  await listen();
  for (const p of pages) { await wc.loadURL('https://en.wikipedia.org/wiki/' + p).catch(() => {}); await new Promise(r => setTimeout(r, 3500)); await listen(); log.push({step: p, ws: await mem()}); }
  // Back once: persisted === true in pageshow means the page came from the back/forward cache.
  wc.navigationHistory.goBack(); await new Promise(r => setTimeout(r, 2500));
  const persisted = await wc.executeJavaScript('JSON.stringify(globalThis.__ps||null)').catch(() => 'new document');
  log.push({step: 'back', ws: await mem(), persistedInThisDocument: persisted, url: wc.getURL()});
  return log;
}, pages);
return out;
