'use strict';
// Store package size bounds (extension-packages.cjs). HubSpot Sales 3.4.4 is 58.1 MiB packed and 251.3 MiB unpacked (139 files, the largest
// 48.1 MiB, mostly source maps): Acira refused it with "Unsafe or oversized extension archive." because all files together were over 200 MiB.
// The bounds are now 128 MiB for the package, 128 MiB per file and 512 MiB in all; every other check is unchanged and still refuses.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const {unpackVerified, verifyCRX3, LIMITS} = require('../desktop/browser-services/extension-packages.cjs');
const MiB = 1024 * 1024, ID = 'a'.repeat(32);
const manifest = () => Buffer.from(JSON.stringify({manifest_version: 3, name: 'Size fixture', version: '1.0'}));
const folder = t => { const dir = path.resolve('.qa-profiles/services-unit/limits-' + crypto.randomUUID()); fs.mkdirSync(dir, {recursive: true}); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir; };
const sizeOf = dir => fs.readdirSync(dir, {recursive: true, withFileTypes: true}).filter(e => e.isFile()).reduce((sum, e) => sum + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
const unpack = (archive, dir) => unpackVerified({archive, publicKey: Buffer.from('fixture key')}, path.join(dir, 'out'));
/** Where each entry's central-directory record and local header start, by name, in a zip built by adm-zip (which may reorder entries), so a
 *  test can write names and sizes the library itself would not write. */
function records(bytes) {
  const found = new Map(), signature = Buffer.from([0x50, 0x4b, 1, 2]);
  for (let at = bytes.indexOf(signature); at >= 0; at = bytes.indexOf(signature, at + 46 + bytes.readUInt16LE(at + 28))) {
    const name = bytes.toString('latin1', at + 46, at + 46 + bytes.readUInt16LE(at + 28));
    found.set(name, {central: at, local: bytes.readUInt32LE(at + 42)});
  }
  return found;
}

test('the bounds are 128 MiB per package, 128 MiB per file and 512 MiB unpacked; header, file count and manifest bounds are unchanged', () => {
  assert.deepEqual({...LIMITS}, {package: 128 * MiB, header: MiB, entries: 100000, entry: 128 * MiB, total: 512 * MiB, manifest: MiB});
  assert.ok(Object.isFrozen(LIMITS));
  const source = fs.readFileSync(require.resolve('../desktop/browser-services/extension-packages.cjs'), 'utf8');
  assert.match(source, /if\(size>LIMITS\.package\)\{finish\(new Error\('The extension package exceeds 128 MB\.'\)\)/, 'the download stops at the same bound, and says so with spaces');
});

test('a package the size of HubSpot Sales unpacks: 251.3 MiB in all with a 48.1 MiB file (13.6 refused it over 200 MiB)', t => {
  // HubSpot Sales 3.4.4.45603's ten largest files, then the rest of its 263,531,241 bytes in one file.
  const sizes = [50434486, 50404000, 23960000, 23950000, 11280000, 11260000, 8690000, 8670000, 8400000, 8380000];
  sizes.push(263531241 - sizes.reduce((a, b) => a + b, 0));
  const zip = new AdmZip(), filler = Buffer.alloc(Math.max(...sizes), 0x20);
  zip.addFile('manifest.json', manifest());
  sizes.forEach((size, i) => zip.addFile(`js/part-${i}.js.map`, filler.subarray(0, size)));
  const dir = folder(t), result = unpack(zip.toBuffer(), dir);
  assert.equal(result.name, 'Size fixture');
  assert.equal(sizeOf(path.join(dir, 'out')) - fs.statSync(path.join(dir, 'out', 'manifest.json')).size, 263531241);
});

test('one file over the old 50 MiB bound and under the new 128 MiB bound unpacks', t => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', manifest());
  zip.addFile('js/big.js.map', Buffer.alloc(64 * MiB, 0x20));
  const dir = folder(t);
  unpack(zip.toBuffer(), dir);
  assert.equal(fs.statSync(path.join(dir, 'out', 'js', 'big.js.map')).size, 64 * MiB);
});

test('a 65 MiB package passes the package bound (13.6 stopped at 64 MiB) and one byte over 128 MiB does not', () => {
  const crx = length => { const b = Buffer.alloc(length); b.write('Cr24', 0, 'ascii'); b.writeUInt32LE(3, 4); b.writeUInt32LE(0, 8); return b; };
  // Past the bound the next check runs: this fixture has no signed identity.
  assert.throws(() => verifyCRX3(crx(65 * MiB), ID), /^Error: Missing CRX identity\.$/);
  assert.throws(() => verifyCRX3(crx(128 * MiB), ID), /^Error: Missing CRX identity\.$/);
  assert.throws(() => verifyCRX3(crx(128 * MiB + 1), ID), /Only bounded CRX3 packages/);
});

test('zip bomb: a file declared over 128 MiB is refused before it is decompressed, and nothing is written', t => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', manifest());
  zip.addFile('bomb.js', Buffer.alloc(4096, 0x20));
  const bytes = zip.toBuffer();
  bytes.writeUInt32LE(128 * MiB + 1, records(bytes).get('bomb.js').central + 24);   // uncompressed size in the central directory, which the check reads
  const dir = folder(t);
  assert.throws(() => unpack(bytes, dir), /^Error: Unsafe or oversized extension archive\.$/);
  assert.equal(fs.existsSync(path.join(dir, 'out', 'bomb.js')), false);
});

