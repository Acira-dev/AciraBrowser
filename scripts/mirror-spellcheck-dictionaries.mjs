// Builds the spelling-dictionary mirror for Acira's GitHub release (parity audit #5).
//   node scripts/mirror-spellcheck-dictionaries.mjs            lists the files this Electron's Chromium asks for
//   node scripts/mirror-spellcheck-dictionaries.mjs --fetch    downloads them into dist-dictionaries/ with SHA256SUMS
// Upload the files, names unchanged, to the release tagged `spellcheck-dictionaries` (desktop/browser-services/
// spellcheck-dictionaries.cjs points every session there). File names come from the exact Chromium version bundled with
// Electron: components/spellcheck/common/spellcheck_common.cc (BSD-3-Clause) lists the languages and their versions, and
// Chromium requests `<language-region><version>.bdic` in lower case (verified in qa/k-privacy-nav.mjs: /pl-pl-3-0.bdic).
// The files are the ones Chromium itself downloads, from its own dictionary server, fetched once here so users never are.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The package's own answer for the binary's path (Electron.app/Contents/MacOS/Electron on a Mac; dist/electron only exists on Linux).
const electron = createRequire(import.meta.url)(path.join(root, 'node_modules', 'electron'));
const chrome = execFileSync(electron, ['-p', 'process.versions.chrome'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim();
if (!/^\d+\.\d+\.\d+\.\d+$/.test(chrome)) throw new Error('Unexpected Chromium version: ' + chrome);

const sourceUrl = `https://chromium.googlesource.com/chromium/src/+/refs/tags/${chrome}/components/spellcheck/common/spellcheck_common.cc?format=TEXT`;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Could not read Chromium ${chrome} spellcheck_common.cc (${response.status})`);
const source = Buffer.from(await response.text(), 'base64').toString('utf8');

const block = name => { const start = source.indexOf(name); if (start < 0) throw new Error('Missing ' + name); return source.slice(start, source.indexOf('};', start)); };
const regions = [...new Set([...block('kSupportedSpellCheckerLanguages').matchAll(/\{"[^"]+",\s*"([^"]+)"\}/g)].map(m => m[1]))];
const special = new Map([...block('kSpecialVersionString').matchAll(/\{"([^"]+)",\s*"(-\d+-\d+)"\}/g)].map(m => [m[1], m[2]]));
const versioned = /kDefaultVersionString\[\]\s*=\s*"(-\d+-\d+)"/.exec(source)?.[1];
if (!regions.length || !versioned) throw new Error('Could not read the language table.');
const names = regions.map(region => (region + (special.get(region) || versioned) + '.bdic').toLowerCase()).sort();

console.log(`Chromium ${chrome}: ${names.length} dictionaries`);
if (process.argv.includes('--fetch')) {
  const out = path.join(root, 'dist-dictionaries'); await fs.mkdir(out, { recursive: true });
  const sums = [], skipped = [];
  for (const name of names) {
    const file = await fetch('https://redirector.gvt1.com/edgedl/chrome/dict/' + name);
    if (!file.ok) { console.log(`  skipped ${name} (${file.status})`); skipped.push(name); continue; }
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(out, name), bytes);
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
    console.log(`  ${name}  ${(bytes.length / 1024).toFixed(0)} KB`);
  }
  await fs.writeFile(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(`Wrote ${sums.length} files to ${out}. Next: node scripts/prepare-update-host-files.mjs (they are served from update.acirabrowser.com/spellcheck-dictionaries/).`);
  if (skipped.length) { console.error(`${skipped.length} dictionaries could not be fetched (${skipped.join(', ')}): a language without its file gets no spell checking. Run again.`); process.exitCode = 1; }
} else console.log(names.join('\n'));
// (No process.exit: on Windows it can trip a libuv assertion while fetch's sockets are still closing.)
