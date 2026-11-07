'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { sniff, inspect, icoPictures, normalizeIcon } = require('../desktop/browser-services/icon-image.cjs');
const { png, ico, svg, nativeImage } = require('./fixtures/tab-icons/pictures.cjs');

test('what a file is comes from its bytes, and its real pixel size from its header', () => {
  assert.deepEqual(inspect(png(48)), { kind: 'png', width: 48, height: 48, vector: false });
  assert.deepEqual(inspect(png(40, 24)), { kind: 'png', width: 40, height: 24, vector: false });
  assert.deepEqual(inspect(ico([16, 32, 48])), { kind: 'ico', width: 48, height: 48, vector: false }, 'an .ico reports its biggest picture');
  assert.deepEqual(inspect(ico([{ png: 256 }])), { kind: 'ico', width: 256, height: 256, vector: false }, 'a 0 in the directory means 256, and a PNG picture says its own size');
  assert.deepEqual(inspect(svg()), { kind: 'svg', width: 0, height: 0, vector: true });
  assert.equal(sniff(Buffer.from('<!doctype html><html><svg')), null, 'a web page is not an icon');
  assert.equal(sniff(Buffer.from('GIF89a\x10\x00\x10\x00')), 'gif');
  assert.deepEqual(inspect(Buffer.concat([Buffer.from('GIF89a'), Buffer.from([32, 0, 32, 0, 0, 0])])), { kind: 'gif', width: 32, height: 32, vector: false });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 64, 0, 48, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(inspect(jpeg), { kind: 'jpeg', width: 48, height: 64, vector: false });
  for (const junk of [Buffer.alloc(0), Buffer.alloc(40), Buffer.from('not an image at all'), png(0)]) assert.equal(inspect(junk), null);
  const broken = ico([32]); broken.writeUInt32LE(9999, 6 + 12);
  assert.equal(icoPictures(broken), null, 'a picture that runs past the end of the file is ignored');
});

test('an .ico is cut down to the one picture a tab needs, and a PNG picture inside it comes out as a PNG', () => {
  const all = ico([16, 32, 48, 64]);
  const bmp = normalizeIcon({ bytes: all, need: 48 });
  assert.equal(bmp.type, 'image/x-icon'); assert.equal(bmp.width, 48);
  assert.deepEqual(inspect(bmp.bytes), { kind: 'ico', width: 48, height: 48, vector: false }); assert.equal(icoPictures(bmp.bytes).length, 1);
  assert.match(bmp.data, /^data:image\/x-icon;base64,/);
  assert.equal(normalizeIcon({ bytes: all, need: 20 }).width, 32, 'the smallest picture that is big enough');
  assert.equal(normalizeIcon({ bytes: ico([16, 32]), need: 48 }).width, 32, 'none big enough: the biggest there is');
  const inner = normalizeIcon({ bytes: ico([16, { png: 64 }]), need: 48 });
  assert.equal(inner.type, 'image/png'); assert.equal(inner.width, 64); assert.deepEqual(inspect(inner.bytes), { kind: 'png', width: 64, height: 64, vector: false });
});

test('a bitmap is kept as the site sent it unless it is too big; a big one is shrunk, never stretched', () => {
  const kept = normalizeIcon({ bytes: png(64) }), same = png(64);
  assert.equal(kept.data, 'data:image/png;base64,' + same.toString('base64'), 'the same bytes');
  assert.equal(normalizeIcon({ bytes: png(16) }).width, 16, 'a small one is not stretched');
  const big = normalizeIcon({ bytes: png(512), nativeImage });
  assert.equal(big.width, 128); assert.equal(big.type, 'image/png');
  assert.equal(normalizeIcon({ bytes: png(192), maxSide: 96, nativeImage }).width, 96, 'the store asks for at most 96');
  assert.equal(normalizeIcon({ bytes: png(512) }), null, 'too big and nothing to shrink it with: not used');
  assert.equal(normalizeIcon({ bytes: Buffer.concat([png(64), Buffer.alloc(70 * 1024)]) , nativeImage }).width, 64, 'too heavy for its size: redrawn smaller');
  assert.equal(normalizeIcon({ bytes: Buffer.concat([png(64), Buffer.alloc(70 * 1024)]), maxOut: 20, nativeImage }), null, 'cannot be made to fit');
});

test('an SVG is kept as text, at any size, within the limit', () => {
  const made = normalizeIcon({ bytes: svg() });
  assert.equal(made.vector, true); assert.equal(made.type, 'image/svg+xml');
  assert.match(made.data, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(made.data.split(',')[1], 'base64').toString(), /<svg /);
  assert.equal(normalizeIcon({ bytes: Buffer.concat([svg(), Buffer.alloc(70 * 1024, 32)]) }), null);
  assert.equal(normalizeIcon({ bytes: Buffer.from('<html><body>login</body></html>') }), null);
});
