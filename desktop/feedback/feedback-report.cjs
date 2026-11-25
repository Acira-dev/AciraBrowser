'use strict';
// Beta 14: the message a report sends, and nothing else. The pop-up shows preview()'s payload and send() rebuilds the same one from the same inputs,
// so what is shown is what is sent (the same rule as the older site report, desktop/browser-services/site-reports.cjs, which keeps its own job:
// reports about a WEBSITE for the threat and allow lists). This one is for reports and ideas about Acira itself, sent to Acira's feedback server
// with the profile's contributor proof, only when the person presses Send, never from a Tor window.
//
// Always in a report: kind, category, the text, Acira's version, channel and the system family. Only when "Include technical details" is ticked:
// a short closed list of facts (TECHNICAL), each from a fixed list or a bucket, never a path, a user name, a device name, an address or a page.
const { LIMITS, sentName } = require('./feedback-media.cjs');

const SCHEMA = 2;
const KINDS = Object.freeze(['bug', 'idea']);
/** The chips on the Report tab. */
const CATEGORIES = Object.freeze(['broken', 'looks', 'crash', 'site']);
const PLATFORMS = Object.freeze(['darwin', 'win32', 'linux']);
const TEXT_MAX = 4000;
/** The technical details and the rule each value must pass; anything else is dropped. The order is the order the pop-up lists them in. */
const TECHNICAL = Object.freeze({
  os: /^(?:macOS \d{1,2}|Windows (?:10|11|\d{1,2})|Linux)$/,
  arch: /^(?:x64|arm64|ia32|other)$/,
  language: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/,
  displayScale: /^(?:1|1\.25|1\.5|1\.75|2|2\.5|3|other)$/,
  theme: /^(?:light|dark)$/,
  layout: /^[a-z][a-z-]{0,23}$/,
  motion: /^(?:full|reduced)$/,
  gpu: /^(?:hardware|software)$/,
  memory: /^(?:<4|4-8|8-16|16-32|32\+) GB$/,
  monitors: /^(?:1|2|3\+)$/,
});

/** The text as it will be sent: trimmed, line breaks as \n, no other control characters, at most 4000 characters. */
function cleanText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('The text must be text.');
  const text = value.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').trim();
  if ([...text].length > TEXT_MAX) throw new Error(`Keep it under ${TEXT_MAX} characters.`);
  return text;
}

/** The facts main collected, cut to the closed list (an unknown key or a value that fails its rule is dropped, never sent). */
function technicalDetails(facts) {
  const out = {};
  for (const [key, rule] of Object.entries(TECHNICAL)) if (typeof facts?.[key] === 'string' && rule.test(facts[key])) out[key] = facts[key];
  return out;
}

/** The attachments as they are described to the server: made-up names, the kind, the type, the size, the hash. Order: images first, then the video. */
function describeAttachments(files) {
  const counts = { image: 0, video: 0 };
  return files.map((record, index) => ({ index, kind: record.kind, name: sentName(record, counts[record.kind]++), type: record.type, bytes: record.bytes, sha256: record.sha256, ...(record.seconds !== undefined ? { seconds: record.seconds } : {}) }));
}

/** Exactly the message that is sent. Throws when something is not reportable. A `draft` (the pop-up's preview while typing) may have an empty text. */
function buildReport({ kind, category = null, text = '', details = false, facts = null, files = [], appVersion, channel, platform }, { draft = false } = {}) {
  if (!KINDS.includes(kind)) throw new Error('Choose a bug or an idea.');
  const body = cleanText(text);
  if (!body && !draft) throw new Error('Write what happened first.');
  const images = files.filter((file) => file.kind === 'image').length, videos = files.length - images;
  if (images > LIMITS.images || videos > LIMITS.videos) throw new Error('Too many files.');
  const ordered = [...files.filter((file) => file.kind === 'image'), ...files.filter((file) => file.kind === 'video')];
  return {
    schema: SCHEMA, kind, category: kind === 'bug' && CATEGORIES.includes(category) ? category : null, text: body,
    appVersion: String(appVersion), channel: typeof channel === 'string' && /^[a-z]{1,16}$/.test(channel) ? channel : 'beta', platform: PLATFORMS.includes(platform) ? platform : 'linux',
    details: kind === 'bug' && details ? technicalDetails(facts) : null, attachments: describeAttachments(ordered),
  };
}

module.exports = { SCHEMA, KINDS, CATEGORIES, PLATFORMS, TEXT_MAX, TECHNICAL, cleanText, technicalDetails, describeAttachments, buildReport };
