// Gets the two files that update.acirabrowser.com has to serve ready for the update repository, and checks them once they are live.
//
//   site-allowlist.json                 the reviewed-sites list  (desktop/browser-services/site-allowlist.cjs asks https://update.acirabrowser.com/site-allowlist.json)
//   spellcheck-dictionaries/<n>.bdic    one Hunspell dictionary per language (spellcheck-dictionaries.cjs points every session at
//                                       https://update.acirabrowser.com/spellcheck-dictionaries/ and Chromium adds <language>-<version>.bdic)
//
// The host is GitHub Pages from docs/ of Acira-dev/AciraBrowserUpdates, so the folder this script writes is copied into that docs/. Nothing is pushed or uploaded here.
//
//   node scripts/export-site-allowlist.mjs --out build/site-allowlist.json      the list, from the shipped function (or any file that passes --check)
//   node scripts/mirror-spellcheck-dictionaries.mjs --fetch                     the dictionaries into dist-dictionaries/ with SHA256SUMS (about 104 MB, from Chromium's own server)
//   node scripts/prepare-update-host-files.mjs --allowlist build/site-allowlist.json [--dictionaries dist-dictionaries] [--out build/update-host]
//                                                                               checks both, copies them into <out>/ the way docs/ will hold them, writes <out>/MANIFEST.txt
//   node scripts/prepare-update-host-files.mjs --verify-live [--manifest build/update-host/MANIFEST.txt] [--base https://update.acirabrowser.com/] [--full]
//                                                                               after the update repository is pushed and Pages has built: every file answers 200 with the size
//                                                                               in the manifest (--full also downloads each and compares its SHA-256)
//
// Limits it enforces: GitHub Pages refuses a file over 100 MB and a site over 1 GB (the dictionaries are about 104 MB in 47 files, the largest 11 MB).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { parseAllowlist, FILE_NAME: ALLOWLIST_NAME, MAX_BYTES: ALLOWLIST_MAX } = require(path.join(here, '..', 'desktop', 'browser-services', 'site-allowlist.cjs'));
const { HOST_URL } = require(path.join(here, '..', 'desktop', 'browser-services', 'update-hosts.cjs'));

export const DICTIONARY_FOLDER = 'spellcheck-dictionaries';
export const PAGES_FILE_LIMIT = 100 * 1000 * 1000; // GitHub Pages: "files larger than 100 MB are blocked" (pushes and Pages builds)
export const PAGES_SITE_LIMIT = 1000 * 1000 * 1000; // a published Pages site may not exceed 1 GB
export const MIN_DICTIONARIES = 40; // Chromium 152 lists 47; fewer means the mirror run skipped files
/** What Chromium requests: `<language>[-<region>]-<major>-<minor>.bdic`, lower case (spellcheck-dictionaries.cjs, mirror-spellcheck-dictionaries.mjs). */
export const DICTIONARY_NAME = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}-\d+-\d+\.bdic$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** SHA256SUMS text -> Map(name -> hex). Throws on a line it cannot read, so a damaged list is never half-used. */
export function readSums(text) {
  const sums = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (!match) throw new Error('Cannot read this SHA256SUMS line: ' + line.slice(0, 80));
    if (sums.has(match[2])) throw new Error('SHA256SUMS lists ' + match[2] + ' twice.');
    sums.set(match[2], match[1]);
  }
  return sums;
}

/** Checks a mirror folder (what mirror-spellcheck-dictionaries.mjs --fetch writes). Returns [{ name, bytes, sha256 }] sorted by name, or throws with every problem found. */
export function checkDictionaries(directory, { minimum = MIN_DICTIONARIES, limit = PAGES_FILE_LIMIT } = {}) {
  const problems = [];
  let raw;
  try { raw = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8'); } catch { throw new Error(`${directory}: no SHA256SUMS (run node scripts/mirror-spellcheck-dictionaries.mjs --fetch)`); }
  const sums = readSums(raw);
  const onDisk = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS').sort();
  for (const name of onDisk) if (!sums.has(name)) problems.push(`${name} is in the folder but not in SHA256SUMS`);
  const entries = [];
  for (const [name, expected] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    if (!DICTIONARY_NAME.test(name)) { problems.push(`${name}: not a name Chromium asks for (lower case <language>[-<region>]-<major>-<minor>.bdic)`); continue; }
    let bytes;
    try { bytes = fs.readFileSync(path.join(directory, name)); } catch { problems.push(`${name}: listed in SHA256SUMS but missing`); continue; }
    const actual = sha256(bytes);
    if (actual !== expected) problems.push(`${name}: SHA-256 is ${actual.slice(0, 12)}…, SHA256SUMS says ${expected.slice(0, 12)}…`);
    if (!bytes.length) problems.push(`${name}: empty`);
    if (bytes.length >= limit) problems.push(`${name}: ${bytes.length} bytes, GitHub Pages refuses files of 100 MB or more`);
    entries.push({ name, bytes: bytes.length, sha256: actual });
  }
  if (entries.length < minimum) problems.push(`only ${entries.length} dictionaries (expected at least ${minimum}): a language that is missing here gets no spell checking`);
  if (problems.length) throw new Error(`${directory} cannot be published:\n  ` + problems.join('\n  '));
  return entries;
}

/** The allow-list file, checked the way the app reads it. Returns { bytes, sha256, hosts, updated }. */
export function checkAllowlist(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > ALLOWLIST_MAX) throw new Error(`${file}: ${bytes.length} bytes, the app accepts at most ${ALLOWLIST_MAX}`);
  const text = bytes.toString('utf8');
  const hosts = [...parseAllowlist(text)].sort(); // throws the app's own error for anything it would refuse
  const value = JSON.parse(text);
  if (value.schema !== 1) throw new Error(`${file}: "schema" must be 1`);
  return { bytes: bytes.length, sha256: sha256(bytes), hosts: hosts.length, updated: typeof value.updated === 'string' ? value.updated : null };
}

