'use strict';
// The rules behind scripts/app-icon.mjs: how the team publishes a new app icon (and takes it back) on update.acirabrowser.com/appicon/. Pure planning plus a publisher that takes `gh` and `fetch` as arguments, so tests run it against fakes
// and nothing here writes anywhere by itself. The app's own readers decide what is acceptable (desktop/browser-services/app-icon.cjs): this refuses whatever an installed Acira would refuse, before anything is written.
//   PICTURES  Three PNGs the team supplies, used byte for byte: Windows 256 x 256, Mac 1024 x 1024, Linux 512 x 512. A wrong size is refused, never resized.
//   VERSION   One above the live document's (the app only follows a rising number). File names carry the version (`christmas-8-mac.png`), so a picture already live is never overwritten.
//   ORDER     (1) the three pictures in one commit; (2) each fetched anonymously from the public address and compared byte for byte; (3) only then the document, in a second commit; (4) wait until the public address serves it.
//             The document is written last, so nobody is ever pointed at a picture that is not there yet. Taking it back is `clear` (a higher version that says "standard") or publishing the earlier pictures again.
const icon = require('../desktop/browser-services/app-icon.cjs');
const { isDay } = icon;

const HOST = 'https://update.acirabrowser.com/';
const FOLDERS = Object.freeze({ main: '', testers: 'testers/', rehearsal: 'rehearsal/' });
const slug = (name) => String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
const PLATFORMS = Object.keys(icon.SIZES);

/** What the live document says (the parsed text served by the site), or null when there is none. {version, name, standard, ...} */
function liveOf(text) {
  if (!text) return null;
  const read = icon.parseDocument(text);
  return read.ok ? read.doc : { version: (() => { try { const raw = JSON.parse(text); return Number.isSafeInteger(raw.version) ? raw.version : 0; } catch { return 0; } })(), unreadable: true };
}

function checkAudience({ from, until, minVersion, audience }) {
  const problems = [];
  if (from !== undefined && !isDay(from)) problems.push('--from must be a day, YYYY-MM-DD.');
  if (until !== undefined && !isDay(until)) problems.push('--until must be a day, YYYY-MM-DD.');
  if (from && until && isDay(from) && isDay(until) && from > until) problems.push('--until is before --from.');
  if (audience !== undefined && !icon.AUDIENCES.includes(audience)) problems.push('--audience must be insider, public or all.');
  if (minVersion !== undefined && !require('../desktop/browser-services/update-feeds.cjs').isVersion(minVersion)) problems.push('--min-version must be a version such as 0.1.0-beta.14.3.');
  return problems;
}

/** The plan for publishing a new icon. pictures: {windows, mac, linux} (Buffers); live: the live document or null; existing: [{path, size}] of what is already under appicon/ (for the size cap). */
function planPublish({ pictures = {}, name, from, until, minVersion, audience, live = null, folder = '', existing = [], macSquareOk = false } = {}) {
  const problems = [...checkAudience({ from, until, minVersion, audience })], files = [];
  const label = typeof name === 'string' ? name.trim() : '';
  if (!label) problems.push('--name is needed (the icon\'s name, for example Christmas).');
  else if (label.length > 40 || /[\u0000-\u001f\u007f]/.test(label)) problems.push('--name is at most 40 characters, with no control characters.');
  const base = slug(label);
  if (label && !base) problems.push('--name needs letters or digits (it becomes part of the file names).');
  const version = (live?.version ?? 0) + 1, doc = { schema: icon.SCHEMA, version, name: label };
  if (live?.unreadable) problems.push('The live document cannot be read by this build (it is not a document the app accepts); fix or clear it first.');
  for (const platform of PLATFORMS) {
    const bytes = pictures[platform], side = icon.SIZES[platform];
    if (!Buffer.isBuffer(bytes)) { problems.push(`The ${platform} picture is missing (a ${side} x ${side} PNG).`); continue; }
    const verdict = icon.checkPng(bytes, { width: side, height: side });
    if (!verdict.ok) { problems.push(`The ${platform} picture is refused (${verdict.reason}): it must be a sound ${side} x ${side} PNG, no animation, not interlaced, at most ${icon.PICTURE_MAX / 1024} KB. It is never resized.`); continue; }
    if (platform === 'mac' && !macSquareOk && icon.cornersOpaque(bytes) === true) { problems.push('The Mac picture is a hard-cornered full-bleed square (all four corners are opaque). macOS draws a Dock picture exactly as supplied, with no rounding and no margin, so it would show as a square among rounded icons. Supply it already shaped like a macOS icon (a 1024 canvas, a rounded body, transparent corners), or pass --mac-square-ok if a square is meant.'); continue; }
    const file = `${base}-${version}-${platform}.png`;
    if (!icon.FILE_NAME.test(file)) { problems.push(`The file name ${file} is not one the app accepts.`); continue; }
    doc[platform] = { file, size: bytes.length, width: side, height: side, sha512: icon.sha512Of(bytes) };
    files.push({ path: `${folder}appicon/${file}`, bytes, platform });
  }
  if (from !== undefined) doc.from = from;
  if (until !== undefined) doc.until = until;
  if (minVersion !== undefined) doc.minVersion = minVersion;
  if (audience !== undefined && audience !== 'all') doc.audience = audience;
  const text = JSON.stringify(doc, null, 1) + '\n';
  const read = icon.parseDocument(text);
  if (!read.ok) problems.push(`The document is not one an installed Acira accepts (${read.reason}).`);
  else if (Buffer.byteLength(text) > icon.DOC_MAX) problems.push('The document is too large.');
  const grown = existing.reduce((sum, item) => sum + (item.size || 0), 0) + files.reduce((sum, item) => sum + item.bytes.length, 0);
  if (grown > require('./update-site.cjs').APPICON_TOTAL) problems.push(`appicon/ would hold ${grown} bytes; the site keeps at most ${require('./update-site.cjs').APPICON_TOTAL}. Remove an old set first.`);
  const site = new Map([[`${folder}appicon/index.json`, Buffer.from(text)], ...files.map((file) => [file.path, file.bytes])]);
  if (!problems.length) problems.push(...require('./update-site.cjs').checkAppIcons(site));
  return { ok: problems.length === 0, problems, version, document: doc, text, files, indexPath: `${folder}appicon/index.json`, replaces: live };
}

