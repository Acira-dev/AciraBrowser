import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { BrowserDownload } from '../src/runtime/types';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } } });
const { downloadMeta } = await import('../src/features/Downloads');
const { sizeOf } = await import('../src/features/downloadText');

// 13.3 (9 Nov 2026). A download whose server gives no length (a generated archive, "Download ZIP" on a code host) is shown by the native side's own size text,
// always in kilobytes: "716800 KB" for a 700 MB file, while every known-length download says "700 MB". The size follows the bytes that arrived, in the same units.
const row = (extra: Partial<BrowserDownload>) => ({ id: 'd', name: 'archive.zip', status: 'Downloading', size: '0 KB', receivedBytes: 0, totalBytes: 0, startedAt: 1_700_000_000_000, ...extra } as BrowserDownload);

test('an unknown length is shown in the unit of what has arrived', () => {
  assert.equal(sizeOf(row({ receivedBytes: 716_800 * 1024, size: '716800 KB' })), '734 MB');
  assert.equal(sizeOf(row({ receivedBytes: 5_800_000, size: '5664 KB' })), '6 MB');
  assert.equal(sizeOf(row({ receivedBytes: 2_500_000_000, size: '2441406 KB' })), '2.5 GB');
  assert.equal(sizeOf(row({ receivedBytes: 40 * 1024, size: '40 KB' })), '41 KB');
});

test('a known length and a missing byte count read as before', () => {
  assert.equal(sizeOf(row({ totalBytes: 3_000_000, receivedBytes: 1_000_000, size: '977 / 2930 KB' })), '3 MB');
  assert.equal(sizeOf(row({ totalBytes: 0, receivedBytes: undefined, size: '2930 / 2930 KB' })), '2930 KB', 'an old record without byte counts keeps its text');
  assert.equal(sizeOf(row({ totalBytes: 0, receivedBytes: 0, size: '0 KB' })), '0 KB');
});

test('the rows say it: running and finished, popup and page', () => {
  assert.equal(downloadMeta(row({ receivedBytes: 716_800 * 1024, size: '716800 KB' }), false), '734 MB');
  assert.match(downloadMeta(row({ status: 'Ready', receivedBytes: 5_800_000, size: '5664 KB' })), /^6 MB/);
});
