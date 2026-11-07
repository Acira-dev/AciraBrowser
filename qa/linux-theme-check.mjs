#!/usr/bin/env node
// Match my system theme: what a real Linux desktop says, and what Acira does with it. No dependencies (Node 22 or newer).
//
//   node qa/linux-theme-check.mjs --app ~/.local/share/acira-browser/AciraBrowser.AppImage [--watch 120] [--arg=--no-sandbox]
//   node qa/linux-theme-check.mjs --electron node_modules/electron/dist/electron --main desktop/main.cjs      (a source checkout)
//
// It starts Acira on a THROWAWAY profile (never your own), asks the interface what the desktop gave it, switches "Match my system
// theme" on through the same action the Settings switch sends, and reads back the colours the interface paints with. With --watch it
// then prints a line whenever the desktop's light/dark or accent changes, so you can flip them by hand or with the commands in
// docs/launch/LINUX_THEME_CHECKS.md. Exit code 1 when a check fails. The steps and what to expect per desktop are in that file.
//
// For pictures and tests on a machine that is not Linux, ACIRA_SIMULATE_SYSTEM_THEME='{"dark":true,"accent":"#9141ac"}' makes a
// pretend desktop (honoured only on a throwaway profile, which this script always uses).
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => { const i = args.findIndex(a => a === name || a.startsWith(name + '=')); if (i < 0) return undefined; return args[i].includes('=') ? args[i].slice(name.length + 1) : args[i + 1]; };
const flag = name => args.includes(name);
const extra = args.filter(a => a.startsWith('--arg=')).map(a => a.slice(6));
const app = option('--app'), electron = option('--electron'), main = option('--main');
const watchSeconds = Number(option('--watch') || 0);
if (!app && !(electron && main)) { console.error('Give --app <AciraBrowser.AppImage>, or --electron <binary> --main <desktop/main.cjs>.'); process.exit(2); }
if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node 22 or newer is needed (global WebSocket).'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (ok, text, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}${detail ? '  ' + detail : ''}`); };
const info = (text) => console.log(`INFO  ${text}`);

// --- what the desktop itself says (outside Acira) ------------------------------------------------------------------------------
function run(file, argv) { try { const r = spawnSync(file, argv, {encoding: 'utf8', timeout: 4000}); return r.status === 0 ? r.stdout.trim() : ''; } catch { return ''; } }
function desktopFacts() {
  const env = process.env;
  info(`desktop: XDG_CURRENT_DESKTOP=${env.XDG_CURRENT_DESKTOP || '-'}  session=${env.XDG_SESSION_TYPE || '-'}  WAYLAND_DISPLAY=${env.WAYLAND_DISPLAY || '-'}  DISPLAY=${env.DISPLAY || '-'}`);
  if (process.platform !== 'linux') { info('not Linux: portal and desktop settings are not read (only useful with a simulated feed)'); return; }
  const portal = key => run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.portal.Settings.ReadOne', 'org.freedesktop.appearance', key]);
  info(`portal color-scheme: ${portal('color-scheme') || '(no answer: no portal, or no gdbus)'}   [(<uint32 1>,) dark, 2 light, 0 none]`);
  info(`portal accent-color: ${portal('accent-color') || '(no answer: the desktop offers no accent through the portal)'}   [(<(r, g, b)>,) with 0..1 values]`);
  const gs = key => run('gsettings', ['get', 'org.gnome.desktop.interface', key]);
  if (gs('color-scheme')) info(`gsettings color-scheme: ${gs('color-scheme')}   accent-color: ${gs('accent-color') || '(none: GNOME before 47)'}   gtk-theme: ${gs('gtk-theme')}`);
  const kde = path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kdeglobals');
  if (fs.existsSync(kde)) {
    const text = fs.readFileSync(kde, 'utf8'), pick = re => (re.exec(text) || [])[1] || '-';
    info(`kdeglobals: ColorScheme=${pick(/^ColorScheme=(.*)$/m)}  AccentColor=${pick(/^AccentColor=(.*)$/m)}  View.DecorationFocus=${pick(/^\[Colors:View\][^[]*?^DecorationFocus=(.*)$/ms)}`);
  }
}

