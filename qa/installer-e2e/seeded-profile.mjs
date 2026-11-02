// The seeded test profile for the installer end-to-end (cwd = worktree; .qa-profiles is a junction to C:\ae\r6\polish\e2e\profiles).
//   node qa/installer-e2e/seeded-profile.mjs seed   <exe>   first run: skip setup, open two sites, bookmark one, quit the ordinary way; writes expected.json
//   node qa/installer-e2e/seeded-profile.mjs verify <exe>   start, compare tabs + bookmark with expected.json, quit
//   node qa/installer-e2e/seeded-profile.mjs hold   <exe>   start and keep running until Acira quits by itself (the installer asks it to), max 150 s
// The app runs with APPDATA / LOCALAPPDATA / ACIRA_BROWSER_TEST_DATA under the profile root only (d-harness startApp).
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root = process.cwd();
const {startApp, sleep, poll} = await import(pathToFileURL(path.join(root, 'qa/d-harness.mjs')).href);
const [mode, exe] = process.argv.slice(2);
process.env.D_APP_EXE = exe; process.env.D_VISIBLE = '1';
const PROFILE = '.qa-profiles/e2e-seeded', OUT = 'C:/ae/r6/polish/e2e';
const expectedFile = path.join(OUT, 'expected.json');
const sites = ['https://example.com/', 'https://example.org/'];
let h; const out = {mode, exe, at: new Date().toISOString()};
try {
  h = await startApp({root: PROFILE, skipSetup: mode === 'seed', args: ['--disable-features=CalculateNativeWinOcclusion']});
  await h.main(({BaseWindow, screen}) => { const minX = Math.min(...screen.getAllDisplays().map(d => d.bounds.x)); for (const w of BaseWindow.getAllWindows()) { w.setBounds({x: minX - 1400, y: 60, width: 1200, height: 760}); } });
  const read = async () => { const s = await h.state(); return {tabs: s.tabs.map(t => t.url).filter(u => /^https:/.test(u)).sort(), bookmarks: (s.bookmarks || []).filter(u => /^https:/.test(u)).sort()}; };
  if (mode === 'seed') {
    for (const url of sites) await h.act({type: 'tab.new', url});
    await poll(async () => (await read()).tabs.length >= 2, Boolean, 'two tabs', 20000);
    await h.act({type: 'bookmark.toggle', url: sites[0]});
    await poll(async () => (await read()).bookmarks.includes(sites[0]), Boolean, 'bookmark', 5000);
    await sleep(2500); // let the session and the database settle
    out.state = await read(); await fs.writeFile(expectedFile, JSON.stringify(out.state, null, 1));
  } else if (mode === 'verify') {
    await sleep(3000);
    const expected = JSON.parse(await fs.readFile(expectedFile, 'utf8'));
    out.state = await poll(read, s => s.tabs.length >= expected.tabs.length, 'restored tabs', 20000).catch(async () => read());
    out.tabsRestored = JSON.stringify(out.state.tabs) === JSON.stringify(expected.tabs);
    out.bookmarkKept = expected.bookmarks.every(b => out.state.bookmarks.includes(b));
    out.version = await h.main(({app}) => app.getVersion());
  } else if (mode === 'hold') {
    await sleep(2000); out.state = await read(); out.version = await h.main(({app}) => app.getVersion());
    await fs.writeFile(path.join(OUT, 'hold-ready.txt'), 'ready');
    const proc = h.app.process(); const started = Date.now();
    out.quitByItself = await new Promise(resolve => { const t = setTimeout(() => resolve(false), 150000); proc.once('exit', () => { clearTimeout(t); resolve(true); }); });
    out.heldMs = Date.now() - started;
  }
} catch (e) { out.error = e.stack || e.message; }
finally {
  if (mode !== 'hold' || !out.quitByItself) { try { await h?.close(); } catch {} try { h?.app.process().kill(); } catch {} }
  await fs.writeFile(path.join(OUT, `app-${mode}-${Date.now()}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
}
