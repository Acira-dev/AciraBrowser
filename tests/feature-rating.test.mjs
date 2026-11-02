// R4-60 / R4-61 on the client: the app's schema-3 lists equal the function's, the payload has no identifier, and the feature-rating
// card follows the founder's eligibility and cadence rules; its message is exactly what the function accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENUMS, USES, COUNTS, RATING_FEATURES, validate, validateRating } from '../supabase/functions/usage/handler.mjs';

const require = createRequire(import.meta.url);
const usage = require('../desktop/browser-services/usage-facts.cjs');
const rating = require('../desktop/browser-services/feature-rating.cjs');
const { createMetrics } = require('../desktop/browser-services/metrics.cjs');
const DAY_MS = 86400000, START = Date.parse('2026-10-27T09:00:00Z');

test('the app and the function agree on every schema-3 field, value and bucket, and on the rating features', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(usage.ENUMS)), JSON.parse(JSON.stringify(ENUMS)));
  assert.deepEqual([...usage.USES], [...USES]);
  assert.deepEqual([...usage.COUNT_BUCKETS], [...COUNTS]);
  assert.deepEqual([...rating.FEATURES], [...RATING_FEATURES]);
  for (const feature of Object.values(rating.SOURCES)) assert.ok(rating.FEATURES.includes(feature), feature);
});

test('no identifier can reach the daily payload, whatever the local facts say', () => {
  const hostile = { windowView: 'https://evil.example/', interfaceScale: 133, adBlocking: 'maybe', linkPreview: 1, proxy: 'socks5://10.0.0.1:9050', workspaces: 999, tabsOpen: 37, windows: -1, splitPanes: 7, setup: 'C:\\Users\\Alice', shortcutsCustom: 'Ctrl+Alt+K', signBackIn: { total: 7, done: 3, sites: ['bank.example'] }, passwordsImported: 'alice@example.org' };
  const out = usage.sanitize(hostile, { commandBar: 41, unknown: 5 }, { tabsOpen: 120 });
  assert.equal(out.tabsOpen, '101+', 'the higher of the live count and the day peak, as a bucket');
  assert.deepEqual([out.windowView, out.interfaceScale, out.adBlocking, out.linkPreview, out.proxy, out.workspaces, out.windows, out.splitPanes, out.setup, out.shortcutsCustom, out.signBackIn, out.passwordsImported, out.commandBar],
    ['unknown', 'other', 'unknown', 'unknown', 'unknown', '5+', '1', '4', 'unknown', 'no', '1-49', 'no', '10+']);
  assert.doesNotMatch(JSON.stringify(out), /evil|socks|10\.0|Alice|bank|example|Ctrl|37|133/);
  for (const [field, list] of Object.entries(usage.ENUMS)) assert.ok(list.includes(out[field]), field);
  assert.ok(!('unknown' in out));
});

