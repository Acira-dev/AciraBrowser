'use strict';
// Spelling dictionaries never come from Google (parity audit #5). On Windows, Chromium checks spelling with the Windows
// spellchecker for languages Windows has installed, and downloads a Hunspell dictionary (`<language>-<version>.bdic`) for
// the rest, from Google's CDN unless told otherwise (verified: a de-DE dictionary appeared in a test profile). Every
// session is pointed at Acira's own release instead, before it can start a download; Helium and Brave reroute the same
// downloads. `scripts/mirror-spellcheck-dictionaries.mjs` fills that release with the exact files Chromium asks for.
// ACIRA_SPELLCHECK_DICTIONARY_URL overrides the location for tests and mirrors (https, or http on this computer only).
// Beside the app's releases (packaging/release-target.json). The installed app ships no packaging/ folder, so there the same
// target is read from resources/app-update.yml, which electron-builder writes from that file. Requiring packaging/ at load
// time stopped the installed app before its first window (28 Oct).
const RELEASE_URL = releaseDictionaryURL();

function releaseDictionaryURL() {
  try { const { loadReleaseTarget, dictionaryUrl } = require('../../packaging/release-target.cjs'); return dictionaryUrl(loadReleaseTarget()); } catch { /* installed app */ }
  return dictionaryURLFromUpdateConfig(readUpdateConfig());
}

function readUpdateConfig() {
  try { return require('node:fs').readFileSync(require('node:path').join(process.resourcesPath || '', 'app-update.yml'), 'utf8'); } catch { return ''; }
}

/** The dictionary folder for the target in an app-update.yml (github owner/repo, or a generic url); '' when there is none. */
function dictionaryURLFromUpdateConfig(yml) {
  const field = name => (new RegExp(`^${name}:\\s*['"]?([^'"\\s]+)`, 'm').exec(yml || '') || [])[1];
  const owner = field('owner'), repo = field('repo'), url = field('url');
  if (/^[A-Za-z0-9._-]+$/.test(owner || '') && /^[A-Za-z0-9._-]+$/.test(repo || '')) return `https://github.com/${owner}/${repo}/releases/download/spellcheck-dictionaries/`;
  if (url && /^https:\/\//.test(url)) return `${url.replace(/\/+$/, '')}/spellcheck-dictionaries/`;
  return '';
}

/** The base URL Chromium appends dictionary file names to. */
function dictionaryBaseURL(env = process.env) {
  const override = env.ACIRA_SPELLCHECK_DICTIONARY_URL;
  if (typeof override === 'string' && override) {
    let url; try { url = new URL(override); } catch { url = null; }
    const local = url && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url && (url.protocol === 'https:' || local) && !url.username && !url.password && !url.search && !url.hash) return url.href.endsWith('/') ? url.href : url.href + '/';
  }
  return RELEASE_URL;
}

/** Point one session's dictionary downloads at Acira. Returns false for objects that are not spellchecking sessions. */
function secureSpellcheckDownloads(session, base = dictionaryBaseURL()) {
  if (typeof session?.setSpellCheckerDictionaryDownloadURL !== 'function') return false;
  // No known release location: a closed local port, so a missing dictionary never falls back to Google's CDN.
  session.setSpellCheckerDictionaryDownloadURL(base || 'http://127.0.0.1:9/');
  return true;
}

/** Every session Electron creates from now on (and the default one, if it already exists) downloads from Acira. */
function installSpellcheckDownloads(app, sessionModule, base = dictionaryBaseURL()) {
  app.on('session-created', session => { try { secureSpellcheckDownloads(session, base); } catch { /* A session without spelling support. */ } });
  if (app.isReady()) secureSpellcheckDownloads(sessionModule.defaultSession, base);
  return base;
}

module.exports = { RELEASE_URL, dictionaryBaseURL, dictionaryURLFromUpdateConfig, secureSpellcheckDownloads, installSpellcheckDownloads };