// --- start Acira on a throwaway profile -------------------------------------------------------------------------------------------
const profile = path.resolve(option('--profile') || fs.mkdtempSync(path.join(os.tmpdir(), 'acira-linux-theme-')));
if (/[\\/]\.config[\\/]|Application Support|AppData/i.test(profile) && !flag('--i-know-this-is-a-throwaway-folder')) { console.error('That looks like a real profile folder. Use an empty temporary folder.'); process.exit(2); }
fs.mkdirSync(profile, {recursive: true});
const port = 9400 + Math.floor(Math.random() * 400);
const env = {...process.env, ACIRA_BROWSER_TEST_DATA: profile, ACIRA_QA_RUN: '1', ACIRA_TEST_QUIET_NETWORK: '1', ...(flag('--hidden') ? {ACIRA_BROWSER_TEST_HIDDEN: '1'} : {})};
delete env.ELECTRON_RUN_AS_NODE;
const launchArgs = [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), `--remote-debugging-port=${port}`, ...extra];
const child = app ? spawn(path.resolve(app), launchArgs, {env, stdio: ['ignore', 'pipe', 'pipe']}) : spawn(path.resolve(electron), [...launchArgs, path.resolve(main)], {env, stdio: ['ignore', 'pipe', 'pipe']});
const logs = []; child.stdout.on('data', d => logs.push(String(d))); child.stderr.on('data', d => logs.push(String(d)));
let finished = false;
async function finish(code) {
  if (finished) return; finished = true;
  try { child.kill('SIGTERM'); await sleep(1200); if (child.exitCode === null) child.kill('SIGKILL'); } catch {}
  if (!option('--profile') && !flag('--keep')) { try { fs.rmSync(profile, {recursive: true, force: true}); } catch {} }
  process.exit(code);
}
process.on('SIGINT', () => finish(130)); process.on('exit', () => { try { child.kill('SIGKILL'); } catch {} });
setTimeout(() => { console.error('Timed out.\n' + logs.join('').slice(-1500)); finish(2); }, (watchSeconds + 150) * 1000).unref();

async function interfacePage() {
  for (let i = 0; i < 120; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = list.find(p => p.url === 'acira-browser-ui://ui/index.html'); if (page) return page; } catch {}
    await sleep(500);
  }
  throw new Error('The interface page never appeared.\n' + logs.join('').slice(-1500));
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), pending = new Map(); let id = 0;
    ws.onmessage = event => { const m = JSON.parse(event.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
    ws.onerror = () => reject(new Error('CDP connection failed'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: n, method, params})); }),
      eval: async expression => { for (let attempt = 0; ; attempt++) { try { return await once(expression); } catch (error) { if (attempt >= 6 || !/context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error; await sleep(700); } } },
      close: () => ws.close(),
    });
    const once = async expression => { const n = ++id; const r = await new Promise((res, rej) => { pending.set(n, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: n, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}})); }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
  });
}
const READ = `(() => { const a = document.querySelector('.app'), cs = a && getComputedStyle(a); return { desktop: window.acira.systemTheme(), media: matchMedia('(prefers-color-scheme: dark)').matches, appearance: a && a.dataset.appearance, accent: cs && cs.getPropertyValue('--accent').trim(), toggle: cs && cs.getPropertyValue('--toggle-on').trim(), frame: cs && cs.getPropertyValue('--ed-chrome').trim() }; })()`;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

