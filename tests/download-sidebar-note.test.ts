import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLocale } from '../src/i18n';
import { sidebarNote } from '../src/features/downloadText';
import type { BrowserDownload } from '../src/runtime/types';

/** The sidebar's Downloads section (Customize sidebar) noted a finished file as the native "2930 / 2930 KB" and every other row with its
 * status in English ("Paused", "Cancelled", "Interrupted") whatever the language. It now says what the popup and the page say. */
const row = (status: string, extra: Partial<BrowserDownload> = {}) => ({ id: 'd', name: 'report.pdf', status, size: '2930 / 2930 KB', receivedBytes: 3_000_000, totalBytes: 3_000_000, ...extra } as BrowserDownload);
const de = JSON.parse(readFileSync(new URL('../src/i18n/de.json', import.meta.url), 'utf8'));

test('a finished file shows its size; a running one how far it is', async () => {
  await setLocale('en');
  assert.equal(sidebarNote(row('Ready')), '3 MB');
  assert.equal(sidebarNote(row('Downloading', { receivedBytes: 1_500_000 })), '50%');
  assert.equal(sidebarNote(row('Downloading', { totalBytes: 0, size: '1088 KB' })), '…', 'size unknown');
});

test('statuses follow the interface language', async () => {
  await setLocale('de');
  for (const status of ['Paused', 'Cancelled', 'Interrupted']) assert.equal(sidebarNote(row(status)), de['dl.status.' + status], status);
  await setLocale('en');
});

test('the sidebar row uses it', () => {
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /<small className="sb-row-note">\{sidebarNote\(item\)\}<\/small>/);
});
