'use strict';
// Profile picture, email and default profile (browser.profile.update {picture, email, default}).
const test = require('node:test'), assert = require('node:assert/strict');
const {validateAction} = require('../desktop/validation.cjs');
const {createInitialState, reduceBrowser, restoreSnapshot, persistedSnapshot} = require('../desktop/runtime.cjs');
const {profilePictureProblem} = require('../desktop/profile-picture.cjs');

const withWork = () => reduceBrowser(createInitialState(), {type: 'browser.profile.create', name: 'Work'});
const workId = state => state.browserProfiles.find(p => p.name === 'Work').id;

// Headers only: the validator reads sizes from the header and never decodes pixels.
const png = (width, height, extra = 0) => {
  const bytes = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'latin1'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return 'data:image/png;base64,' + bytes.toString('base64');
};
const jpeg = (width, height) => {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]).toString('base64');
};

// WebP: lossy (VP8 ), lossless (VP8L) and extended (VP8X) headers.
const webp = (kind, width, height) => {
  const bytes = Buffer.alloc(40);
  bytes.write('RIFF', 0, 'latin1'); bytes.writeUInt32LE(32, 4); bytes.write('WEBP', 8, 'latin1'); bytes.write(kind, 12, 'latin1');
  if (kind === 'VP8 ') { bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a; bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); }
  if (kind === 'VP8L') { bytes[20] = 0x2f; bytes.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21); }
  if (kind === 'VP8X') { bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); }
  return 'data:image/webp;base64,' + bytes.toString('base64');
};

test('pictures: PNG, JPEG or WebP, up to 64 KB and 256 px, read from the header', () => {
  for (const ok of [png(1, 1), png(256, 256), png(64, 200), jpeg(256, 256), jpeg(48, 48), webp('VP8 ', 256, 128), webp('VP8L', 256, 256), webp('VP8X', 100, 100)]) assert.equal(profilePictureProblem(ok), null, ok.slice(0, 40));
  for (const bad of [png(257, 256), png(256, 257), png(0, 10), png(5000, 5000), jpeg(257, 100), jpeg(100, 300), webp('VP8 ', 257, 100), webp('VP8L', 300, 100), webp('VP8X', 100, 4000), webp('ABCD', 10, 10), png(10, 10).replace('image/png', 'image/webp')]) assert.match(profilePictureProblem(bad), /PNG, JPEG or WebP/, bad.slice(0, 40));
  assert.equal(profilePictureProblem(png(100, 100, 64 * 1024 - 33)), null, 'exactly 64 KB');
  assert.match(profilePictureProblem(png(100, 100, 64 * 1024 - 32)), /64 KB/, 'one byte over');
  for (const bad of ['', 5, null, {}, 'https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data:image/png;base64,@@@', 'data:text/html;base64,PGI+', png(10, 10).replace('image/png', 'image/jpeg'), 'data:image/png;base64,' + Buffer.from('not an image at all, just text').toString('base64')])
    assert.ok(profilePictureProblem(bad), String(bad).slice(0, 40));
});

test('update validation accepts picture, email and default and still needs something to change', () => {
  const s = withWork(), id = workId(s);
  assert.doesNotThrow(() => validateAction({type: 'browser.profile.update', id, picture: png(128, 128)}, s));
  assert.doesNotThrow(() => validateAction({type: 'browser.profile.update', id, picture: null, email: null}, s));
  assert.doesNotThrow(() => validateAction({type: 'browser.profile.update', id, email: 'me@example.com', default: true}, s));
  assert.doesNotThrow(() => validateAction({type: 'browser.profile.update', id, default: false}, s));
  assert.throws(() => validateAction({type: 'browser.profile.update', id, picture: png(900, 900)}, s), /PNG, JPEG or WebP/);
  assert.throws(() => validateAction({type: 'browser.profile.update', id, picture: 'javascript:alert(1)'}, s), /PNG, JPEG or WebP/);
  for (const email of ['', 'nope', 'a@b', '<b>@x.com', 'a b@example.com', 5, {}, 'x'.repeat(260) + '@example.com']) assert.throws(() => validateAction({type: 'browser.profile.update', id, email}, s), /email/i, JSON.stringify(email));
  for (const value of ['yes', 1, null, {}]) assert.throws(() => validateAction({type: 'browser.profile.update', id, default: value}, s), /true or false/);
  assert.throws(() => validateAction({type: 'browser.profile.update', id}, s), /colour or an avatar/i);
  assert.throws(() => validateAction({type: 'browser.profile.update', id, picture: png(1, 1), partition: 'persist:x'}, s), /unsupported/i);
  assert.throws(() => validateAction({type: 'browser.profile.update', id: 'missing', email: 'me@example.com'}, s));
});

