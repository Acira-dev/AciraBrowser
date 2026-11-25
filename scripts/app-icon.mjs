#!/usr/bin/env node
// Publishes a new app icon for Acira on update.acirabrowser.com/appicon/, and takes it back. The rules are in packaging/app-icon-publish.cjs; what an installed Acira accepts is decided by its own reader (desktop/browser-services/app-icon.cjs).
//   node scripts/app-icon.mjs check   --name Christmas --windows w.png --mac m.png --linux l.png [--from 2026-12-01 --until 2027-01-03] [--min-version 0.1.0-beta.14.3] [--audience insider|public|all] [--target main|testers|rehearsal]
//   node scripts/app-icon.mjs publish <the same>  [--publish] [--yes]     DRY RUN unless --publish: the same checks, a contact sheet to look at, nothing written
//   node scripts/app-icon.mjs clear   [--min-version V] [--audience insider|public|all] [--target T] [--publish] [--yes]    "back to the standard icon" (a higher version; for everyone unless an audience is named)
//   node scripts/app-icon.mjs status  [--target T]                          what is live now (a plain read of the public address)
//   node scripts/app-icon.mjs preview --windows w.png --mac m.png --linux l.png [--out folder]   writes app-icon-preview.png: the three pictures as they will look (a Mac Dock tile between two rounded neighbours, the Windows taskbar sizes, the Linux launcher sizes); no network, nothing published
//   --yes     skips the typed "publish" question (for a script the team runs himself); without it a person at a terminal must type it
//   --live-file <index.json | none>  take the live document from a local file instead of reading the public address (offline dry runs; the size cap of appicon/ is then not checked)
// The three pictures are used byte for byte: Windows 256 x 256, Mac 1024 x 1024, Linux 512 x 512, PNG. A wrong size is refused, never resized. macOS draws a run-time Dock picture EXACTLY as supplied (no mask, no rounding, no margin),
// so the Mac picture must already be shaped like a macOS icon (rounded body, transparent corners): a full-bleed square is refused unless --mac-square-ok.
// --publish is a LIVE write to the public updates repository (needs `gh` logged in with write access): the team's go, never run by a build or a test session. Pictures first, verified anonymously, the document last.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../packaging/app-icon-publish.cjs'), T = require('../packaging/update-targets.cjs'), icon = require('../desktop/browser-services/app-icon.cjs');

const [command, ...rest] = process.argv.slice(2);
const options = {}, flags = new Set(['publish', 'yes', 'mac-square-ok']);
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (!arg.startsWith('--')) { console.error('Unexpected argument: ' + arg); process.exit(2); }
  const key = arg.slice(2);
  if (flags.has(key)) options[key] = true;
  else { options[key] = rest[++i]; if (options[key] === undefined) { console.error('--' + key + ' needs a value.'); process.exit(2); } }
}
const known = new Set(['name', 'windows', 'mac', 'linux', 'from', 'until', 'min-version', 'audience', 'target', 'out', 'live-file', 'publish', 'yes', 'mac-square-ok']);
for (const key of Object.keys(options)) if (!known.has(key)) { console.error('Unknown option --' + key); process.exit(2); }
if (!['check', 'publish', 'clear', 'status', 'preview'].includes(command)) { console.error('Usage: node scripts/app-icon.mjs check|publish|clear|status|preview [options] (see the top of this file)'); process.exit(2); }
if (options.publish && !['publish', 'clear'].includes(command)) { console.error('--publish belongs to the publish and clear commands; check never writes anything.'); process.exit(2); }
const target = options.target ?? 'main';
if (!(target in P.FOLDERS)) { console.error('--target must be main, testers or rehearsal.'); process.exit(2); }
const folder = P.FOLDERS[target];
const common = { from: options.from, until: options.until, minVersion: options['min-version'], audience: options.audience, folder };

const readPicture = (platform) => { const file = options[platform]; if (!file) return null; try { return fs.readFileSync(path.resolve(file)); } catch (error) { console.error(`Cannot read --${platform} ${file}: ${error.message}`); process.exit(2); } };
const gh = (args, { input } = {}) => execFileSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

