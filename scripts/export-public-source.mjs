// Local preparation only: reads one committed tree; never writes Git or contacts a remote.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prohibitedPath, scanSecrets} from './release-source-audit.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('..', import.meta.url));
// Deliberately bounded tracked-source allowlist. New top-level areas, binary kinds,
// operational documents and scripts do not become publishable automatically.
const rootFiles = new Set(['.gitignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'package.json', 'package-lock.json', 'index.html', 'launch.mjs', 'vite.config.ts',
  'tsconfig.json', 'design-tokens.json', 'page-zoom-levels.json']);
const scriptFiles = new Set(['build-filter-engine.cjs', 'build-installer-helper.cjs', 'deploy-site-reports.mjs',
  'build-ui-preload.mjs', 'deploy-metrics.mjs', 'desktop-bundle.mjs', 'one-byte-source.mjs', 'one-byte-chunks.mjs', 'one-byte-chunks.d.mts', 'fetch-tor.mjs',
  'fetch-baseline-filters.mjs', 'install-runtime.mjs', 'installer-art-main.cjs',
  'installer-frames-main.cjs', 'uninstall-art-main.cjs', 'mirror-spellcheck-dictionaries.mjs',
  'publish-spellcheck-dictionaries.mjs', 'preview.mjs', 'preview-snapshot.mjs',
  'export-public-source.mjs', 'i18n-scan.mjs']);
const documentFiles = new Set(['docs/launch/PUBLIC_SOURCE_BUILD.md',
  'docs/launch/CODE_SIGNING.md', 'docs/launch/RELEASE_NOTES.md',
  'docs/launch/concepts/installer-creation.html',
  'docs/design/rewind-routines/examples/start-work.acira-routine.json',
  // Required withdrawal guard, not the private snapshots/publication records.
  'docs/release/withdrawals.json',
  // These are full license/adaptation inputs, not the surrounding research archive.
  'docs/research/helium-ui/progress-bar.patch', 'docs/research/helium-ui/SOURCE.txt',
  ...['browseros', 'electron', 'ghostery', 'helium', 'ungoogled_chromium']
    .map(name => 'docs/research/privacy-feature-audit/LICENSE.' + name)]);
const deniedArtwork = new Set(['b2f5055dad1dbf670f23232cfaea687eea45387eac4caaa1df494e95d2760c36']);
const requiredInputs = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json',
  'src/main.tsx', 'src/runtime/core.ts', 'desktop/main.cjs', 'desktop/ui-preload-entry.cjs',
  'src/features/onboarding/upstream/LICENSE', 'src/ui/LICENSE.iphone-solo.txt',
  'scripts/build-ui-preload.mjs', 'scripts/build-filter-engine.cjs', 'scripts/fetch-tor.mjs',
  'scripts/build-installer-helper.cjs', 'scripts/release.mjs', 'scripts/i18n-scan.mjs',
  'qa/rtl-target.mjs', 'qa/rtl-interface-matrix.mjs', 'qa/lightweight-policy.mjs', 'qa/lightweight-owned.ps1',
  'packaging/acira-icon.ico', 'packaging/installer/AciraProgress.cs',
  'packaging/installer/AciraUninstall.cs', 'packaging/installer/acira-helper.manifest',
  'packaging/installer/strings.json', 'packaging/LICENSE.NSIS.txt', 'packaging/LICENSE.rcedit.txt',
  'docs/launch/concepts/installer-creation.html', 'docs/release/withdrawals.json',
  'docs/design/rewind-routines/examples/start-work.acira-routine.json',
  'public/fonts/inter-LICENSE.txt'];
const code = /\.(?:cjs|mjs|js|ts|tsx|css|json|html|md|txt|svelte|pem)$/i;
const asset = /\.(?:svg|png|jpg|ico|woff2|md|txt|json)$/i;

