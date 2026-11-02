// Code signing for the files electron-builder does not sign itself (the installer's own helper programs), plus a verifier.
// Configuration comes from the environment only (docs/launch/CODE_SIGNING.md); with none set, nothing is signed and a warning says so.
//   ACIRA_SIGN=azure   ACIRA_PUBLISHER_NAME  AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET
//                      ACIRA_AZURE_ENDPOINT ACIRA_AZURE_ACCOUNT ACIRA_AZURE_PROFILE
//                      ACIRA_AZURE_DLIB (path to Azure.CodeSigning.Dlib.dll)  ACIRA_SIGNTOOL (path to signtool.exe, optional: found in the Windows SDK)
//   CSC_LINK + CSC_KEY_PASSWORD                         certificate file
//   ACIRA_SIGN_COMMAND=<script>                         called as <script> <file> for each file
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { signingMode } = require('../packaging/signing-config.cjs');
export { signingMode };

export const TIMESTAMP_AZURE = 'http://timestamp.acs.microsoft.com';

/** signtool.exe: ACIRA_SIGNTOOL, else the newest x64 one in the Windows SDK. */
export function findSigntool(env = process.env) {
  if (env.ACIRA_SIGNTOOL) return env.ACIRA_SIGNTOOL;
  const base = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  try { for (const version of fs.readdirSync(base).sort().reverse()) { const candidate = path.join(base, version, 'x64', 'signtool.exe'); if (fs.existsSync(candidate)) return candidate; } } catch { /* no SDK */ }
  return null;
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
  if (mode === 'pfx') return { command: signtool, args: ['sign', '/f', env.CSC_LINK, '/p', env.CSC_KEY_PASSWORD, '/fd', 'SHA256', '/tr', env.ACIRA_TIMESTAMP_URL || 'http://timestamp.digicert.com', '/td', 'SHA256', file] };
  throw new Error('Unknown signing mode: ' + mode);
}

/** Signs the files. Returns { mode, signed: [...] }; mode 'none' signs nothing and warns. */
export function signFiles(files, env = process.env, log = console.log) {
  const mode = signingMode(env);
  if (mode === 'none') { log('[sign] no signing configured (ACIRA_SIGN / CSC_LINK / ACIRA_SIGN_COMMAND unset): files stay unsigned.'); return { mode, signed: [] }; }
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
