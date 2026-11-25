'use strict';
// The local state behind the daily usage message (schema 4, Beta 14), as pure functions with no file, clock or network in them, so tests run them
// directly. metrics.cjs reads and writes metrics.json; everything it keeps comes through `cleanState`, which trusts nothing in the file: every
// number is capped, every name must be on a closed list, and anything else is dropped.
//
// What lives here, and why it can be kept on this computer (it is deleted with the id when sharing is turned off, and never leaves except as a
// bucket or a closed-list value in the message):
//  - the id and the day it was made (it is replaced every 28 days; nothing follows an install for longer than that);
//  - counters since the last message that was sent: active seconds, sessions, page loads, searches per engine family, crashes, trackers blocked,
//    the most-opened Settings section, the highest memory use;
//  - the names of the features ever used and used in the first 3 days (the discovery fields);
//  - the setup funnel (once), the usage notice state (section C), the version of the last message (so an update is seen) and the billboard
//    states (section D) to report.
const facts = require('./usage-facts.cjs');

/** A new random id every 28 days (brief B1). */
const ID_DAYS = 28;
/** The notice stays until X, a link, or this long after setup finished (brief section C). */
const NOTICE_MS = 24 * 3600 * 1000;
/** After X, the Undo toast is on screen for about 8 s (12 s with a hold). The notice only settles, and the first message is only released, after this. */
const UNDO_MS = 2 * 60 * 1000;
const FIRST_DAYS = 3;

const small = (value, cap) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), cap) : 0; };
const names = (raw) => { const out = {}; for (const name of facts.USES) if (raw && raw[name]) out[name] = 1; return out; };
const inList = (list, value) => (list.includes(value) ? value : '');

function cleanDay(raw) {
  const day = raw && typeof raw === 'object' ? raw : {};
  const searches = {}; for (const engine of facts.SEARCH_ENGINES) { const n = small(day.searches && day.searches[engine], 1e6); if (n) searches[engine] = n; }
  const sections = {}; for (const id of facts.SETTINGS_SECTIONS) { const n = id === 'none' ? 0 : small(day.sections && day.sections[id], 1e6); if (n) sections[id] = n; }
  return { seconds: small(day.seconds, 86400 * 400), sessions: small(day.sessions, 1e5), pages: small(day.pages, 1e7), searches, sections, login: day.login === true ? true : day.login === false ? false : undefined,
    crashes: small(day.crashes, 1e5), memory: small(day.memory, 2 ** 45), trackers: small(day.trackers, 1e9) };
}
function cleanNotice(raw) {
  const notice = raw && typeof raw === 'object' ? raw : {};
  const how = ['', 'x', 'link', 'timeout', 'undoneThenX'].includes(notice.how) ? notice.how : '';
  return { startedAt: small(notice.startedAt, 1e14), how, pendingUntil: small(notice.pendingUntil, 1e14), undone: notice.undone === true };
}
function cleanFunnel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const funnel = { path: inList(facts.SETUP_PATHS, raw.path), step: inList(facts.SETUP_STEPS, raw.step), seconds: Number.isFinite(raw.seconds) && raw.seconds >= 0 ? Math.min(Math.floor(raw.seconds), 86400) : -1 };
  return funnel.path || funnel.step || funnel.seconds >= 0 ? funnel : null;
}
function cleanBillboard(raw) {
  const out = []; const seen = new Set();
  for (const card of Array.isArray(raw) ? raw : []) {
    if (!card || typeof card.id !== 'string' || !facts.BILLBOARD_ID.test(card.id) || !facts.BILLBOARD_STATES.includes(card.state)) continue;
    const key = card.id + ':' + card.state; if (seen.has(key)) continue; seen.add(key); out.push({ id: card.id, state: card.state });
    if (out.length >= 20) break;
  }
  return out;
}
const dayString = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '');
const versionString = (value) => (typeof value === 'string' && value.length <= 24 && facts.VERSION.test(value) ? value : '');

/** The parts of a saved file that belong to schema 4. `noticeMissing` is true for a file written before the notice existed (an upgrade). */
function cleanState(saved) {
  const raw = saved && typeof saved === 'object' ? saved : {};
  return { idCreated: dayString(raw.idCreated), day: cleanDay(raw.day), ever: names(raw.ever), early: names(raw.early), funnel: cleanFunnel(raw.funnel), notice: cleanNotice(raw.notice),
    noticeMissing: !(raw.notice && typeof raw.notice === 'object'), lastVersion: versionString(raw.lastVersion), billboard: cleanBillboard(raw.billboard),
    lastSentAt: small(raw.lastSentAt, 1e14) };
}

/** True when the id was made 28 or more days ago, or has no recorded day (a build before Beta 14 kept one id for ever). */
const idDue = (idCreated, today) => !idCreated || facts.daysBetween(idCreated, today) >= ID_DAYS;
/** The day the id will be replaced, 'YYYY-MM-DD'. */
const idResetDay = (idCreated) => (idCreated ? facts.addDaysTo(idCreated, ID_DAYS) : '');

/** firstToday / firstThisWeek / firstThisMonth / firstEver come from the last message that was SENT on this computer (not from the id, which is replaced), so
 *  counting the messages with a flag set gives daily, weekly and monthly active installs and new installs without anything that follows an install. */
