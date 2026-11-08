'use strict';
// Live pull requests (item 31): the rows a source hands over, the folder's filters, and what the sidebar is told to draw.
// Pure functions only: no network, no files, no Electron. Sources (github-session.cjs, mock.cjs) produce adapter rows; this
// file turns them into what the interface shows, so the same rules are tested once.
//
// An adapter row is the whole contract between a source and the folder:
//   { id, title, url, repo, number, state: 'open'|'closed'|'merged', draft, reviewRequested, updatedAt, relations }
// `relations` says why the person sees it: 'author' (yours), 'review' (a review is asked of you), 'assigned', 'mentioned',
// or 'recent' (it closed or merged lately). A source that cannot tell may leave it empty.

const RELATIONS = Object.freeze(['author', 'review', 'assigned', 'mentioned']);
const DAY = 24 * 3600 * 1000;
const MAX_ROWS = 60;
const MAX_REPOS = 40;
const NAME_MAX = 64;

/** The filters a new folder starts with (the design: Created by me, Review requested, Assigned to me and Drafts on; Mentioned and Recently merged or closed off). */
const defaultFilters = () => ({ author: true, review: true, assigned: true, mentioned: false, drafts: true, recent: false, repos: null });

const isRepo = (value) => typeof value === 'string' && /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(value) && value.split('/').every((part) => !/^\.+$/.test(part));

/** Filters from anything stored or sent: unknown keys dropped, wrong types back to the default, repositories de-duplicated and capped. */
function normalizeFilters(raw) {
  const base = defaultFilters();
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const key of ['author', 'review', 'assigned', 'mentioned', 'drafts', 'recent']) if (typeof input[key] === 'boolean') base[key] = input[key];
  if (Array.isArray(input.repos)) base.repos = [...new Set(input.repos.filter(isRepo))].slice(0, MAX_REPOS);
  return base;
}

/** A change to the filters from the interface: only keys of the right type apply, anything else leaves the current value alone. */
function patchFilters(before, patch) {
  const next = { ...normalizeFilters(before) };
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  for (const key of ['author', 'review', 'assigned', 'mentioned', 'drafts', 'recent']) if (typeof input[key] === 'boolean') next[key] = input[key];
  if (input.repos === null) next.repos = null;
  else if (Array.isArray(input.repos)) next.repos = normalizeFilters({ repos: input.repos }).repos;
  return next;
}

/** Which relations a source must be asked for (the ones switched on). */
function relationsWanted(filters) {
  return RELATIONS.filter((relation) => filters[relation]);
}

/** A github.com pull request address, or null (only https://github.com/<owner>/<repo>/pull/<n>). */
function pullUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) return null;
    const match = /^\/([\w.-]{1,100})\/([\w.-]{1,100})\/pull\/(\d{1,9})\/?$/.exec(url.pathname);
    return match ? `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` : null;
  } catch { return null; }
}

/** Text from a source for a single line: tags and entities of highlighted search titles removed, control characters turned to spaces, 200 characters at most. */
function plainTitle(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" }[name]))
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** One adapter row from whatever a source produced, or null when it is not a usable pull request. */
function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = pullUrl(raw.url);
  const match = url && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url);
  if (!match) return null;
  const repo = match[1], number = Number(match[2]);
  const state = raw.state === 'merged' || raw.merged === true ? 'merged' : raw.state === 'closed' ? 'closed' : 'open';
  const title = plainTitle(raw.title) || `${repo}#${number}`;
  const updated = Number(raw.updatedAt);
  const relations = [...new Set((Array.isArray(raw.relations) ? raw.relations : []).filter((item) => RELATIONS.includes(item) || item === 'recent'))];
  return {
    id: `${repo}#${number}`, title, url, repo, number, state,
    draft: state === 'open' && raw.draft === true,
    reviewRequested: state === 'open' && raw.reviewRequested === true,
    updatedAt: Number.isFinite(updated) && updated > 0 ? Math.floor(updated) : 0,
    relations,
  };
}

/** Rows from several queries as one list: a pull request seen twice keeps all its relations, and counts as review-requested if any copy was. */
function mergeRows(lists) {
  const byId = new Map();
  for (const list of lists) for (const raw of list || []) {
    const row = normalizeRow(raw);
    if (!row) continue;
    const known = byId.get(row.id);
    if (!known) { byId.set(row.id, row); continue; }
    known.relations = [...new Set([...known.relations, ...row.relations])];
    known.reviewRequested ||= row.reviewRequested;
    if (row.updatedAt > known.updatedAt) { known.updatedAt = row.updatedAt; known.title = row.title; known.state = row.state; known.draft = row.draft; }
  }
  return [...byId.values()];
}

/** The rows the folder shows: relations that are switched on, drafts, the chosen repositories, finished ones only when asked for (and then only a day),
 *  and the ones the person hid that have not changed since. Open first, the most recently touched first within each. */
function visibleRows(rows, filters, { now = Date.now(), hidden = {} } = {}) {
  const wanted = relationsWanted(filters);
  const shown = rows.filter((row) => {
    const mark = hidden[row.id];
    if (mark && row.updatedAt <= mark.updatedAt && row.state === mark.state) return false;
    if (filters.repos && !filters.repos.includes(row.repo)) return false;
    if (row.state !== 'open') return filters.recent && (row.updatedAt === 0 || now - row.updatedAt <= DAY);
    if (row.draft && !filters.drafts) return false;
    return !row.relations.length || row.relations.some((relation) => wanted.includes(relation));
  });
  const rank = (row) => (row.state === 'open' ? 0 : 1);
  return shown.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, MAX_ROWS);
}

/** Every repository in the rows, for the Repositories list (the chosen ones that nothing matches now stay listed). */
function repositoriesOf(rows, filters) {
  return [...new Set([...rows.map((row) => row.repo), ...(filters.repos || [])])].sort((a, b) => a.localeCompare(b)).slice(0, MAX_REPOS);
}

/** The hidden marks that still matter: a row that is gone from the list for good no longer needs its mark. */
function pruneHidden(hidden, rows) {
  const live = new Set(rows.map((row) => row.id));
  return Object.fromEntries(Object.entries(hidden || {}).filter(([id]) => live.has(id)));
}

/** A folder's name: trimmed, single line, empty falls back to the default. */
function folderName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name || 'Pull requests';
}

module.exports = { RELATIONS, DAY, MAX_ROWS, defaultFilters, normalizeFilters, patchFilters, relationsWanted, pullUrl, plainTitle, normalizeRow, mergeRows, visibleRows, repositoriesOf, pruneHidden, folderName, isRepo };