/** The plan for taking the icon back: a higher version that says "standard" (optionally only for a group). */
function planClear({ minVersion, audience, live = null, folder = '' } = {}) {
  const problems = [...checkAudience({ minVersion, audience })];
  const version = (live?.version ?? 0) + 1, doc = { schema: icon.SCHEMA, version, standard: true };
  if (minVersion !== undefined) doc.minVersion = minVersion;
  if (audience !== undefined && audience !== 'all') doc.audience = audience;
  const text = JSON.stringify(doc, null, 1) + '\n', read = icon.parseDocument(text);
  if (!read.ok) problems.push(`The document is not one an installed Acira accepts (${read.reason}).`);
  return { ok: problems.length === 0, problems, version, document: doc, text, files: [], indexPath: `${folder}appicon/index.json`, replaces: live };
}

/** A short description of a document for `status` and the dry-run report. */
function describe(doc) {
  if (!doc) return 'Nothing is live: every install keeps its standard icon.';
  if (doc.unreadable) return `Version ${doc.version} is live but this build cannot read it.`;
  if (doc.standard) return `Version ${doc.version}: back to the standard icon${doc.audience && doc.audience !== 'all' ? ' for ' + doc.audience + ' only' : ''}${doc.minVersion ? ' from ' + doc.minVersion : ''}.`;
  const who = doc.audience === 'insider' ? 'Insiders only' : doc.audience === 'public' ? 'everyone except Insiders' : 'everyone';
  return `Version ${doc.version} "${doc.name}": shown to ${who}${doc.minVersion ? ', from ' + doc.minVersion + ' up' : ''}${doc.from || doc.until ? `, ${doc.from || 'always'} to ${doc.until || 'for ever'}` : ''}.`;
}