function make(extra = {}) {
  let time = START; const sent = [];
  const metrics = createMetrics({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-rating-')), endpoint: 'https://x.supabase.co/functions/v1/usage', appVersion: '0.9.4', platform: 'darwin', arch: 'arm64', language: 'en', send: async (url, body) => { sent.push(JSON.parse(body)); return 204; }, now: () => time, ...extra });
  return { metrics, sent, advance: (ms) => { time += ms; } };
}

test('rating state machine: 3 uses, 2 days, not the first session, 10 quiet minutes, one ask a week, never again once answered or dismissed twice', () => {
  const at = (day, extra = {}) => ({ sharing: true, ask: true, today: day, launchedAt: 0, now: rating.RULES.quietMs, ...extra });
  let s = rating.startSession(null, '2026-10-27');
  for (let i = 0; i < 3; i++) s = rating.countUse(s, 'splitView');
  s = rating.countUse(s, 'not-a-feature');
  assert.equal(rating.blocker(s, at('2026-10-28')), 'too new'); assert.equal(rating.nextFeature(s, at('2026-10-28')), null);
  assert.equal(rating.blocker(s, at('2026-10-29')), 'first session', 'the first session never asks');
  s = rating.startSession(s, '2026-10-29');
  assert.equal(rating.nextFeature(s, at('2026-10-29')), 'splitView');
  assert.equal(rating.blocker(s, at('2026-10-29', { now: rating.RULES.quietMs - 1 })), 'just launched');
  assert.equal(rating.blocker(s, at('2026-10-29', { now: 1, quietMs: 0 })), '', 'the QA-only quiet override (test data only) changes nothing else');
  assert.equal(rating.blocker(s, at('2026-10-29', { sharing: false })), 'sharing off', 'sharing off: never asks');
  assert.equal(rating.blocker(s, at('2026-10-29', { ask: false })), 'asking off');
  s = rating.countUse(rating.countUse(s, 'peek'), 'peek');
  assert.equal(rating.nextFeature(s, at('2026-10-29')), 'splitView', 'peek has only 2 uses');
  s = rating.shown(s, 'splitView', '2026-10-29');
  assert.equal(rating.blocker(s, at('2026-11-04')), 'asked recently', 'six days later');
  s = rating.dismissed(s, 'splitView');
  assert.equal(rating.nextFeature(s, at('2026-11-05')), 'splitView', 'one dismissal: may ask again after a week');
  s = rating.dismissed(rating.shown(s, 'splitView', '2026-11-05'), 'splitView');
  s = rating.countUse(s, 'peek');
  assert.equal(rating.nextFeature(s, at('2026-11-12')), 'peek', 'dismissed twice: never splitView again');
  s = rating.answered(rating.shown(s, 'peek', '2026-11-12'), 'peek');
  assert.equal(rating.nextFeature(s, at('2026-12-30')), null, 'answered: never again');
  for (let i = 0; i < 5000; i++) s = rating.countUse(s, 'rewind');
  assert.equal(rating.clean(s).counts.rewind, rating.RULES.cap, 'counts are capped');
  assert.deepEqual(Object.keys(rating.clean({ counts: { evil: 9, rewind: 4 }, answered: ['evil', 'peek'], url: 'https://x' })).sort(), ['answered', 'counts', 'dismissed', 'lastAsk', 'sessions', 'since']);
});

test('rating message: exactly what the function accepts, nothing else, and only valid answers', () => {
  const message = rating.ratingMessage({ feature: 'workspaces', stars: 3, appVersion: '0.9.4', platform: 'win32', day: '2026-10-27' });
  assert.deepEqual(Object.keys(message).sort(), ['appVersion', 'day', 'event', 'feature', 'platform', 'schema', 'stars']);
  assert.ok(validateRating(message, Date.parse('2026-10-27T12:00:00Z')));
  for (const bad of [{ stars: 0 }, { stars: 6 }, { stars: 2.5 }, { feature: 'history' }, { platform: 'android' }, { day: 'today' }]) assert.equal(rating.ratingMessage({ feature: 'peek', stars: 4, appVersion: '1.0.0', platform: 'linux', day: '2026-10-27', ...bad }), null, JSON.stringify(bad));
});

test('the real client: no card while sharing is off, then one card after the rules pass; the answer sends only the rating fields', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-rating-live-'));
  let time = START; const sent = [];
  const open = () => createMetrics({ directory, endpoint: 'https://x.supabase.co/functions/v1/usage', appVersion: '0.9.4', platform: 'darwin', arch: 'arm64', language: 'en', send: async (url, body) => { sent.push(JSON.parse(body)); return 204; }, now: () => time });
  let metrics = open();
  for (let i = 0; i < 5; i++) metrics.note('splitView');
  assert.equal(metrics.ratingOffer(), null, 'sharing unset: nothing counted, nothing asked');
  await metrics.set(true); metrics.ratingSession();
  for (let i = 0; i < 3; i++) metrics.note('splitView');
  metrics.note('sidebarTabs');
  time += 3 * DAY_MS; metrics = open(); time += rating.RULES.quietMs;
  assert.equal(metrics.ratingOffer(), 'splitView');
  metrics.ratingShown('splitView');
  assert.equal(metrics.ratingOffer(), null, 'one ask, then a week of quiet');
  assert.deepEqual(await metrics.ratingAnswer('splitView', 5), { sent: true });
  const [message] = sent;
  assert.deepEqual(message, { schema: 1, event: 'rating', feature: 'splitView', stars: 5, appVersion: '0.9.4', platform: 'darwin', day: '2026-10-30' });
  assert.ok(!('installId' in message), 'a rating carries no install id');
  await assert.rejects(metrics.ratingAnswer('splitView', 9), /1 to 5/);
  const status = await metrics.status();
  assert.deepEqual(Object.keys(status.ratingPayload).sort(), Object.keys(message).sort(), '"What\'s sent" lists the rating fields');
  assert.ok(validate(status.payload, time), 'the daily payload still validates');
  await metrics.setAskRatings(false); time += 30 * DAY_MS; metrics = open(); time += rating.RULES.quietMs;
  for (let i = 0; i < 3; i++) metrics.note('peek');
  assert.equal(metrics.ratingOffer(), null, 'asking switched off');
  await metrics.setAskRatings(true); assert.equal(metrics.ratingOffer(), 'peek');
  await metrics.set(false);
  assert.equal(metrics.ratingOffer(), null, 'sharing off: never asks');
  assert.deepEqual(await metrics.ratingAnswer('peek', 4), { sent: false, reason: 'off' }, 'and never sends');
  assert.equal(sent.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'metrics.json'), 'utf8'));
  assert.deepEqual(saved.rating.counts, {}, 'turning sharing off deletes the rating counts');
});

test('peaks: the day\'s highest tabs, windows and split panes, only while on, reset after a send', async () => {
  const { metrics, sent, advance } = make();
  metrics.notePeaks({ tabsOpen: 50 }); assert.equal((await metrics.status()).payload.tabsOpen, '1-5', 'nothing kept while unset');
  await metrics.set(true);
  metrics.notePeaks({ tabsOpen: 20, windows: 3, splitPanes: 3 }); metrics.notePeaks({ tabsOpen: 7, splitPanes: 4 });
  const p = (await metrics.status()).payload;
  assert.deepEqual([p.tabsOpen, p.windows, p.splitPanes], ['16-40', '3-5', '4']);
  await metrics.maybeSend(); assert.equal(sent[0].tabsOpen, '16-40');
  advance(DAY_MS); assert.equal((await metrics.status()).payload.splitPanes, 'none', 'a new day starts again');
  metrics.notePasswordsImported(); metrics.noteSignBackIn({ total: 8, done: 6, items: ['bank.example'] });
  const q = (await metrics.status()).payload;
  assert.deepEqual([q.passwordsImported, q.signBackIn], ['yes', '50-99']);
  assert.doesNotMatch(JSON.stringify(q), /bank/);
});
