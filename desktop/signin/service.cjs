'use strict';
// The "Sign back in" checklist: which accounts to offer after an import, and which of them the person has signed in to since.
// The list comes from candidates.cjs (history, bookmarks, saved-password hosts). "Signed in" is only ever inferred from the
// NAMES of cookies in Acira's own profile (never their values, never another browser's store): a new session cookie for the
// site, once its tab has left the sign-in page. The person can always tick a row by hand. Nothing here touches the network.
const fs = require('node:fs');
const path = require('node:path');
const { computeCandidates, hostOf, registrable, providerOf } = require('./candidates.cjs');

const FIRST_ROWS = 10;
const MAX_ROWS = 12;
const RETIRE_AFTER_MS = 14 * 86400000;
const GENERIC_SESSION = /(sess(ion)?(id)?$|(^|[_-])sid($|[_-])|auth|token|jwt|logged_?in|login|remember|c_user|user_?id)/i;
const NOT_A_SIGN_IN = /^(_ga|_gid|_gat|_gcl|_fbp|_fbc|__utm|_hj|_pk_|amplitude|mp_|ajs_|optimizely|optanon|cookieconsent|cf_|__cf|_cfuvid|_?csrf|_?xsrf|__stripe|nid$|consent|socs$|ide$|dsid$|visitor|tracking|__gads|__gpi|_clck|_clsk)/i;
const SIGN_IN_PATH = /(^|[/_.-])(log-?in|sign-?in|signin|sign_in|sso|auth|authorize|oauth2?|challenge|verify|2fa|mfa|passkey|identifier)([/_.-]|$)/i;
const SIGN_IN_HOST = /^(accounts|login|signin|auth|sso|id|account|secure)\./i;

/** True while a tab is still on a sign-in page for one of the site's own addresses. */
function onSignInPage(url, domains) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  if (!domains.some((d) => host === d || host.endsWith('.' + d))) return false;
  return SIGN_IN_PATH.test(parsed.pathname) || SIGN_IN_HOST.test(host);
}

/** Cookie names (with their domain) that look like "this browser is signed in" for one row. Names only. */
function signInCookies(item, cookies) {
  const provider = providerOf(item.host) || providerOf(item.iconHosts?.[item.iconHosts.length - 1] || '');
  const domains = item.cookieDomains;
  const keys = [];
  for (const cookie of cookies) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!domains.some((d) => domain === d || domain.endsWith('.' + d))) continue;
    const name = String(cookie.name || '');
    const specific = provider?.session ? provider.session.test(name) : false;
    const generic = !provider?.session && GENERIC_SESSION.test(name) && !NOT_A_SIGN_IN.test(name);
    if (specific || generic) keys.push({ key: domain + '|' + name, specific });
  }
  return keys;
}

const emptyFile = () => ({ v: 1, profiles: {} });

/**
 * @param {{file: string, now?: () => number, fsApi?: typeof fs}} options
 */