/** The live document. For a write (`--publish`) it is read from the repository itself through `gh`, which is authoritative; otherwise (and as a fallback for a dry run) from the public address, which a CDN can serve a few minutes stale: said so. */
async function liveDocument() {
  if (options['live-file']) { if (options['live-file'] === 'none') return null; return P.liveOf(fs.readFileSync(path.resolve(options['live-file']), 'utf8')); }
  const current = T.targets().current;
  if (command !== 'status') {
    try { return P.liveOf(await P.readRepoDocument({ gh, target: current, indexPath: folder + 'appicon/index.json' })); }
    catch (error) { if (options.publish) throw new Error('Cannot read the repository to number the new version: ' + String(error?.message || error).split('\n')[0]); console.log('(the repository could not be read through gh; using the public address, which can lag by ten minutes)'); }
  }
  const response = await fetch(P.HOST + folder + 'appicon/index.json', { cache: 'no-store', redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error('The public address answered HTTP ' + response.status + '.');
  return P.liveOf(await response.text());
}
async function existingFiles() {
  if (options['live-file']) return [];
  try { const list = JSON.parse(gh(['api', `repos/${T.targets().current.repo}/contents/${T.targets().current.dir}/${folder}appicon?ref=${T.targets().current.branch}`])); return list.filter((item) => item.type === 'file').map((item) => ({ path: item.name, size: item.size })); } catch { return []; }
}
const confirm = async (what) => {
  if (options.yes) return true;
  if (!process.stdin.isTTY) throw new Error('This step asks you to type "publish"; run it in a terminal, or add --yes.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question('\n' + what + '\nType publish to continue: ')).trim() === 'publish'; } finally { rl.close(); }
};

if (command === 'preview') {
  const pictures = { windows: readPicture('windows'), mac: readPicture('mac'), linux: readPicture('linux') }, problems = [];
  for (const [platform, side] of Object.entries(icon.SIZES)) { if (!pictures[platform]) problems.push(`--${platform} is needed`); else { const verdict = icon.checkPng(pictures[platform], { width: side, height: side }); if (!verdict.ok) problems.push(`the ${platform} picture is refused (${verdict.reason}): it must be a sound ${side} x ${side} PNG`); } }
  if (problems.length) { console.error('REFUSED. Nothing was written:'); for (const problem of problems) console.error('  x ' + problem); process.exit(1); }
  const { png, notes } = require('../packaging/app-icon-preview.cjs').preview(pictures);
  const file = path.join(path.resolve(options.out ?? os.tmpdir()), 'app-icon-preview.png'); fs.writeFileSync(file, png);
  console.log('A picture of the three as they will look: ' + file + '\n  top: the Mac Dock (a system-shaped neighbour, yours exactly as supplied, another neighbour); middle: the Windows taskbar (32 and 48 px); bottom: a Linux launcher panel (64 and 48 px).');
  for (const note of notes) console.log('  ! ' + note);
  process.exit(0);
}
try {
  const live = await liveDocument();
  if (command === 'status') { console.log(P.describe(live)); process.exit(0); }
  const pictures = { windows: readPicture('windows'), mac: readPicture('mac'), linux: readPicture('linux') };
  const plan = command === 'clear' ? P.planClear({ ...common, live }) : P.planPublish({ ...common, name: options.name, pictures, live, existing: await existingFiles(), macSquareOk: options['mac-square-ok'] === true });
  console.log('Live now: ' + P.describe(live));
  if (!plan.ok) { console.error('\nREFUSED. Nothing was written:'); for (const problem of plan.problems) console.error('  x ' + problem); process.exit(1); }
  console.log('This would make: ' + P.describe(plan.document));
  for (const file of plan.files) console.log(`  + ${file.path} (${file.bytes.length} bytes, ${file.platform}, sha512 ${icon.sha512Of(file.bytes).slice(0, 16)}...)`);
  console.log(`  + ${plan.indexPath} (the document, version ${plan.version}, written last)`);
  if (command !== 'clear') {
    const sheet = path.join(path.resolve(options.out ?? os.tmpdir()), `app-icon-check-${P.slug(options.name)}.html`);
    fs.writeFileSync(sheet, P.contactSheet({ pictures, label: options.name })); console.log('A contact sheet to look at: ' + sheet);
  }
  if (!options.publish) { console.log('\nDRY RUN OK. Nothing was written. Add --publish to write it (a live commit to the public updates repository).'); process.exit(0); }
  const current = T.targets().current;
  if (!(await confirm(`Write ${plan.files.length ? 'the pictures and ' : ''}the document (version ${plan.version}) to ${current.repo} (${current.branch}, ${current.dir}/${folder}appicon/)?`))) { console.log('Not written.'); process.exit(1); }
  await P.publish({ plan, deps: { gh, fetch, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log: console.log, target: current } });
  console.log('Taken back by `clear`, or by publishing the earlier pictures again. Each person\'s app follows within a day.');
} catch (error) {
  console.error('\n' + (error?.message || error));
  process.exit(1);
}
