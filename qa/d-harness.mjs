// Stream D harness: launches the real product main on a disposable profile and drives it with Playwright's Electron driver.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {launchPreparedNative} from './prepared-native.mjs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function poll(read, accept = Boolean, label = 'poll', timeout = 15000) {
  const end = Date.now() + timeout; let value;
  do { try { value = await read(); if (accept(value)) return value; } catch (e) { value = e.message; } await sleep(60); } while (Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

/** After setup is skipped or finished the browser arrives in a finale (setup light, the Acira mark drawing, the frost clearing); a press
 *  during it only skips it and is not passed on. The setup stage leaves about a second before the frost veil is added, so wait for the
 *  veil to come and then to go. Call it right after Skip / Escape / the last Continue and before the first click of a test. */
export async function finaleEnded(ui) {
  await poll(() => ui.evaluate(() => Boolean(document.querySelector('.fr-finale-veil, .fr-finale-mark'))), Boolean, 'finale started', 8000).catch(() => {});
  await poll(() => ui.evaluate(() => !document.querySelector('.fr-stage, .fr-finale-veil, .fr-finale-mark, .fr-ghost')), Boolean, 'setup finale ended', 20000).catch(() => {});
}

/** Launch the real product main on a disposable profile (under .qa-profiles). */
export async function startApp({root, args = [], env = {}, skipSetup = true, main = path.resolve(process.env.D_APP_MAIN || 'desktop/main.cjs')} = {}) {
  root = path.resolve(root || `.qa-profiles/d-${Date.now()}`);
  if (!root.startsWith(path.resolve('.qa-profiles') + path.sep)) throw new Error('profile must be under .qa-profiles');
  await fs.mkdir(root, {recursive: true});
  const e = {...process.env, APPDATA: path.join(root, 'fixture-roaming'), LOCALAPPDATA: path.join(root, 'fixture-local'), ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ...(process.env.D_VISIBLE ? {} : {ACIRA_BROWSER_TEST_HIDDEN: '1'}), ...env};
  await fs.mkdir(e.APPDATA, {recursive: true}); await fs.mkdir(e.LOCALAPPDATA, {recursive: true});
  // D_APP_EXE=<path to AciraBrowser.exe> runs the same QA against a packaged build (its app is inside the exe's resources folder, so no main path is passed).
  const packaged = process.env.D_APP_EXE ? path.resolve(process.env.D_APP_EXE) : null;
  const app = await launchPreparedNative({args: packaged ? [...args] : [path.resolve(main), ...args], ...(packaged ? {executablePath: packaged} : {}), env: e, timeout: 40000});
  try {
  const logs = []; try { app.process().stderr?.on('data', d => logs.push(String(d))); app.process().stdout?.on('data', d => logs.push(String(d))); } catch {}
  const context = app.context();
  const ui = await poll(async () => { for (const p of context.pages()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'ui page', 30000);
  await poll(() => ui.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'window.acira', 30000);
  // A fresh profile shows first-run setup, which hides every website view; real users skip or finish it.
  // Skipping plays the browser's arrival (the finale: setup light, the Acira mark drawing, the frost clearing). A press during
  // that moment only skips it and is not passed on, so the first click of a test would be lost: wait until it has ended.
  if (skipSetup) {
    let skipped = false;
    try { const skip = ui.getByRole('button', {name: 'Skip setup'}); await skip.waitFor({timeout: 5000}); await skip.click(); skipped = true; await sleep(600); } catch {}
    if (skipped) await finaleEnded(ui);
  }
  const api = {
    root, app, context, ui, logs,
    act: a => ui.evaluate(a => window.acira.dispatch(a), a),
    state: () => ui.evaluate(() => window.acira.getSnapshot()),
    svc: r => ui.evaluate(r => window.acira.service(r), r),
    cmd: c => ui.evaluate(c => window.acira.browserCommand(c), c),
    main: (fn, arg) => app.evaluate(fn, arg),
    web: match => context.pages().find(p => { try { return typeof match === 'function' ? match(p.url()) : p.url().startsWith(match); } catch { return false; } }),
    waitWeb: (match, label) => poll(() => api.web(match), Boolean, label || `web ${match}`, 20000),
    async close() { try { await app.close(); } catch {} },
  };
  return api;
  } catch (error) {
    try { await app.close(); } catch {}
    throw error;
  }
}

/** Self-signed local HTTPS fixture. Returns {port, close, server}. */
export async function httpsFixture(root, handler, {cn = 'localhost', san = 'DNS:localhost,IP:127.0.0.1'} = {}) {
  const dir = path.join(root, 'tls-' + Math.random().toString(36).slice(2)); await fs.mkdir(dir, {recursive: true});
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : '/usr/bin/openssl';
  await promisify(execFile)(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-nodes', '-subj', '/CN=' + cn, '-addext', 'subjectAltName=' + san]);
  const server = https.createServer({key: await fs.readFile(path.join(dir, 'k.pem')), cert: await fs.readFile(path.join(dir, 'c.pem'))}, handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {port: server.address().port, close: () => new Promise(r => server.close(r)), server};
}
export async function httpFixture(handler) {
  const server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {port: server.address().port, close: () => new Promise(r => server.close(r)), server};
}
