'use strict';
// Beta 14: points and ranks, as a LOCAL COPY. The server holds the truth (the team award points and ranks); this file only keeps what it
// last said, so the profile viewer opens instantly and offline, and decides what to show. The server's answer always wins: normalizeServer takes
// everything from the answer and invents nothing. In particular the point thresholds for Trusted Contributor and Insider are OPEN (the brief proposes
// 50 and 150): they come from the server's answer (`thresholds`) and are null until it has said them, and then no "N points away" figure is shown.
// Everything that comes from the network is untrusted: ids, enums, numbers and text are checked and cut here, once.

/** The four ranks in order, lowest first. Early Member is a mark, not a rank (see MARKS). */
const RANKS = Object.freeze(['contributor', 'trusted', 'insider', 'founding']);
const MARKS = Object.freeze(['earlyMember']);
const REPORT_STATUSES = Object.freeze(['received', 'working', 'fixed']);
const NOTE_KINDS = Object.freeze(['accepted', 'shipped', 'invited']);   // 'invited' (Beta 14.5): a friend joined with the member's invite code; an older build drops a kind it does not know
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/;
const MAX_REPORTS = 200, MAX_NOTES = 50, MAX_POINTS = 1000000;

const rankIndex = (rank) => RANKS.indexOf(rank);
const int = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);
const iso = (value) => { if (typeof value !== 'string' || value.length > 40) return null; const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
const plain = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').trim().slice(0, max) : '');

/** The thresholds as the server said them, or null while it has not (or said something that does not make sense). */
function normalizeThresholds(raw) {
  const trusted = int(raw?.trusted, 1, MAX_POINTS), insider = int(raw?.insider, 1, MAX_POINTS);
  return trusted !== null && insider !== null && trusted < insider ? { trusted, insider } : null;
}

/** One server answer ({points, rank, thresholds, reports, notes}) cleaned for keeping; null when it is not an answer at all. */
function normalizeServer(raw, { now = () => Date.now() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const points = int(raw.points, 0, MAX_POINTS);
  if (points === null) return null;
  const rank = raw.rank === null || raw.rank === 'none' || raw.rank === undefined ? null : RANKS.includes(raw.rank) ? raw.rank : undefined;
  if (rank === undefined) return null;
  const reports = [];
  for (const item of Array.isArray(raw.reports) ? raw.reports.slice(0, MAX_REPORTS) : []) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id) || !REPORT_STATUSES.includes(item.status)) continue;
    reports.push({ id: item.id, status: item.status, release: item.status === 'fixed' && typeof item.release === 'string' && RELEASE.test(item.release) ? item.release : null, at: iso(item.at) });
  }
  const notes = [];
  for (const item of Array.isArray(raw.notes) ? raw.notes.slice(0, MAX_NOTES) : []) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id) || !NOTE_KINDS.includes(item.kind)) continue;
    notes.push({
      id: item.id, kind: item.kind, reportId: typeof item.reportId === 'string' && ID.test(item.reportId) ? item.reportId : null,
      points: item.kind === 'accepted' || item.kind === 'invited' ? int(item.points, 1, MAX_POINTS) : null,
      rank: item.kind === 'accepted' && RANKS.includes(item.rank) ? item.rank : null,   // an invite never carries a rank
      askName: item.kind === 'accepted' && item.askName === true,
      release: item.kind === 'shipped' && typeof item.release === 'string' && RELEASE.test(item.release) ? item.release : null,
      at: iso(item.at),
    });
  }
  // the member record per rank (Beta 14): the number the server issued where the rank was granted (sequential per rank) and the month it was granted ('2026-11')
  const members = {};
  for (const kind of ['early', ...RANKS]) { const item = raw.members?.[kind]; if (item && Number.isInteger(item.number) && item.number >= 1 && item.number <= 99999999 && typeof item.since === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.since)) members[kind] = { number: item.number, since: item.since }; }
  return {
    points, rank, members, thresholds: normalizeThresholds(raw.thresholds), reports, notes,
    fetchedAt: now(),
  };
}

/** The mark and rank a profile shows. The rank comes only from the server's copy; the mark is the local Early Member mark. */
const shownRank = (local) => local?.server?.rank ?? null;

/** What the next rank needs, from the server's own thresholds: {rank, away} (away is null when it is not about points), or null at the top. */
function nextStep(local) {
  const server = local?.server;
  if (!server) return null;
  const rank = server.rank;
  if (rank === 'founding') return null;
  if (rank === null) return { rank: 'contributor', away: null };
  if (!server.thresholds) return null;
  if (rank === 'contributor') return { rank: 'trusted', away: Math.max(0, server.thresholds.trusted - server.points) };
  // Points alone never give Insider in this build (the word needs a certificate: feedback-service view()), so a Trusted profile is never told how far away it is, and Founding is by invitation too: no figure for any of them.
  return null;
}

/** The aura a change earns, or null: a rank that is higher than the last one the profile saw (and not yet shown), else nothing. */
const rankAuraId = (rank) => `rank:${rank}`;

