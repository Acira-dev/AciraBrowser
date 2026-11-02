'use strict';
// Local Windows and macOS provider controls. No Acira tunnel, account storage, IP check, PATH lookup or shell command expansion.
// Contracts and installation paths: docs/launch/research/VPN_INTEGRATION.md.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFile } = require('node:child_process');
const PROVIDERS = Object.freeze([
  { id: 'mullvad', name: 'Mullvad VPN', site: 'https://mullvad.net/', help: 'https://mullvad.net/en/help/how-use-mullvad-cli', publishers: ['Mullvad VPN AB', 'Amagicom AB'] },
  { id: 'proton', name: 'Proton VPN', site: 'https://protonvpn.com/', help: 'https://protonvpn.com/support/install-windows-vpn', publishers: ['Proton AG', 'Proton Technologies AG'] },
  { id: 'ivpn', name: 'IVPN', site: 'https://www.ivpn.net/', help: 'https://www.ivpn.net/blog/command-line-interface-ivpn-released/', publishers: ['IVPN Limited', 'Privatus Limited'] },
]);
const COMMANDS = Object.freeze({
  mullvad: { status: ['status', '--json'], connect: ['connect'], disconnect: ['disconnect'] },
  ivpn: { status: ['status'], connect: ['connect', '-last'], disconnect: ['disconnect'] },
});
const STATES = new Set(['connected', 'disconnected', 'connecting', 'disconnecting', 'error']);
// Constant source, never interpolated. The fixed candidate is a literal path in a dedicated child environment variable.
const VERIFY_SCRIPT = "$ErrorActionPreference='Stop'; try { $s=Get-AuthenticodeSignature -LiteralPath $env:ACIRA_VPN_VERIFY_PATH; @{valid=($s.Status -eq 'Valid'); publisher=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{''}} | ConvertTo-Json -Compress } catch { '{\"valid\":false,\"publisher\":\"\"}' }";

function runFile(file, args, options = {}) {
  return new Promise(resolve => {
    try {
      const child = execFile(file, args, { windowsHide: true, timeout: 7000, maxBuffer: 128 * 1024, encoding: 'utf8', ...options }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout || '') }));
      child.stdin?.end(); // Never answer provider account, password or enhanced-authentication prompts.
    } catch { resolve({ ok: false, stdout: '' }); }
  });
}

function parseStatus(provider, output) {
  if (typeof output !== 'string' || output.length > 128 * 1024) return { state: 'unknown', blocked: false };
  if (provider === 'mullvad') {
    // Current CLI may print a logged-out warning before its JSON object; never return the raw output.
    const line = output.split(/\r?\n/).find(value => value.trim().startsWith('{'));
    try {
      const value = JSON.parse(line || 'null');
      if (!STATES.has(value?.state)) return { state: 'unknown', blocked: false };
      return { state: value.state, blocked: value.state === 'disconnected' && value.details?.locked_down === true };
    } catch { return { state: 'unknown', blocked: false }; }
  }
  if (provider === 'ivpn') {
    const state = /^VPN\s*:\s*(CONNECTED|DISCONNECTED|CONNECTING|DISCONNECTING|RECONNECTING|PAUSED)\b/im.exec(output)?.[1];
    return { state: state === 'RECONNECTING' ? 'connecting' : state?.toLowerCase() || 'unknown', blocked: state === 'DISCONNECTED' && /^Firewall\s*:\s*Enabled\b/im.test(output) };
  }
  return { state: 'unknown', blocked: false };
}

