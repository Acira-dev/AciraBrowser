'use strict';
// 13.3 (9 Nov 2026). A second download of "archive.tar.gz" was saved as "archive.tar (1).gz": a name no archive tool opens as a tar. Chrome
// puts the number before a compressed tar's two-part extension ("archive (1).tar.gz"); so do we, for downloads and for chrome.downloads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {nextFreePath, extensionOf} = require('../desktop/download-preferences.cjs');
const {uniquePath} = require('../desktop/browser-services/ext-api/downloads/destination.cjs');

const folderWith = names => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-ext-')); for (const name of names) fs.writeFileSync(path.join(dir, name), 'x'); return dir; };

test('a compressed tar keeps its two-part extension when a copy is numbered', () => {
  const dir = folderWith(['archive.tar.gz']);
  try {
    assert.equal(path.basename(nextFreePath(dir, 'archive.tar.gz')), 'archive (1).tar.gz');
    fs.writeFileSync(path.join(dir, 'archive (1).tar.gz'), 'x');
    assert.equal(path.basename(nextFreePath(dir, 'archive.tar.gz')), 'archive (2).tar.gz');
    fs.writeFileSync(path.join(dir, 'data.tar.bz2'), 'x'); fs.writeFileSync(path.join(dir, 'log.csv.gz'), 'x');
    assert.equal(path.basename(nextFreePath(dir, 'data.tar.bz2')), 'data (1).tar.bz2');
    assert.equal(path.basename(nextFreePath(dir, 'log.csv.gz')), 'log (1).csv.gz');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('ordinary names are numbered as before', () => {
  const dir = folderWith(['report.pdf', 'plain.gz', 'a.b.pdf', 'Makefile', 'notes.tar']);
  try {
    assert.equal(path.basename(nextFreePath(dir, 'report.pdf')), 'report (1).pdf');
    assert.equal(path.basename(nextFreePath(dir, 'plain.gz')), 'plain (1).gz');
    assert.equal(path.basename(nextFreePath(dir, 'a.b.pdf')), 'a.b (1).pdf');
    assert.equal(path.basename(nextFreePath(dir, 'Makefile')), 'Makefile (1)');
    assert.equal(path.basename(nextFreePath(dir, 'notes.tar')), 'notes (1).tar');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a very long stem is shortened to leave room for the two-part extension', () => {
  const dir = folderWith([]);
  try {
    const chosen = path.basename(nextFreePath(dir, 'a'.repeat(400) + '.tar.gz'));
    assert.ok(chosen.endsWith('.tar.gz'));
    assert.ok(Buffer.byteLength(chosen) + Buffer.byteLength(' (9999)') + Buffer.byteLength('.crdownload') <= 255, 'the longest name this download can need still fits the file system');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('extensionOf: only a common compression suffix after a short extension joins', () => {
  assert.equal(extensionOf('a.tar.gz'), '.tar.gz');
  assert.equal(extensionOf('A.TAR.XZ'), '.TAR.XZ');
  assert.equal(extensionOf('a.gz'), '.gz');
  assert.equal(extensionOf('.gz'), '');
  assert.equal(extensionOf('a.verylong.gz'), '.gz');
  assert.equal(extensionOf('a.b.pdf'), '.pdf');
});

test('chrome.downloads numbers a compressed tar the same way', () => {
  const dir = folderWith(['archive.tar.gz']);
  try { assert.equal(path.basename(uniquePath(path.join(dir, 'archive.tar.gz'))), 'archive (1).tar.gz'); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
