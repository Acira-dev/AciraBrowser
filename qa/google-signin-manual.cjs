'use strict';
// Manual account acceptance: no Playwright, CDP, input automation, request logging,
// cookie inspection or credential access. Launch with the local Electron binary.
// Reuse ACIRA_SIGNIN_TEST_PROFILE for the restart/persistence part of the test.
const fs = require('node:fs'), path = require('node:path');
const { app, BaseWindow } = require('electron');
const repo = path.resolve(__dirname, '..');
const qaRoot = path.join(repo, '.qa-profiles');
const profile = path.resolve(process.env.ACIRA_SIGNIN_TEST_PROFILE || path.join(qaRoot, 'google-signin-manual-' + Date.now()));
if (!profile.startsWith(qaRoot + path.sep) || profile === qaRoot) throw Error('Use an isolated profile below .qa-profiles.');
for (let at = profile; at.startsWith(qaRoot); at = path.dirname(at)) {
  if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) throw Error('The manual test profile must not be a symbolic link.');
}
if (process.argv.some(arg => /^--(?:enable-automation|remote-debugging|inspect|headless|no-sandbox|ignore-certificate-errors)/.test(arg))) throw Error('The manual sign-in test must run without automation or security-bypass flags.');
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
process.env.ACIRA_BROWSER_TEST_DATA = profile;
process.env.ACIRA_TEST_QUIET_NETWORK = '1';
delete process.env.ACIRA_BROWSER_TEST_HIDDEN;
delete process.env.ACIRA_QA_RUN; // a person signs in here by hand: Google and YouTube must stay reachable
delete process.env.ACIRA_DEV;
delete process.env.ACIRA_KEEP_ELECTRON_UA;
const output = path.join(profile, 'manual-signin-status.json');
const command = path.join(profile, 'manual-signin-action.json');
if (fs.existsSync(command)) fs.unlinkSync(command);
const state = { schema: 1, startedAt: new Date().toISOString(), pid: process.pid, profile, manualAccountStepRequired: true, automationAttached: false, googleRejected: false, youtubeSignedIn: false, observations: [] };
const save = () => {
  const pending = output + '.tmp';
  fs.writeFileSync(pending, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(pending, output);
};
let checking = false;
const observed = new Set();
function watch(wc) {
  observed.add(wc);
  wc.once('destroyed', () => observed.delete(wc));
  wc.on('did-finish-load', () => { void inspect(); });
}
async function inspect() {
  if (checking) return;
  checking = true;
  try {
    for (const wc of observed) {
      if (wc.isDestroyed()) continue;
      let url; try { url = new URL(wc.getURL()); } catch { continue; }
      if (url.protocol !== 'https:') continue;
      if (url.hostname === 'accounts.google.com') {
        // Only a stage label is retained, never the URL/query, inputs or page text.
        const rejected = /\/(?:v\d+\/)?signin\/rejected(?:\/|$)/.test(url.pathname);
        state.googleRejected ||= rejected;
        state.lastGoogleStage = rejected ? 'rejected' : /challenge/.test(url.pathname) ? 'challenge' : 'sign-in';
      }
      if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
        const result = await wc.executeJavaScript(`(() => {
          const avatar = document.querySelector('ytd-masthead #avatar-btn');
          const rect = avatar?.getBoundingClientRect();
          return {
            loggedInConfiguration: window.ytcfg?.get?.('LOGGED_IN') === true,
            avatarVisible: Boolean(avatar && rect && rect.width > 0 && rect.height > 0),
            webdriver: navigator.webdriver,
            nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined'
          };
        })()`).catch(() => null);
        if (result) {
          state.youtube = result;
          state.youtubeSignedIn = result.loggedInConfiguration && result.avatarVisible;
          state.manualAccountStepRequired = !state.youtubeSignedIn;
        }
      }
    }
    state.checkedAt = new Date().toISOString();
    save();
  } finally { checking = false; }
}
app.on('web-contents-created', (_event, wc) => watch(wc));
app.on('before-quit', () => { state.normalQuitRequestedAt = new Date().toISOString(); save(); });
app.on('will-quit', () => { state.normalQuitCompletedAt = new Date().toISOString(); save(); });
process.argv.push('https://www.youtube.com/');
save();
require('../desktop/main.cjs');
app.whenReady().then(() => {
  const title = setInterval(() => {
    const windows = BaseWindow.getAllWindows();
    if (!windows.length) return;
    for (const win of windows) if (!win.isDestroyed()) win.setTitle('Acira — Google sign-in test');
    clearInterval(title);
  }, 500);
  title.unref();
  const timer = setInterval(() => {
    void inspect();
    if (!fs.existsSync(command)) return;
    let action;
    try {
      if (fs.statSync(command).size > 128) return;
      action = JSON.parse(fs.readFileSync(command, 'utf8')).action;
    } catch { return; }
    fs.unlinkSync(command);
    if (action === 'quit') app.quit();
    if (action === 'reload-youtube') for (const wc of observed) {
      if (!wc.isDestroyed() && /^https:\/\/(?:www\.)?youtube\.com\//.test(wc.getURL())) wc.reload();
    }
  }, 3000);
  timer.unref();
});
console.log(JSON.stringify({ profile, statusFile: output, manualAccountStepRequired: true }));
