import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {allowedSource, safePath, auditExport, auditBuildInputs, writeExport} from '../scripts/export-public-source.mjs';

const entry = (file, bytes = 'source', mode = '100644') => ({file, mode, type: 'blob', oid: file, content: Buffer.from(bytes)});
const read = item => item.content;

test('public export excludes history, profiles, private documents, generated EXEs and unresolved images', () => {
  for (const file of ['.git/config', '.git/objects/aa', '.env.example', '.env.production', '.profile/Cookies',
    'release/installer.exe', 'node_modules/react/package.json', 'qa/artifacts/proof.png',
    'docs/orchestration/handoff.md', 'docs/research/archive.zip', 'docs/launch/installer-captures/proof.png',
    'docs/reference/workspace-coast.png', 'public/workspace-coast.png', 'public/screenshots/proof.png',
    'src/secrets.json', 'src/private.key', 'packaging/installer/acira-progress.exe',
    'packaging/installer/acira-uninstall.exe', 'packaging/installer/install-dark-1-preview.png'])
    assert.equal(allowedSource(file), false, file);
});

test('public export retains source, licenses, helper/frame inputs and safety/test fixtures', () => {
  for (const file of ['LICENSE', 'package-lock.json', 'src/App.tsx', 'desktop/main.cjs',
    'src/features/onboarding/upstream/LICENSE', 'src/ui/LICENSE.iphone-solo.txt',
    'packaging/installer/AciraProgress.cs', 'packaging/installer/acira-helper.manifest',
    'packaging/installer/anim/dark-1x-p00.jpg', 'packaging/installer/uninstall/layout.txt',
    'docs/launch/concepts/installer-creation.html', 'docs/release/withdrawals.json',
    'docs/research/privacy-feature-audit/LICENSE.helium', 'docs/research/helium-ui/progress-bar.patch',
    'public/fonts/InterVariable.woff2', 'public/fonts/inter-LICENSE.txt', 'qa/prepared-native.mjs',
    'tests/services-fixtures/certificate.pem', 'scripts/release-helpers.mjs'])
    assert.equal(allowedSource(file), true, file);
});

test('export rejects traversal, Windows aliases, special files and case collisions', () => {
  for (const file of ['../src/a.ts', '/src/a.ts', 'src\\a.ts', 'src/a.ts:stream', 'src/NUL.ts',
    'src/a.ts.', 'src/a.ts ', 'src//a.ts']) assert.equal(safePath(file), false, file);
  assert.throws(() => auditExport([entry('src/a.ts', '', '120000')], read), /Unsupported/);
  assert.throws(() => auditExport([entry('src/a.ts'), entry('src/A.ts')], read), /collision/);
});

test('audit is deterministic and reports secret locations without values', () => {
  const token = ['ghp', 'x'.repeat(36)].join('_');
  const a = entry('src/a.ts', token), b = entry('src/b.ts', 'ordinary source');
  const first = auditExport([a, b], read), second = auditExport([b, a], read);
  assert.deepEqual(first, second); assert.equal(first.automatedGate, 'FAIL');
  assert.deepEqual(first.findings, [{file: 'src/a.ts', kind: 'github-token', line: 1}]);
  assert.equal(JSON.stringify(first).includes(token), false);
});

test('build-input audit catches excluded local import and absent helper/frame inputs', () => {
  const entries = [entry('scripts/preview.mjs', "import './private-build.mjs'"), entry('scripts/private-build.mjs')];
  const result = auditBuildInputs(entries, read);
  assert.equal(result.automatedGate, 'FAIL');
  assert.deepEqual(result.excludedImports, [{file: 'scripts/preview.mjs', dependency: 'scripts/private-build.mjs'}]);
  assert.ok(result.missing.includes('packaging/installer/AciraProgress.cs'));
  assert.equal(result.helperExecutablesExcluded, true);
});

test('export retains the exact RTL and performance test helpers, including the dynamic Windows fixture', () => {
  const entries = ['rtl-target', 'lightweight-policy'].flatMap(name => [
    entry(`tests/${name}.test.mjs`, `import '../qa/${name}.mjs';`),
    entry(`qa/${name}.mjs`, 'export const fixture = true;'),
  ]);
  for (const name of ['rtl-target', 'lightweight-policy']) assert.equal(allowedSource(`qa/${name}.mjs`), true);
  assert.equal(allowedSource('qa/lightweight-owned.ps1'), true);
  assert.equal(allowedSource('qa/rtl-interface-matrix.mjs'), true);
  assert.equal(allowedSource('qa/unreviewed-helper.mjs'), false);
  assert.equal(allowedSource('qa/rtl-interface-native.mjs'), false);
  assert.deepEqual(auditBuildInputs(entries, read).excludedImports, []);
  assert.ok(auditBuildInputs(entries, read).missing.includes('qa/lightweight-owned.ps1'));
  entries.push(entry('qa/lightweight-owned.ps1', '# fixture-only inspector'));
  assert.equal(auditBuildInputs(entries, read).missing.includes('qa/lightweight-owned.ps1'), false);
});

test('export writes reviewed bytes only into a new tree, with audit outside source', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-export-unit-'));
  t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
  const selected = entry('src/a.ts', 'exact captured source'), ignored = entry('docs/workstreams/private.md');
  const report = auditExport([selected, ignored], read), destination = path.join(parent, 'candidate');
  const source = writeExport(destination, report, item => [selected, ignored].find(e => e.oid === item.oid).content);
  assert.equal(fs.readFileSync(path.join(source, 'src/a.ts'), 'utf8'), 'exact captured source');
  assert.equal(fs.existsSync(path.join(source, '.git')), false);
  assert.equal(fs.existsSync(path.join(source, 'audit.json')), false);
  assert.equal(fs.existsSync(path.join(source, ignored.file)), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'audit.json'))).treeDigest, report.treeDigest);
  assert.throws(() => writeExport(destination, report, read), /EEXIST/);
  assert.throws(() => writeExport(path.join(parent, 'failed'), {...report, automatedGate: 'FAIL'}, read), /audit failed/);
  assert.equal(fs.existsSync(path.join(parent, 'failed')), false);
});
