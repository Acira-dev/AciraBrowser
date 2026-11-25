// Code signing for the files electron-builder does not sign itself (the installer's own helper programs, AciraBrowser.exe before VMP), plus a verifier.
// Configuration comes from the environment only (docs/launch/CODE_SIGNING.md); with none set, nothing is signed and a warning says so.
//   ACIRA_SIGN=certum  ACIRA_PUBLISHER_NAME (the name on the certificate: Acira, Inc.)  ACIRA_CERTUM_THUMBPRINT (its SHA-1 thumbprint)
//                      ACIRA_SIGNTOOL (path to signtool.exe, optional: found in the Windows SDK)  ACIRA_TIMESTAMP_URL (optional, default Certum's)
//                      The certificate lives in Certum's cloud (SimplySign): a person logs in to SimplySign Desktop on the build laptop just before the build,
//                      which makes it usable from the Windows certificate store. Nothing here ever sees that login.
//   ACIRA_SIGN=azure   ACIRA_PUBLISHER_NAME  AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET
//                      ACIRA_AZURE_ENDPOINT ACIRA_AZURE_ACCOUNT ACIRA_AZURE_PROFILE
//                      ACIRA_AZURE_DLIB (path to Azure.CodeSigning.Dlib.dll)  ACIRA_SIGNTOOL (path to signtool.exe, optional: found in the Windows SDK)
//   CSC_LINK + CSC_KEY_PASSWORD                         certificate file
//   ACIRA_SIGN_COMMAND=<script>                         called as <script> <file> for each file
//   ACIRA_SIGN_RECORDS=<file>                           (optional) every Certum signature is appended there as one JSON line (signer, timestamp, hash): the build result reads it
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { signingMode, publisherNames } = require('../packaging/signing-config.cjs');
export { signingMode, publisherNames };

export const TIMESTAMP_AZURE = 'http://timestamp.acs.microsoft.com';
export const TIMESTAMP_CERTUM = 'http://time.certum.pl';

/** A stop that is the person's to fix (a login, a name, a thumbprint): the message says what to do. Never swallowed into an unsigned build. */
export class SigningStop extends Error { constructor(message, detail = '') { super(message); this.name = 'SigningStop'; this.detail = detail; } }

/** The one line a person sees when the certificate cannot be used before the build starts (no thumbprint, no account, nothing else in it). */
export const NOT_LOGGED_IN = 'SimplySign is not logged in: log in on the laptop, then run the build again';
export const LOGIN_HINT = 'Log in to SimplySign first: start SimplySign Desktop, tray icon > "Connect to SimplySign", enter the user name and the one-time token from the SimplySign phone app (a person does this: no session or script handles that login). The login expires, so do it right before the build, then run again.';

/** signtool.exe: ACIRA_SIGNTOOL, else the newest x64 one in the Windows SDK. */
export function findSigntool(env = process.env) {
  if (env.ACIRA_SIGNTOOL) return env.ACIRA_SIGNTOOL;
  const base = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  try { for (const version of fs.readdirSync(base).sort().reverse()) { const candidate = path.join(base, version, 'x64', 'signtool.exe'); if (fs.existsSync(candidate)) return candidate; } } catch { /* no SDK */ }
  return null;
}

/** The certificate's SHA-1 thumbprint from ACIRA_CERTUM_THUMBPRINT, as 40 upper-case hex digits. Windows' certificate dialog copies it with spaces and an invisible mark: both are dropped. */
export function certumThumbprint(env = process.env) {
  const raw = String(env.ACIRA_CERTUM_THUMBPRINT || '');
  if (!raw.trim()) throw new SigningStop('Certum signing needs ACIRA_CERTUM_THUMBPRINT: the SHA-1 thumbprint of the Acira certificate (SimplySign Desktop > Manage certificates > Certificate list > open the certificate > Details > Thumbprint).');
  const hex = raw.replace(/[\s:\u200e\u200f\ufeff]/g, '').toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(hex)) throw new SigningStop(`ACIRA_CERTUM_THUMBPRINT must be the 40 hex digits of the SHA-1 thumbprint (got ${hex.length} characters).`);
  return hex;
}