test('update stores the picture and email and clears them with null', () => {
  let s = withWork(); const id = workId(s), picture = png(96, 96), get = () => s.browserProfiles.find(p => p.id === id);
  s = reduceBrowser(s, {type: 'browser.profile.update', id, picture, email: '  me@example.com '});
  assert.equal(get().picture, picture); assert.equal(get().email, 'me@example.com', 'trimmed');
  s = reduceBrowser(s, {type: 'browser.profile.update', id, color: '#336699'});
  assert.equal(get().picture, picture, 'other changes leave the picture alone');
  s = reduceBrowser(s, {type: 'browser.profile.update', id, picture: null});
  assert.equal(get().picture, undefined); assert.equal(get().email, 'me@example.com');
  s = reduceBrowser(s, {type: 'browser.profile.update', id, email: null});
  assert.equal(get().email, undefined);
  const before = s;
  s = reduceBrowser(s, {type: 'browser.profile.update', id, picture: 'data:text/html;base64,PGI+', email: 'bad'});
  assert.equal(get().picture, undefined, 'the reducer ignores values the native boundary would have refused');
  assert.equal(get().email, undefined); assert.ok(before);
});

test('picture, email and default survive save and restore; hand-edited values are dropped', () => {
  let s = withWork(); const id = workId(s), picture = png(64, 64);
  s = reduceBrowser(s, {type: 'browser.profile.update', id, picture, email: 'me@example.com', default: true});
  const restored = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
  const profile = restored.browserProfiles.find(p => p.id === id);
  assert.equal(profile.picture, picture); assert.equal(profile.email, 'me@example.com'); assert.equal(restored.settings.defaultProfileId, id);
  const hand = JSON.parse(JSON.stringify(persistedSnapshot(s)));
  hand.browserProfiles.find(p => p.id === id).picture = 'javascript:alert(1)'; hand.browserProfiles.find(p => p.id === id).email = '<script>';
  const clean = restoreSnapshot(hand).browserProfiles.find(p => p.id === id);
  assert.equal(clean.picture, undefined); assert.equal(clean.email, undefined);
});

test('default profile: set, move, clear, and cleared when that profile is removed', () => {
  let s = withWork(); const work = workId(s), first = s.browserProfiles.find(p => p.id !== work).id;
  assert.equal(s.settings.defaultProfileId, undefined, 'no default until one is chosen');
  s = reduceBrowser(s, {type: 'browser.profile.update', id: work, default: true});
  assert.equal(s.settings.defaultProfileId, work);
  s = reduceBrowser(s, {type: 'browser.profile.update', id: first, default: true});
  assert.equal(s.settings.defaultProfileId, first, 'one default at a time');
  s = reduceBrowser(s, {type: 'browser.profile.update', id: work, default: false});
  assert.equal(s.settings.defaultProfileId, first, 'clearing a profile that is not the default changes nothing');
  s = reduceBrowser(s, {type: 'browser.profile.update', id: first, default: false});
  assert.equal(s.settings.defaultProfileId, undefined);
  s = reduceBrowser(s, {type: 'browser.profile.update', id: work, default: true});
  s = reduceBrowser(s, {type: 'browser.profile.remove', id: work});
  assert.equal(s.browserProfiles.some(p => p.id === work), false);
  assert.equal(s.settings.defaultProfileId, first, 'removing the default hands it to the first profile left, never to nothing');
  s = reduceBrowser(s, {type: 'browser.profile.create', name: 'Play'});
  const play = s.browserProfiles.find(p => p.name === 'Play').id;
  s = reduceBrowser(s, {type: 'browser.profile.remove', id: play});
  assert.equal(s.settings.defaultProfileId, first, 'removing a profile that is not the default leaves it alone');
  const none = withWork(); const noneId = workId(none);
  assert.equal(reduceBrowser(none, {type: 'browser.profile.remove', id: noneId}).settings.defaultProfileId, undefined, 'no default stays no default');
});

test('a saved default that points at a profile that is gone is dropped on restore', () => {
  let s = withWork(); const id = workId(s);
  s = reduceBrowser(s, {type: 'browser.profile.update', id, default: true});
  const raw = JSON.parse(JSON.stringify(persistedSnapshot(s))); raw.settings.defaultProfileId = 'no-such-profile';
  assert.equal(restoreSnapshot(raw).settings.defaultProfileId, undefined);
});