function flagsFor({ lastSent, ever }, today, installedOn) {
  // `ever`: whether a first message was ever sent from this data folder (install-mark.cjs, brief B9). It decides firstEver; it is true even when `lastSent` is empty (sharing was turned off and on again, which
  // clears the choice's own record). Without it (older callers) a first message is one with no latest day.
  const first = !lastSent, counted = ever === undefined ? !first : ever === true;
  const days = installedOn ? Math.max(0, facts.daysBetween(installedOn, today)) : undefined;
  return { firstToday: lastSent !== today, firstThisWeek: first || facts.isoWeekOf(lastSent) !== facts.isoWeekOf(today), firstThisMonth: first || lastSent.slice(0, 7) !== today.slice(0, 7), firstEver: !counted,
    ...(installedOn ? { installWeek: facts.isoWeekOf(installedOn), installDay: days <= 29 ? days : undefined, daysSinceInstall: days } : {}) };
}
const daysSinceInstall = (installedOn, today) => (installedOn ? Math.max(0, facts.daysBetween(installedOn, today)) : undefined);
/** The feature was used in the first 3 days after install (day 0, 1 or 2). */
const inFirstDays = (installedOn, today) => installedOn && facts.daysBetween(installedOn, today) <= FIRST_DAYS - 1 && facts.daysBetween(installedOn, today) >= 0;

// ---- the usage notice (section C) -----------------------------------------------------------------------------------------------------------
/** What the notice is now. `applies`: a notice was ever due for this install (setup's initialisation, or an upgrade that was already sharing); a person who turned
 *  sharing on in Settings never had one. `visible`: the banner shows. `pending`: X was pressed and the Undo toast may still be on screen. `settled`: the first message
 *  may be sent (X's undo time is over, a link was clicked, or 24 hours passed). `how`: the noticeSeen value once settled. */
function noticeStatus(rawNotice, now) {
  const notice = cleanNotice(rawNotice);
  if (!notice.startedAt) return { applies: false, visible: false, pending: false, settled: true, how: 'none', expiresAt: 0 };
  const expiresAt = notice.startedAt + NOTICE_MS;
  if (!notice.how) return now >= expiresAt ? { applies: true, visible: false, pending: false, settled: true, how: 'timeout', expiresAt } : { applies: true, visible: true, pending: false, settled: false, how: '', expiresAt };
  if (notice.how === 'link' || notice.how === 'timeout') return { applies: true, visible: false, pending: false, settled: true, how: notice.how, expiresAt };
  const pending = now < notice.pendingUntil;
  return { applies: true, visible: false, pending, settled: !pending, how: notice.how, expiresAt };
}
/** X: the banner goes and the Undo toast shows. A second X after an Undo is `undoneThenX`. */
function noticeClose(rawNotice, now) {
  const notice = cleanNotice(rawNotice); if (!notice.startedAt || notice.how === 'link' || notice.how === 'timeout') return notice;
  return { ...notice, how: notice.undone ? 'undoneThenX' : 'x', pendingUntil: now + UNDO_MS };
}
/** Undo, only while the toast can still be on screen. */
function noticeUndo(rawNotice, now) {
  const notice = cleanNotice(rawNotice);
  return (notice.how === 'x' || notice.how === 'undoneThenX') && now < notice.pendingUntil ? { ...notice, how: '', pendingUntil: 0, undone: true } : notice;
}
/** Either link (See exactly what we send, Turn off) was used. */
function noticeLink(rawNotice) {
  const notice = cleanNotice(rawNotice); return notice.startedAt && notice.how !== 'link' ? { ...notice, how: 'link', pendingUntil: 0 } : notice;
}
/** The 24 hours are over: remembered as `timeout` (read lazily, written at the next change). */
function noticeTimeout(rawNotice, now) {
  const notice = cleanNotice(rawNotice); return notice.startedAt && !notice.how && now >= notice.startedAt + NOTICE_MS ? { ...notice, how: 'timeout' } : notice;
}
const noticeStart = (now) => ({ startedAt: now, how: '', pendingUntil: 0, undone: false });

/** Compare two version strings such as 0.1.0-beta.13.8: numbers numerically, words equal. Returns -1, 0 or 1. */
function compareVersions(a, b) {
  const parts = (value) => String(value).split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parts(a), right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index], y = right[index];
    if (x === y) continue;
    if (x === undefined) return -1; if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}
/** What changed in the version since the last message that was sent: `ok` after an update (updateFrom = the earlier version), `rolledBack` after a downgrade,
 *  `failed` when the updater reported a failure and the version is the same, else `none`. */
function updateOutcome(lastVersion, appVersion, updateFailed) {
  if (lastVersion && lastVersion !== appVersion) { const order = compareVersions(lastVersion, appVersion); if (order < 0) return { updateFrom: lastVersion, updateResult: 'ok' }; if (order > 0) return { updateFrom: lastVersion, updateResult: 'rolledBack' }; }
  return { updateResult: updateFailed ? 'failed' : 'none' };
}

/** The Settings section opened most often since the last message (the later one wins a tie), or undefined. */
function topSection(sections) {
  let best, count = 0; for (const [id, n] of Object.entries(sections || {})) if (n >= count) { best = id; count = n; }
  return best;
}

module.exports = { ID_DAYS, NOTICE_MS, UNDO_MS, FIRST_DAYS, cleanState, cleanDay, cleanNotice, cleanFunnel, cleanBillboard, idDue, idResetDay, flagsFor, daysSinceInstall, inFirstDays, noticeStatus, noticeClose, noticeUndo, noticeLink, noticeTimeout, noticeStart, compareVersions, updateOutcome, topSection };