/** The command that signs one file in the given mode: { command, args }. Pure, so tests can check it. */
export function signCommand(file, env = process.env, mode = signingMode(env), metadataFile = '') {
  if (mode === 'command') return { command: env.ACIRA_SIGN_COMMAND, args: [file] };
  const signtool = findSigntool(env);
  if (!signtool) throw new Error('signtool.exe not found: install the Windows SDK or set ACIRA_SIGNTOOL.');
  if (mode === 'azure') {
    if (!env.ACIRA_AZURE_DLIB) throw new Error('ACIRA_AZURE_DLIB must point at Azure.CodeSigning.Dlib.dll.');
    return { command: signtool, args: ['sign', '/v', '/fd', 'SHA256', '/tr', env.ACIRA_TIMESTAMP_URL || TIMESTAMP_AZURE, '/td', 'SHA256', '/dlib', env.ACIRA_AZURE_DLIB, '/dmdf', metadataFile, file] };
  }
  // Certum (Certum's own signtool guide): the certificate is picked from the current user's store by thumbprint; SHA-256 file digest; RFC 3161 timestamp.
  if (mode === 'certum') return { command: signtool, args: ['sign', '/v', '/s', 'My', '/sha1', certumThumbprint(env), '/fd', 'SHA256', '/tr', env.ACIRA_TIMESTAMP_URL || TIMESTAMP_CERTUM, '/td', 'SHA256', file] };
  if (mode === 'pfx') return { command: signtool, args: ['sign', '/f', env.CSC_LINK, '/p', env.CSC_KEY_PASSWORD, '/fd', 'SHA256', '/tr', env.ACIRA_TIMESTAMP_URL || 'http://timestamp.digicert.com', '/td', 'SHA256', file] };
  throw new Error('Unknown signing mode: ' + mode);
}

/** How the signing steps start programs: { status, stdout, stderr, error }. Tests hand in a stand-in. */
export function defaultRun(command, args, options = {}) {
  const run = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '', error: run.error || null };
}

/** The common name from a certificate subject such as `CN="Acira, Inc.", O="Acira, Inc.", C=US` (quoted values may hold commas). */
export function subjectParts(subject) {
  const parts = new Map(); let key = '', value = '', inKey = true, quoted = false;
  const finish = () => { const k = key.trim().toUpperCase(); if (k && !parts.has(k)) parts.set(k, value.trim()); key = ''; value = ''; inKey = true; };
  const text = String(subject || '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inKey) { if (c === '=') inKey = false; else key += c; continue; }
    if (quoted) { if (c === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = false; else value += c; continue; }
    if (c === '"' && value.trim() === '') { quoted = true; value = ''; continue; }
    if (c === '\\' && i + 1 < text.length) { value += text[++i]; continue; }
    if (c === ',') { finish(); continue; }
    value += c;
  }
  finish();
  return parts;
}
export const commonName = subject => subjectParts(subject).get('CN') || '';

/** Windows' own reading of one file's signature, as one JSON line (the file travels in the environment, never in the command line). */
const DETAILS_SCRIPT = "$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:ACIRA_VERIFY_FILE; [pscustomobject]@{status=[string]$s.Status;subject=$(if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null});thumbprint=$(if($s.SignerCertificate){$s.SignerCertificate.Thumbprint}else{$null});timestamper=$(if($s.TimeStamperCertificate){$s.TimeStamperCertificate.Subject}else{$null})} | ConvertTo-Json -Compress";
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const BUSY = /being used by another process/i, BUSY_RETRIES = 10, BUSY_WAIT_MS = 6000;
const sleepSync = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const tail = result => String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-6).join('\n');

/**
 * Checks one signed file and returns its record, or stops: Windows must call the signature valid (trusted chain), the signer's common name must be one of the
 * accepted names and its thumbprint must be the Certum certificate's, and the signature must carry a timestamp (so it outlives the certificate).
 */
