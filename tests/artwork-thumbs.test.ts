import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createArtworkThumbs, THUMB_WIDTH } = require('../desktop/artwork-thumbs.cjs');

/** A header-only JPEG: enough for the probe the module verifies with, no decoder needed. */
function jpeg(width: number, height: number, padding = 0) {
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.alloc(8 + padding), Buffer.from([0xff, 0xd9])]);
}
const url = (tail: string) => new URL(`acira-browser-ui://ui/artwork-t/${tail}`);

function setup(ids = ['met-1', 'met-2', 'met-3']) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-thumbs-'));
  const dist = path.join(base, 'dist'), root = path.join(base, 'userData'), remoteDirectory = path.join(root, 'artwork-remote');
  fs.mkdirSync(path.join(dist, 'artwork', 'catalog-v2'), { recursive: true });
  fs.mkdirSync(remoteDirectory, { recursive: true });
  for (const id of ids) fs.writeFileSync(path.join(dist, 'artwork', 'catalog-v2', `${id}.jpg`), jpeg(2560, 1600, 5000));
  fs.writeFileSync(path.join(remoteDirectory, 'abc123.jpg'), jpeg(3840, 2160, 5000));
  let encodes = 0;
  const thumbs = createArtworkThumbs({ root, dist, remoteDirectory, encode: () => { encodes += 1; return jpeg(THUMB_WIDTH, 300); }, schedule: (task: () => void) => task() });
  return { base, root, thumbs, encodes: () => encodes, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

test('the first request gets the original at once and queues the whole catalogue; the next gets the cached 480px thumbnail', async () => {
  const { thumbs, root, encodes, cleanup } = setup();
  try {
    const first = thumbs.response(url('met-1.jpg'))!;
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store', 'the stand-in is never cached by the page');
    assert.equal((await bytesOf(first)).length, fs.statSync(path.join(root, '..', 'dist', 'artwork', 'catalog-v2', 'met-1.jpg')).size);
    await thumbs.drain();
    assert.equal(thumbs.pending(), 0);
    assert.equal(encodes(), 3, 'every painting in the catalogue was made once');
    const next = thumbs.response(url('met-2.jpg'))!;
    assert.equal(next.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(artworkWidth(await bytesOf(next)), THUMB_WIDTH);
    assert.equal(encodes(), 3, 'a cached thumbnail is not made again');
  } finally { cleanup(); }
});

function artworkWidth(bytes: Buffer) { return bytes.readUInt16BE(9); }

test('a collection picture is made on request and served from its own route', async () => {
  const { thumbs, cleanup } = setup();
  try {
    assert.equal(thumbs.make('remote/abc123.jpg'), true);
    const response = thumbs.response(url('remote/abc123.jpg'))!;
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(artworkWidth(await bytesOf(response)), THUMB_WIDTH);
  } finally { cleanup(); }
});

test('only the known routes and names are answered', () => {
  const { thumbs, cleanup } = setup();
  try {
    assert.equal(thumbs.response(new URL('acira-browser-ui://ui/artwork-t/met-1.jpg?x=1')), null, 'no query');
    assert.equal(thumbs.response(new URL('acira-browser-ui://other/artwork-t/met-1.jpg')), null, 'only the ui host');
    assert.equal(thumbs.response(url('nothing.jpg'))!.status, 404);
    assert.equal(thumbs.response(url('remote/..%2Fabc123.jpg'))!.status, 404, 'no path escape');
    assert.equal(thumbs.response(url('remote/missing.jpg'))!.status, 404);
    assert.equal(thumbs.response(url('../met-1.jpg')), null);
  } finally { cleanup(); }
});

test('a stale or oversized cache file is replaced, never served', async () => {
  const { thumbs, root, cleanup } = setup(['met-1']);
  try {
    assert.equal(thumbs.make('built-in/met-1'), true);
    const cacheDirectory = path.join(root, 'artwork-thumbs');
    const [file] = fs.readdirSync(cacheDirectory);
    fs.writeFileSync(path.join(cacheDirectory, file), jpeg(2560, 1600));
    assert.equal(thumbs.cached('built-in/met-1'), null, 'a full-size file in the cache is rejected');
    assert.equal(thumbs.make('built-in/met-1'), true);
    assert.notEqual(thumbs.cached('built-in/met-1'), null);
  } finally { cleanup(); }
});
