// Shared pieces for the P4 real-app rigs (permissions / management on a store extension in an isolated profile).
//   - launchIsolated(name): the real product on a disposable profile under .qa-profiles (ACIRA_BROWSER_TEST_DATA via d-harness startApp),
//     the system message box stubbed the way a person clicking the second button (Add / Allow / Remove) would answer, and every question recorded.
//   - extension pages are opened in a HIDDEN window of the profile's session and driven with executeJavaScript(…, userGesture = true), which
//     gives the page a real transient user activation without touching the person's mouse or keyboard.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
import {answerAppDialogs, install, installedManifest} from './extension-matrix/lib.mjs';

export {sleep, installedManifest};

/** Installs from the store through Acira's own path; a dropped connection (net::ERR_NETWORK_CHANGED …) is retried up to three times. */
export async function installWithRetry(app, id) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await install(app, id);
    if (!last.error || !/net::|network|timed? ?out|ECONN|ENOTFOUND/i.test(String(last.error))) return last;
    await sleep(3000);
  }
  return last;
}
export {install};

export async function launchIsolated(name, {fresh = true, args = [], env = {}} = {}) {
  const root = path.resolve('.qa-profiles', name);
  if (fresh) { try { await fs.access(root); throw new Error('profile folder exists: ' + root); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const app = await startApp({root, args, env: {ACIRA_DEV: '0', ...env}});
  try {
    await app.main(({dialog}) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1) || {};
        globalThis.__asked.push({title: options.title, message: options.message, detail: options.detail, buttons: options.buttons});
        // Two buttons: [Cancel, Add / Allow / Remove] -> the second, like a person agreeing. One button: OK.
        return {response: globalThis.__answer ?? (Array.isArray(options.buttons) && options.buttons.length === 2 ? 1 : 0), checkboxChecked: false};
      };
    });
    await app.main(answerAppDialogs);
    app.profileId = (await app.state()).activeBrowserProfileId;
    app.ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId: app.profileId, ...request});
    app.asked = () => app.main(() => globalThis.__asked);
    app.answer = value => app.main((_, v) => { globalThis.__answer = v; }, value);
    app.partition = async () => (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
    return app;
  } catch (error) { await app.close(); throw error; }
}

/** Opens chrome-extension://<id>/<page> in a hidden window of the profile and returns helpers to run code in it (with a user gesture). */
export async function openExtensionPage(app, id, page, key = page) {
  const partition = await app.partition();
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 560, height: 760, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    (globalThis.__p4pages ||= {})[args.key] = w;
    return w.loadURL(args.url);
  }, {partition, key, url: `chrome-extension://${id}/${page}`});
  // The expression runs inside an async try/catch, so a rejection or throw comes back as its message (Electron only says 'Script failed to execute').
  const run = async (code, gesture = true) => {
    const wrapped = '(async () => { try { const value = await (' + code + '); return {value: value === undefined ? null : JSON.parse(JSON.stringify(value))}; } catch (error) { return {error: String(error && error.message || error)}; } })()';
    const answer = await app.main((_, args) => globalThis.__p4pages[args.key].webContents.executeJavaScript(args.code, args.gesture), {key, code: wrapped, gesture});
    if (answer.error !== undefined) throw new Error(answer.error);
    return answer.value;
  };
  return {run, close: () => app.main((_, k) => { try { globalThis.__p4pages[k].destroy(); } catch {} }, key)};
}
