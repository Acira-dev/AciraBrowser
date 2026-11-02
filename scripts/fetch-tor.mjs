#!/usr/bin/env node
// Fetches the pinned Tor Expert Bundle (desktop/browser-services/tor-engine/tor-version.json), verifies it and extracts
// tor.exe + its license into desktop/browser-services/tor-engine/win-x64/ for packaging (electron-builder extraResources).
//   node scripts/fetch-tor.mjs --soft                dev and demo builds (npm run build / npm start): same, but a failure only warns
//   node scripts/fetch-tor.mjs                       fetch if missing or wrong; pinned SHA-256 always checked, signature when gpg exists
//   node scripts/fetch-tor.mjs --require-signature   release builds: also fail when gpg is missing or the signature is not the pinned key
//   node scripts/fetch-tor.mjs --check               ask Tor's update feed whether a newer Tor Browser release exists
//   node scripts/fetch-tor.mjs --update 15.0.27      verify a new release's signature (gpg required) and rewrite the pins
//   node scripts/fetch-tor.mjs --from-tor-browser "C:\...\Tor Browser"   copy tor.exe, the bridge clients (lyrebird, conjure) and their
//                                                    licences from a local Tor Browser's program files instead of downloading; every
//                                                    file must still match its pin (tor-version.json "files" / "pluggableTransports")
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'desktop/browser-services/tor-engine/tor-version.json');
const target = path.join(root, 'desktop/browser-services/tor-engine/win-x64');
const args = process.argv.slice(2), flag = name => args.includes(name), value = name => args[args.indexOf(name) + 1];
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const log = message => console.log(`[tor] ${message}`);

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Minimal ustar reader: regular files only, enough for the Tor Project's tarballs. */
function untar(buffer) {
  const files = new Map();
  let longName = null;
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(text(124, 136).trim() || '0', 8), type = String.fromCharCode(header[156] || 48);
    const prefix = text(345, 500), name = longName || (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    longName = null;
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else if (type === '0' || type === '\0') files.set(name.replace(/^\.\//, ''), Buffer.from(body));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function findGpg() {
  for (const candidate of ['gpg', 'C:\\Program Files\\Git\\usr\\bin\\gpg.exe', 'C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe', 'C:\\Program Files\\GnuPG\\bin\\gpg.exe']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    // Git for Windows ships an MSYS gpg that wants /c/... paths (its "Home:" line is POSIX).
    if (probe.status === 0) return { exe: candidate, msys: /^Home: \//m.test(probe.stdout) || candidate.includes('\\Git\\') };
  }
  return null;
}

/** Tor's dist host keeps only the current release; its archive host keeps every one. A pinned version is the same file there, and its SHA-256 and signature are checked all the same. */
async function downloadPinned(url) {
  try { return await download(url); } catch (error) {
    if (!/HTTP 404/.test(error.message)) throw error;
    log('not on the dist host any more: taking it from the Tor archive');
    return download(url.replace('https://dist.torproject.org/torbrowser/', 'https://archive.torproject.org/tor-package-archive/torbrowser/'));
  }
}
/** Verifies `file` against `signature` with a throwaway keyring holding only the pinned key. Returns true, false (bad), or null (no gpg). */
async function verifySignature(file, signature, manifest) {
  const gpg = findGpg();
  if (!gpg) return null;
  const home = path.join(tmpdir(), `acira-gpg-${randomUUID()}`);
  mkdirSync(home, { recursive: true });
  const native = p => gpg.msys ? p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/') : p;
  try {
    const keyFile = path.join(home, 'key.asc');
    writeFileSync(keyFile, await download(manifest.signingKeyUrl));
    const run = list => spawnSync(gpg.exe, ['--batch', '--no-autostart', '--homedir', native(home), ...list], { encoding: 'utf8' });
    run(['--import', native(keyFile)]);
    const result = run(['--status-fd', '1', '--verify', native(signature), native(file)]);
    const valid = /^\[GNUPG:\] VALIDSIG (\S+) .* ([0-9A-F]{40})$/m.exec(result.stdout || '');
    return Boolean(valid && valid[2] === manifest.signingKey && /^\[GNUPG:\] GOODSIG /m.test(result.stdout));
  } finally { rmSync(home, { recursive: true, force: true }); }
}

async function fetchArchive(manifest, { requireSignature, pinned }) {
  const work = path.join(tmpdir(), `acira-tor-${randomUUID()}`);
  mkdirSync(work, { recursive: true });
  try {
    log(`downloading ${manifest.archive.name}`);
    const archive = await downloadPinned(manifest.archive.url), file = path.join(work, manifest.archive.name);
    writeFileSync(file, archive);
    const digest = sha256(archive);
    if (pinned && digest !== manifest.archive.sha256) throw new Error(`archive SHA-256 ${digest} does not match the pin ${manifest.archive.sha256}`);
    writeFileSync(`${file}.asc`, await downloadPinned(manifest.archive.signature));
    const signed = await verifySignature(file, `${file}.asc`, manifest);
    if (signed === false) throw new Error('signature is not a valid signature by the Tor Browser Developers key');
    if (signed === null && requireSignature) throw new Error('gpg is required to verify the signature (install Git for Windows or GnuPG)');
    log(signed ? `signature OK (${manifest.signingKey})` : 'gpg not found: signature not checked, pinned SHA-256 matched');
    return { files: untar(gunzipSync(archive)), digest };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Every pinned file: tor.exe + its licence ("files"), and the bridge clients + their licences ("pluggableTransports"), by target name. */
const pinned = manifest => ({ ...manifest.files, ...(manifest.pluggableTransports?.files || {}) });
function installed(manifest) {
  return Object.entries(pinned(manifest)).every(([name, entry]) => {
    const file = path.join(target, name);
    return existsSync(file) && sha256(readFileSync(file)) === entry.sha256;
  });
}
function write(name, body) { const file = path.join(target, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); }

/** A local Tor Browser's program files (never its profile, Browser/TorBrowser/Data): the same builds the Expert Bundle carries. */
function fromTorBrowser(manifest, folder) {
  const base = existsSync(path.join(folder, 'Browser')) ? path.join(folder, 'Browser') : folder;
  const tbPath = { 'tor.exe': 'TorBrowser/Tor/tor.exe', 'LICENSE.tor.txt': 'TorBrowser/Docs/Licenses/tor.txt' };
  for (const [name, entry] of Object.entries(pinned(manifest))) {
    const relative = (entry.torBrowser || tbPath[name] || '').replace(/^Browser\//, '');
    if (!relative) throw new Error(`no Tor Browser path is known for ${name}`);
    const file = path.join(base, relative);
    if (!existsSync(file)) throw new Error(`${file} is missing`);
    const body = readFileSync(file);
    if (sha256(body) !== entry.sha256) throw new Error(`${relative} SHA-256 does not match the pin (a different Tor Browser release?)`);
    write(name, body);
  }
  log(`copied tor + bridge clients from ${folder}; every file matched its pin`);
}

async function ensure() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')), requireSignature = flag('--require-signature');
  if (flag('--from-tor-browser')) { fromTorBrowser(manifest, value('--from-tor-browser')); return; }
  if (installed(manifest) && !requireSignature) { log(`tor ${manifest.tor} and its bridge clients already in place`); return; }
  const { files } = await fetchArchive(manifest, { requireSignature, pinned: true });
  mkdirSync(target, { recursive: true });
  for (const [name, entry] of Object.entries(pinned(manifest))) {
    const body = files.get(entry.from);
    if (!body) throw new Error(`${entry.from} is missing from the archive (copy it from a local Tor Browser: --from-tor-browser <folder>)`);
    if (sha256(body) !== entry.sha256) throw new Error(`${entry.from} SHA-256 does not match the pin`);
    write(name, body);
  }
  log(`tor ${manifest.tor} and its bridge clients (Tor Browser ${manifest.torBrowserVersion}) installed in ${path.relative(root, target)}`);
}

async function check() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const feed = JSON.parse((await download(manifest.updateFeed)).toString('utf8'));
  if (feed.version === manifest.torBrowserVersion) log(`up to date: Tor Browser ${feed.version}`);
  else { log(`update available: Tor Browser ${feed.version} (pinned ${manifest.torBrowserVersion}). Run: node scripts/fetch-tor.mjs --update ${feed.version}`); process.exitCode = 2; }
}

async function update(version) {
  if (!/^\d+\.\d+(\.\d+)*$/.test(version || '')) throw new Error('Pass a stable Tor Browser version, e.g. --update 15.0.27');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')), name = `tor-expert-bundle-windows-x86_64-${version}.tar.gz`;
  const next = { ...manifest, torBrowserVersion: version, checked: new Date().toISOString().slice(0, 10), archive: { name, url: `https://dist.torproject.org/torbrowser/${version}/${name}`, signature: `https://dist.torproject.org/torbrowser/${version}/${name}.asc`, sha256: '' } };
  const { files, digest } = await fetchArchive(next, { requireSignature: true, pinned: false });
  next.archive.sha256 = digest;
  next.files = Object.fromEntries(Object.entries(manifest.files).map(([file, entry]) => {
    const body = files.get(entry.from);
    if (!body) throw new Error(`${entry.from} is missing from the new archive`);
    return [file, { from: entry.from, sha256: sha256(body) }];
  }));
  if (manifest.pluggableTransports?.files) {
    next.pluggableTransports = { ...manifest.pluggableTransports, source: `Tor Expert Bundle ${version}`, files: Object.fromEntries(Object.entries(manifest.pluggableTransports.files).map(([file, entry]) => {
      const body = files.get(entry.from);
      if (!body) throw new Error(`${entry.from} is missing from the new archive`);
      return [file, { ...entry, sha256: sha256(body) }];
    })) };
  }
  mkdirSync(target, { recursive: true });
  for (const [file, entry] of Object.entries(pinned(next))) write(file, files.get(entry.from));
  const probe = spawnSync(path.join(target, 'tor.exe'), ['--version'], { encoding: 'utf8' });
  next.tor = /Tor version (\S+?)\.?\s/.exec(probe.stdout || '')?.[1] || manifest.tor;
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  log(`pinned Tor Browser ${version} (tor ${next.tor}); commit tor-version.json`);
}

try {
  if (flag('--soft') && !flag('--check') && !flag('--update') && process.platform !== 'win32') log('Windows Tor bundle skipped for this host build.');
  else if (flag('--check')) await check();
  else if (flag('--update')) await update(value('--update'));
  else await ensure();
} catch (error) {
  if (flag('--soft')) console.warn(`[tor] not fetched (${error.message}). Tor windows will show "Tor isn't available"; run: node scripts/fetch-tor.mjs`);
  else { console.error(`[tor] ${error.message}`); process.exitCode = 1; }
}