function createSignin({ file, now = Date.now, fsApi = fs }) {
  let data = null;
  const load = () => {
    if (data) return data;
    try {
      const raw = JSON.parse(fsApi.readFileSync(file, 'utf8'));
      data = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object' ? raw : emptyFile();
    } catch { data = emptyFile(); }
    return data;
  };
  let written = '';
  const save = () => {
    const text = JSON.stringify(data);
    if (text === written) return;
    try {
      fsApi.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + '.' + process.pid + '.tmp';
      fsApi.writeFileSync(temp, text);
      fsApi.renameSync(temp, file);
      written = text;
    } catch { /* the checklist still works for this run */ }
  };
  const profileRecord = (profileId) => {
    const all = load().profiles;
    return (all[profileId] ||= { createdAt: 0, dismissed: false, order: [], rows: {} });
  };

  /** Everything a request knows: history, bookmarks and saved-password hosts of the profile, and its cookies (names only). */
  function plan(profileId, input = {}) {
    const { visits = [], bookmarks = [], passwordOrigins = [], cookies = [], tabUrls = [], refresh = false, eligible = true } = input;
    const ranked = computeCandidates({ visits, bookmarks, passwordHosts: passwordOrigins, now: now(), limit: 40 });
    const known = load().profiles[profileId];
    // Offered after an import (or a password file) only: a profile that brought nothing over has nothing to sign back in to.
    if (!known && (!eligible || !ranked.length)) return { items: [], total: 0, done: 0, skipped: 0, dismissed: false, retired: false, createdAt: 0 };
    const rec = profileRecord(profileId);
    const byId = new Map(ranked.map((item) => [item.id, item]));
    if (!rec.order.length || refresh) {
      const limit = rec.order.length ? MAX_ROWS : FIRST_ROWS;
      for (const item of ranked) {
        if (rec.order.length >= limit) break;
        if (!rec.order.includes(item.id)) rec.order.push(item.id);
      }
      if (rec.order.length && !rec.createdAt) rec.createdAt = now();
    }
    const items = [];
    for (const id of rec.order) {
      const base = byId.get(id);
      if (!base) continue;
      const item = { ...base, cookieDomains: cookieDomainsOf(base) };
      let row = rec.rows[id];
      if (!row) {
        row = rec.rows[id] = { status: 'todo', by: '', baseline: signInCookies(item, cookies).map((c) => c.key).slice(0, 64) };
      }
      if (row.status === 'todo' || row.status === 'opened') {
        const fresh = signInCookies(item, cookies).filter((c) => !row.baseline.includes(c.key));
        const away = !tabUrls.some((url) => onSignInPage(url, item.cookieDomains));
        const specific = fresh.some((c) => c.specific);
        // A provider's own session cookie is proof enough once its tab has moved on; a guessed one counts only after the
        // person pressed Sign in on that row.
        if (fresh.length && away && (specific || row.status === 'opened')) { row.status = 'done'; row.by = 'detected'; row.doneAt = now(); }
      }
      const { cookieDomains, ...visible } = item;
      items.push({ ...visible, status: row.status, by: row.by || '', autofill: base.saved });
    }
    save();
    const counted = items.filter((item) => item.status !== 'skipped');
    return {
      items,
      total: counted.length,
      done: counted.filter((item) => item.status === 'done').length,
      skipped: items.length - counted.length,
      dismissed: rec.dismissed,
      retired: rec.createdAt > 0 && now() - rec.createdAt > RETIRE_AFTER_MS,
      createdAt: rec.createdAt,
    };
  }

  /** Marks a row opened (the person pressed Sign in), remembering which sign-in cookies were already there. */
  function open(profileId, id, input = {}) {
    const result = plan(profileId, input);
    const item = result.items.find((entry) => entry.id === id);
    if (!item) throw new Error('That site is not on the list.');
    const rec = profileRecord(profileId), row = rec.rows[id];
    if (row.status === 'todo' || row.status === 'skipped') row.status = 'opened';
    row.baseline = signInCookies({ ...item, cookieDomains: cookieDomainsOf(item) }, input.cookies || []).map((c) => c.key).slice(0, 64);
    row.openedAt = now();
    save();
    return { url: item.url };
  }

  function mark(profileId, id, status) {
    if (!['todo', 'done', 'skipped'].includes(status)) throw new Error('Choose done, to do or not now.');
    const rec = profileRecord(profileId), row = rec.rows[id];
    if (!rec.order.includes(id) || !row) throw new Error('That site is not on the list.');
    row.status = status;
    row.by = status === 'done' ? 'manual' : '';
    if (status === 'done') row.doneAt = now();
    save();
  }

  function dismiss(profileId, dismissed) {
    profileRecord(profileId).dismissed = Boolean(dismissed);
    save();
  }

  /** A profile that is removed takes its checklist with it. */
  function removeProfile(profileId) {
    if (load().profiles[profileId]) { delete data.profiles[profileId]; save(); }
  }

  return { plan, open, mark, dismiss, removeProfile };
}

/** The cookie domains that show a row's sign-in: the provider's own, else the site's registrable domain. */
function cookieDomainsOf(item) {
  const provider = providerOf(item.host) || (item.iconHosts || []).map((host) => providerOf(host)).find(Boolean);
  if (provider) return provider.cookieDomains || provider.domains;
  return [...new Set((item.iconHosts || [item.host]).map((host) => registrable(host)))];
}

module.exports = { createSignin, signInCookies, onSignInPage, hostOf, FIRST_ROWS, MAX_ROWS, RETIRE_AFTER_MS };
