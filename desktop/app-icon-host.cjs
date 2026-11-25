'use strict';
// The app icon in the main process builds the service of browser-services/app-icon.cjs and the per-platform applier of app-icon-apply.cjs once, on first use, from Electron's own pieces, and answers the
// two requests the Settings row sends. main.cjs holds a few lines: `appIconHost().startupIcon()` where a window is made, `.start()` when the update check may start, `.handle(request)` in the service switch.
//   LIVE   Only a packaged app asks the server and changes anything. A development run does nothing at all (no timer, no session, no request); a test profile that names ACIRA_APPICON_URL (plain http on 127.0.0.1) drives the same path.
//   ROUTE  The two GETs leave through the update check's own session and route (user agent "AciraUpdater", no cookie, no Referer) like the billboard's, so a profile's proxy or an extension's route is followed and nothing new is learned
//          by anyone about the person.
//   SWITCH "Seasonal app icon" is the person's: on by default, kept in the icon folder, and it covers every run of every profile (an icon belongs to the app, not to a profile).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const icon = require('./browser-services/app-icon.cjs');
const { createIconApplier } = require('./browser-services/app-icon-apply.cjs');

/** The picture a window made now should wear, for the few modules that make a window and cannot reach main's own function (the extension popup window): set by the host, null until it knows one. */
let latest = null;
const currentIcon = () => latest;

/**
 * app: Electron's app. electron: {BaseWindow, nativeImage, shell, session}. dist: the folder of the interface build (app-icon.png, brand/). version: the running version. route(): awaits the update check's route.
 * following(): true | false | null (the Insider feed is followed right now). toast(id): says the one quiet line. ownWindow(window): false for an installed web app's window. schedule: for tests.
 */
function createAppIconHost({ app, electron, dist, version, platform = process.platform, env = process.env, route = async () => {}, userAgent = 'AciraUpdater', following = () => null, toast = () => {}, ownWindow = () => true, warn = () => {}, io = fs, schedule = undefined } = {}) {
  const directory = path.join(app.getPath('userData'), 'app-icon'), setting = icon.createSetting({ directory, io, warn });
  const standardWindowFile = path.join(dist, 'app-icon.png');
  const testRun = Boolean(env.ACIRA_BROWSER_TEST_DATA);
  const live = () => app.isPackaged === true || Boolean(testRun && env.ACIRA_APPICON_URL);
  let service = null, fetchers = null, dockSet = false;

  const getFetchers = () => fetchers ||= (() => {
    const own = electron.session.fromPartition('electron-updater', { cache: false });
    try { own.setUserAgent(userAgent); } catch { /* the updater already did */ }
    return icon.sessionFetchers(own, { route });
  })();

  function build() {
    const places = {
      startMenu: platform === 'win32' ? path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
      desktop: platform === 'win32' ? app.getPath('desktop') : '',
      dataHome: platform === 'linux' ? (env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')) : '',
    };
    const applier = createIconApplier({
      platform, app, windows: () => electron.BaseWindow.getAllWindows(), ownWindow, nativeImage: electron.nativeImage, shell: electron.shell, directory, exePath: process.execPath, places, io, warn,
      standard: {
        windowFile: standardWindowFile,
        launcherBytes: () => { try { return io.readFileSync(standardWindowFile); } catch { return null; } },
      },
    });
    const quick = testRun && Number(env.ACIRA_APPICON_FIRST_MS) > 0 ? Number(env.ACIRA_APPICON_FIRST_MS) : undefined;
    return icon.createAppIcon({
      directory, platform, running: testRun && env.ACIRA_APPICON_RUNNING_VERSION ? String(env.ACIRA_APPICON_RUNNING_VERSION) : version, enabled: setting.get, /* QA only: a test profile may pretend to run another version, to see minVersion at work */ insider: following, baseUrl: icon.appIconBase(env),
      fetchDocument: (request) => getFetchers().fetchDocument(request), fetchPicture: (request) => getFetchers().fetchPicture(request),
      apply: applier.apply, notify: () => toast('appicon.toast'), onChange: () => { try { latest = service?.current()?.file ?? null; } catch { latest = null; } }, first: quick, io, warn, ...(schedule ? { schedule } : {}),
    });
  }
  const get = () => service ||= build();

  return {
    /** The picture a new window should wear, from the saved state alone (no network): a path, or null for the standard icon. */
    startupIcon() {
      try {
        latest = live() ? get().startupIcon() : null;
        // The Dock shows the program's own icon from the moment the app starts until it says otherwise: the saved icon goes there now, not at the first look 90 seconds later.
        if (latest && platform === 'darwin' && !dockSet) { dockSet = true; const image = electron.nativeImage.createFromPath(latest); if (image && !image.isEmpty()) app.dock?.setIcon(image); }
        return latest;
      } catch { return null; }
    },
    /** The schedule: the first look 90 seconds after this, then once a day. Nothing at all unless live and switched on. */
    start() { try { if (live()) get().start(); } catch (error) { warn('app icon: ' + String(error?.message || error)); } },
    /** The Settings row's two requests. */
    async handle(request) {
      if (request.type === 'appicon.set') {
        setting.set(request.enabled === true);
        if (live()) { try { await get().changed(); } catch { /* the next look */ } }
      }
      const status = live() ? get().status() : null;
      return { appIcon: { enabled: setting.get(), live: live(), name: status?.applied?.name || null } };
    },
    service: get, setting, live,
  };
}

module.exports = { createAppIconHost, currentIcon };
