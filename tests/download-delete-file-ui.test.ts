import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

// "Delete file" on a finished download (13.2). The downloads popup and the Downloads page each give a finished file whose file is still on
// disk one more icon button, between "Show in folder" and "Remove from list" (Remove keeps its place at the end). It runs the `delete`
// download command; the native side moves the file to the Trash and takes the row off the list. These tests render the real components.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } },
});
const { DownloadsPanel } = await import('../src/features/DownloadsPanel');
const { Downloads, canDeleteFile } = await import('../src/features/Downloads');
const { createInitialState } = await import('../src/runtime/core');
import type { BrowserDownload, BrowserSnapshot } from '../src/runtime/types';

const download = (id: string, name: string, extra: Partial<BrowserDownload> = {}): BrowserDownload =>
  ({ id, name, size: '2048 / 2048 KB', totalBytes: 2097152, receivedBytes: 2097152, startedAt: 1_700_000_000_000 + Number(id.replace(/\D/g, '')), status: 'Ready', browserProfileId: 'profile-personal', canOpen: true, canShow: true, canRetry: false, ...extra });
const windowWith = (...items: BrowserDownload[]): BrowserSnapshot => ({ ...createInitialState(), downloads: items });
const panel = (state: BrowserSnapshot) => renderToStaticMarkup(createElement(DownloadsPanel, { state, close: () => undefined, onSeeAll: () => undefined }));
const page = (state: BrowserSnapshot) => renderToStaticMarkup(createElement(Downloads, { state }));
const button = (html: string, label: string) => html.includes(`aria-label="${label}"`);

test('the helper: Delete file is for a Ready download whose file is still there', () => {
  assert.equal(canDeleteFile({ status: 'Ready', canShow: true }), true);
  assert.equal(canDeleteFile({ status: 'Ready', canShow: false }), false, 'the file is gone');
  assert.equal(canDeleteFile({ status: 'Ready' }), false, 'nothing known about the file yet');
  for (const status of ['Downloading', 'Paused', 'Interrupted', 'Failed', 'Cancelled']) assert.equal(canDeleteFile({ status, canShow: true }), false, status);
});

test('the popup: a finished file that is still there has Delete file, between Show in folder and Remove; no other row has it', () => {
  const html = panel(windowWith(
    download('1', 'setup.exe'),
    download('2', 'missing.png', { canOpen: false, canShow: false }),
    download('3', 'running.zip', { status: 'Downloading', receivedBytes: 1024, canShow: false, canPause: true, canCancel: true }),
    download('4', 'broken.pdf', { status: 'Interrupted', canShow: false, canRetry: true }),
  ));
  assert.ok(button(html, 'Delete setup.exe'));
  assert.ok(!button(html, 'Delete missing.png'), 'the file is gone: nothing to delete');
  assert.ok(!button(html, 'Delete running.zip'));
  assert.ok(!button(html, 'Delete broken.pdf'));
  assert.equal(html.split('Delete setup.exe').length - 1 >= 2, true, 'label and tooltip');
  const show = html.indexOf('aria-label="Show setup.exe in folder"'), del = html.indexOf('aria-label="Delete setup.exe"'), remove = html.indexOf('aria-label="Remove setup.exe from list"');
  assert.ok(show > 0 && show < del && del < remove, 'Show in folder, Delete file, Remove from list: Remove keeps the end place');
  assert.match(html, /<button type="button" class="dl-panel-act" data-danger="true" aria-label="Delete setup\.exe" title="Delete setup\.exe">/);
  assert.match(html, /class="dl-panel-item" data-status="Ready" data-deletable="true"/, 'only that row gets room for the third button');
  assert.equal(html.split('data-deletable').length - 1, 1);
});

test('the Downloads page: the same button, beside Open, Show in folder and Remove from list', () => {
  const html = page(windowWith(
    download('1', 'setup.exe'),
    download('2', 'missing.png', { canOpen: false, canShow: false }),
    download('3', 'running.zip', { status: 'Downloading', receivedBytes: 1024, canShow: false, canPause: true, canCancel: true }),
    download('4', 'broken.pdf', { status: 'Failed', canShow: false }),
  ));
  assert.ok(button(html, 'Delete setup.exe'));
  assert.match(html, /<button type="button" class="lib-icon" data-danger="true" aria-label="Delete setup\.exe" title="Delete file">/);
  for (const name of ['missing.png', 'running.zip', 'broken.pdf']) assert.ok(!button(html, 'Delete ' + name), name);
  const show = html.indexOf('aria-label="Show setup.exe in folder"'), del = html.indexOf('aria-label="Delete setup.exe"'), remove = html.indexOf('aria-label="Remove setup.exe from list"');
  assert.ok(show > 0 && show < del && del < remove);
  assert.equal(html.split('aria-label="Delete ').length - 1, 1, 'one Delete file button in the whole list');
});

test('both buttons run the delete command on that download and use the existing error line; Remove still only clears the list', () => {
  const panelSource = read('../src/features/DownloadsPanel.tsx'), pageSource = read('../src/features/Downloads.tsx');
  assert.match(panelSource, /deletable && button\(t\('dl\.deleteAria', \{ name: item\.name \}\), <Trash2 size=\{14\}\/>, \(\) => void act\(item\.id, 'delete'\), true\)/);
  assert.match(pageSource, /canDeleteFile\(item\) && <button type="button" className="lib-icon" data-danger aria-label=\{t\('dl\.deleteAria', \{ name: label \}\)\} title=\{t\('dl\.delete'\)\} onClick=\{\(\) => void act\(item\.id, 'delete'\)\}>/);
  // act() shows a failed command's message in the panel's and page's own error line, and refreshes the list after a good one.
  assert.match(pageSource, /const act = async \(id: string, command: DownloadCommand\) => \{ setError\(''\); try \{ await runtime\.service\(\{ type: 'downloads\.command', id, command \}\); await refresh\(\); \} catch \(reason\) \{ setError\(/);
  assert.match(panelSource, /role="alert">\{error\}/);
  assert.match(pageSource, /role="alert">\{error\}/);
  assert.equal((panelSource + pageSource).split("type: 'downloads.remove'").length - 1, 2, 'Remove from list is unchanged in both');
  assert.match(read('../src/runtime/types.ts'), /command:'pause'\|'resume'\|'cancel'\|'show'\|'open'\|'retry'\|'drag'\|'delete'\}/);
});

test('the popup keeps the buttons off the name: a deletable row reserves room for three', () => {
  const css = read('../src/features/downloads-panel.css');
  assert.match(css, /\.dl-panel-item \{ position: relative; --dl-acts: 60px; \}/);
  assert.match(css, /\.dl-panel-item\[data-deletable\] \{ --dl-acts: 88px; \}/);
});