function candidates(provider, roots, readDir) {
  const p = path.win32, cli = [], apps = [];
  for (const root of roots) {
    if (provider === 'mullvad') { cli.push(p.join(root, 'Mullvad VPN', 'resources', 'mullvad.exe')); apps.push(p.join(root, 'Mullvad VPN', 'Mullvad VPN.exe')); }
    if (provider === 'ivpn') { cli.push(p.join(root, 'IVPN Client', 'cli', 'ivpn.exe')); apps.push(p.join(root, 'IVPN Client', 'ui', 'IVPN Client.exe')); }
    if (provider === 'proton') {
      const base = p.join(root, 'Proton', 'VPN');
      // Only bounded, version-named folders, newest first. No arbitrary executable discovery or registry command strings.
      let versions = []; try { versions = readDir(base).filter(name => /^\d+(?:\.\d+){1,3}$/.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).slice(0, 12); } catch {}
      for (const version of versions) apps.push(p.join(base, version, 'ProtonVPN.Launcher.exe'), p.join(base, version, 'ProtonVPN.exe'));
    }
  }
  return { cli, apps };
}

// Fixed vendor bundle locations, verified against their official Mac package sources.
function macCandidates(provider, roots) {
  const names = { mullvad: ['Mullvad VPN.app'], ivpn: ['IVPN.app'], proton: ['ProtonVPN.app', 'Proton VPN.app'] };
  const cli = { mullvad: 'Contents/Resources/mullvad', ivpn: 'Contents/MacOS/cli/ivpn' };
  return roots.flatMap(root => (names[provider] || []).map(name => {
    const app = path.posix.join(root, name);
    return { app, cli: cli[provider] ? path.posix.join(app, cli[provider]) : null };
  }));
}
// Apple's Developer ID chain plus the same fixed vendor organization allow-list used on Windows.
// The requirement is built only from source constants, never renderer or filesystem text.
function macRequirement(provider) {
  return '=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and (' + provider.publishers.map(name => 'certificate leaf[subject.O] = ' + JSON.stringify(name)).join(' or ') + ')';
}

