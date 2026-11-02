'use strict';
// Windows version detection by build number (never by marketing name), so every Windows-version-dependent feature degrades by
// feature detection instead of crashing or looking broken on an older build. docs/launch/WINDOWS_COMPAT.md lists every user.
//   Windows 10: 1809 = 17763, 21H2 = 19044, 22H2 = 19045 (last Windows 10 build)
//   Windows 11: 21H2 = 22000, 22H2 = 22621, 23H2 = 22631, 24H2 = 26100 (Insider builds are higher still)
const os = require('node:os');

const BUILD = Object.freeze({
  WIN10_1809: 17763,
  WIN10_22H2: 19045,
  WIN11_21H2: 22000,
  /** First build where Electron's backgroundMaterial (DWM system backdrop: acrylic / Mica) exists. Windows 11 22H2. */
  BACKGROUND_MATERIAL: 22621,
  /** First build whose Settings app honours ms-settings:defaultapps?registeredAppUser=<name>. Windows 11 23H2. */
  DEFAULT_APPS_DEEP_LINK: 22631,
});

/** Windows build number from os.release() ("10.0.19045" -> 19045). null when not Windows 10 or later, or unreadable. */
function windowsBuild(release = os.release(), platform = process.platform) {
  if (platform !== 'win32') return null;
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(String(release));
  if (!parts || Number(parts[1]) < 10) return null; // 6.1 / 6.2 / 6.3 are Windows 7, 8 and 8.1: Electron 44 does not run there
  const build = Number(parts[3]);
  return Number.isSafeInteger(build) && build > 0 ? build : null;
}

/** QA only: ACIRA_WINDOWS_BUILD=19045 makes a Windows 11 test machine take the Windows 10 paths. Ignored unless a test profile is set. */
function overriddenBuild(env = process.env) {
  if (!env.ACIRA_BROWSER_TEST_DATA || !/^\d{4,6}$/.test(String(env.ACIRA_WINDOWS_BUILD || ''))) return null;
  return Number(env.ACIRA_WINDOWS_BUILD);
}

/** The build to decide with: the QA override when allowed, otherwise the real one. */
function currentBuild({ release = os.release(), platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return null;
  return overriddenBuild(env) ?? windowsBuild(release, platform);
}

const atLeast = (build, minimum) => typeof build === 'number' && build >= minimum;

/** Windows 11 22H2+ paints a DWM system backdrop (acrylic) behind a window. Anything older keeps the opaque frame colour. */
const supportsBackgroundMaterial = build => atLeast(build, BUILD.BACKGROUND_MATERIAL);
/** Windows 11 23H2+ opens Default apps on Acira's own entry; older builds open the plain Default apps page. */
const supportsDefaultAppsDeepLink = build => atLeast(build, BUILD.DEFAULT_APPS_DEEP_LINK);

/** "windows-11", "windows-10" or "unsupported" (anything below Windows 10, or not Windows). */
function windowsFamily(build) {
  if (atLeast(build, BUILD.WIN11_21H2)) return 'windows-11';
  if (atLeast(build, 10240)) return 'windows-10';
  return 'unsupported';
}

/**
 * The window material decision in one place. `acrylic` is true only on Windows 11 22H2+ with the user's Transparency effects
 * available; ACIRA_MATERIAL=none switches it off anywhere. Everything else is the solid fallback: the opaque `--frame` colour and
 * no backgroundMaterial option (Electron ignores an unknown material on older builds, but we never pass one there).
 */
function windowMaterial({ release = os.release(), platform = process.platform, env = process.env } = {}) {
  const build = currentBuild({ release, platform, env });
  const acrylic = platform === 'win32' && env.ACIRA_MATERIAL !== 'none' && supportsBackgroundMaterial(build);
  return { build, family: windowsFamily(build), acrylic, material: acrylic ? 'acrylic' : 'none' };
}

module.exports = { BUILD, windowsBuild, currentBuild, overriddenBuild, supportsBackgroundMaterial, supportsDefaultAppsDeepLink, windowsFamily, windowMaterial };
