'use strict';
// "Match my system theme" on Linux (Settings › Appearance). What the desktop says about its theme, read in one place and handed to
// the interface as plain data: { supported, dark, accent, accentSource, desktop }. Nothing here changes how Acira looks by itself;
// ui/theme.ts decides what an accent does to Acira's own finishes.
//
// Where the values come from (Electron 44 = Chromium 152):
//  - light / dark: nativeTheme.shouldUseDarkColors. Chromium reads the XDG desktop portal (org.freedesktop.appearance color-scheme)
//    and falls back to GTK's own settings when no portal answers. It is what prefers-color-scheme follows when themeSource is 'system'.
//  - accent: systemPreferences.getAccentColor(). On Linux Electron returns NativeTheme::user_color() as "#RRGGBBAA" (or "" when the
//    desktop gave none); Chromium fills it from the portal's accent-color key (GNOME 47+, KDE Plasma 6). The 'accent-color-changed'
//    event fires when it changes.
//  - accent, KDE only, when the portal gave none (Plasma 5, or a session without xdg-desktop-portal-kde): ~/.config/kdeglobals.
// Electron ships without Qt support (use_qt5 = use_qt6 = false), so on KDE the GTK path and the portal are all Chromium has.
//
// Everything below the "service" line takes its inputs as arguments, so tests can feed any desktop from any platform.

const HEX6 = /^#[0-9a-f]{6}$/i;

/** "#RRGGBBAA", "RRGGBBAA", "#RRGGBB" or "RRGGBB" -> "#rrggbb"; "" and a fully transparent colour -> null. */
function accentFromHex(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return null;
  if (text.length === 8 && /^00$/i.test(text.slice(6))) return null;
  return ('#' + text.slice(0, 6)).toLowerCase();
}

/** The portal's accent-color: an (ddd) tuple of sRGB values in [0,1]. Anything outside that range means "no accent". */
function accentFromPortal(tuple) {
  if (!Array.isArray(tuple) || tuple.length !== 3 || !tuple.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return '#' + tuple.map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('');
}

/** The portal's color-scheme: 1 = prefer dark, 2 = prefer light, 0 or anything else = no preference. */
function schemeFromPortal(value) {
  return value === 1 ? 'dark' : value === 2 ? 'light' : null;
}

/** A tiny INI reader for kdeglobals: { 'Section': { key: 'value' } }. Comments and blank lines are skipped; keys keep their case. */
function parseIni(text) {
  const result = {};
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';') continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) { section = header[1]; result[section] ||= {}; continue; }
    const at = line.indexOf('=');
    if (at < 1) continue;
    (result[section] ||= {})[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return result;
}

