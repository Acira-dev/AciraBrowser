import './scripts/build-mac-material.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('.', import.meta.url));
// The preview runs the built interface by default, so edits in progress never reload it while you use it.
// --live loads the dev server instead, with every saved change appearing at once.
const live = process.argv.includes('--live');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_QA_RUN;/* a person launching Acira is never a QA run: Google and YouTube stay reachable */
if(live)env.ACIRA_DEV='1';else delete env.ACIRA_DEV;
// Private windows with Tor need the pinned tor.exe, which is not in git: fetch and verify it the first time (set ACIRA_SKIP_TOR_FETCH=1 to skip).
if (process.platform === 'win32' && !process.env.ACIRA_SKIP_TOR_FETCH && !existsSync(fileURLToPath(new URL('desktop/browser-services/tor-engine/win-x64/tor.exe', import.meta.url)))) {
  console.log('Fetching the Tor engine (once, about 4 MB, checked against a pinned hash)...');
  const fetched = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/fetch-tor.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' });
  if (fetched.status !== 0) console.error('Could not fetch Tor, so private windows with Tor will say it is missing. Run "node scripts/fetch-tor.mjs" when you are online.');
}
// A fresh profile compiles the content-blocking engine from the bundled lists on the main thread (about half a second before the first
// window can show) unless the compiled engine sits next to them, as the installer ships it. Build it here when it is missing or out of
// date (once per filter list or engine update), so a first run from source starts like an installed one.
try {
  const { bundledEngineCurrent } = require('./scripts/build-filter-engine.cjs');
  if (!bundledEngineCurrent()) {
    console.log('Preparing the content-blocking engine (once per filter list update)...');
    spawnSync(process.execPath, [fileURLToPath(new URL('scripts/build-filter-engine.cjs', import.meta.url)), '--if-stale'], { cwd: root, stdio: 'inherit' });
  }
} catch { /* the browser parses the lists itself */ }
const child = spawn(require('electron'), [fileURLToPath(new URL('desktop/main.cjs', import.meta.url))], {
  cwd: root,
  env,
  detached: true,
  stdio: 'ignore',
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.unref();
console.log(live ? 'Launching Acira Browser with live interface updates.' : 'Launching Acira Browser.');
