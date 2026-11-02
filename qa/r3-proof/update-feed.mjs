// R3-44 row "Auto-update feed". The PACKAGED app (the installed-style build) checks a local feed that carries a newer version.
//   node qa/r3-proof/update-feed.mjs [feed folder]      PROOF_PACKAGED_SOURCE=<folder with AciraBrowser.exe> (default C:\ae\rel5\win-unpacked)
// The packaged folder is copied to C:\ae\r3\proof\pkg (the original is never touched) and given the stand-in "Uninstall AciraBrowser.exe" the updater looks for
// (without it the app calls itself a portable copy and updates are off). The feed is a latest.yml + beta.yml and a stand-in installer file (never run) whose
// SHA-512 is real, so the updater's integrity check is exercised for real.  Delegates the run itself to qa/e-update-feed.mjs.
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {probe, withSlot} from './lib.mjs';

const P = probe('update-feed');
const feed = path.resolve(process.argv[2] || 'C:/ae/r3/proof/feed');
const source = path.resolve(process.env.PROOF_PACKAGED_SOURCE || 'C:/ae/rel5/win-unpacked');
const target = path.resolve('C:/ae/r3/proof/pkg/win-unpacked');
const VERSION = '99.0.0', NAME = 'AciraBrowserSetup.exe';

if (!fs.existsSync(path.join(source, 'AciraBrowser.exe'))) { P.check('a packaged build is available', false, `no AciraBrowser.exe in ${source} (set PROOF_PACKAGED_SOURCE)`); P.finish(); process.exit(1); }
if (!fs.existsSync(path.join(target, 'AciraBrowser.exe'))) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const copy = spawnSync('robocopy', [source, target, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], {windowsHide: true, encoding: 'utf8'});
  if (copy.status >= 8) { P.check('the packaged build was copied for the test', false, `robocopy exit ${copy.status}`); P.finish(); process.exit(1); }
}
const stub = path.join(target, 'Uninstall AciraBrowser.exe');
if (!fs.existsSync(stub)) fs.writeFileSync(stub, 'MZ stand-in for the uninstaller; QA only, never run');
fs.rmSync(feed, {recursive: true, force: true}); fs.mkdirSync(feed, {recursive: true});
const installer = Buffer.alloc(1024 * 1024); for (let i = 0; i < installer.length; i++) installer[i] = (i * 31 + 7) & 255;
fs.writeFileSync(path.join(feed, NAME), installer);
const sha512 = createHash('sha512').update(installer).digest('base64');
const yml = `version: ${VERSION}\nfiles:\n  - url: ${NAME}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${NAME}\nsha512: ${sha512}\nreleaseDate: '2026-10-26T00:00:00.000Z'\n`;
fs.writeFileSync(path.join(feed, 'latest.yml'), yml); fs.writeFileSync(path.join(feed, 'beta.yml'), yml);

await withSlot('proof-update-feed', async () => {
  const output = await new Promise(resolve => {
    let text = '';
    const child = spawn(process.execPath, ['qa/e-update-feed.mjs', feed], {env: {...process.env, D_APP_EXE: path.join(target, 'AciraBrowser.exe')}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    const timer = setTimeout(() => { if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); }, 360000);
    child.on('close', code => { clearTimeout(timer); resolve({code, text}); });
  });
  fs.writeFileSync(P.shot('e-update-feed.txt'), output.text);
  let out = null; try { out = JSON.parse(output.text.slice(output.text.indexOf('{'), output.text.lastIndexOf('}') + 1)); } catch {}
  P.check('the packaged app ran the update check against the local feed', Boolean(out), output.text.slice(-300), P.shot('e-update-feed.txt'));
  if (!out) return;
  P.check('the installed-style build is update-capable (not a portable copy)', out.before?.supported === true, JSON.stringify({supported: out.before?.supported, reason: out.before?.reason, version: out.before?.version, channel: out.before?.channel}));
  P.check('the check finds the newer version in the feed', out.afterCheck?.available === VERSION && ['downloading', 'checking', 'available', 'ready'].includes(out.afterCheck?.status), JSON.stringify({status: out.afterCheck?.status, available: out.afterCheck?.available, from: out.before?.version}));
  P.check('the installer is downloaded and its SHA-512 verified: status "ready"', out.final?.status === 'ready' && out.final?.available === VERSION && output.code === 0, JSON.stringify({status: out.final?.status, available: out.final?.available, progress: out.final?.progress, error: out.final?.error}));
  P.check('the feed was asked for the update file and the installer', (out.served || []).some(u => /latest\.yml|beta\.yml/.test(u)) && (out.served || []).some(u => u.includes(NAME)), JSON.stringify(out.served));
  P.check('the Stable / Beta switch answers for both channels', out.stable?.channel === 'stable' && out.beta?.channel === 'beta', JSON.stringify({stable: out.stable?.channel, beta: out.beta?.channel}));
  P.note(`packaged ${out.before?.version} (${target}) -> feed ${VERSION}: ${out.final?.status}`);
});
P.finish({packagedSource: source});
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
