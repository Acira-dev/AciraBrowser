'use strict';
// Notepad, Visual Studio and PowerShell (-Encoding UTF8) save a file as UTF-8 with a byte-order mark. Chrome loads an extension whose manifest.json (or
// _locales/*/messages.json) starts with one; Acira said "Unexpected token in JSON" on Load unpacked, and a store package with one failed to install.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { readManifest } = require('../desktop/browser-services/extension-manager.cjs');
const { unpackVerified } = require('../desktop/browser-services/extension-packages.cjs');

const BOM = '﻿';
const withFolder = run => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-bom-')); try { return run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

test('Load unpacked: a manifest.json and a messages.json with a byte-order mark read like any other', () => withFolder(dir => {
  fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), BOM + JSON.stringify({ manifest_version: 3, name: '__MSG_appName__', version: '1.0', default_locale: 'en' }), 'utf8');
  fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), BOM + JSON.stringify({ appName: { message: 'Sample tool' } }), 'utf8');
  const manifest = readManifest(dir);
  assert.equal(manifest.version, '1.0');
  assert.equal(manifest.name, 'Sample tool', 'the BOM-led messages file resolved the placeholder');
}));

test('without a byte-order mark nothing changes, and a file that is not JSON is still refused', () => withFolder(dir => {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Plain', version: '2' }));
  assert.equal(readManifest(dir).name, 'Plain');
  fs.writeFileSync(path.join(dir, 'manifest.json'), BOM + 'not json');
  assert.throws(() => readManifest(dir));
}));

test('a store package whose manifest.json has a byte-order mark unpacks (and the key is added)', () => withFolder(dir => {
  const zip = new AdmZip(), key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' });
  zip.addFile('manifest.json', Buffer.from(BOM + JSON.stringify({ manifest_version: 3, name: 'Packaged', version: '1.2' }), 'utf8'));
  const target = path.join(dir, 'out'), manifest = unpackVerified({ archive: zip.toBuffer(), publicKey: key }, target);
  assert.equal(manifest.name, 'Packaged');
  assert.equal(manifest.key, key.toString('base64'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')).key, manifest.key, 'the file on disk is plain JSON again');
}));
