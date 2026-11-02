'use strict';
// "Is a VPN already running?" for the Connection choice. Looks on this computer only, never sends anything: network adapter names, and whether a known VPN app's
// process is running. Reports just the matches (a product name and how it was seen), never the process or adapter list.
const os = require('node:os'), { execFile } = require('node:child_process');
const APPS = Object.freeze([
  ['mullvad vpn.exe', 'Mullvad VPN'], ['mullvad-daemon.exe', 'Mullvad VPN'], ['protonvpn.exe', 'Proton VPN'], ['protonvpn.client.exe', 'Proton VPN'], ['protonvpnservice.exe', 'Proton VPN'],
  ['ivpn client.exe', 'IVPN'], ['ivpn-service.exe', 'IVPN'], ['openvpn.exe', 'OpenVPN'], ['openvpn-gui.exe', 'OpenVPN'], ['openvpnserv.exe', 'OpenVPN'], ['wireguard.exe', 'WireGuard'],
  ['nordvpn.exe', 'NordVPN'], ['nordvpn-service.exe', 'NordVPN'], ['expressvpn.exe', 'ExpressVPN'], ['expressvpnd.exe', 'ExpressVPN'], ['surfshark.exe', 'Surfshark'], ['cyberghost.exe', 'CyberGhost'],
  ['windscribe.exe', 'Windscribe'], ['pia-client.exe', 'Private Internet Access'], ['pia-service.exe', 'Private Internet Access'], ['warp-svc.exe', 'Cloudflare WARP'], ['cloudflare warp.exe', 'Cloudflare WARP'],
  ['tailscaled.exe', 'Tailscale'], ['tailscale-ipn.exe', 'Tailscale'], ['tunnelbear.exe', 'TunnelBear'], ['hotspotshield.exe', 'Hotspot Shield'], ['proton vpn', 'Proton VPN'], ['mullvad-daemon', 'Mullvad VPN'],
  ['openvpn', 'OpenVPN'], ['wireguard-go', 'WireGuard'], ['tailscaled', 'Tailscale'], ['nordvpnd', 'NordVPN'], ['expressvpnd', 'ExpressVPN']
]);
const ADAPTERS = Object.freeze([
  [/mullvad/i, 'Mullvad VPN'], [/proton/i, 'Proton VPN'], [/ivpn/i, 'IVPN'], [/nord(lynx|vpn)/i, 'NordVPN'], [/express/i, 'ExpressVPN'], [/windscribe/i, 'Windscribe'], [/surfshark/i, 'Surfshark'],
  [/cyberghost/i, 'CyberGhost'], [/tailscale/i, 'Tailscale'], [/warp/i, 'Cloudflare WARP'], [/wintun|wireguard|^wg\d/i, 'WireGuard'], [/tap-windows|openvpn|^tun\d|^tap\d/i, 'OpenVPN or a similar VPN'], [/\bvpn\b/i, 'a VPN']
]);
/** The VPN apps behind the given adapter names and process names, deduplicated, in the order found. */
function matchVpn(adapterNames = [], processNames = []) {
  const found = new Map();
  for (const name of processNames) { const hit = APPS.find(([process]) => String(name).toLowerCase() === process); if (hit && !found.has(hit[1])) found.set(hit[1], 'app running'); }
  for (const name of adapterNames) { const hit = ADAPTERS.find(([pattern]) => pattern.test(String(name))); if (hit && !found.has(hit[1])) found.set(hit[1], 'network adapter'); }
  return [...found].map(([name, how]) => ({ name, how }));
}
function runningProcesses(timeoutMs = 4000) {
  return new Promise(resolve => {
    const command = process.platform === 'win32' ? ['tasklist', ['/FO', 'CSV', '/NH']] : ['ps', ['-A', '-o', 'comm=']];
    try {
      execFile(command[0], command[1], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout) return resolve([]);
        resolve(String(stdout).split(/\r?\n/).map(line => process.platform === 'win32' ? (/^"([^"]+)"/.exec(line) || [])[1] : line.trim().split('/').pop()).filter(Boolean));
      });
    } catch { resolve([]); }
  });
}
/** What this computer shows: `{detected: [{name, how}]}`. Failures simply find nothing. */
async function detectVpn({ interfaces = () => os.networkInterfaces(), processes = runningProcesses } = {}) {
  let adapters = []; try { adapters = Object.entries(interfaces() || {}).filter(([, addresses]) => (addresses || []).some(address => !address.internal)).map(([name]) => name); } catch { adapters = []; }
  const names = await processes().catch(() => []);
  return { detected: matchVpn(adapters, names) };
}
/** Three providers that publish independent security audits. Plain links: Acira has no deal with any of them, adds no tracking parameters and earns nothing. */
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'mullvad', name: 'Mullvad VPN', url: 'https://mullvad.net/', note: 'Paid, no email or account name needed. Its infrastructure was audited by Cure53.' }),
  Object.freeze({ id: 'proton', name: 'Proton VPN', url: 'https://protonvpn.com/', note: 'Has a free plan. Its no-logs policy is audited every year (Securitum).' }),
  Object.freeze({ id: 'ivpn', name: 'IVPN', url: 'https://www.ivpn.net/', note: 'Paid. Published a Cure53 security audit.' })
]);
/** The provider list with each note in the current language. PROVIDERS keeps the English text for tests. */
const localizedProviders = () => PROVIDERS.map((provider) => ({ ...provider, note: require('./tx.cjs').t('vpn.note.' + provider.id) }));
module.exports = { localizedProviders, detectVpn, matchVpn, PROVIDERS };
