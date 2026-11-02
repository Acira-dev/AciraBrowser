'use strict';
// Installed browsers' own app icons (R4-53), read from the local executable (Windows) or app bundle (macOS) with
// Electron's app.getFileIcon. Nothing is fetched and no third-party logo ships: a browser that is not installed simply
// has no icon, and the interface keeps its letter tile for it.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Browsers the importers can read, in the order the interface lists them. */
const BROWSERS = Object.freeze(['Chrome', 'Edge', 'Brave', 'Helium', 'Firefox', 'Zen', 'Arc']);
/** Windows "App Paths" registration names, for a browser installed outside the usual folders. */
const APP_PATHS = Object.freeze({ Chrome: 'chrome.exe', Edge: 'msedge.exe', Brave: 'brave.exe', Firefox: 'firefox.exe', Zen: 'zen.exe' });
/** Larger icons are scaled down to this before they cross to the interface (2x of the 32px 'large' icon). */
const MAX_SIDE = 64;
/** An icon crosses the IPC boundary as a small PNG data URL and nothing else. */
const MAX_URL = 96 * 1024;
const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

const validIconUrl = (value) => typeof value === 'string' && value.length <= MAX_URL && PNG_URL.test(value);

/** Keeps only well-formed icons for the browsers asked about; anything else is dropped, never passed on. */
function sanitizeIcons(value, allowed = BROWSERS) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const name of allowed) if (BROWSERS.includes(name) && Object.hasOwn(value, name) && validIconUrl(value[name])) out[name] = value[name];
  return out;
}

/** Where each browser lives on this machine, most likely first. Windows: Program Files, then the per-user folder (the
 * environment's LOCALAPPDATA and the profile folder's own AppData\Local, which differ only in a redirected test setup).
 * macOS: the .app bundle itself, which is what app.getFileIcon wants there. */
function browserExecutables(env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'darwin') {
    const bundle = (name) => [path.posix.join('/Applications', name), path.posix.join(home, 'Applications', name)];
    return {
      Chrome: bundle('Google Chrome.app'),
      Edge: bundle('Microsoft Edge.app'),
      Brave: bundle('Brave Browser.app'),
      Helium: bundle('Helium.app'),
      Firefox: bundle('Firefox.app'),
      Zen: bundle('Zen.app'),
      Arc: bundle('Arc.app'),
    };
  }
  if (platform !== 'win32') return {};
  const join = path.win32.join,
    pf = env.ProgramFiles || 'C:\\Program Files',
    pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    locals = [...new Set([env.LOCALAPPDATA, join(home, 'AppData', 'Local')].filter(Boolean))],
    perUser = (...parts) => locals.map((local) => join(local, ...parts));
  return {
    Chrome: [join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), ...perUser('Google', 'Chrome', 'Application', 'chrome.exe')],
    Edge: [join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    Brave: [join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), ...perUser('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')],
    Helium: perUser('imput', 'Helium', 'Application', 'chrome.exe'),
    Firefox: [join(pf, 'Mozilla Firefox', 'firefox.exe'), join(pf86, 'Mozilla Firefox', 'firefox.exe'), ...perUser('Mozilla Firefox', 'firefox.exe')],
    Zen: [join(pf, 'Zen Browser', 'zen.exe'), ...perUser('Zen Browser', 'zen.exe')],
    // Arc is a Store (MSIX) app: its install folder is locked, but its app execution alias carries its icon.
    Arc: [...perUser('Microsoft', 'WindowsApps', 'Arc.exe'), ...perUser('Microsoft', 'WindowsApps', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'Arc.exe')],
  };
}

/** A path that does not exist: Windows answers app.getFileIcon for it with its generic application icon, which is also what an
 * executable without a readable icon resource yields. Comparing against it tells a browser's own icon from the stand-in. */
const GENERIC_PROBE = 'C:\\acira-no-such-folder\\generic.exe';
const EXTRACT_SCRIPT = "Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:ACIRA_ICON_FILE); if(-not $i){exit 1}; $m=New-Object System.IO.MemoryStream; $i.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())";

/** The Windows shell's own icon extraction, for an executable whose icon app.getFileIcon cannot read (Helium's chrome.exe
 * yields the generic one there). Slow (a PowerShell start), so it runs only for such a browser, once per session. The path
 * travels in the environment, never in the script text. */
function windowsExtract(file, env = process.env) {
  return new Promise((resolve) => {
    const exe = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', EXTRACT_SCRIPT], { env: { ...env, ACIRA_ICON_FILE: file }, windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024 }, (error, output) => {
      const url = error ? null : 'data:image/png;base64,' + String(output).trim();
      resolve(validIconUrl(url) ? url : null);
    });
  });
}

/** The Windows registry's App Paths entries for an executable name (HKCU first). Loaded late: default-browser.cjs owns the
 * registry reader and also uses this module. */
async function registryAppPaths(exe) {
  const { readRegistryStringAsync } = require('../accounts/default-browser.cjs');
  const key = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe;
  return (await Promise.all(['HKCU', 'HKLM'].map((hive) => readRegistryStringAsync(hive, key)))).filter(Boolean);
}

