'use strict';
// The folder of Acira's public update feed, as an https address with a trailing slash ('' when the release target is not a plain folder).
// Small files that belong beside the feed (the reviewed-sites list, site-allowlist.cjs) are read from it, so the app needs no second address
// and the person sees one host for "updates" (raw.githubusercontent.com). Same sources as spellcheck-dictionaries.cjs: a source checkout reads
// packaging/release-target.json; the installed app has no packaging/ folder and reads the app-update.yml electron-builder wrote beside it.
function readUpdateConfig() {
  try { return require('node:fs').readFileSync(require('node:path').join(process.resourcesPath || '', 'app-update.yml'), 'utf8'); } catch { return ''; }
}

/** The feed folder named by an app-update.yml: `provider: generic` with an https `url:`. A github provider has no plain folder: ''. */
function folderFromUpdateConfig(yml) {
  const field = (name) => (new RegExp(`^${name}:\\s*['"]?([^'"\\s]+)`, 'm').exec(yml || '') || [])[1];
  if (field('provider') !== 'generic') return '';
  const url = field('url');
  return url && /^https:\/\//.test(url) ? url.replace(/\/+$/, '') + '/' : '';
}

function feedFolderURL({ loadTarget = () => require('../../packaging/release-target.cjs').loadReleaseTarget(), readConfig = readUpdateConfig } = {}) {
  try {
    const target = loadTarget();
    if (target && target.provider === 'generic' && /^https:\/\//.test(target.url)) return target.url.replace(/\/+$/, '') + '/';
    if (target) return '';
  } catch { /* installed app: no packaging/ folder */ }
  return folderFromUpdateConfig(readConfig());
}

module.exports = { feedFolderURL, folderFromUpdateConfig };
