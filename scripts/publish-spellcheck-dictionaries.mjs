// Publishes the spelling-dictionary mirror (dist-dictionaries/, built by mirror-spellcheck-dictionaries.mjs --fetch) as assets of the
// GitHub release tagged `spellcheck-dictionaries`, which desktop/browser-services/spellcheck-dictionaries.cjs points every session at.
//   node scripts/publish-spellcheck-dictionaries.mjs             dry run: checks the files against SHA256SUMS and prints the gh commands
//   node scripts/publish-spellcheck-dictionaries.mjs --publish   runs them (needs `gh` logged in with write access; founder go only)
//   --dir <folder>  use another mirror folder.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = name => args.includes(name), value = name => args[args.indexOf(name) + 1];
const dir = path.resolve(flag('--dir') ? value('--dir') : path.join(root, 'dist-dictionaries'));
const { loadReleaseTarget, repoSlug } = createRequire(import.meta.url)('../packaging/release-target.cjs');
const repo = repoSlug(loadReleaseTarget()), tag = 'spellcheck-dictionaries';
if (!repo) { console.error('The release target (packaging/release-target.json) is not a GitHub repository; upload the dictionaries to its spellcheck-dictionaries/ folder yourself.'); process.exit(1); }

const sums = new Map();
try { for (const line of (await fs.readFile(path.join(dir, 'SHA256SUMS'), 'utf8')).split('\n')) { const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim()); if (m) sums.set(m[2], m[1]); } }
catch { console.error(`No SHA256SUMS in ${dir}. Run: node scripts/mirror-spellcheck-dictionaries.mjs --fetch`); process.exit(1); }
const files = (await fs.readdir(dir)).filter(name => /^[a-z0-9-]+\.bdic$/.test(name)).sort();
if (!files.length) { console.error('The mirror folder has no .bdic files.'); process.exit(1); }
for (const name of files) {
  const hash = createHash('sha256').update(await fs.readFile(path.join(dir, name))).digest('hex');
  if (sums.get(name) !== hash) { console.error(`Hash mismatch for ${name}; rebuild the mirror.`); process.exit(1); }
}
console.log(`${files.length} dictionaries verified against SHA256SUMS (${dir}).`);
const assets = [...files, 'SHA256SUMS'].map(name => path.join(dir, name));
const commands = [
  ['release', 'view', tag, '--repo', repo],
  ['release', 'create', tag, '--repo', repo, '--title', 'Spelling dictionaries', '--notes', 'Hunspell dictionaries for Chromium, mirrored unchanged so Acira never contacts Google to spell-check. See scripts/mirror-spellcheck-dictionaries.mjs.', '--latest=false'],
  ['release', 'upload', tag, '--repo', repo, '--clobber', ...assets],
];
if (!flag('--publish')) {
  console.log('Dry run. With --publish this would run:');
  console.log('  gh release view ' + tag + ' (create it when missing: gh release create ' + tag + ' --title "Spelling dictionaries" --latest=false)');
  console.log(`  gh release upload ${tag} --repo ${repo} --clobber <${files.length} dictionaries + SHA256SUMS>`);
  process.exit(0);
}
const gh = (...a) => spawnSync('gh', a, { stdio: 'inherit' });
if (gh('--version').error) { console.error('The GitHub CLI (gh) is not installed or not on PATH.'); process.exit(1); }
const exists = spawnSync('gh', commands[0], { stdio: 'ignore' }).status === 0;
if (!exists && gh(...commands[1]).status !== 0) process.exit(1);
process.exit(gh(...commands[2]).status ?? 1);
