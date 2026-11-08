/** The release as people name it, worked out from the package version so it is right on every release (the updater still compares the full build version).
 *  0.1.0-beta.12 is "Beta 12" (the first line, 0.1, is implied while Acira is in beta); a fix release of a beta adds its number: 0.1.0-beta.13.1 is
 *  "Beta 13.1". A beta on any other line keeps its line: 0.1.1-beta.2 is "0.1.1 Beta 2" and 0.2.0-beta.1 is "0.2 Beta 1". A plain version drops a
 *  patch of 0: 0.1.0 is "0.1", 1.2.3 stays "1.2.3". Anything else (a local build such as 0.1.0-beta.12.local.1) is shown exactly as it is. */
export function releaseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+)(?:\.(\d+))?)?$/.exec(version);
  if (!match) return version;
  const [, major, minor, patch, beta, fix] = match, line = `${major}.${minor}${patch === '0' ? '' : `.${patch}`}`;
  if (beta === undefined) return line;
  // i18n-ignore: "Beta" is part of the release's name, as the release is named (the same in every language, like "Chromium")
  return `${major === '0' && minor === '1' && patch === '0' ? '' : `${line} `}Beta ${beta}${fix === undefined ? '' : `.${fix}`}`;
}

/** The part after the release in About > Updates: " (Chromium 152)", or nothing when the engine's version is not known. */
export const chromiumSuffix = (chromium?: string) => (chromium ? ` (Chromium ${chromium})` : ''); // i18n-ignore: product name and its version, not words
