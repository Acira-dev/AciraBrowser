// Shared helpers for the extension compatibility matrix. Everything runs on an isolated profile under .qa-profiles and installs through
// Acira's own install path (window.acira.extensions({type:'install'}) -> Chrome Web Store package, CRX3 verified, review dialog, load).
// The review is asked with the system message box when the window is hidden and with Acira's own question window when it is shown
// (D_VISIBLE=1); the harness answers either the way a person clicking "Add extension" would, and records its text.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from '../d-harness.mjs';
import {matrixProfile} from './run-context.mjs';
export {sleep};

export async function launch(name, {env = {}, fresh = true, args = []} = {}) {
  const root = await matrixProfile(name, fresh);
  const app = await startApp({root, env: {ACIRA_DEV: '0', ...env}, args});
  try {
  await app.main(({dialog}) => {
    globalThis.__reviews = [];
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1) || {};
      globalThis.__reviews.push({title: options.title, message: options.message, detail: options.detail, buttons: options.buttons});
      return {response: Array.isArray(options.buttons) && options.buttons.length === 2 ? 1 : 0, checkboxChecked: false};
    };
  });
  await app.main(answerAppDialogs);
  const state = await app.state();
  app.profileId = state.activeBrowserProfileId;
  app.ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId: app.profileId, ...request});
  app.reviews = () => app.main(() => globalThis.__reviews);
  return app;
  } catch (error) { await app.close(); throw error; }
}

/** Acira asks with its own question window (native-dialog.html) whenever the browser window is shown, so in a visible run
 *  (D_VISIBLE=1) the dialog.showMessageBox stub above is never consulted: the review waited for a click forever, and an outer
 *  timeout then killed the app mid-wait, which Playwright reports as "Target crashed" on the UI page. This answers that window
 *  the way the stub answers the system dialog (the second of two buttons, else the first) by clicking the button in the page,
 *  as a person would, and records the question in the same list. Passed to app.evaluate, so it runs in the main process and
 *  must stay self-contained (no module-scope references). */
export function answerAppDialogs({ipcMain}) {
  if (globalThis.__appDialogAnswerer) return;
  globalThis.__appDialogAnswerer = true;
  const script = `(() => {
    const asked = typeof state === 'object' && state;
    if (!asked || !Array.isArray(asked.buttons) || !asked.buttons.length) return null;
    const seen = window.__qaAnswered || (window.__qaAnswered = new WeakSet());
    if (seen.has(asked)) return null;
    seen.add(asked);
    const index = asked.buttons.length === 2 ? 1 : 0;
    const button = document.querySelector('#actions button[data-index="' + index + '"]');
    if (!button) return null;
    button.click();
    return {title: asked.kicker, message: asked.title, detail: asked.detail, buttons: asked.buttons, answer: index, via: 'acira-dialog'};
  })()`;
  ipcMain.on('acira:dialog-ready', event => {
    event.sender.executeJavaScript(script).then(review => { if (review) (globalThis.__reviews ||= []).push(review); }, () => {});
  });
}

export async function install(app, id) {
  const started = Date.now();
  const result = await app.ext({type: 'install', extensionId: id}).catch(error => ({error: String(error.message || error)}));
  const entry = (result.extensions || []).find(item => item.id === id);
  return {ms: Date.now() - started, error: result.error || (entry ? undefined : 'not listed after install'), cancelled: !!result.cancelled, entry};
}

/** The unpacked manifest of an installed extension, read from the profile's registry (the same copy Acira loads). */
export async function installedManifest(app, id) {
  const registry = JSON.parse(await fs.readFile(path.join(app.root, 'extensions.json'), 'utf8'));
  const saved = registry.entries.find(entry => entry.id === id);
  if (!saved) return null;
  const manifest = JSON.parse(await fs.readFile(path.join(saved.path, 'manifest.json'), 'utf8'));
  return {folder: saved.path, manifest};
}

/** What the manifest promises, in the terms the matrix reports. */
export function summarize(manifest) {
  const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || []).map(p => p + '?')];
  const scripts = manifest.content_scripts || [];
  return {
    manifestVersion: manifest.manifest_version,
    background: manifest.background?.service_worker ? 'service worker' : manifest.background?.scripts ? 'event page' : manifest.background?.page ? 'background page' : 'none',
    action: !!(manifest.action || manifest.browser_action),
    popup: (manifest.action || manifest.browser_action || {}).default_popup || null,
    options: manifest.options_ui?.page || manifest.options_page || null,
    contentScriptMatches: [...new Set(scripts.flatMap(script => script.matches || []))].slice(0, 12),
    contentScriptCount: scripts.length,
    mainWorldScripts: scripts.filter(script => script.world === 'MAIN').length,
    permissions,
    hostPermissions: [...(manifest.host_permissions || [])].slice(0, 12),
    nativeMessaging: permissions.includes('nativeMessaging') || permissions.includes('nativeMessaging?'),
    overrides: manifest.chrome_url_overrides || null,
    devtoolsPage: manifest.devtools_page || null,
    sidePanel: manifest.side_panel?.default_path || null,
    commands: Object.keys(manifest.commands || {}).length
  };
}
