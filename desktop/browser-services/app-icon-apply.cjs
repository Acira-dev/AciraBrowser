'use strict';
// Where an app may change its own icon while it runs (plan section 1). app-icon.cjs decides WHAT the icon should be; this puts it there, per platform, with everything Electron and the system injected:
//   Mac      the Dock tile of the running app (`app.dock.setIcon`). macOS 27 draws that picture EXACTLY as supplied (no mask, no rounded corners, no margin: a full-bleed square shows as a hard square), so the Mac picture
//            must already have the shape it should have in the Dock. Standard = an empty picture, which gives the tile back to the system and its own bundle icon. Never the bundle (the signed program), never the Dock tile of a closed app.
//   Windows  the open windows (`win.setIcon`), the Start menu entry "Acira Browser.lnk" and a Desktop "Acira Browser.lnk" (`shell.readShortcutLink` / `writeShortcutLink` in this process). A shortcut is touched only when it is
//            one of those two, points at THIS Acira, and its icon is empty, the program's own, or the exact file written last time; what it said before is saved and put back, only if it still says what we wrote.
//            Not the pinned taskbar shortcut (decided out of this work), not the registry, not Apps and features: no program is started, nothing is written outside Acira's own folder and those two shortcut files.
//   Linux    the open windows (`win.setIcon`) and, when Acira was installed by the installer, the launcher picture (hicolor/512x512/apps/acira-browser.png), replaced only while it is the installer's own picture or the
//            one written last time (judged by hash) and put back the same way.
// Windows that belong to installed web apps keep their own icons (`ownWindow`). Every call is best effort: one place failing never stops the others, and a failure never throws into the app.
const fs = require('node:fs'), path = require('node:path');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const { makeIco, sha512Of } = require('./app-icon.cjs');

const SHORTCUT_NAME = 'Acira Browser.lnk', LAUNCHER_ICON = 'icons/hicolor/512x512/apps/acira-browser.png';
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();

/**
 * platform: process.platform. app (Electron's app, for `dock`), windows(): the open windows, ownWindow(win): false for an installed web app's window. nativeImage, shell: Electron's.
 * directory: <data folder>/app-icon. standard: {windowFile (the bundled standard picture, a path), launcherBytes() (the installer's picture)}.
 * exePath: this program (shortcuts must point at it). places: {startMenu, desktop (folders), dataHome (the XDG data folder)}. warn(message): where a failure is noted.
 */
