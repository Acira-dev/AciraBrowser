'use strict';
// "Sign back in": which sites to offer after an import. Pure and on this computer: it reads the visit counts, bookmarks and
// saved-password hosts it is handed and returns a short, ranked, de-duplicated list. No network, no other browser's data.
const { PROVIDERS, NEVER, SECOND_LEVEL } = require('./providers.cjs');

const DAY = 86400000;
const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 30;
const BOOKMARK_BONUS = 6;
const SAVED_BONUS = 12;
// An account with a saved password but no visit in 90 days is still listed, below the ones in use.
const SAVED_ONLY_BONUS = 4;
const LOGIN_BONUS = 8;
const LOGIN_PATH = /(^|[/_.-])(log-?in|sign-?in|signin|sign_in|sso|auth|authorize|session|accounts?\/login)([/_.-]|$)/i;

/** A page address's host, lower-case, without "www.", only for ordinary web pages with a name (no IPs, no one-word hosts). */
function hostOf(value) {
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':') || host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.localhost') || host.endsWith('.internal')) return '';
  return host;
}

/** The part of a host a person would call "the site": example.com for app.example.com, example.co.uk for www.example.co.uk. */
function registrable(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return labels.slice(SECOND_LEVEL.has(labels.slice(-2).join('.')) ? -3 : -2).join('.');
}

/** The provider an address belongs to: the longest matching owned domain wins (aws.amazon.com is AWS, not Amazon). */
function providerOf(host, providers = PROVIDERS) {
  let best = null;
  let length = -1;
  for (const provider of providers) {
    for (const domain of provider.domains) {
      if ((host === domain || host.endsWith('.' + domain)) && domain.length > length) { best = provider; length = domain.length; }
    }
  }
  if (best) return best;
  const root = registrable(host);
  const label = root.split('.')[0];
  return providers.find((provider) => provider.labels?.includes(label) && root.length > label.length + 1) || null;
}

const never = (host) => { const root = registrable(host); return NEVER.has(root) || NEVER.has(host); };

/** A visit's weight: 1 for today, half after a month, nothing after ninety days. */
function weight(age) {
  if (age < 0) return 1;
  if (age > WINDOW_DAYS * DAY) return 0;
  return Math.pow(0.5, age / (HALF_LIFE_DAYS * DAY));
}

/** A sign-in page the person already used, without its query or fragment (those can carry codes or return addresses). */
function loginPageOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !LOGIN_PATH.test(parsed.pathname)) return '';
    return parsed.origin + parsed.pathname;
  } catch { return ''; }
}

function stamp(value) {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {{visits?: Array<{url: string, time: string|number}>, bookmarks?: Array<string|{url: string}>, passwordHosts?: string[], now?: number, limit?: number}} input
 * @returns {Array<{id: string, kind: 'provider'|'site', name: string, host: string, iconHosts: string[], covers: string[], visits: number, bookmarked: boolean, saved: boolean, url: string, score: number}>}
 */
function computeCandidates({ visits = [], bookmarks = [], passwordHosts = [], now = Date.now(), limit = 10 } = {}) {
  /** @type {Map<string, {host: string, visits: number, score: number, bookmarked: boolean, saved: boolean, login: string, loginAt: number, scheme: string}>} */
  const hosts = new Map();
  const entry = (host) => {
    let row = hosts.get(host);
    if (!row) { row = { host, visits: 0, score: 0, bookmarked: false, saved: false, login: '', loginAt: 0, scheme: 'https:' }; hosts.set(host, row); }
    return row;
  };
  for (const visit of visits) {
    const host = hostOf(visit?.url || '');
    if (!host || never(host)) continue;
    const at = stamp(visit.time), w = weight(now - at);
    if (!w) continue;
    const row = entry(host);
    row.visits++;
    row.score += w;
    const login = loginPageOf(visit.url);
    if (login && at >= row.loginAt) { row.login = login; row.loginAt = at; }
  }
  for (const item of bookmarks) {
    const host = hostOf(typeof item === 'string' ? item : item?.url || '');
    if (host && !never(host)) entry(host).bookmarked = true;
  }
  for (const item of passwordHosts) {
    const host = hostOf(item || '');
    if (host && !never(host)) entry(host).saved = true;
  }

  // One row per account: a provider's sites join into one, any other site by its registrable domain.
  /** @type {Map<string, {id: string, provider: any, members: any[], root: string}>} */
  const groups = new Map();
  for (const row of hosts.values()) {
    const provider = providerOf(row.host);
    const root = registrable(row.host);
    const id = provider ? provider.id : 'site:' + root;
    let group = groups.get(id);
    if (!group) { group = { id, provider, members: [], root }; groups.set(id, group); }
    group.members.push(row);
  }

  const out = [];
  for (const group of groups.values()) {
    const members = group.members.sort((a, b) => b.score - a.score || b.visits - a.visits || a.host.localeCompare(b.host));
    const visitCount = members.reduce((sum, m) => sum + m.visits, 0);
    const recency = members.reduce((sum, m) => sum + m.score, 0);
    const bookmarked = members.some((m) => m.bookmarked);
    const saved = members.some((m) => m.saved);
    const loginRow = members.filter((m) => m.login).sort((a, b) => b.loginAt - a.loginAt)[0];
    const login = loginRow?.login || '';
    const provider = group.provider;
    // Any other site: worth a row only when there is a sign of an account (a saved password, a sign-in page, a bookmark it
    // is used from) or it is simply used a lot.
    if (!provider && !(saved || login || (bookmarked && visitCount >= 2) || visitCount >= 6)) continue;
    const active = recency > 0;
    const score = recency + (bookmarked ? BOOKMARK_BONUS : 0) + (saved ? (active ? SAVED_BONUS : SAVED_ONLY_BONUS) : 0) + (login && active ? LOGIN_BONUS : 0);
    const best = members[0];
    let url;
    // A provider has its official sign-in page (Amazon signs in on the shop the person uses: amazon.de, amazon.co.uk).
    if (provider) url = provider.signIn.replace('{domain}', registrable(best.host));
    else url = login || 'https://' + best.host + '/';
    const iconHosts = provider ? [provider.domains[0], ...members.map((m) => m.host)] : members.map((m) => m.host);
    const seen = new Set();
    const coverNames = [];
    if (provider?.covers) {
      // Services the person actually uses first, then the account's best-known ones.
      const used = (cover) => members.some((m) => m.host === cover.host || m.host.endsWith('.' + cover.host));
      for (const cover of [...provider.covers.filter(used), ...provider.covers.filter((c) => !used(c))]) {
        if (!seen.has(cover.name)) { seen.add(cover.name); coverNames.push(cover.name); }
      }
    }
    out.push({
      id: group.id,
      kind: provider ? 'provider' : 'site',
      name: provider ? provider.name : registrable(best.host),
      host: iconHosts[0],
      iconHosts: [...new Set(iconHosts)],
      covers: coverNames.slice(0, 4),
      visits: visitCount,
      bookmarked,
      saved,
      url,
      score: Math.round(score * 100) / 100,
      pin: provider?.pin || 0,
    });
  }
  // The accounts that open many doors lead: Google, then Microsoft, then Apple; after them by score, ties by name.
  out.sort((a, b) => b.pin - a.pin || b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, Math.max(1, limit)).map(({ pin, ...rest }) => rest);
}

module.exports = { computeCandidates, hostOf, registrable, providerOf, loginPageOf, weight, WINDOW_DAYS };
