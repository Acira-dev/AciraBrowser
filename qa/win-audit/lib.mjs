// Window-views audit helper (qa/win-audit): launches the product main on a disposable profile under .qa-profiles, keeps the main window
// on screen at about 2% opacity with mouse events off (it never takes focus or input), and gives helpers for geometry, frames and
// a short full-opacity recording of that one window (screencapture -v -l <window id>, never the screen). Frames and shots go to
// WIN_AUDIT_OUT (default: the OS temp folder). Run from the repository root: node qa/win-audit/<rig>.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startApp, poll, sleep, httpFixture} from '../d-harness.mjs';
export {poll, sleep, httpFixture};
export const OUT = process.env.WIN_AUDIT_OUT || path.join(os.tmpdir(), 'acira-win-audit');
await fs.mkdir(OUT, {recursive: true});

const UI = 'acira-browser-ui://ui/index.html';
export async function launch({name = 'w' + Date.now(), env = {}, offscreen = true, width = 1200, height = 700, settings = {}, ui = {}} = {}) {
  const root = path.resolve('.qa-profiles/' + name);
  const app = await startApp({root, skipSetup: true, main: path.resolve('qa/mac-window-controls-entry.cjs'), env: {ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1', ...env}});
  app.errors = [];
  const listen = p => { p.on('pageerror', e => app.errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') app.errors.push('console: ' + m.text()); }); };
  app.context.pages().forEach(listen); app.context.on('page', listen);
  if (offscreen) await app.main(({BaseWindow}, a) => { const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === a.UI)); w.setOpacity(0.02); w.setIgnoreMouseEvents(true); w.setBounds({x: 20, y: 60, width: a.width, height: a.height}); w.showInactive(); }, {UI, width, height});
  if (Object.keys(settings).length) await app.act({type: 'settings.update', patch: settings});
  if (Object.keys(ui).length) await app.act({type: 'ui.update', patch: ui});
  app.win = (fn, arg) => app.main(({BaseWindow}, a) => { const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === a.UI)); return a.fn ? (new Function('w', 'arg', 'return (' + a.fn + ')(w,arg)'))(w, a.arg) : null; }, {UI, fn: String(fn), arg});
  app.shot = async (file) => { const b64 = await app.main(async ({webContents}, a) => (await webContents.getAllWebContents().find(w => w.getURL() === a.UI).capturePage()).toPNG().toString('base64'), {UI}); await fs.writeFile(path.join(OUT, file + '.png'), Buffer.from(b64, 'base64')); return path.join(OUT, file + '.png'); };
  app.buttons = () => app.win(w => JSON.parse(global.__aciraWindowButtons(w.getNativeWindowHandle())));
  return app;
}

import {spawn, execFileSync} from 'node:child_process';
/** Window bounds used by the audit: inside any work area so macOS never clamps them. */
export const place = (app, b = {x: 20, y: 60, width: 1200, height: 700}) => app.win((w, b) => { w.setBounds(b); }, b);
/** Make the test window visible at full strength for `fn`, recording it with screencapture -v; back to a faint ghost after. */
export async function record(app, name, seconds, fn, {lead = 700} = {}) {
  const wid = (await app.win(w => w.getMediaSourceId())).split(':')[1], file = path.join(OUT, name + '.mov');
  await fs.rm(file, {force: true});
  await app.win(w => { w.setOpacity(1); });
  await sleep(250);
  const rec = spawn('screencapture', ['-x', '-v', '-V', String(seconds), '-l', wid, file], {stdio: 'ignore'});
  const done = new Promise(r => rec.on('exit', r));
  await sleep(lead);
  const t0 = Date.now();
  const result = await fn();
  await done;
  await app.win(w => { w.setOpacity(0.02); });
  return {file, result, t0};
}
export const ghost = app => app.win(w => { w.setOpacity(0.02); w.setIgnoreMouseEvents(true); });
export const solid = app => app.win(w => { w.setOpacity(1); });
export async function magentaPage(port) { return 'http://127.0.0.1:' + port + '/'; }

/** Main-process probe: every layout the renderer sends (acira:set-layout) and the page views' real bounds each ~4 ms, stamped with Date.now(). */
export async function startProbe(app) {
  await app.main(({ipcMain, BaseWindow}, a) => {
    global.__probe?.stop?.();
    const log = [], seen = new Map();
    const onLayout = (_e, l) => log.push({t: Date.now(), k: 'layout', page: l?.pageBounds, radius: l?.pageRadius, caption: l?.captionHeight, edge: l?.edge, motion: l?.pageMotion ?? l?.motion, views: (l?.views || []).map(v => ({id: v.id, b: v.bounds, visible: v.visible}))});
    ipcMain.on('acira:set-layout', onLayout);
    const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === a.UI));
    const timer = setInterval(() => {
      for (const v of w.contentView.children) { const u = v.webContents?.getURL(); if (!u || u === a.UI) continue; const b = v.getBounds(), key = JSON.stringify([b, v.getVisible?.()]); if (seen.get(v) !== key) { seen.set(v, key); log.push({t: Date.now(), k: 'view', url: u.slice(0, 40), b, visible: v.getVisible?.()}); } }
    }, 4);
    global.__probe = {log, stop() { clearInterval(timer); ipcMain.removeListener('acira:set-layout', onLayout); }};
  }, {UI: 'acira-browser-ui://ui/index.html'});
}
export async function stopProbe(app) { return app.main(() => { const p = global.__probe; if (!p) return []; p.stop(); const log = p.log; global.__probe = null; return log; }); }
