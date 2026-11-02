import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createArtworkRenditions, RENDITION_WIDTH, MAX_CACHE_BYTES } = require('../desktop/artwork-renditions.cjs');
const { artworkImageInfo } = require('../desktop/artwork-image.cjs');

/** A header-only JPEG: enough for the probe the module verifies with, no decoder needed. */
function jpeg(width: number, height: number, padding = 0) {
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.alloc(8 + padding), Buffer.from([0xff, 0xd9])]);
}
const url = (id: string, extra = '') => new URL(`acira-browser-ui://ui/artwork-r/${id}.jpg${extra}`);

function setup(options: { encode?: (bytes: Buffer) => Buffer | null; originals?: Record<string, Buffer> } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-renditions-'));
  const dist = path.join(base, 'dist');
  const root = path.join(base, 'userData');
  fs.mkdirSync(path.join(dist, 'artwork', 'catalog-v2'), { recursive: true });
  for (const [id, bytes] of Object.entries(options.originals ?? { 'met-1': jpeg(2560, 1600, 5000) })) fs.writeFileSync(path.join(dist, 'artwork', 'catalog-v2', `${id}.jpg`), bytes);
  let encodes = 0;
  const encode = options.encode ?? (() => jpeg(RENDITION_WIDTH, 1100));
  const renditions = createArtworkRenditions({ root, dist, encode: (bytes: Buffer) => { encodes += 1; return encode(bytes); }, schedule: (task: () => void) => task() });
  return { base, dist, root, renditions, encodes: () => encodes, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

test('the first view gets the original at once, the next gets the cached 1760px rendition', async () => {
  const { renditions, root, encodes, cleanup } = setup();
  try {
    const original = fs.readFileSync(path.join(root, '..', 'dist', 'artwork', 'catalog-v2', 'met-1.jpg'));
    const first = renditions.response(url('met-1'))!;
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'image/jpeg');
    assert.equal(first.headers.get('cache-control'), 'no-store', 'the stand-in is never cached by the page');
    assert.equal(renditions.pending(), 1, 'one rendition is being made');
    assert.deepEqual(await bytesOf(first), original);
    await renditions.drain();
    assert.equal(renditions.pending(), 0);
    assert.equal(encodes(), 1);

    const second = renditions.response(url('met-1'))!;
    assert.equal(second.headers.get('cache-control'), 'public, max-age=86400');
    const served = await bytesOf(second);
    assert.equal(artworkImageInfo(served).width, RENDITION_WIDTH);
    assert.ok(served.length < original.length);
    assert.equal(encodes(), 1, 'it is made once, not per view');
    const files = fs.readdirSync(renditions.cacheDirectory);
    assert.deepEqual(files, [`met-1-${original.length}-${RENDITION_WIDTH}q80.jpg`]);
  } finally { cleanup(); }
});

test('asking again while a rendition is queued does not queue it twice', async () => {
  const { renditions, encodes, cleanup } = setup();
  try {
    for (let index = 0; index < 5; index += 1) renditions.response(url('met-1'));
    assert.equal(renditions.pending(), 1);
    await renditions.drain();
    assert.equal(encodes(), 1);
  } finally { cleanup(); }
});

test('only catalog paintings are served: bad ids, other hosts, queries and traversal never reach the disk', async () => {
  const { renditions, base, cleanup } = setup();
  try {
    fs.writeFileSync(path.join(base, 'secret.jpg'), jpeg(2560, 1600));
    for (const bad of ['..%2F..%2Fsecret', '../secret', 'MET-1', 'met 1', 'a', 'x'.repeat(60)]) {
      const response = renditions.response(new URL(`acira-browser-ui://ui/artwork-r/${bad}.jpg`));
      assert.ok(response === null || response.status === 404, bad);
    }
    assert.equal((await renditions.response(url('missing'))!).status, 404);
    assert.equal(renditions.response(new URL('acira-browser-ui://other/artwork-r/met-1.jpg')), null);
    assert.equal(renditions.response(url('met-1', '?x=1')), null);
    assert.equal(renditions.response(new URL('acira-browser-ui://ui/artwork-r/nested/met-1.jpg')), null);
    assert.equal(renditions.pending(), 0, 'nothing was queued for any of them');
    assert.equal(fs.existsSync(renditions.cacheDirectory), false);
  } finally { cleanup(); }
});

test('output that is not a smaller JPEG is never cached or served', async () => {
  for (const encode of [() => null, () => Buffer.from('not an image at all, just some bytes'), () => jpeg(2560, 1600), () => { throw new Error('decoder failed'); }]) {
    const { renditions, cleanup } = setup({ encode });
    try {
      renditions.response(url('met-1'));
      await renditions.drain();
      assert.equal(renditions.cached('met-1'), null);
      const next = renditions.response(url('met-1'))!;
      assert.equal(next.headers.get('cache-control'), 'no-store', 'the original keeps being served');
    } finally { cleanup(); }
  }
});

test('a damaged cache file is dropped and made again', async () => {
  const { renditions, encodes, cleanup } = setup();
  try {
    renditions.response(url('met-1'));
    await renditions.drain();
    const file = path.join(renditions.cacheDirectory, fs.readdirSync(renditions.cacheDirectory)[0]);
    fs.writeFileSync(file, Buffer.from('truncated'));
    const served = renditions.response(url('met-1'))!;
    assert.equal(served.headers.get('cache-control'), 'no-store', 'the original covers the gap');
    await renditions.drain();
    assert.equal(encodes(), 2);
    assert.equal(artworkImageInfo(fs.readFileSync(file)).width, RENDITION_WIDTH);
  } finally { cleanup(); }
});

test('a changed painting never serves the old rendition', async () => {
  const { renditions, dist, encodes, cleanup } = setup();
  try {
    renditions.response(url('met-1'));
    await renditions.drain();
    fs.writeFileSync(path.join(dist, 'artwork', 'catalog-v2', 'met-1.jpg'), jpeg(2560, 1600, 9000));
    assert.equal(renditions.cached('met-1'), null);
    assert.equal(renditions.response(url('met-1'))!.headers.get('cache-control'), 'no-store');
    await renditions.drain();
    assert.equal(encodes(), 2);
    assert.equal(fs.readdirSync(renditions.cacheDirectory).length, 2, 'the old file stays until it is the least recently used');
  } finally { cleanup(); }
});

test('the cache stays within its bound, dropping the least recently used first', async () => {
  const big = () => jpeg(RENDITION_WIDTH, 1100, 7_000_000);
  const ids = ['met-1', 'met-2', 'met-3'];
  const { renditions, root, cleanup } = setup({ encode: big, originals: Object.fromEntries(ids.map((id, index) => [id, jpeg(2560, 1600, 5000 + index)])) });
  try {
    assert.ok(3 * (big().length) > MAX_CACHE_BYTES && 2 * big().length < MAX_CACHE_BYTES);
    renditions.response(url('met-1'));
    await renditions.drain();
    renditions.response(url('met-2'));
    await renditions.drain();
    const directory = path.join(root, 'artwork-renditions');
    const [oldest, newer] = fs.readdirSync(directory).sort();
    fs.utimesSync(path.join(directory, oldest), new Date(2026, 0, 1), new Date(2026, 0, 1));
    fs.utimesSync(path.join(directory, newer), new Date(2026, 0, 2), new Date(2026, 0, 2));
    renditions.response(url('met-3'));
    await renditions.drain();
    const left = fs.readdirSync(directory);
    assert.equal(left.length, 2);
    assert.ok(!left.includes(oldest), 'the least recently used rendition was dropped');
    assert.ok(left.reduce((total, name) => total + fs.statSync(path.join(directory, name)).size, 0) <= MAX_CACHE_BYTES);
  } finally { cleanup(); }
});

test('a painting already at rendition size is left alone', async () => {
  const { renditions, cleanup } = setup({ encode: () => null, originals: { 'met-small': jpeg(1500, 900) } });
  try {
    renditions.response(url('met-small'));
    await renditions.drain();
    assert.equal(renditions.cached('met-small'), null);
    assert.equal(fs.existsSync(renditions.cacheDirectory), false);
  } finally { cleanup(); }
});