export function safePath(file) {
  return typeof file === 'string' && file.length > 0 && !/[\\\x00-\x1f:]/.test(file)
    && !file.startsWith('/') && !file.split('/').some(p => !p || p === '.' || p === '..'
      || p.toLowerCase() === '.git' || /[. ]$/.test(p))
    && !file.split('/').some(p => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}

export function allowedSource(file) {
  if (!safePath(file) || prohibitedPath(file)) return false;
  if (/(?:^|\/)(?:workspace-coast[^/]*|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|profiles?|screenshots?|[^/]*\.(?:key|pfx|p12|keystore))$/i.test(file)) return false;
  if (rootFiles.has(file) || documentFiles.has(file)) return true;
  if (/^(?:src|desktop)\//.test(file)) return code.test(file) || /\/LICENSE$/.test(file);
  if (/^public\//.test(file)) return ['public/native-dialog.html', 'public/native-dialog.js'].includes(file)
    || asset.test(file) && (/^public\/(?:artwork|fonts|brand|site-icons)\//.test(file)
      || /^public\/(?:acira-[\w-]+|app-icon|frost-grain|glass-displacement)\.(?:svg|png)$/.test(file));
  if (/^resources\/(?:brand|filters)\//.test(file)) return /\.(?:mjs|json|txt|md)$/.test(file);
  if (/^packaging\//.test(file)) return !/-preview\.png$/i.test(file)
    && /\.(?:json|cjs|cs|manifest|nsh|plist|txt|md|ico|png|jpg|bmp)$/i.test(file);
  if (/^tests\//.test(file)) return code.test(file);
  if (/^qa\//.test(file)) return /^qa\/(?:release-|accounts-)[^/]+\.(?:mjs|cjs|tsx|ps1)$/.test(file)
    || ['qa/native-helpers.mjs', 'qa/browser-smoke.mjs', 'qa/window-lifecycle.mjs',
      'qa/native-capture.mjs', 'qa/native-recorder.html', 'qa/prepared-native.mjs',
      'qa/prepare-native-profile.cjs', 'qa/rtl-target.mjs', 'qa/rtl-interface-matrix.mjs', 'qa/lightweight-policy.mjs', 'qa/lightweight-owned.ps1'].includes(file);
  if (file.startsWith('scripts/')) return scriptFiles.has(file.slice(8))
    || /^scripts\/release-[a-z-]+\.(?:mjs|cjs)$/.test(file) && file !== 'scripts/release-archive-audit.mjs'
    || file === 'scripts/release.mjs';
  return file === '.github/workflows/release-qualification.yml'
    || /^supabase\/(?:config\.toml|functions\/(?:usage|report|allowlist)\/[\w.-]+\.(?:mjs|ts)|migrations\/\d+_(?:usage_metrics(?:_v\d+)?|usage_churn|site_reports)\.sql)$/.test(file);
}

export function auditExport(entries, readBlob) {
  const files = [], excluded = [], findings = [], seen = new Set();
  for (const entry of [...entries].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)) {
    if (!safePath(entry.file)) throw new Error('Unsafe tracked path');
    const folded = entry.file.toLowerCase();
    if (seen.has(folded)) throw new Error('Case-insensitive path collision: ' + entry.file);
    seen.add(folded);
    if (!allowedSource(entry.file)) { excluded.push(entry.file); continue; }
    if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') throw new Error('Unsupported source mode: ' + entry.file);
    const bytes = readBlob(entry), sha256 = sha(bytes);
    if (deniedArtwork.has(sha256)) throw new Error('Unresolved-rights artwork bytes: ' + entry.file);
    const secrets = scanSecrets(bytes);
    if (secrets.length) findings.push(...secrets.map(finding => ({file: entry.file, ...finding})));
    if (bytes.length > 10 * 1024 * 1024) findings.push({file: entry.file, kind: 'large-file'});
    files.push({file: entry.file, mode: entry.mode, oid: entry.oid, bytes: bytes.length, sha256,
      binary: bytes.includes(0)});
  }
  return {schema: 1, automatedGate: findings.length ? 'FAIL' : 'PASS', files, excluded, findings,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    treeDigest: sha(JSON.stringify(files)), limitations: [
      'Local source preparation only; no repository, root commit, remote or release is created.',
      'Pattern scanning cannot establish absence of all secrets or asset redistribution rights.',
      'Exact clean-export build, native/package tests and founder destination/license approval remain required.',
      'Excluded private history is not read or copied. The source commit ID is recorded only in the sibling audit report.'
    ]};
}

export function auditBuildInputs(entries, readBlob) {
  const tracked = new Map(entries.map(entry => [entry.file, entry]));
  const included = new Set(entries.filter(entry => allowedSource(entry.file)).map(entry => entry.file));
  const missing = requiredInputs.filter(file => !included.has(file));
  for (const directory of ['packaging/installer/anim/', 'packaging/installer/uninstall/'])
    if (![...included].some(file => file.startsWith(directory))) missing.push(directory + '(embedded frames)');
  const excludedImports = [];
  for (const file of included) {
    if (!/\.(?:[cm]?js|tsx?)$/.test(file)) continue;
    const text = readBlob(tracked.get(file)).toString('utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const resolved = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '/index.ts', '/index.tsx']
        .map(extension => target + extension).find(candidate => tracked.has(candidate));
      if (resolved && !included.has(resolved)) excludedImports.push({file, dependency: resolved});
    }
  }
  return {automatedGate: missing.length || excludedImports.length ? 'FAIL' : 'PASS', missing,
    excludedImports, helperExecutablesExcluded: ['acira-progress.exe', 'acira-uninstall.exe']
      .every(name => !included.has('packaging/installer/' + name)),
    limitation: 'Static committed-input/import audit; actual clean-export build and native qualification are separate gates.'};
}

export function readCommittedTree(cwd, ref = 'HEAD') {
  const git = (...args) => execFileSync('git', args, {cwd, maxBuffer: 256 * 1024 * 1024});
  // Resolve first, then use only the immutable object ID (no option or ref injection).
  const commit = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').toString().trim();
  const entries = git('ls-tree', '-rz', commit).toString().split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' ');
    return {file: row.slice(tab + 1), mode, type, oid};
  });
  const oids = [...new Set(entries.filter(e => allowedSource(e.file)).map(e => e.oid))];
  const batch = execFileSync('git', ['cat-file', '--batch'], {cwd,
    input: oids.join('\n') + '\n', maxBuffer: 256 * 1024 * 1024});
  return {commit, entries, oids, batch};
}

export function writeExport(destination, report, readBlob) {
  if (report.automatedGate !== 'PASS') throw new Error('Source audit failed; no export written');
  for (const item of report.files) if (!allowedSource(item.file)) throw new Error('Unapproved export path: ' + item.file);
  // A new directory is mandatory; never merge with, overwrite or delete another tree.
  fs.mkdirSync(destination);
  const tree = path.join(destination, 'source'); fs.mkdirSync(tree);
  for (const item of report.files) {
    const bytes = readBlob(item);
    if (sha(bytes) !== item.sha256) throw new Error('Captured blob changed: ' + item.file);
    const target = path.join(tree, item.file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes, {flag: 'wx', mode: item.mode === '100755' ? 0o755 : 0o644});
  }
  fs.writeFileSync(path.join(destination, 'audit.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return tree;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg, i) => i % 2 === 0 && !['--ref', '--write', '--report'].includes(arg)) || args.length % 2)
    throw new Error('Usage: node scripts/export-public-source.mjs [--ref COMMIT] [--report NEW_NAME] [--write NEW_NAME]');
  const options = Object.fromEntries(Array.from({length: args.length / 2}, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  if (Object.keys(options).length !== args.length / 2) throw new Error('Duplicate option');
  const captured = readCommittedTree(root, options['--ref']);
  const blobs = new Map(); let offset = 0;
  for (const oid of captured.oids) {
    const end = captured.batch.indexOf(10, offset), header = captured.batch.subarray(offset, end).toString().split(' '), size = Number(header[2]);
    if (header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid captured Git blob');
    const start = end + 1; blobs.set(oid, captured.batch.subarray(start, start + size)); offset = start + size + 1;
  }
  const readBlob = entry => blobs.get(entry.oid), report = {...auditExport(captured.entries, readBlob),
    sourceCommit: captured.commit, buildInputs: auditBuildInputs(captured.entries, readBlob)};
  if (report.buildInputs.automatedGate !== 'PASS') report.automatedGate = 'FAIL';
  let source, audit;
  if (options['--write'] || options['--report']) {
    for (const name of [options['--write'], options['--report']].filter(Boolean))
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('Output name must be a simple new name');
    const parent = path.join(root, 'release', 'public-source-prep');
    fs.mkdirSync(parent, {recursive: true});
    if (fs.realpathSync(parent).toLowerCase() !== path.resolve(parent).toLowerCase()) throw new Error('Export parent must not traverse a symlink');
    if (options['--report']) {
      audit = path.join(parent, options['--report'] + '.json');
      fs.writeFileSync(audit, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    }
    if (options['--write']) source = writeExport(path.join(parent, options['--write']), report, readBlob);
  }
  console.log(JSON.stringify({sourceCommit: report.sourceCommit, automatedGate: report.automatedGate,
    files: report.files.length, excluded: report.excluded.length, totalBytes: report.totalBytes,
    treeDigest: report.treeDigest, findings: report.findings, buildInputs: report.buildInputs,
    source: source || null, audit: audit || null}, null, 2));
  if (report.automatedGate !== 'PASS') process.exitCode = 1;
}