function createVpnControl({ platform = process.platform, env = process.env, files = fs, run = runFile, verify, openApp, homeDir = os.homedir() } = {}) {
  const signatureCache = new Map(); let busy = false;
  const windowsRoots = [...new Set([env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter(value => typeof value === 'string' && /^[a-z]:\\Program Files(?: \(x86\))?$/i.test(value)))];
  const roots = platform === 'darwin' ? ['/Applications', path.posix.join(homeDir, 'Applications')] : windowsRoots;
  const macPaths = provider => macCandidates(provider.id, roots);
  const identity = (file, directory = false) => {
    try {
      const stat = files.lstatSync(file);
      const canonical = platform === 'darwin' ? path.posix.resolve(file) : path.win32.resolve(file).toLowerCase();
      const real = files.realpathSync(file);
      if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink() || (platform === 'darwin' ? real : real.toLowerCase()) !== canonical) return null;
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    } catch { return null; }
  };
  const verifyFile = verify || (async (file, provider) => {
    if (platform === 'darwin') {
      const result = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', macRequirement(provider), file], { timeout: 10000 });
      return result.ok;
    }
    const powershell = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', VERIFY_SCRIPT], { env: { ...env, ACIRA_VPN_VERIFY_PATH: file }, timeout: 6000 });
    try { const signature = JSON.parse(result.stdout.trim()); return result.ok && signature.valid === true && provider.publishers.includes(signature.publisher); } catch { return false; }
  });
  async function trusted(file, provider) {
    if (platform === 'darwin') {
      const candidate = macPaths(provider).find(item => file === item.app || file === item.cli);
      if (!candidate) return false;
      // No Mac signature cache: changes inside an app need not change the bundle directory's mtime.
      // Check the exact CLI and resource seal around a fresh deep verification of its enclosing app.
      const seal = path.posix.join(candidate.app, 'Contents/_CodeSignature/CodeResources');
      const stamp = () => [identity(candidate.app, true), identity(seal), identity(file, file === candidate.app)];
      const before = stamp(); if (before.some(value => !value)) return false;
      try { if (!await verifyFile(candidate.app, provider)) return false; } catch { return false; }
      return stamp().every((value, index) => value === before[index]);
    }
    if (!roots.some(root => file.toLowerCase().startsWith(root.toLowerCase() + '\\'))) return false;
    const before = identity(file); if (!before) return false;
    const key = file + '|' + before;
    if (!signatureCache.has(key)) signatureCache.set(key, Promise.resolve(verifyFile(file, provider)).catch(() => false));
    return await signatureCache.get(key) === true && identity(file) === before;
  }
  async function find(provider) {
    if (platform === 'darwin') {
      const paths = macPaths(provider); let seen = false, app = null, cli = null;
      for (const candidate of paths) {
        seen ||= Boolean(identity(candidate.app, true));
        if (!app && await trusted(candidate.app, provider)) {
          app = candidate.app;
          if (candidate.cli && await trusted(candidate.cli, provider)) cli = candidate.cli;
        }
      }
      return { cli, app, seen };
    }
    if (platform !== 'win32') return { cli: null, app: null, seen: false };
    const paths = candidates(provider.id, roots, folder => files.readdirSync(folder));
    const choose = async list => { for (const file of list) if (await trusted(file, provider)) return file; return null; };
    const [cli, app] = await Promise.all([choose(paths.cli), choose(paths.apps)]);
    return { cli, app, seen: [...paths.cli, ...paths.apps].some(file => identity(file)) };
  }
  async function read(provider, install) {
    let status = { state: 'unknown', blocked: false };
    if (install.cli && COMMANDS[provider.id]) {
      const result = await run(install.cli, COMMANDS[provider.id].status);
      // A failed command (including authentication or a stopped daemon) cannot attest to a connected tunnel.
      if (result.ok) status = parseStatus(provider.id, result.stdout);
    }
    return { id: provider.id, name: provider.name, site: provider.site, help: platform === 'darwin' && provider.id === 'proton' ? 'https://protonvpn.com/support/protonvpn-mac-vpn-application' : provider.help, installed: install.seen, verified: Boolean(install.cli || install.app), canOpen: Boolean(install.app), canConnect: Boolean(install.cli) && status.state === 'disconnected', canDisconnect: Boolean(install.cli) && ['connected', 'connecting', 'error'].includes(status.state), ...status };
  }
  async function status() {
    const providers = await Promise.all(PROVIDERS.map(async provider => read(provider, await find(provider))));
    return { platform, busy, providers };
  }
  async function command(providerId, action) {
    const provider = PROVIDERS.find(item => item.id === providerId);
    if (!provider || !['connect', 'disconnect', 'open'].includes(action)) throw Error('Invalid VPN command.');
    if (busy) throw Error('Another VPN change is in progress.');
    busy = true;
    try {
      const install = await find(provider);
      if (action === 'open') {
        if (!install.app || !await trusted(install.app, provider)) throw Error('Open the provider website to install or configure its app.');
        const failure = await (openApp || (file => require('electron').shell.openPath(file)))(install.app);
        if (failure) throw Error('The provider app could not be opened. Open it directly from your applications.');
      } else {
        const before = await read(provider, install);
        if (!COMMANDS[providerId] || !install.cli || !(action === 'connect' ? before.canConnect : before.canDisconnect) || !await trusted(install.cli, provider)) throw Error('Open the provider app to sign in, choose a server and check its connection.');
        const result = await run(install.cli, COMMANDS[providerId][action], { timeout: 15000 });
        if (!result.ok) throw Error('The VPN app did not complete that command. Check its connection and sign-in in the provider app.');
      }
    } finally { busy = false; }
    return status(); // The provider status is authoritative; successful command delivery is never shown as Connected.
  }
  return { status, command };
}
let shared;
const sharedVpnControl = () => shared ||= createVpnControl();
module.exports = { createVpnControl, sharedVpnControl, parseStatus, candidates, macCandidates, macRequirement, runFile, PROVIDERS, COMMANDS };
