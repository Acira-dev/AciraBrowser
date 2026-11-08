import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// Dragging a finished download out of its row (13.3). The downloads popup and the Downloads page make a Ready download whose file is still on disk
// draggable; the drag itself is a native file drag that main starts (the `drag` download command), so the file can be dropped on a page's upload box,
// in Explorer or Finder, in a chat or mail, or on the desktop. Nothing changes at rest; a picked-up row dims, as a dragged bookmark row does.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } },
});
const { DownloadsPanel } = await import('../src/features/DownloadsPanel');
const { Downloads, canDragFile, pickUpFile } = await import('../src/features/Downloads');
const { createInitialState } = await import('../src/runtime/core');
import type { BrowserDownload, BrowserSnapshot } from '../src/runtime/types';

const download = (id: string, name: string, extra: Partial<BrowserDownload> = {}): BrowserDownload =>
  ({ id, name, size: '2048 / 2048 KB', totalBytes: 2097152, receivedBytes: 2097152, startedAt: 1_700_000_000_000 + Number(id.replace(/\D/g, '')), status: 'Ready', browserProfileId: 'profile-personal', canOpen: true, canShow: true, canRetry: false, ...extra });
const windowWith = (...items: BrowserDownload[]): BrowserSnapshot => ({ ...createInitialState(), downloads: items });
const panel = (state: BrowserSnapshot) => renderToStaticMarkup(createElement(DownloadsPanel, { state, close: () => undefined, onSeeAll: () => undefined }));
const page = (state: BrowserSnapshot) => renderToStaticMarkup(createElement(Downloads, { state }));
const rows = (html: string, cls: string) => html.split(`class="${cls}`).slice(1).map(part => part.slice(0, part.indexOf('>') + 1));

const list = () => windowWith(
  download('1', 'setup.exe'),
  download('2', 'missing.png', { canOpen: false, canShow: false }),
  download('3', 'running.zip', { status: 'Downloading', receivedBytes: 1024, canShow: false, canOpen: false, canPause: true, canCancel: true }),
  download('4', 'paused.zip', { status: 'Paused', receivedBytes: 1024, canShow: false, canOpen: false, canResume: true, canCancel: true }),
  download('5', 'broken.pdf', { status: 'Interrupted', canShow: false, canOpen: false, canRetry: true }),
  download('6', 'failed.pdf', { status: 'Failed', canShow: false, canOpen: false }),
  download('7', 'private.pdf', { private: true } as Partial<BrowserDownload>),
);

test('the helper: a Ready download whose file is still there can be dragged; nothing else can', () => {
  assert.equal(canDragFile({ status: 'Ready', canOpen: true }), true);
  assert.equal(canDragFile({ status: 'Ready', canOpen: false }), false, 'the file is gone');
  assert.equal(canDragFile({ status: 'Ready' }), false, 'nothing known about the file yet');
  for (const status of ['Downloading', 'Paused', 'Interrupted', 'Failed', 'Cancelled']) assert.equal(canDragFile({ status, canOpen: true }), false, status);
});

test('the popup: only the rows of finished files that are still there are draggable, and a row at rest looks the same as before', () => {
  // The popup shows the five latest (what runs first), so this list is five rows.
  const html = panel(windowWith(
    download('1', 'setup.exe'),
    download('2', 'missing.png', { canOpen: false, canShow: false }),
    download('3', 'running.zip', { status: 'Downloading', receivedBytes: 1024, canShow: false, canOpen: false, canPause: true, canCancel: true }),
    download('5', 'broken.pdf', { status: 'Interrupted', canShow: false, canOpen: false, canRetry: true }),
    download('7', 'private.pdf', { private: true } as Partial<BrowserDownload>),
  ));
  const items = rows(html, 'dl-panel-item');
  assert.equal(items.length, 5, 'every row is drawn');
  const draggable = items.filter(row => row.includes('draggable="true"'));
  assert.equal(draggable.length, 2, 'setup.exe and private.pdf (the two Ready rows whose files exist)');
  assert.ok(draggable.every(row => row.includes('data-status="Ready"')));
  for (const row of draggable) assert.match(row, /^[^>]*data-status="Ready"/, 'a Ready row');
  for (const row of items.filter(row => !row.includes('draggable'))) assert.doesNotMatch(row, /data-status="Ready"[^>]*data-deletable/, 'a row that cannot be dragged is not a Ready row with a file');
  assert.equal(html.includes('data-dragging'), false, 'at rest no row is dimmed');
  assert.equal((html.match(/draggable/g) || []).length, 2, 'nothing else on the popup is draggable, no handle or new element');
});