test('zip bomb: declared sizes adding up past 512 MiB are refused before the file that crosses the bound is decompressed', t => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', manifest());
  for (const name of ['a/', 'b/', 'c/', 'd/']) zip.addFile(name, Buffer.alloc(0));
  zip.addFile('e/last.js', Buffer.alloc(5 * MiB, 0x20));
  const bytes = zip.toBuffer(), at = records(bytes);
  // Four records declare 127 MiB each (508 MiB); the 5 MiB file, listed after them, then takes the total past 512 MiB.
  assert.deepEqual([...at.keys()], ['a/', 'b/', 'c/', 'd/', 'e/last.js', 'manifest.json'], 'the library writes entries in name order');
  for (const name of ['a/', 'b/', 'c/', 'd/']) bytes.writeUInt32LE(127 * MiB, at.get(name).central + 24);
  const dir = folder(t);
  assert.throws(() => unpack(bytes, dir), /^Error: Unsafe or oversized extension archive\.$/);
  assert.equal(fs.existsSync(path.join(dir, 'out', 'e', 'last.js')), false);
});

test('a lying file (declares 1 KiB, inflates to 1 MiB) is refused and not written', t => {
  const zip = new AdmZip();
  zip.addFile('manifest.json', manifest());
  zip.addFile('liar.js', Buffer.alloc(MiB, 0x20));
  const bytes = zip.toBuffer(), {central, local} = records(bytes).get('liar.js');
  bytes.writeUInt32LE(1024, central + 24); bytes.writeUInt32LE(1024, local + 22);
  const dir = folder(t);
  assert.throws(() => unpack(bytes, dir));
  assert.equal(fs.existsSync(path.join(dir, 'out', 'liar.js')), false);
});

test('path escapes and unsafe names are still refused, and nothing lands outside the extraction folder', t => {
  // Each name is written into the archive's own records (the library would clean it up when adding); same length as the placeholder.
  const cases = ['../../evil.js', 'a/../../e.js', '/absolute.js', 'dir\\back.js', 'C:drive.js', 'nested/NUL.js', 'tail-dot.', 'tail-space '];
  for (const name of cases) {
    const zip = new AdmZip(), placeholder = 'p'.repeat(Buffer.byteLength(name));
    zip.addFile('manifest.json', manifest());
    zip.addFile(placeholder, Buffer.from('not written'));
    const bytes = zip.toBuffer(), {central, local} = records(bytes).get(placeholder);
    bytes.write(name, central + 46, 'latin1'); bytes.write(name, local + 30, 'latin1');
    const dir = folder(t);
    assert.throws(() => unpack(bytes, dir), /^Error: Unsafe or oversized extension archive\.$/, name);
    assert.deepEqual(fs.readdirSync(dir).filter(n => n !== 'out'), [], name);
    assert.equal(fs.existsSync(path.resolve(dir, 'out', name)), false, name);   // where the name points, inside or outside the folder
  }
  // Two names that differ only in case would overwrite each other on Windows and macOS.
  const zip = new AdmZip();
  zip.addFile('manifest.json', manifest()); zip.addFile('Same.js', Buffer.from('1')); zip.addFile('xame.js', Buffer.from('2'));
  const bytes = zip.toBuffer(), {central, local} = records(bytes).get('xame.js');
  bytes.write('same.js', central + 46, 'latin1'); bytes.write('same.js', local + 30, 'latin1');
  assert.throws(() => unpack(bytes, folder(t)), /Unsafe/);
});
