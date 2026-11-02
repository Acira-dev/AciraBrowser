// Shared helpers for the R3-44 feature-proof probes (qa/r3-feature-proof.mjs runs them; each also runs on its own: node qa/r3-proof/<name>.mjs).
//  - one native slot (C:\ae\slot-N.lock) held while the app runs, released in finally
//  - a plain checks list written to $PROOF_RESULT (or <evidence>/result.json) so the suite can build the pass/fail table
//  - real-pixel captures of the popup overlay and the window
// Never calls the real Windows Hello / PIN prompt: the vault's explicit test substitute is switched on for every probe.
import fs from 'node:fs';
import path from 'node:path';

process.env.ACIRA_PASSWORDS_TEST_GATE = 'allow'; // only honoured by an unpackaged run inside an isolated test profile (desktop/passwords/gate.cjs)

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** A capture of a heavy page can stall: never wait more than this for pixels. */
const within = (promise, ms = 10000) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(''), ms))]);

export async function withSlot(name, fn) {
  if (process.env.PROOF_SLOT_HELD === '1') return fn(); // the suite already holds a slot for this process
  const until = Date.now() + 20 * 60 * 1000; let held = null;
  fs.mkdirSync('C:\\ae', {recursive: true});
  while (!held && Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `${name} ${new Date().toISOString()}`); fs.closeSync(fd); held = file; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!held) await sleep(30000);
  }
  if (!held) throw new Error('No native slot became free in 20 minutes.');
  try { return await fn(); } finally { try { fs.unlinkSync(held); } catch {} }
}

/** Collects PASS/FAIL checks for one probe. `evidence` is the folder PNGs and logs go to. */
export function probe(name) {
  const evidence = path.resolve(process.env.PROOF_EVIDENCE || `C:/ae/r3/proof/evidence/${name}`);
  fs.mkdirSync(evidence, {recursive: true});
  const checks = [], files = [];
  const state = {summary: []};
  const check = (label, ok, detail = '', file) => {
    const entry = {name: label, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 600)};
    if (file) { entry.evidence = file; files.push(file); }
    checks.push(entry);
    console.log((entry.ok ? 'PASS ' : 'FAIL ') + label + (entry.detail ? ' :: ' + entry.detail : ''));
    return entry.ok;
  };
  const note = text => { state.summary.push(text); console.log('NOTE ' + text); };
  const finish = (extra = {}) => {
    const failed = checks.filter(c => !c.ok);
    const result = {name, ok: failed.length === 0 && checks.length > 0, passed: checks.length - failed.length, total: checks.length, checks, summary: state.summary, evidence, files, ...extra};
    fs.writeFileSync(process.env.PROOF_RESULT || path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    console.log(`\n${result.passed}/${result.total} passed`);
    return result;
  };
  return {name, evidence, checks, check, note, finish, shot: file => path.join(evidence, file)};
}

/** The popup overlay's own pixels (the protection popup, menus ...). */
export async function captureOverlay(app, file) {
  const data = await within(app.main(async ({webContents}) => {
    const view = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay'));
    if (!view) return '';
    return (await view.capturePage()).toPNG().toString('base64');
  })).catch(() => '');
  if (!data) return null;
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

/** The whole window as the screen shows it (needs a visible window: set D_VISIBLE=1). Falls back to the interface page. */
export async function captureWindow(app, file) {
  const data = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows().find(w => w.isVisible());
    if (!win) return '';
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale)}});
    const source = sources.find(item => item.id === win.getMediaSourceId());
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : '';
  }).catch(() => '');
  if (data) { fs.writeFileSync(file, Buffer.from(data, 'base64')); return file; }
  try { await app.ui.screenshot({path: file}); return file; } catch { return null; }
}

/** Capture the website view of a tab (the page pixels); `needle` is any part of the page address. */
export async function capturePage(app, needle, file) {
  const data = await within(app.main(async ({webContents}, needle) => {
    const view = webContents.getAllWebContents().find(w => { try { return /^https?:/.test(w.getURL()) && w.getURL().includes(needle); } catch { return false; } });
    if (!view) return '';
    return (await view.capturePage()).toPNG().toString('base64');
  }, needle)).catch(() => '');
  if (!data) return null;
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

/** The toolbar's Ads-and-trackers button is optional in the toolbar: switch it on (the same storage key the Customize toolbar panel writes). */
export async function showProtectionButton(app) {
  const profileId = (await app.state()).activeBrowserProfileId;
  await app.ui.evaluate(profile => { localStorage.setItem('acira-toolbar-items:' + profile, JSON.stringify([{id: 'protection', visible: true}, {id: 'vpn', visible: false}, {id: 'extensions', visible: false}, {id: 'profile', visible: true}, {id: 'focus', visible: true}])); window.dispatchEvent(new Event('acira-toolbar-items')); }, profileId);
  await sleep(400);
}