export function verifySigned(file, { env = process.env, names, thumbprint, run = defaultRun, now = () => new Date() } = {}) {
  const details = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DETAILS_SCRIPT], { env: { ...env, ACIRA_VERIFY_FILE: file, PSModulePath: path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') } });
  let found;
  try { found = JSON.parse(String(details.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || ''); } catch { throw new SigningStop(`Could not read the signature of ${file} back from Windows: ${details.error?.message || tail(details) || 'no answer'}`); }
  if (found.status !== 'Valid') throw new SigningStop(`${file} is not signed correctly: Windows says "${found.status}"${found.subject ? ' (signer ' + found.subject + ')' : ''}.`);
  const signer = commonName(found.subject);
  if (!names.includes(signer)) throw new SigningStop(`${file} is signed by "${signer}", not by ${names.map(n => '"' + n + '"').join(' or ')}: check ACIRA_PUBLISHER_NAME and the certificate behind ACIRA_CERTUM_THUMBPRINT.`);
  if (thumbprint && String(found.thumbprint || '').toUpperCase() !== thumbprint) throw new SigningStop(`${file} is signed with certificate ${found.thumbprint}, not ${thumbprint}.`);
  // signtool verify: exit 0 = valid and timestamped, 2 = valid but NOT timestamped (/tw warns), anything else = not valid.
  const tool = findSigntool(env), check = run(tool, ['verify', '/pa', '/tw', file], {});
  if (check.error || (check.status !== 0 && check.status !== 2)) throw new SigningStop(`signtool does not accept the signature of ${file} (exit ${check.error ? check.error.message : check.status}).\n${tail(check)}`);
  if (check.status === 2 && !found.timestamper) throw new SigningStop(`${file} is signed but carries no timestamp: the signature would stop being valid when the certificate expires. Is ${env.ACIRA_TIMESTAMP_URL || TIMESTAMP_CERTUM} reachable?`);
  return { name: path.basename(file), file, status: 'Valid', signer, subject: found.subject, thumbprint: found.thumbprint, timestamped: true, timestamper: found.timestamper || null, timestampServer: env.ACIRA_TIMESTAMP_URL || TIMESTAMP_CERTUM, signedAt: now().toISOString(), sha256: sha256(file) };
}

/** A small program that ships with every Windows, copied and signed as the throwaway of the probe. */
function probeSource(env) {
  const system = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32');
  for (const name of ['where.exe', 'whoami.exe', 'hostname.exe']) { const file = path.win32.join(system, name); if (fs.existsSync(file)) return file; }
  return null;
}
/** Signs one throwaway copy of a small Windows program with the Certum certificate, so a login that is not usable is found now, not halfway through the build. Nothing of it is kept. */
function probeSigning(env, run, deps) {
  const source = deps.probeSource === undefined ? probeSource(env) : deps.probeSource;
  if (!source) throw new SigningStop('No small Windows program found to test-sign (System32\\where.exe): set up the laptop, then run the build again');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-sign-probe-'));
  try {
    const file = path.join(dir, 'probe.exe');
    fs.copyFileSync(source, file);
    const { command, args } = signCommand(file, env, 'certum');
    const result = run(command, args, {});
    if (result.error || result.status !== 0) {
      const output = tail(result);
      if (/timestamp server/i.test(output)) throw new SigningStop(`The Certum timestamp server (${env.ACIRA_TIMESTAMP_URL || TIMESTAMP_CERTUM}) could not be reached: check the laptop's internet connection, then run the build again`, output);
      throw new SigningStop(NOT_LOGGED_IN, `Test-signing a throwaway file failed (signtool ${result.error ? result.error.message : 'exit ' + result.status}).\n${output}\n${LOGIN_HINT}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Before any long work: the certificate must be in the current user's Windows store (SimplySign Desktop, logged in, puts it there), signtool must exist, and the
 * name and thumbprint must be given. Stops with what to do. With { probe: true } (the start of a build) one throwaway file is also really signed, which proves the
 * login works and the timestamp server answers. Certum mode only; other modes return their mode.
 */
export function preflightSigning(env = process.env, deps = {}) {
  const mode = signingMode(env);
  if (mode !== 'certum') return { mode };
  const run = deps.run || defaultRun, platform = deps.platform || process.platform;
  if (!publisherNames(env).length) throw new SigningStop('Certum signing needs ACIRA_PUBLISHER_NAME: the name on the certificate, exactly (Acira, Inc.).');
  const thumbprint = certumThumbprint(env);
  if (platform !== 'win32') throw new SigningStop(`Certum signing runs on the Windows build laptop (signtool and the SimplySign certificate store); this computer is ${platform}.`);
  if (!findSigntool(env)) throw new SigningStop('signtool.exe not found: install the Windows SDK or set ACIRA_SIGNTOOL.');
  const store = run('certutil', ['-user', '-store', 'My', thumbprint], {});
  if (store.error || store.status !== 0) throw new SigningStop(NOT_LOGGED_IN, `The Acira certificate (thumbprint ${thumbprint.slice(0, 4)}...${thumbprint.slice(-4)}) is not in the Windows certificate store (current user, "My"). ${LOGIN_HINT} If you are logged in, check ACIRA_CERTUM_THUMBPRINT.`);
  if (deps.probe) probeSigning(env, run, deps);
  return { mode, thumbprint };
}

export function appendSignRecords(file, records) {
  if (file && records.length) fs.appendFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}
/** The records the signing steps of one build appended to ACIRA_SIGN_RECORDS (one JSON object per line). */
export function readSignRecords(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function signFilesCertum(files, env, log, deps) {
  const run = deps.run || defaultRun, { thumbprint } = preflightSigning(env, deps), names = publisherNames(env), signed = [], records = [];
  for (const file of files) {
    const { command, args } = signCommand(file, env, 'certum');
    log(`[sign] ${path.basename(file)}`);
    let result = run(command, args, {}), held = 0;
    // 14.5's first signed build: a freshly written program or setup (250 MB) is briefly held by the antivirus or Windows Search, and signtool says
    // "The file is being used by another process". That one answer waits and tries the same file again; every other failure stops at once.
    while ((result.error || result.status !== 0) && !result.error && BUSY.test(tail(result)) && held < BUSY_RETRIES) {
      held++; log(`[sign] ${path.basename(file)} is held by another program (antivirus or search indexing): waiting ${BUSY_WAIT_MS / 1000} s, then try ${held + 1} of ${BUSY_RETRIES + 1}`);
      (deps.sleep || sleepSync)(BUSY_WAIT_MS); result = run(command, args, {});
    }
    if (result.error || result.status !== 0) throw new SigningStop(`Signing failed for ${file} (signtool ${result.error ? result.error.message : 'exit ' + result.status}).\n${tail(result)}\n${BUSY.test(tail(result)) ? `Another program kept the file open through ${BUSY_RETRIES + 1} tries (antivirus or search indexing): pause it for the build, then run the build again.` : LOGIN_HINT}`);
    records.push(verifySigned(file, { env, names, thumbprint, run, now: deps.now }));
    signed.push(file);
  }
  appendSignRecords(env.ACIRA_SIGN_RECORDS, records);
  return { mode: 'certum', signed, records };
}

/** Signs the files. Returns { mode, signed: [...], records? }; mode 'none' signs nothing and warns. Certum mode also verifies every file and stops at the first problem. */
export function signFiles(files, env = process.env, log = console.log, deps = {}) {
  const mode = signingMode(env);
  if (mode === 'none') { log('[sign] no signing configured (ACIRA_SIGN / CSC_LINK / ACIRA_SIGN_COMMAND unset): files stay unsigned.'); return { mode, signed: [] }; }
  if (mode === 'certum') return signFilesCertum(files, env, log, deps);
  let metadataFile = '';
  if (mode === 'azure') {
    for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'ACIRA_AZURE_ENDPOINT', 'ACIRA_AZURE_ACCOUNT', 'ACIRA_AZURE_PROFILE']) if (!env[name]) throw new Error(`Azure signing needs ${name}.`);
    metadataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-sign-')), 'metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify({ Endpoint: env.ACIRA_AZURE_ENDPOINT, CodeSigningAccountName: env.ACIRA_AZURE_ACCOUNT, CertificateProfileName: env.ACIRA_AZURE_PROFILE }));
  }
  const signed = [];
  try {
    for (const file of files) {
      const { command, args } = signCommand(file, env, mode, metadataFile);
      log(`[sign] ${path.basename(file)}`);
      const run = spawnSync(command, args, { stdio: 'inherit', env, shell: mode === 'command' && /\.(cmd|bat)$/i.test(command) });
      if (run.status !== 0) throw new Error(`Signing failed for ${file}`);
      signed.push(file);
    }
  } finally { if (metadataFile) fs.rmSync(path.dirname(metadataFile), { recursive: true, force: true }); }
  return { mode, signed };
}

/** Authenticode status of a file: 'Valid', 'NotSigned', ... (Windows PowerShell). */
export function signatureStatus(file) {
  const run = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'", "''")}').Status`], { encoding: 'utf8', timeout: 60000 });
  return (run.stdout || '').trim() || 'Unknown';
}