test('the Downloads page: the same rows are draggable, and only those', () => {
  const html = page(list());
  const items = rows(html, 'lib-row dl');
  assert.equal(items.length >= 7, true, 'every row is drawn: ' + items.length);
  const draggable = items.filter(row => row.includes('draggable="true"'));
  assert.equal(draggable.length, 2);
  for (const row of draggable) assert.match(row, /data-status="Ready"/);
  assert.equal(html.includes('data-dragging'), false, 'at rest no row is dimmed');
  assert.equal((html.match(/draggable/g) || []).length, 2);
});

test('picking a row up: the browser\'s own drag is cancelled, the drag command runs for that download, and the row dims for at least 400 ms', async () => {
  const log: string[] = [], commands: [string, string][] = [];
  let release = () => undefined as void;
  const act = (id: string, command: string) => { commands.push([id, command]); return new Promise<void>(resolve => { release = () => resolve(); }); };
  let clock = 1000;
  const later: { run: () => void; ms: number }[] = [];
  const done = pickUpFile({ preventDefault: () => log.push('prevented') }, 'dl-7', act as never, on => log.push(on ? 'lift' : 'drop'), () => clock, (run, ms) => { later.push({ run, ms }); });
  assert.deepEqual(log, ['prevented', 'lift'], 'cancelled first, dimmed at once');
  assert.deepEqual(commands, [['dl-7', 'drag']]);
  assert.equal(later.length, 0, 'still held while the command runs (Windows answers when the drag ends)');
  clock += 150; release(); await done;
  assert.deepEqual(later.map(entry => entry.ms), [250], 'a quick answer (macOS) keeps the dim for the rest of the 400 ms');
  later[0].run(); assert.deepEqual(log, ['prevented', 'lift', 'drop']);
  // A drag that lasted longer than that lets go at once.
  clock = 5000; const long = pickUpFile({ preventDefault() {} }, 'dl-8', (async () => { clock += 3000; }) as never, () => undefined, () => clock, (run, ms) => { later.push({ run, ms }); });
  await long; assert.equal(later.at(-1)!.ms, 0);
});

test('a failed drag command (the file went away) lets go too and leaves the message to the list\'s own error line', async () => {
  const log: string[] = [], later: number[] = [];
  const act = async () => undefined; // useDownloads.act catches the failure and shows it in the popup's / page's error line
  await pickUpFile({ preventDefault() {} }, 'dl-9', act as never, on => log.push(String(on)), () => 0, (run, ms) => { later.push(ms); run(); });
  assert.deepEqual(log, ['true', 'false']);
  const hook = read('../src/features/Downloads.tsx');
  assert.match(hook, /const act = async \(id: string, command: DownloadCommand\) => \{ setError\(''\); try \{ await runtime\.service\(\{ type: 'downloads\.command', id, command \}\); await refresh\(\); \} catch \(reason\) \{ setError\(/);
});

test('wiring: both rows take their props from the one hook, the drag command is the existing one, and the dim is the existing 45%', () => {
  const panelSource = read('../src/features/DownloadsPanel.tsx'), pageSource = read('../src/features/Downloads.tsx');
  assert.match(panelSource, /drag = useFileDrag\(item, act\)/);
  assert.match(panelSource, /data-deletable=\{deletable \|\| undefined\} \{\.\.\.drag\}>/);
  assert.match(pageSource, /const drag = useFileDrag\(item, act\);/);
  assert.match(pageSource, /data-settled=\{!live\(item\) \|\| undefined\} \{\.\.\.drag\}>/);
  assert.match(pageSource, /if \(!canDragFile\(item\)\) return \{\};/);
  assert.match(pageSource, /act\(id, 'drag'\)/);
  assert.match(read('../src/runtime/types.ts'), /command:'pause'\|'resume'\|'cancel'\|'show'\|'open'\|'retry'\|'drag'\|'delete'\}/);
  assert.match(read('../src/features/downloads-panel.css'), /\.dl-panel-item\[data-dragging\] \{ opacity: 0\.45; \}/);
  assert.match(read('../src/features/library.css'), /\.lib-row\[data-dragging\] \{ opacity: 0\.45; \}/);
  // Clicks still work: the row's open button, Show in folder, Delete file and Remove are the same buttons as before.
  assert.match(panelSource, /onClick=\{\(\) => \{ void act\(item\.id, 'open'\); onOpened\(\); \}\}/);
  assert.match(panelSource, /void runtime\.dispatch\(\{ type: 'downloads\.remove', id: item\.id \}\)/);
});