/** "61,174,233" (KDE's colour format; a fourth alpha number is ignored) -> "#3daee9". */
function colorFromTriple(value) {
  const parts = String(value || '').split(',').map(part => part.trim());
  if (parts.length < 3 || !parts.slice(0, 3).every(part => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.slice(0, 3).map(Number);
  if (numbers.some(n => n > 255)) return null;
  return '#' + numbers.map(n => n.toString(16).padStart(2, '0')).join('');
}

/**
 * The accent in KDE's colour settings. Plasma 6 writes [General] AccentColor when an accent is chosen. Without one, the colour scheme's
 * own highlight is the accent: Breeze keeps it in [Colors:View] DecorationFocus and [Colors:Selection] BackgroundNormal.
 */
function accentFromKdeglobals(text) {
  const ini = parseIni(text);
  return colorFromTriple(ini.General?.AccentColor)
    || colorFromTriple(ini['Colors:View']?.DecorationFocus)
    || colorFromTriple(ini['Colors:Selection']?.BackgroundNormal)
    || null;
}

/** 'kde', 'gnome' or 'other' from XDG_CURRENT_DESKTOP ("KDE", "GNOME", "ubuntu:GNOME", "X-Cinnamon"...). */
function desktopFamily(env = {}) {
  const names = String(env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || '').toLowerCase().split(':');
  return names.includes('kde') || names.includes('plasma') ? 'kde' : names.includes('gnome') || names.includes('ubuntu') ? 'gnome' : 'other';
}

/** A colour only counts as an accent when it has a hue to show: pure greys and unreadable values are no accent. */
function usableAccent(hex) {
  if (!HEX6.test(hex || '')) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 8 ? null : hex.toLowerCase();
}

/**
 * Decides what the desktop says right now.
 *   platform     process.platform; anything but 'linux' is { supported: false } unless a simulation is given
 *   dark         nativeTheme.shouldUseDarkColors
 *   electronAccent  systemPreferences.getAccentColor() ('' when none)
 *   kdeglobals   the text of ~/.config/kdeglobals, or '' when absent
 *   simulate     { dark, accent } from the tests' environment variable
 */
function resolveSystemTheme({ platform, env = {}, dark = false, electronAccent = '', kdeglobals = '', simulate = null } = {}) {
  if (simulate) {
    return { supported: true, dark: Boolean(simulate.dark), accent: usableAccent(simulate.accent), accentSource: usableAccent(simulate.accent) ? 'simulated' : null, desktop: simulate.desktop || 'other' };
  }
  if (platform !== 'linux') return { supported: false, dark: Boolean(dark), accent: null, accentSource: null, desktop: 'other' };
  const desktop = desktopFamily(env);
  const portal = usableAccent(accentFromHex(electronAccent));
  const kde = !portal && desktop === 'kde' ? usableAccent(accentFromKdeglobals(kdeglobals)) : null;
  return { supported: true, dark: Boolean(dark), accent: portal || kde || null, accentSource: portal ? 'portal' : kde ? 'kdeglobals' : null, desktop };
}

/**
 * The accent a main-process surface should use for "Match my system theme", or undefined. The same rule as src/ui/systemThemeRules.ts
 * (a test holds the two together): the flag is set, Appearance (as this profile sees it) is Auto, and the desktop gave an accent.
 */
function activeAccent(settings, info) {
  return settings && settings.systemTheme && settings.appearance === 'system' && info && info.supported && info.accent ? info.accent : undefined;
}

/** The tests' feed: {"dark":true,"accent":"#9141ac"}. Honoured only inside a throwaway test profile, never in a normal run. */
function simulationFrom(env = {}) {
  if (!env.ACIRA_BROWSER_TEST_DATA || !env.ACIRA_SIMULATE_SYSTEM_THEME) return null;
  try {
    const value = JSON.parse(env.ACIRA_SIMULATE_SYSTEM_THEME);
    return value && typeof value === 'object' ? { dark: Boolean(value.dark), accent: typeof value.accent === 'string' ? value.accent : '', desktop: typeof value.desktop === 'string' ? value.desktop : 'other' } : null;
  } catch { return null; }
}

// --- service -----------------------------------------------------------------------------------------------------------------------

/**
 * Reads the desktop's theme and tells `onChange` when it moves. Nothing is read or watched off Linux (the simulation aside).
 * `electron` is { nativeTheme, systemPreferences }; `fs` and `watch` are injected so a test needs neither a disk nor a desktop.
 */
function createSystemTheme({ platform = process.platform, env = process.env, electron, readFile, watch, configDir, onChange = () => {} } = {}) {
  const simulate = simulationFrom(env);
  const active = Boolean(simulate) || platform === 'linux';
  const dir = configDir ? configDir.replace(/\/+$/, '') : '';
  const kdePath = dir ? dir + '/kdeglobals' : '';
  let last = null, timer = null, closers = [];
  const read = () => {
    let kdeglobals = '';
    if (!simulate && platform === 'linux' && kdePath && desktopFamily(env) === 'kde') { try { kdeglobals = readFile(kdePath); } catch {} }
    let electronAccent = '', dark = false;
    try { dark = Boolean(electron?.nativeTheme?.shouldUseDarkColors); } catch {}
    try { electronAccent = electron?.systemPreferences?.getAccentColor?.() || ''; } catch {}
    return resolveSystemTheme({ platform, env, dark, electronAccent, kdeglobals, simulate });
  };
  const same = (a, b) => a && b && a.supported === b.supported && a.dark === b.dark && a.accent === b.accent && a.accentSource === b.accentSource;
  const refresh = () => { const next = read(); if (same(last, next)) return last; last = next; try { onChange(next); } catch {} return next; };
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
  if (active && !simulate) {
    try { electron?.nativeTheme?.on?.('updated', soon); closers.push(() => electron.nativeTheme.removeListener('updated', soon)); } catch {}
    try { electron?.systemPreferences?.on?.('accent-color-changed', soon); closers.push(() => electron.systemPreferences.removeListener('accent-color-changed', soon)); } catch {}
    if (kdePath && desktopFamily(env) === 'kde' && typeof watch === 'function') {
      try { const stop = watch(dir, name => { if (!name || name === 'kdeglobals') soon(); }); if (typeof stop === 'function') closers.push(stop); } catch {}
    }
  }
  last = read();
  return {
    current: () => last,
    refresh,
    dispose() { clearTimeout(timer); for (const close of closers.splice(0)) try { close(); } catch {} },
  };
}

module.exports = { activeAccent, accentFromHex, accentFromPortal, schemeFromPortal, parseIni, colorFromTriple, accentFromKdeglobals, desktopFamily, usableAccent, resolveSystemTheme, simulationFrom, createSystemTheme };