/** Applies a normalized server answer to the local copy. Returns {local, newRank} where newRank is the rank that was gained (the aura's reason) or null. */
function applyServer(local, server, { certified = false } = {}) {
  const before = shownRank(local);
  const gained = server.rank && rankIndex(server.rank) > rankIndex(before) ? server.rank : null;
  const known = new Set((local.notesSeen || []));
  // A note that was already in the last answer does not light the dot again: only one that is new since.
  const previous = new Set((local.server?.notes || []).map((note) => note.id));
  const unseen = server.notes.some((note) => !known.has(note.id) && !previous.has(note.id));
  const next = { ...local, server, engaged: true };
  // A new rank earns one aura, once. With the switch off nothing plays, and it is not saved up to play later: the rank counts as shown.
  if (gained && !(local.aura?.played || []).includes(rankAuraId(gained))) next.aura = local.off ? { ...(local.aura || { pending: null }), played: [...(local.aura?.played || []), rankAuraId(gained)] } : { ...(local.aura || { played: [] }), pending: rankAuraId(gained) };
  if (unseen && !local.off) next.dot = true;
  // Beta 14.4 (reported 24 Nov): an accepted report that only adds POINTS is announced by the same bubble as a new rank. The points of the acceptances that arrive now are added up (several at once = one bubble with the
  // total, and what was not announced yet stays in the total), each note once (`pointsCounted`). A new rank in the same answer is announced by the rank's bubble and its note already carries the points, so they are not
  // announced again, except for a certificate holder, whose rank never changes (the rank's bubble never plays for them). With the switch off nothing is saved up. The dot is as it was.
  const counted = new Set(local.pointsCounted || []);
  const fresh = server.notes.filter((note) => note.kind === 'accepted' && Number.isInteger(note.points) && note.points > 0 && !known.has(note.id) && !previous.has(note.id) && !counted.has(note.id));
  if (fresh.length) {
    next.pointsCounted = [...counted, ...fresh.map((note) => note.id)].slice(-400);
    if (!local.off && (certified || !gained)) next.pointsOwed = Math.min(1000000, (Number.isInteger(local.pointsOwed) ? local.pointsOwed : 0) + fresh.reduce((sum, note) => sum + note.points, 0));
  }
  // Beta 14.5 (reported 25 Nov: "Yes, add points"): a friend who joined with the member's invite code adds points. Its bubble says so ("Your friend joined: +25 points"), so its points are their own total (`inviteOwed`),
  // each note once (`inviteCounted`); never part of a rank's bubble (an invite never changes a rank). With the switch off nothing is saved up.
  const invitedBefore = new Set(local.inviteCounted || []);
  const friends = server.notes.filter((note) => note.kind === 'invited' && Number.isInteger(note.points) && note.points > 0 && !known.has(note.id) && !previous.has(note.id) && !invitedBefore.has(note.id));
  if (friends.length) {
    next.inviteCounted = [...invitedBefore, ...friends.map((note) => note.id)].slice(-400);
    if (!local.off) next.inviteOwed = Math.min(1000000, (Number.isInteger(local.inviteOwed) ? local.inviteOwed : 0) + friends.reduce((sum, note) => sum + note.points, 0));
  }
  // The ring around the picture is the rank's own colour; a new rank's ring appears when its aura has been drawn back into the button (auraDone), not before. Without an aura due (the
  // switch is off, or it was shown already) the ring follows the rank at once.
  next.ringRank = next.aura?.pending && next.aura.pending !== 'earlyMember' && server.rank ? local.ringRank ?? null : server.rank ?? null;
  return { local: next, newRank: gained };
}

/** The view the interface gets: no secrets, nothing that is not shown. `off` hides points, rank, ring, aura and notes (report status still works). */
function viewOf(local, { available = false, privateOrTor = false, key = 'ready' } = {}) {
  const off = Boolean(local?.off);
  const server = local?.server ?? null;
  const base = { available, off, key, privateOrTor, member: null, aura: null, engaged: Boolean(local?.engaged), mark: null, rank: null, points: 0, next: null, thresholds: null, notes: [], reports: [], dot: false, thresholdsKnown: Boolean(server?.thresholds) };
  const sent = Array.isArray(local?.sent) ? local.sent : [];
  const byId = new Map((server?.reports ?? []).map((item) => [item.id, item]));
  // Your reports: what this profile sent, with the server's coarse status for it. Status works with the switch off too.
  base.reports = sent.map((item) => ({ id: item.id, kind: item.kind, snippet: item.snippet, at: item.at, status: byId.get(item.id)?.status ?? 'received', release: byId.get(item.id)?.release ?? null })).reverse();
  if (off || privateOrTor) return base;
  base.mark = local?.earlyMember ? 'earlyMember' : null;
  base.rank = shownRank(local);
  base.points = server?.points ?? 0;
  // the member record of the card this profile shows (the top rank, else the Early Member mark): its number and the month it was granted; null until the server has issued one
  base.member = server?.members?.[base.rank ?? (base.mark ? 'early' : '')] ?? null;
  base.next = nextStep(local);
  base.thresholds = server?.thresholds ?? null;
  const seen = new Set(local?.notesSeen || []);
  base.notes = (server?.notes ?? []).filter((note) => !seen.has(note.id));
  base.dot = Boolean(local?.dot);
  base.aura = local?.aura?.pending ?? null;   // the aura this profile is owed ('earlyMember' or 'rank:<rank>'): the interface asks main to play it when the window is calm
  return base;
}

module.exports = { RANKS, MARKS, REPORT_STATUSES, NOTE_KINDS, rankIndex, normalizeServer, normalizeThresholds, nextStep, applyServer, viewOf, shownRank, rankAuraId, plain };
