import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {withInstallerHelpers, HELPERS, APP_HELPERS} from '../scripts/release-helpers.mjs';

function fixture(t, existing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-helper-unit-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'packaging/installer'), {recursive: true});
  const files = HELPERS.map(n => path.join(root, 'packaging/installer', n));
  if (existing) files.forEach((file, i) => fs.writeFileSync(file, 'original-' + i));
  return {root, files, compile: () => files.forEach((file, i) => fs.writeFileSync(file, 'compiled-' + i))};
}

test('fresh export compiles every helper before builder and restores initial absence', t => {
  const f = fixture(t), order = [];
  const result = withInstallerHelpers({...f, compile() { order.push('compile'); f.compile(); },
    sign(files) { order.push('sign'); files.forEach(file => fs.appendFileSync(file, '-signed')); },
    build() { order.push('build'); assert.equal(fs.readFileSync(f.files[1], 'utf8'), 'compiled-1-signed'); return 'package'; }});
  assert.equal(result, 'package'); assert.deepEqual(order, ['compile', 'sign', 'build']);
  f.files.forEach(file => assert.equal(fs.existsSync(file), false));
});

for (const failure of ['compile', 'sign', 'build']) test('original helper bytes survive ' + failure + ' failure', t => {
  const f = fixture(t, true);
  assert.throws(() => withInstallerHelpers({...f,
    compile() { fs.writeFileSync(f.files[0], 'partial'); if (failure === 'compile') throw Error('fixture'); f.compile(); },
    sign(files) { fs.appendFileSync(files[0], '-signed'); if (failure === 'sign') throw Error('fixture'); },
    build() { throw Error('fixture'); }}), /fixture/);
  f.files.forEach((file, i) => assert.equal(fs.readFileSync(file, 'utf8'), 'original-' + i));
});

test('incomplete clean-export compilation removes partial outputs and never builds', t => {
  const f = fixture(t);
  assert.throws(() => withInstallerHelpers({...f, compile() { fs.writeFileSync(f.files[0], 'partial'); },
    sign() { assert.fail('must not sign'); }, build() { assert.fail('must not build'); }}), /ENOENT/);
  f.files.forEach(file => assert.equal(fs.existsSync(file), false));
});

test('unsigned release uses newly compiled helpers and keeps original checkout bytes', t => {
  const f = fixture(t, true);
  withInstallerHelpers({...f, sign() {}, build() {
    f.files.forEach((file, i) => assert.equal(fs.readFileSync(file, 'utf8'), 'compiled-' + i));
  }});
  f.files.forEach((file, i) => assert.equal(fs.readFileSync(file, 'utf8'), 'original-' + i));
});

test('the app helper (acira-verify.exe) is compiled, signed and handed to the build with the installer helpers, and alone for the portable package', t => {
  assert.deepEqual([...HELPERS], ['acira-progress.exe', 'acira-uninstall.exe', 'acira-verify.exe']);
  assert.deepEqual([...APP_HELPERS], ['acira-verify.exe']);
  const f = fixture(t), verify = path.join(f.root, 'packaging/installer/acira-verify.exe'), signed = [];
  const shipped = withInstallerHelpers({...f, names: APP_HELPERS, compile() { fs.writeFileSync(verify, 'compiled-verify'); },
    sign(files) { signed.push(...files); files.forEach(file => fs.appendFileSync(file, '-signed')); },
    build(files) { return files.map(file => fs.readFileSync(file, 'utf8')); }});
  assert.deepEqual(signed, [verify], 'signed by the same step as the installer helpers');
  assert.deepEqual(shipped, ['compiled-verify-signed'], 'the build gets the signed bytes');
  assert.equal(fs.existsSync(verify), false, 'the checkout keeps no compiled copy');
  // The default compile builds only what was asked for.
  const source = fs.readFileSync(new URL('../scripts/release-helpers.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.\.\.\(names === HELPERS \? \[\] : names\)/);
});
