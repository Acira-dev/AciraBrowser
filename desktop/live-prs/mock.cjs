'use strict';
// A stand-in source for tests, pictures and QA runs on a test profile (ACIRA_TEST_LIVE_PRS, see service.cjs): fake pull requests in
// made-up repositories, or a scripted run of answers. It never touches the network and never reads a real account.
const HOUR = 3600 * 1000;

/** A believable list for pictures: yours, a review asked of you, a draft, one merged and one closed a few hours ago. */
function mockRows(now = Date.now()) {
  const row = (repo, number, title, extra) => ({ url: `https://github.com/${repo}/pull/${number}`, title, state: 'open', draft: false, reviewRequested: false, relations: ['author'], updatedAt: now, ...extra });
  return [
    row('acme/browser', 412, 'Fix sidebar flicker on resize', { updatedAt: now - 20 * 60e3 }),
    row('acme/browser', 418, 'Add keyboard path to the tab switcher', { relations: ['review'], reviewRequested: true, updatedAt: now - 55 * 60e3 }),
    row('acme/browser', 405, 'Folders in their own area', { draft: true, updatedAt: now - 3 * HOUR }),
    row('acme/website', 88, 'Update German strings', { state: 'merged', relations: ['recent'], updatedAt: now - 5 * HOUR }),
    row('acme/website', 91, 'Try a wider hover card', { state: 'closed', relations: ['recent'], updatedAt: now - 7 * HOUR }),
    row('acme/docs', 230, 'Document the update channel', { relations: ['assigned'], updatedAt: now - 26 * HOUR }),
  ];
}

/** Variants a QA run can ask for: `mock`, `mock:empty`, `mock:signed-out`, `mock:offline`, `mock:rate-limited`, `mock:unreadable`. */
function mockSourceFor(kind, now = Date.now) {
  const name = String(kind || 'mock').split(':')[1] || 'ok';
  const answer = {
    ok: () => ({ ok: true, rows: mockRows(now()), more: false }),
    empty: () => ({ ok: true, rows: [], more: false }),
    'signed-out': () => ({ ok: false, reason: 'signed-out' }),
    offline: () => ({ ok: false, reason: 'offline' }),
    'rate-limited': () => ({ ok: false, reason: 'rate-limited', retryAfterMs: 5 * 60e3 }),
    unreadable: () => ({ ok: false, reason: 'unreadable' }),
  }[name] || (() => ({ ok: false, reason: 'unreadable' }));
  return { id: 'mock', calls: [], async fetch(request) { this.calls.push(request); return answer(); } };
}

/** A scripted source: each call takes the next answer (the last one repeats). `answers` are source results or functions returning them. */
function scriptedSource(answers) {
  let at = 0;
  const source = { id: 'mock', calls: [], async fetch(request) { source.calls.push(request); const next = answers[Math.min(at++, answers.length - 1)]; return typeof next === 'function' ? next(request) : next; } };
  return source;
}

module.exports = { mockRows, mockSourceFor, scriptedSource };