/**
 * One lookup per browser, once per session: the answer (an icon or none) is remembered, so opening the list again, in
 * Settings or in setup, never reads a file again. Everything runs asynchronously and in parallel.
 *  - app: Electron's app (getFileIcon)
 *  - stat / readAppPaths / executables: replaceable for tests
 */
function createBrowserIcons({
  app,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  stat = (file) => fs.promises.stat(file).then((info) => ({ file: info.isFile(), directory: info.isDirectory() }), () => null),
  readAppPaths = registryAppPaths,
  extractIcon = (file) => windowsExtract(file, env),
  executables = browserExecutables(env, { platform, home }),
  // macOS: app.getFileIcon answers the generic application icon for an .app bundle on current systems, so the bundle's Quick Look thumbnail (its own icon) comes first.
  thumbnail = platform === 'darwin' ? (file) => require('electron').nativeImage.createThumbnailFromPath(file, { width: MAX_SIDE, height: MAX_SIDE }) : null,
} = {}) {
  const supported = (platform === 'win32' || platform === 'darwin') && typeof app?.getFileIcon === 'function';
  const found = new Map();

  /** The icon at its 'large' size (32px on Windows), kept as is when small and scaled down when bigger; the interface draws
   * it smaller still, so it stays sharp at 100% and 150%. */
  function dataUrl(image) {
    let shown = image;
    try {
      const { width, height } = image.getSize();
      const side = Math.max(width, height);
      if (side > MAX_SIDE) shown = image.resize({ width: Math.max(1, Math.round((width * MAX_SIDE) / side)), height: Math.max(1, Math.round((height * MAX_SIDE) / side)), quality: 'best' });
    } catch {}
    const url = shown.toDataURL();
    return validIconUrl(url) ? url : null;
  }
  /** What Windows draws for an executable with no icon of its own, per size (asked once per session). */
  const generic = {};
  async function genericIcon(size) {
    if (platform !== 'win32') return null;
    generic[size] ??= app.getFileIcon(GENERIC_PROBE, { size }).then((image) => (image && !image.isEmpty() ? image.toPNG() : null), () => null);
    return generic[size];
  }
  async function fromFile(file) {
    let stand = false;
    if (platform === 'darwin' && thumbnail) {
      try {
        const image = await thumbnail(file);
        const url = image && !image.isEmpty() ? dataUrl(image) : null;
        if (url) return url;
      } catch {}
    }
    // Some executables only yield an icon at one size; an empty image counts as a miss.
    // Electron does not support 'large' on macOS; requesting it aborts the native process.
    const sizes = platform === 'darwin' ? ['normal', 'small'] : ['large', 'normal'];
    for (const size of sizes) {
      try {
        const image = await app.getFileIcon(file, { size });
        if (!image || image.isEmpty()) continue;
        const baseline = await genericIcon(size);
        if (baseline && image.toPNG().equals(baseline)) { stand = true; continue; }
        const url = dataUrl(image);
        if (url) return url;
      } catch {}
    }
    // Windows only had its generic icon to give: ask the shell for the executable's own, else keep the letter tile.
    if (stand) return Promise.resolve(extractIcon(file)).then((url) => (validIconUrl(url) ? url : null), () => null);
    return null;
  }
  const exists = async (candidate) => {
    const info = await stat(candidate);
    return !!info && (platform === 'darwin' ? info.directory || info.file : info.file);
  };
  async function firstExisting(candidates) {
    const present = await Promise.all(candidates.map(exists));
    return candidates[present.indexOf(true)] || null;
  }
  async function look(name) {
    const known = executables[name] || [];
    let file = await firstExisting(known);
    if (!file && platform === 'win32' && APP_PATHS[name]) {
      // Helium registers itself as chrome.exe, so a Chrome candidate inside Helium's folder is not Chrome.
      const registered = (await readAppPaths(APP_PATHS[name]).catch(() => []))
        .map((candidate) => String(candidate).replace(/^"|"$/g, ''))
        .filter((candidate) => name !== 'Chrome' || !/[\\/]imput[\\/]helium[\\/]/i.test(candidate));
      file = await firstExisting(registered);
    }
    return file ? fromFile(file) : null;
  }
  /** Icons (PNG data URLs) for the browsers named, or every known one; browsers that aren't installed are left out. */
  async function icons(names = BROWSERS) {
    if (!supported) return {};
    const wanted = [...new Set(names)].filter((name) => BROWSERS.includes(name));
    for (const name of wanted) if (!found.has(name)) found.set(name, look(name).catch(() => null));
    const resolved = await Promise.all(wanted.map(async (name) => [name, await found.get(name)]));
    return sanitizeIcons(Object.fromEntries(resolved.filter(([, url]) => url)), wanted);
  }
  return { icons };
}

module.exports = { BROWSERS, browserExecutables, createBrowserIcons, sanitizeIcons, validIconUrl };
