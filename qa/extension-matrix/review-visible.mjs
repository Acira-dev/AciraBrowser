// Visible-window check of the extension review step (the "Add … to Acira?" question shown before a folder or a Chrome Web Store
// package is loaded). With D_VISIBLE=1 Acira asks with its own question window, not the system message box the harness stubs; a
// visible run used to wait on that window forever and an outer timeout then killed the app ("Target crashed"). This drives the
// Settings › Extensions path (window.acira.extensions load / install) on an isolated profile, lets lib.mjs answer the review in
// the page the way a person would, and records every render-process-gone / child-process-gone, the UI console and the
// Crashpad reports folder. Each request is bounded: an unanswered review fails loudly instead of hanging. Never captures the
// screen, never moves the mouse.
// Usage (cwd = repo, after npm run build): D_VISIBLE=1 node qa/extension-matrix/review-visible.mjs [--fixture=api-probe|media-capture]
//   [--store=<id>|--no-store] [--theme=dark|light] [--share-flag]
import fs from 'node:fs/promises';
import {openSync, closeSync, writeSync, unlinkSync} from 'node:fs';
import path from 'node:path';
import {launch, sleep} from './lib.mjs';
import {RUN} from './run-context.mjs';

const argv = process.argv.slice(2);
const opt = name => (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || '';
// Small store package by default (20 KB): store downloads on this network run at ~20 KB/s. Run with ACIRA_EXT_MATRIX_RUN=<short>
// from a deep worktree: unpacked store packages under a long .qa-profiles path pass Windows' 260-character limit.
const STORE = opt('store') || 'bcjindcccaagfpapjjmafapmmgkkhgoa', NO_STORE = argv.includes('--no-store');
const FIXTURE = opt('fixture') || 'api-probe', THEME = opt('theme'), SHARE = argv.includes('--share-flag');
const out = path.join(RUN.output, 'review-visible');
await fs.mkdir(out, {recursive: true});

async function takeSlot() {
  const end = Date.now() + 20 * 60 * 1000;
  while (Date.now() < end) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = openSync(file, 'wx'); writeSync(fd, `review-visible ${new Date().toISOString()}\n`); closeSync(fd); return file; } catch {}
    }
    await sleep(30000);
  }
  throw Error('no native slot free');
}
const R = {runId: RUN.id, visible: !!process.env.D_VISIBLE, fixture: FIXTURE, store: NO_STORE ? null : STORE, steps: [], gone: [], console: [], failures: []};
const log = (step, detail) => { R.steps.push({step, at: Date.now(), detail}); console.log(step, JSON.stringify(detail ?? '').slice(0, 400)); };

let app, slot;
try {
  slot = await takeSlot();
  app = await launch('rv' + Date.now().toString(36), {env: SHARE ? {ACIRA_TEST_SHARE_PICKER: '1'} : {}});
  if (THEME) await app.main(({nativeTheme}, theme) => { nativeTheme.themeSource = theme; }, THEME);
  app.ui.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') R.console.push({type: m.type(), text: m.text().slice(0, 400)}); });
  app.ui.on('crash', () => R.failures.push({uiPageCrash: Date.now()}));
  await app.main(({app}) => {
    globalThis.__gone = [];
    app.on('render-process-gone', (_e, wc, details) => { let url = ''; try { url = wc.getURL(); } catch {} globalThis.__gone.push({kind: 'render', url, ...details, at: Date.now()}); });
    app.on('child-process-gone', (_e, details) => globalThis.__gone.push({kind: 'child', ...details, at: Date.now()}));
  });
  R.crashDumps = await app.main(({app}) => app.getPath('crashDumps'));

  // Acira's own question window, if one is open.
  const dialogState = () => app.main(({BaseWindow}) => {
    const w = BaseWindow.getAllWindows().find(w => !w.isDestroyed() && w.contentView.children.some(v => /native-dialog\.html/.test(v.webContents?.getURL?.() || '')));
    return w ? {visible: w.isVisible(), bounds: w.getBounds(), crashed: w.contentView.children[0].webContents.isCrashed()} : null;
  });

  // One request through the review step, bounded (≤150 s: a store package downloads first).
  async function throughReview(label, request) {
    const before = (await app.reviews()).length;
    let settled = null;
    app.ext(request).then(r => { settled = {r}; }, e => { settled = {e: String(e.message || e)}; });
    let seen = null;
    for (let i = 0; i < 300 && !settled; i++) {
      await sleep(500);
      const state = await dialogState().catch(e => ({error: String(e.message || e)}));
      const gone = await app.main(() => globalThis.__gone.splice(0)).catch(() => []);
      if (gone.length) { R.gone.push(...gone.map(g => ({label, ...g}))); log(label + ': process gone', gone); }
      if (state?.visible && !seen) { seen = state; log(label + ': review shown', state); }
    }
    const reviews = (await app.reviews()).slice(before);
    const result = settled || {timeout: true};
    const entries = result.r?.extensions || [];
    const step = {timeout: !!result.timeout, error: result.e || result.r?.error, cancelled: !!result.r?.cancelled, listed: entries.length, reviewShown: !!seen, answered: reviews.map(r => ({via: r.via || 'system-dialog-stub', message: r.message, answer: r.buttons?.[r.answer ?? 1]}))};
    log(label + ': result', step);
    if (result.timeout) R.failures.push(`${label}: no result in 150 s (review shown: ${!!seen}, answered: ${reviews.length})`);
    return step;
  }

  const folder = path.resolve('qa/extension-matrix/fixtures', FIXTURE);
  await app.main(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, folder);
  R.local = await throughReview('local fixture ' + FIXTURE, {type: 'load'});
  if (!NO_STORE) R.storeInstall = await throughReview('store ' + STORE, {type: 'install', extensionId: STORE});
  await sleep(1500);
  const late = await app.main(() => globalThis.__gone.splice(0)).catch(() => []);
  if (late.length) R.gone.push(...late);
  R.uiAlive = await app.ui.evaluate(() => !!window.acira?.getSnapshot).catch(e => String(e.message || e));
  log('ui alive', R.uiAlive);
} catch (error) {
  R.failures.push(String(error.stack || error));
  console.error(error);
} finally {
  try { if (R.crashDumps) R.dumps = await fs.readdir(path.join(R.crashDumps, 'reports')).catch(() => []); } catch {}
  if (app) await app.close();
  if (slot) try { unlinkSync(slot); } catch {}
  const pass = !R.failures.length && !R.gone.length && R.uiAlive === true && R.local?.listed > 0 && !R.local?.error && (NO_STORE || (!R.storeInstall?.error && R.storeInstall?.listed > 1));
  R.pass = pass;
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(R, null, 2));
  console.log(pass ? 'PASS' : 'FAIL', 'gone:', JSON.stringify(R.gone), 'console errors:', R.console.length, 'failures:', JSON.stringify(R.failures).slice(0, 400));
  console.log('result:', path.join(out, 'result.json'));
  process.exitCode = pass ? 0 : 1;
}
