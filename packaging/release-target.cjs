'use strict';
// WHERE releases and updates live. One file (packaging/release-target.json) names the target; everything else derives from it:
//   - the electron-builder "publish" block (so the installed app's app-update.yml points at it)   -> publishBlock()
//   - the `gh` repository scripts/release.mjs creates the draft release on                          -> repoSlug()
//   - the spelling-dictionary mirror URL                                                            -> dictionaryUrl()
//   - the "can users reach it?" preflight (scripts/check-release-target.mjs, release.mjs --publish) -> checkReleaseTarget()
// Nothing here creates or changes anything remotely: the preflight only sends unauthenticated GET requests.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'release-target.json');
const NAME = /^[A-Za-z0-9._-]+$/;

/** Validates a parsed target and returns the normalized form ({provider:'github',owner,repo} or {provider:'generic',url}). */
function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('release-target.json must be an object.');
  if (raw.provider === 'github') {
    const { owner, repo } = raw;
    if (typeof owner !== 'string' || typeof repo !== 'string' || !NAME.test(owner) || !NAME.test(repo)) throw new Error('release-target.json: provider "github" needs "owner" and "repo" (letters, digits, . _ -).');
    return { provider: 'github', owner, repo };
  }
  if (raw.provider === 'generic') {
    let url; try { url = new URL(String(raw.url)); } catch { url = null; }
    const local = url && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!url || !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error('release-target.json: provider "generic" needs an https "url" (a folder that serves latest.yml), without credentials, query or fragment.');
    return { provider: 'generic', url: url.href.replace(/\/+$/, '') };
  }
  throw new Error('release-target.json: "provider" must be "github" or "generic".');
}

// The default target is a plain require so the desktop bundle inlines it at build time: the installed app has no packaging/ folder,
// and reading the file at startup there hung the app before its first window. An explicit file (scripts, tests) is read from disk.
function loadReleaseTarget(file) {
  if (file === undefined) return normalizeTarget(require('./release-target.json'));
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`Cannot read ${file}: ${error.message}`); }
  return normalizeTarget(raw);
}

/** The electron-builder "publish" array for a target (the same block electron-builder.json used to hold, for the default target). */
function publishBlock(target) {
  if (target.provider === 'github') return [{ provider: 'github', owner: target.owner, repo: target.repo, releaseType: 'prerelease', channel: 'latest' }];
  return [{ provider: 'generic', url: target.url, channel: 'latest' }];
}

/** Returns a copy of an electron-builder config whose "publish" comes from the target (key order kept: right after forceCodeSigning). */
function applyReleaseTarget(config, target = loadReleaseTarget()) {
  const out = {};
  let placed = false;
  for (const [key, value] of Object.entries(config)) {
    if (key === 'publish') continue;
    out[key] = value;
    if (key === 'forceCodeSigning') { out.publish = publishBlock(target); placed = true; }
  }
  if (!placed) out.publish = publishBlock(target);
  return out;
}

/** "owner/repo" for `gh --repo`; null for a generic target (nothing for gh to do). */
const repoSlug = target => (target.provider === 'github' ? `${target.owner}/${target.repo}` : null);

/** Where the spell-check dictionaries are mirrored (Chromium appends file names to this). */
const dictionaryUrl = target => (target.provider === 'github' ? `https://github.com/${target.owner}/${target.repo}/releases/download/spellcheck-dictionaries/` : `${target.url}/spellcheck-dictionaries/`);

/** What the person is told a target looks like. */
const describeTarget = target => (target.provider === 'github' ? `GitHub releases of ${repoSlug(target)}` : `${target.url}/`);

const HEADERS = { 'user-agent': 'acira-release-preflight', accept: 'application/vnd.github+json, application/atom+xml, text/plain, */*' };
async function get(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const text = response.status === 200 ? await response.text() : '';
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: '', error: String(error?.message || error) };
  } finally { clearTimeout(timer); }
}

/**
 * Unauthenticated, read-only reachability check: could a person who is not logged in anywhere read the update feed?
 * Returns {ok, state: 'public'|'unreachable'|'unverified', checks, problems}. "unreachable" = a definite 404/401/403 (private or missing);
 * "unverified" = the check itself failed (offline, rate limit, server error). Neither is ok.
 */
async function checkReleaseTarget(target, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const probes = target.provider === 'github'
    ? [
      { name: 'repository', url: `https://api.github.com/repos/${target.owner}/${target.repo}`, accept: (r) => { try { return JSON.parse(r.text).private === false; } catch { return false; } } },
      { name: 'releases', url: `https://api.github.com/repos/${target.owner}/${target.repo}/releases?per_page=5`, accept: (r) => { try { return Array.isArray(JSON.parse(r.text)); } catch { return false; } } },
      { name: 'update feed', url: `https://github.com/${target.owner}/${target.repo}/releases.atom`, accept: (r) => /<feed[\s>]/.test(r.text) },
    ]
    : [{ name: 'latest.yml', url: `${target.url}/latest.yml`, accept: (r) => /^\s*"?version"?\s*:\s*"?\S+/m.test(r.text) }]; // YAML or the JSON form the public feed's channel documents use
  const checks = [];
  for (const probe of probes) {
    const result = await get(fetchImpl, probe.url, timeoutMs);
    const ok = result.status === 200 && probe.accept(result);
    checks.push({ name: probe.name, url: probe.url, status: result.status, ok, error: result.error });
  }
  const problems = [];
  let state = 'public';
  for (const check of checks.filter(c => !c.ok)) {
    const definite = [401, 403, 404, 410].includes(check.status) && !(check.status === 403 && /rate limit/i.test(check.error || ''));
    if (check.status === 200) { state = 'unreachable'; problems.push(`${check.name}: ${check.url} answers, but it is not a public ${check.name} (a private repository or the wrong content).`); }
    else if (definite) { state = 'unreachable'; problems.push(`${check.name}: ${check.url} answers ${check.status}. People who are not logged in cannot read it, so their update checks would fail.`); }
    else { if (state === 'public') state = 'unverified'; problems.push(`${check.name}: could not verify ${check.url} (${check.status ? `HTTP ${check.status}` : check.error || 'no answer'}).`); }
  }
  return { ok: problems.length === 0, state, checks, problems };
}

module.exports = { FILE, normalizeTarget, loadReleaseTarget, publishBlock, applyReleaseTarget, repoSlug, dictionaryUrl, describeTarget, checkReleaseTarget };