function createIconApplier({ platform = process.platform, app = null, windows = () => [], ownWindow = () => true, nativeImage = null, shell = null, directory, standard = {}, exePath = process.execPath, places = {}, io = fs, warn = () => {} } = {}) {
  const placesFile = path.join(directory, 'applied-places.json');
  let remembered = null;
  const load = () => { if (!remembered) { const saved = readJsonFile(placesFile, { fileSystem: io, maxBytes: 32 * 1024, warn }); remembered = { shortcuts: saved && typeof saved.shortcuts === 'object' && saved.shortcuts ? saved.shortcuts : {}, launcher: saved && typeof saved.launcher === 'object' && saved.launcher ? saved.launcher : null }; } return remembered; };
  const save = () => { try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(placesFile, JSON.stringify(load()), { fileSystem: io }); } catch (error) { warn('app icon: ' + String(error?.message || error)); } };
  const attempt = (label, run) => { try { return run(); } catch (error) { warn(`app icon (${label}): ${String(error?.message || error).slice(0, 120)}`); return undefined; } };

  const imageOf = (file) => { const image = nativeImage.createFromPath(file); return image && !image.isEmpty() ? image : null; };
  /** The picture every open window of ours wears (Windows and Linux only: a macOS window has no icon of its own, the Dock tile is the app's). */
  function setWindows(file) {
    const image = imageOf(file); if (!image) return false;
    for (const window of windows()) { if (!window || window.isDestroyed?.() || !ownWindow(window)) continue; attempt('window', () => window.setIcon(image)); }
    return true;
  }

  // ---- Windows
  const wanted = () => [['start', places.startMenu], ['desktop', places.desktop]].filter(([, folder]) => typeof folder === 'string' && folder).map(([name, folder]) => [name, path.join(folder, SHORTCUT_NAME)]);
  const readLink = (file) => (io.existsSync(file) ? attempt('read shortcut', () => shell?.readShortcutLink?.(file)) : undefined);
  function icoFor(target) {
    const png = io.readFileSync(target.file), name = `appicon-v${target.version}.ico`, file = path.join(directory, name);
    const resize = (bytes, side) => nativeImage.createFromBuffer(bytes).resize({ width: side, height: side, quality: 'best' }).toPNG();
    if (!io.existsSync(file)) writeFileAtomic(file, makeIco(png, resize), { fileSystem: io });
    for (const old of io.readdirSync(directory)) if (/^appicon-v\d{1,9}\.ico$/.test(old) && old !== name && !Object.values(load().shortcuts).some((s) => s && samePath(s.wrote, path.join(directory, old)))) attempt('tidy', () => io.rmSync(path.join(directory, old), { force: true }));
    return file;
  }
  function windowsShortcuts(target) {
    if (!shell) return;
    const ico = target.kind === 'picture' ? icoFor(target) : null, kept = load();
    for (const [name, file] of wanted()) {
      const link = readLink(file), mine = kept.shortcuts[name];
      if (!link) continue;
      if (!samePath(link.target, exePath)) continue;                                       // points somewhere else: not ours
      const ours = mine && samePath(link.icon, mine.wrote), plain = !link.icon || samePath(link.icon, exePath);
      if (ico) {
        if (!ours && !plain) continue;                                                      // the person chose their own picture: left alone
        if (ours && samePath(mine.wrote, ico)) continue;                                    // already this one
        const before = ours ? mine : { icon: link.icon || '', iconIndex: link.iconIndex || 0 };
        if (attempt('write shortcut', () => shell?.writeShortcutLink?.(file, 'update', { icon: ico, iconIndex: 0 })) === true) kept.shortcuts[name] = { icon: before.icon, iconIndex: before.iconIndex, wrote: ico };
      } else if (mine) {
        if (ours && attempt('restore shortcut', () => shell?.writeShortcutLink?.(file, 'update', { icon: mine.icon || exePath, iconIndex: mine.iconIndex || 0 })) !== true) continue;
        delete kept.shortcuts[name];                                                        // put back, or no longer ours: forgotten either way
      }
    }
    save();
  }

  // ---- Linux
  const launcherFile = () => (places.dataHome ? path.join(places.dataHome, ...LAUNCHER_ICON.split('/')) : null);
  function linuxLauncher(target) {
    const file = launcherFile(); if (!file || !io.existsSync(file)) return;               // not installed by the installer (an AppImage run on its own): no launcher entry
    const current = sha512Of(io.readFileSync(file)), kept = load(), standardBytes = standard.launcherBytes?.() || null;
    const ours = kept.launcher && kept.launcher.wrote === current, plain = standardBytes && sha512Of(standardBytes) === current;
    if (target.kind === 'picture') {
      if (!ours && !plain) return;                                                          // someone else's picture: left alone
      const bytes = io.readFileSync(target.file), hash = sha512Of(bytes);
      if (ours && kept.launcher.wrote === hash) return;
      writeFileAtomic(file, bytes, { fileSystem: io }); kept.launcher = { wrote: hash }; save();
    } else if (kept.launcher) {
      if (ours && standardBytes) writeFileAtomic(file, standardBytes, { fileSystem: io });
      kept.launcher = null; save();
    }
  }

  /** target: {kind: 'picture', file, version, ...} | {kind: 'standard'}. True when the running app's icon was set. Never throws. */
  async function apply(target) {
    try {
      if (platform === 'darwin') {
        if (!app?.dock) return false;
        // The standard icon: an EMPTY picture hands the tile back to the system, which draws the bundle's own icon again, exactly as it always did (checked on macOS 27 with a Dock capture, plan notes: dock-probe.png).
        if (target.kind === 'standard') { app.dock.setIcon(nativeImage.createEmpty()); return true; }
        const image = imageOf(target.file); if (!image) return false;
        app.dock.setIcon(image); return true;
      }
      const ok = setWindows(target.kind === 'standard' ? standard.windowFile : target.file);
      if (platform === 'win32') attempt('shortcuts', () => windowsShortcuts(target));
      else if (platform === 'linux') attempt('launcher', () => linuxLauncher(target));
      return ok;
    } catch (error) { warn('app icon: ' + String(error?.message || error).slice(0, 160)); return false; }
  }
  return { apply, wanted, launcherFile };
}

module.exports = { createIconApplier, SHORTCUT_NAME, LAUNCHER_ICON, samePath };
