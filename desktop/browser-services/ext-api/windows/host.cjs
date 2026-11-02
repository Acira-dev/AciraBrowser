'use strict';
// The Electron side of chrome.windows for ONE profile (the service in ./service.cjs never touches Electron). main.cjs builds it inside
// extensionBrowser(profile) and hands it to the extension engine as `windows`; ext-api/windows.cjs finds it on `store.impl.windows`.
//
//   windows()           the windows an extension of this profile may see, in no particular order: [{window, kind: 'normal' | 'popup'}]
//                       'normal'  Acira's ordinary browser windows of the profile (controller.window)
//                       'popup'   standalone extension windows (an extension page or a page opened by windows.create({type:'popup'}))
//                       never: private windows, Tor windows, web-app windows, windows of other profiles, closing windows
//   windowOf(webContents)   the window that holds a page (a tab, or an engine popup that belongs to a window)
//   displays() / defaultBounds(kind)    screen facts for the bounds checks
//   create(spec) / close(window)
//
// deps (all from main.cjs): available() -> the profile's ordinary controllers; destination() -> a controller to own a popup window;
// createWindow(options) -> a new ordinary controller of the profile (createBrowserWindow); attach(webContents, window) -> hands a page to the
// engine; sessionOf() -> the profile's Electron session; ordinary(url) -> true for an http(s) address Acira opens; icon, title, hidden().

function createWindowsHost({electron, available, destination, createWindow, attach, sessionOf, ordinary = () => false, icon, title = 'Acira', hidden = () => false}) {
  const alive = window => !!window && !(typeof window.isDestroyed === 'function' && window.isDestroyed());
  const AUX = 'extension-';

  function windows() {
    const out = [], session = sessionOf();
    for (const controller of available()) {
      if (controller.webApp) continue;
      if (alive(controller.window)) out.push({window: controller.window, kind: 'normal'});
      for (const [key, window] of controller.auxiliaries) {
        if (key.startsWith(AUX) && alive(window) && window.webContents && window.webContents.session === session) out.push({window, kind: 'popup'});
      }
    }
    return out;
  }

  const contains = (view, contents) => {
    if (!view) return false;
    if (view.webContents === contents) return true;
    return Array.isArray(view.children) && view.children.some(child => contains(child, contents));
  };
  function windowOf(contents) {
    if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return null;
    try {
      const own = electron.BrowserWindow.fromWebContents(contents);
      if (own) return (typeof own.getParentWindow === 'function' && own.getParentWindow()) || own;
    } catch { /* not a window of its own */ }
    for (const window of electron.BaseWindow.getAllWindows()) { if (alive(window) && contains(window.contentView, contents)) return window; }
    return null;
  }

  const displays = () => electron.screen.getAllDisplays().map(display => ({x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height}));
  function workAreaNearWindow() {
    const first = windows().find(item => item.kind === 'normal' && item.window.isFocused()) || windows()[0];
    try { return (first ? electron.screen.getDisplayMatching(first.window.getBounds()) : electron.screen.getPrimaryDisplay()).workArea; } catch { return electron.screen.getPrimaryDisplay().workArea; }
  }
  /** Centered on the display of the window in use, 900 x 720 as big as the work area allows. */
  function defaultBounds() {
    const area = workAreaNearWindow(), width = Math.min(900, area.width), height = Math.min(720, area.height);
    return {x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height};
  }

  function applyState(window, state) {
    if (state === 'minimized') window.minimize();
    else if (state === 'maximized') window.maximize();
    else if (state === 'fullscreen') window.setFullScreen(true);
  }

  /** An ordinary Acira window with the addresses as tabs (the first one is the window's own first tab). */
  async function createOrdinary({urls, bounds, state, focused}) {
    const controller = createWindow(urls.length ? {initialURL: urls[0]} : {});
    if (!await controller.ready) throw new Error('The extension window is unavailable.');
    for (const url of urls.slice(1)) await controller.extensionCreateTab({url, active: false});
    const window = controller.window;
    if (!alive(window)) throw new Error('The extension window is unavailable.');
    if (bounds) window.setBounds(bounds);
    applyState(window, state);
    if (!hidden()) { if (focused) controller.show(); else if (state !== 'minimized') window.showInactive(); }
    return window;
  }

  /** A window without Acira's interface (Chrome's popup): the page and nothing else, in the profile's session, with the same limits as the
   *  extension windows tabs.create makes (web addresses and this extension's pages only; its own pop-ups stay in the same session). */
  async function createPopup({extensionId, urls, bounds, state, focused}) {
    const owner = available().find(controller => !controller.webApp) || destination();
    if (!await owner.ready) throw new Error('The extension profile is unavailable.');
    const session = sessionOf(), rect = bounds || defaultBounds();
    const origin = extensionId ? `chrome-extension://${extensionId}/` : null;
    const allowed = value => value === 'about:blank' || ordinary(value) || (!!origin && String(value).startsWith(origin));
    const preferences = {session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false};
    const window = new electron.BrowserWindow({show: false, x: rect.x, y: rect.y, width: rect.width, height: rect.height, autoHideMenuBar: true, icon, title: typeof title === 'function' ? title() : title, webPreferences: preferences});
    const track = child => {
      const key = AUX + child.id;
      owner.auxiliaries.set(key, child);
      child.setMenu(null);
      child.on('closed', () => owner.auxiliaries.delete(key));
      child.webContents.on('will-navigate', (event, value) => { if (!allowed(value)) event.preventDefault(); });
      child.webContents.setWindowOpenHandler(details => ({action: allowed(details.url) ? 'allow' : 'deny', overrideBrowserWindowOptions: {show: !hidden(), autoHideMenuBar: true, webPreferences: {...preferences, preload: undefined}}}));
      child.webContents.on('did-create-window', popup => track(popup));
      attach(child.webContents, child);
    };
    track(window);
    try { await window.webContents.loadURL(urls[0] || 'about:blank'); } catch (error) { if (!window.isDestroyed()) window.close(); throw error; }
    if (!alive(window)) throw new Error('Browser windows not allowed.');
    applyState(window, state);
    if (!hidden()) { if (focused) window.show(); else if (state !== 'minimized') window.showInactive(); }
    return window;
  }

  return {
    windows, windowOf, displays, defaultBounds,
    /** spec: {extensionId, urls: [string], kind: 'normal' | 'popup', bounds: {x, y, width, height} | null, state: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'default', focused: boolean} */
    async create(spec) {
      // An extension page cannot be a tab of an ordinary window here (tabs.create gives it a window of its own too), so it opens as a popup.
      if (spec.kind === 'normal' && !spec.urls.some(url => url.startsWith('chrome-extension:'))) return createOrdinary(spec);
      return createPopup(spec);
    },
    close(window) { if (alive(window)) window.close(); }
  };
}

module.exports = {createWindowsHost};