try {
  desktopFacts();
  const page = await interfacePage(), cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.eval(`new Promise(r => { const t = setInterval(() => { if (window.acira && window.acira.getSnapshot) { clearInterval(t); r(true); } }, 200); })`);
  await sleep(1500);
  // A fresh profile starts with first-run setup, which paints its own light or dark over everything. Skip it the way a person does.
  let where = null;
  for (let i = 0; i < 25 && !where; i++) { where = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => /skip setup/i.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`); if (!where) await sleep(400); }
  info(where ? 'first-run setup skipped' : 'no first-run setup on screen');
  if (where) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', {type, x: where.x, y: where.y, button: 'left', clickCount: 1});
    const t0 = Date.now(); let started = false;
    while (Date.now() - t0 < 30000) {
      const now = await cdp.eval(`({finale: Boolean(document.querySelector('.fr-finale-veil, .fr-finale-mark')), stage: Boolean(document.querySelector('.fr-stage, .fr-finale-veil, .fr-finale-mark, .fr-ghost'))})`);
      if (now.finale) started = true;
      if (!now.stage && (started || Date.now() - t0 > 6000)) break;
      await sleep(400);
    }
    await sleep(800);
  }
  const snap = () => cdp.eval(`window.acira.getSnapshot().then(s => ({ appearance: s.settings.appearance, systemTheme: s.settings.systemTheme }))`);
  // A light/dark switch needs the window to draw (the browser tells a page about a media-query change while it renders). A window that
  // draws nothing (hidden, minimised, behind a locked screen) shows the old mode until it does; that is reported, not failed.
  let stalled = false;
  const settle = async until => {
    if (!until) { await sleep(1500); return true; }
    for (let i = 0; i < 20; i++) { await sleep(400); if (await until()) { await sleep(400); return true; } }
    stalled = true; return false;
  };
  const read = async () => ({...(await cdp.eval(READ)), saved: await snap()});

  // 1. what Acira was given
  let r = await read();
  const d = r.desktop;
  info(`Acira was given: ${JSON.stringify(d)}`);
  check(Boolean(d) && d.supported === (process.platform === 'linux' || Boolean(process.env.ACIRA_SIMULATE_SYSTEM_THEME)), 'the interface knows whether the desktop gives a theme (supported only on Linux)');
  if (!d || !d.supported) { console.log('Nothing more to check on this platform.'); await finish(results.every(Boolean) ? 0 : 1); }
  info(d.accent ? `accent from the desktop: ${d.accent} (source: ${d.accentSource})` : 'the desktop gave no accent: Acira must keep its own');

  // 2. with the option off, nothing is different
  await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{onboardingComplete:true,systemTheme:false,appearance:'dark'}})`); await settle();
  const off = await read();
  // 3. switch it on the way the Settings switch does (Appearance becomes Auto)
  await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:true,appearance:'system'}})`); await settle(async () => (await read()).appearance === (d.dark ? 'dark' : 'light'));
  r = await read();
  check(r.saved.systemTheme === true && r.saved.appearance === 'system', 'turning it on saves the switch and sets Appearance to Auto');
  check(r.media === d.dark, 'light/dark follows the desktop', `desktop dark=${d.dark}, interface dark=${r.media}`);
  (stalled && r.appearance !== (d.dark ? 'dark' : 'light') ? info : check.bind(null, r.appearance === (d.dark ? 'dark' : 'light')))('the interface paints in that mode' + (stalled ? ' (skipped: this window is not drawing, so the switch never finished)' : ''), `data-appearance=${r.appearance}`);
  check(same(r.frame, off.frame) || off.media !== r.media, 'the frame colour is the finish\'s own', `${off.frame} -> ${r.frame}${off.media !== r.media ? ' (mode changed too)' : ''}`);
  if (d.accent) {
    // compare with the same mode, option off
    await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:false,appearance:'system'}})`); await settle();
    const plain = await read();
    await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:true}})`); await settle();
    r = await read();
    check(!same(r.accent, plain.accent), 'the accent follows the desktop', `${plain.accent} -> ${r.accent} (desktop ${d.accent})`);
    check(same(r.frame, plain.frame), 'the frame is unchanged by the accent', `${plain.frame} -> ${r.frame}`);
    check(!same(r.toggle, plain.toggle), 'the switch colour follows the accent', `${plain.toggle} -> ${r.toggle}`);
  } else {
    await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:false,appearance:'system'}})`); await settle();
    const plain = await read();
    await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:true}})`); await settle();
    r = await read();
    check(same(r.accent, plain.accent) && same(r.toggle, plain.toggle), 'no desktop accent: Acira keeps its own colours', `${plain.accent} / ${r.accent}`);
  }
  // 4. Light or Dark chosen by hand ends the matching
  await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{appearance:'${d.dark ? 'light' : 'dark'}'}})`); await settle();
  r = await read();
  check(r.media === !d.dark && r.appearance === (d.dark ? 'light' : 'dark'), 'choosing the other of Light/Dark wins over the desktop', `interface=${r.appearance}`);
  await cdp.eval(`window.acira.dispatch({type:'settings.update',patch:{systemTheme:true,appearance:'system'}})`); await settle();

  // 5. watch the desktop change
  if (watchSeconds > 0) {
    info(`Watching for ${watchSeconds}s. Change the desktop's light/dark or accent now (commands in docs/launch/LINUX_THEME_CHECKS.md).`);
    let last = '', changes = 0; const t0 = Date.now();
    while (Date.now() - t0 < watchSeconds * 1000) {
      const now = await read(), line = JSON.stringify({dark: now.desktop.dark, accent: now.desktop.accent, source: now.desktop.accentSource, interfaceDark: now.media, uiAccent: now.accent});
      if (line !== last) { if (last) { changes++; console.log(`CHANGE ${((Date.now() - t0) / 1000).toFixed(1)}s  ${line}`); } else info(`start ${line}`); last = line; }
      await sleep(400);
    }
    info(`${changes} change(s) seen. Each should show the interface following the desktop within about a second.`);
  }
  cdp.close();
  await finish(results.every(Boolean) ? 0 : 1);
} catch (error) {
  console.error('FAIL  ' + error.message);
  await finish(1);
}
