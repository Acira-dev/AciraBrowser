'use strict';
const {t}=require('./tx.cjs');
// Advanced anti-tracking choices that go beyond list blocking: CNAME uncloaking (F15), skipping tracking redirects (F16)
// and fingerprint protection (F58). Application-wide, applied live (fingerprint protection from the next page load).
// `passkeys` is the one choice that is off by default: sites may ask Windows for a passkey or security key only when the person turns it on
// (a profile saved before the choice existed has no such key and reads as off). Open pages follow at their next passkey call.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { readJsonFile } = require('../atomic-file.cjs');
const FINGERPRINT_LEVELS = Object.freeze(['off', 'standard', 'strict']);
const DEFAULTS = Object.freeze({ cnameUncloaking: true, skipTrackingRedirects: true, stripTrackingParams: true, deAmp: true, fingerprint: 'standard', phishingLists: true, pageWarnings: true, passkeys: false });
function normalize(value, base = DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose valid anti-tracking settings.');
  const next = { ...base };
  for (const key of Object.keys(value)) {
    if (!(key in DEFAULTS)) throw new Error('Unknown anti-tracking setting.');
    if (key === 'fingerprint') { if (!FINGERPRINT_LEVELS.includes(value.fingerprint)) throw new Error('Choose off, standard or strict fingerprint protection.'); } else if (typeof value[key] !== 'boolean') throw new Error('Choose on or off.');
    next[key] = value[key];
  }
  return Object.freeze(next);
}
function createPrivacyPlus({ directory, fileSystem = fs }) {
  const file = path.join(directory, 'privacy-plus.json'); let saved = DEFAULTS;
  // A missing or damaged file means the defaults; a damaged one is kept aside first (atomic-file.cjs readJsonFile).
  try { const document = readJsonFile(file, { maxBytes: 4096, fileSystem }); if (document?.version === 1) saved = normalize(document.choice); } catch { /* choices this Acira does not know: the defaults */ }
  return {
    get: () => saved,
    set(patch) {
      const next = normalize(patch, saved), temp = file + '.' + randomUUID() + '.tmp';
      try { fileSystem.mkdirSync(directory, { recursive: true }); fileSystem.writeFileSync(temp, JSON.stringify({ version: 1, choice: next }), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); fileSystem.renameSync(temp, file); } catch { throw new Error('Anti-tracking settings could not be saved. Check that Acira can write to its profile and try again.'); } finally { try { fileSystem.unlinkSync(temp); } catch { } }
      saved = next; return saved;
    },
    defaults: () => DEFAULTS
  };
}
/** Rows for the Settings overview, in plain words; `stats` come from the running modules. */
function privacyPlusRows(settings, stats = {}) {
  const cname = stats.cname || {}, debounce = stats.debounce || {}, nav = stats.navigation || {};
  const state = flag => flag ? 'on' : 'off';
  return [
    { id: 'cname-uncloaking', title: t('privacy.cname.title'), state: state(settings.cnameUncloaking), detail: settings.cnameUncloaking ? (cname.cloaked ? t('privacy.cname.onCaught', { count: cname.cloaked }) : t('privacy.cname.on')) : t('privacy.cname.off') },
    { id: 'tracking-redirects', title: t('privacy.redirects.title'), state: state(settings.skipTrackingRedirects), detail: settings.skipTrackingRedirects ? (debounce.debounced ? t('privacy.redirects.onSkipped', { count: debounce.debounced }) : t('privacy.redirects.on')) : t('privacy.redirects.off') },
    { id: 'tracking-params', title: t('privacy.params.title'), state: state(settings.stripTrackingParams), detail: settings.stripTrackingParams ? (nav.stripped ? t('privacy.params.onCleaned', { count: nav.stripped }) : t('privacy.params.on')) : t('privacy.params.off') },
    { id: 'de-amp', title: t('privacy.amp.title'), state: state(settings.deAmp), detail: settings.deAmp ? (nav.deAmped ? t('privacy.amp.onOpened', { count: nav.deAmped }) : t('privacy.amp.on')) : t('privacy.amp.off') },
    { id: 'fingerprint', title: t('privacy.fingerprint.title'), state: settings.fingerprint === 'off' ? 'off' : 'on', detail: t({ off: 'privacy.fingerprint.off', standard: 'privacy.fingerprint.standard', strict: 'privacy.fingerprint.strict' }[settings.fingerprint]) }
  ];
}
module.exports = { createPrivacyPlus, privacyPlusRows, DEFAULTS, FINGERPRINT_LEVELS };