/** MANIFEST.txt: `<sha256>  <bytes>  <path>` per file (paths are the URLs' paths on the host), then the totals. */
export function manifestText(files) {
  const lines = files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  return lines.join('\n') + `\n# ${files.length} files, ${total} bytes\n`;
}

export function readManifest(text) {
  const files = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64})\s+(\d+)\s+(\S+)$/.exec(line.trim());
    if (!match) throw new Error('Cannot read this MANIFEST line: ' + line.slice(0, 80));
    files.push({ sha256: match[1], bytes: Number(match[2]), path: match[3] });
  }
  return files;
}

/** Writes <out>/site-allowlist.json, <out>/spellcheck-dictionaries/*.bdic and <out>/MANIFEST.txt. Files are cloned where the file system can (no second copy on APFS). */
export function prepare({ allowlist, dictionaries, out }) {
  const list = checkAllowlist(allowlist), entries = checkDictionaries(dictionaries);
  const total = list.bytes + entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total >= PAGES_SITE_LIMIT) throw new Error(`${total} bytes: a Pages site may not exceed 1 GB, and this repository also holds the installers' feeds`);
  fs.mkdirSync(path.join(out, DICTIONARY_FOLDER), { recursive: true });
  const files = [{ path: ALLOWLIST_NAME, bytes: list.bytes, sha256: list.sha256 }];
  fs.copyFileSync(allowlist, path.join(out, ALLOWLIST_NAME));
  for (const entry of entries) {
    fs.copyFileSync(path.join(dictionaries, entry.name), path.join(out, DICTIONARY_FOLDER, entry.name), fs.constants.COPYFILE_FICLONE);
    files.push({ path: `${DICTIONARY_FOLDER}/${entry.name}`, bytes: entry.bytes, sha256: entry.sha256 });
  }
  fs.writeFileSync(path.join(out, 'MANIFEST.txt'), manifestText(files));
  return { files, list, dictionaries: entries.length, bytes: total };
}

/** Asks the live host about every file. `fetchImpl` is injectable for tests. Returns [{ path, ok, detail }]. */
export async function verifyLive(files, { base = HOST_URL, full = false, fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const root = base.endsWith('/') ? base : base + '/', results = [];
  for (const file of files) {
    const url = root + file.path;
    try {
      const needBody = full || file.path === ALLOWLIST_NAME;
      const response = await fetchImpl(url, { method: needBody ? 'GET' : 'HEAD', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status !== 200) { results.push({ path: file.path, ok: false, detail: `HTTP ${response.status}` }); continue; }
      if (needBody) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.bytes) { results.push({ path: file.path, ok: false, detail: `${bytes.length} bytes, expected ${file.bytes}` }); continue; }
        if (sha256(bytes) !== file.sha256) { results.push({ path: file.path, ok: false, detail: 'SHA-256 differs from the manifest' }); continue; }
        if (file.path === ALLOWLIST_NAME) parseAllowlist(bytes.toString('utf8')); // the app would accept it
      } else {
        const length = Number(response.headers.get('content-length') || NaN);
        if (length !== file.bytes) { results.push({ path: file.path, ok: false, detail: `content-length ${response.headers.get('content-length')}, expected ${file.bytes}` }); continue; }
      }
      results.push({ path: file.path, ok: true, detail: `${file.bytes} bytes` });
    } catch (error) { results.push({ path: file.path, ok: false, detail: String(error?.message || error) }); }
  }
  return results;
}

function option(argv, name) { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] || ''; }

async function main(argv) {
  if (argv.includes('--verify-live')) {
    const manifest = path.resolve(option(argv, '--manifest') || path.join('build', 'update-host', 'MANIFEST.txt'));
    const results = await verifyLive(readManifest(fs.readFileSync(manifest, 'utf8')), { base: option(argv, '--base') || HOST_URL, full: argv.includes('--full') });
    for (const result of results.filter((item) => !item.ok)) console.log(`FAIL ${result.path}: ${result.detail}`);
    const bad = results.filter((item) => !item.ok).length;
    console.log(`${results.length - bad} of ${results.length} files answer as the manifest says${bad ? `; ${bad} do not (Pages can take a few minutes after a push)` : '.'}`);
    if (bad) process.exitCode = 1;
    return;
  }
  const allowlist = option(argv, '--allowlist');
  if (!allowlist) throw new Error('Give the list: --allowlist <site-allowlist.json> (node scripts/export-site-allowlist.mjs --out build/site-allowlist.json makes it).');
  const result = prepare({ allowlist: path.resolve(allowlist), dictionaries: path.resolve(option(argv, '--dictionaries') || 'dist-dictionaries'), out: path.resolve(option(argv, '--out') || path.join('build', 'update-host')) });
  const out = option(argv, '--out') || path.join('build', 'update-host');
  console.log(`${out}: ${result.files.length} files, ${result.bytes} bytes (${(result.bytes / 1e6).toFixed(1)} MB). ${ALLOWLIST_NAME} lists ${result.list.hosts} host${result.list.hosts === 1 ? '' : 's'}; ${result.dictionaries} dictionaries, the largest ${Math.max(...result.files.map((file) => file.bytes)) } bytes.`);
  console.log(`Copy the contents of ${out}/ (not MANIFEST.txt) into docs/ of Acira-dev/AciraBrowserUpdates, commit, push, then: node scripts/prepare-update-host-files.mjs --verify-live --manifest ${path.join(out, 'MANIFEST.txt')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(String(error && error.message || error)); process.exit(1); });
}