/** A page with the three pictures side by side on light, grey and dark, at their own size and small, for the team to look at before publishing. Pictures are embedded (no file or network reads). */
function contactSheet({ pictures, label = 'App icon' }) {
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const shown = PLATFORMS.filter((platform) => Buffer.isBuffer(pictures?.[platform]));
  const vars = shown.map((platform) => `--${platform}:url(data:image/png;base64,${pictures[platform].toString('base64')});`).join('');
  const cells = shown.map((platform) => `<section><h2>${esc(platform)} ${icon.SIZES[platform]} x ${icon.SIZES[platform]}</h2>${['#f4f4f6', '#8a8a90', '#1b1b1f'].map((bg) => `<div style="background:${bg}">${[128, 48, 24].map((px) => `<i style="width:${px}px;height:${px}px;background:var(--${platform}) center/contain no-repeat"></i>`).join('')}</div>`).join('')}</section>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(label)}</title><style>:root{${vars}}body{font:14px system-ui;margin:24px}section{display:inline-block;margin-right:24px;vertical-align:top}div{padding:16px;margin:6px 0;display:flex;gap:16px;align-items:center}i{display:block}</style><h1>${esc(label)}</h1>${cells}`;
}

/** The document as the repository itself holds it (not the public address, which a CDN can serve a few minutes stale): its text, or null when there is none. Any other failure throws. */
async function readRepoDocument({ gh, target, indexPath }) {
  try { return Buffer.from(JSON.parse(await gh(['api', `repos/${target.repo}/contents/${target.dir}/${indexPath}?ref=${target.branch}`])).content, 'base64').toString('utf8'); }
  catch (error) { if (/404|Not Found/i.test(String(error?.message || error))) return null; throw error; }
}

/** One commit with these files (text or bytes) under dir/, on top of the branch's head; fast-forward only. Returns the commit's sha. */
async function commitFiles({ gh, repo, branch, dir, files, message }) {
  const json = async (args, options) => JSON.parse(await gh(args, options));
  const ref = await json(['api', `repos/${repo}/git/ref/heads/${branch}`]), parent = ref.object.sha;
  const commit = await json(['api', `repos/${repo}/git/commits/${parent}`]), entries = [];
  for (const file of files) {
    const blob = await json(['api', '-X', 'POST', `repos/${repo}/git/blobs`, '--input', '-'], { input: JSON.stringify({ content: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' }) });
    entries.push({ path: `${dir}/${file.path}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await json(['api', '-X', 'POST', `repos/${repo}/git/trees`, '--input', '-'], { input: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) });
  const created = await json(['api', '-X', 'POST', `repos/${repo}/git/commits`, '--input', '-'], { input: JSON.stringify({ message, tree: tree.sha, parents: [parent] }) });
  await gh(['api', '-X', 'PATCH', `repos/${repo}/git/refs/heads/${branch}`, '--input', '-'], { input: JSON.stringify({ sha: created.sha, force: false }) });
  return created.sha;
}

/** Waits until the public address serves exactly these bytes. */
async function served({ fetch, url, bytes, sleep, tries = 40, every = 15000, log = () => {} }) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
      if (response.status === 200 && Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))) return true;
    } catch { /* not there yet */ }
    if (attempt < tries) { log(`  waiting for ${url} (${attempt}/${tries})`); await sleep(every); }
  }
  return false;
}

/** The live write. Pictures first, verified anonymously, the document last, verified. Throws on any step that fails; the document is never written before every picture is served. deps: {gh, fetch, sleep, log, target: {repo, branch, dir}}. */
async function publish({ plan, deps }) {
  const { gh, fetch, sleep, log, target } = deps;
  if (!plan.ok) throw new Error('The plan has problems: ' + plan.problems.join(' '));
  const info = JSON.parse(await gh(['api', `repos/${target.repo}`]));
  if (info.private !== false) throw new Error(`${target.repo} is not public.`);
  // The plan was made from a read of the PUBLIC address, which can lag. Before anything is written the repository itself must still hold exactly that version, or the plan is refused (a stale read could otherwise number a take-back below a live icon).
  const heldText = await readRepoDocument({ gh, target, indexPath: plan.indexPath }), held = liveOf(heldText), heldVersion = held ? held.version : 0, wasVersion = plan.replaces ? plan.replaces.version : 0;
  if (heldVersion !== wasVersion || plan.version <= heldVersion) throw new Error(`The repository holds version ${heldVersion}, but this plan was made from version ${wasVersion} and numbers ${plan.version}. Nothing was written. Run the command again (the public address can lag by ten minutes).`);
  for (const file of plan.files) {                                   // a picture that is already live under this name is never overwritten
    let live = null;
    try { live = Buffer.from(JSON.parse(await gh(['api', `repos/${target.repo}/contents/${target.dir}/${file.path}?ref=${target.branch}`])).content, 'base64'); }
    catch (error) { if (!/404|Not Found/i.test(String(error?.message || error))) throw error; }
    if (live && !live.equals(file.bytes)) throw new Error(`${file.path} is already live with other bytes; refusing to overwrite it.`);
  }
  if (plan.files.length) {
    const sha = await commitFiles({ gh, repo: target.repo, branch: target.branch, dir: target.dir, files: plan.files, message: `App icon ${plan.document.name} (version ${plan.version}): the pictures` });
    log(`Committed the pictures: ${sha}.`);
    for (const file of plan.files) {
      const ok = await served({ fetch, url: HOST + file.path, bytes: file.bytes, sleep, log });
      if (!ok) throw new Error(`${file.path} is not served byte for byte yet. The document was NOT written, so nobody is pointed at it. Run the same command again to carry on.`);
      log(`  verified anonymously: ${file.path}`);
    }
  }
  const sha = await commitFiles({ gh, repo: target.repo, branch: target.branch, dir: target.dir, files: [{ path: plan.indexPath, bytes: Buffer.from(plan.text) }], message: `App icon: version ${plan.version}${plan.document.standard ? ' (back to the standard icon)' : ' ' + plan.document.name}` });
  log(`Committed the document: ${sha}.`);
  if (!(await served({ fetch, url: HOST + plan.indexPath, bytes: Buffer.from(plan.text), sleep, log }))) throw new Error('The document is committed but the public address does not serve it yet. Look again in a few minutes with `status`.');
  log(`Live: ${describe(plan.document)}`);
  return { version: plan.version };
}

module.exports = { HOST, FOLDERS, slug, liveOf, planPublish, planClear, describe, contactSheet, commitFiles, readRepoDocument, served, publish };
