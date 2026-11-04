import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale, t } from '../src/i18n';
import { LOCALES, type LocaleCode } from '../src/i18n/locales';
import type { MetricsStatus } from '../src/runtime/types';

// beta.9: "See what's sent" lists the Windows uninstall message, with the exact fields, only where the uninstaller sends it.
// UsageSent.tsx imports its stylesheet; Node has no CSS loader, so a .css import loads as an empty module here.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
const { UsageSent } = await import('../src/features/metrics/UsageSent');

const status = (uninstallPayload: MetricsStatus['uninstallPayload']): MetricsStatus => ({
  choice: 'on', enabled: true, configured: true, endpointHost: 'x.supabase.co', lastSent: '', sample: false, askRatings: true,
  payload: { schema: 3, event: 'daily', installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', appVersion: '0.1.0-beta.9', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', day: '2026-11-03' },
  ratingPayload: { schema: 1, event: 'rating', feature: 'splitView', stars: 5, appVersion: '0.1.0-beta.9', platform: 'win32', day: '2026-11-03' },
  uninstallPayload,
});
const windows = { schema: 1, event: 'uninstall', installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', appVersion: '0.1.0-beta.9', platform: 'win32', arch: 'x64', day: '2026-11-03' };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('Windows: the uninstall group shows every field of the message, after the rating and before "Never sent"', async () => {
  await setLocale('en');
  const html = renderToStaticMarkup(createElement(UsageSent, { status: status(windows) }));
  assert.ok(html.includes(escape(t('usage.sent.groupUninstall'))));
  assert.ok(html.includes(escape(t('usage.sent.uninstall'))));
  assert.ok(html.includes('schema 1 · event uninstall · installId 6081ef29-10d4-4023-8c6e-7dc490f6903f · appVersion 0.1.0-beta.9 · platform win32 · arch x64 · day 2026-11-03'));
  const at = (text: string) => html.indexOf(escape(text));
  assert.ok(at(t('usage.sent.groupRatings')) < at(t('usage.sent.groupUninstall')) && at(t('usage.sent.groupUninstall')) < at(t('usage.sent.never')));
});

test('macOS, Linux and QA builds: no uninstall group (nothing is sent when Acira is deleted there)', async () => {
  await setLocale('en');
  for (const payload of [null, undefined]) {
    const html = renderToStaticMarkup(createElement(UsageSent, { status: status(payload) }));
    assert.ok(!html.includes(escape(t('usage.sent.groupUninstall'))));
    assert.ok(!html.includes('event uninstall'));
  }
});

// beta.10: the sentence named four of the five fields; `platform win32` (shown just below it) went unnamed, while the rating line says "system".
test('the uninstall sentence names every field the message carries, system included, in all 13 languages', async () => {
  await setLocale('en');
  const words: Record<string, string> = { installId: 'same random number', appVersion: 'Acira version', platform: 'system', arch: 'processor type', day: 'date' };
  assert.deepEqual(Object.keys(windows).filter(key => key !== 'schema' && key !== 'event').sort(), Object.keys(words).sort());
  for (const [field, word] of Object.entries(words)) assert.ok(t('usage.sent.uninstall').includes(word), `${field}: "${word}"`);
  assert.equal(t('usage.sent.uninstall'), 'Only if this is on when you remove Acira from this PC: one last message with the same random number, Acira version, system, processor type and date. Never when Acira updates itself.');
  // each language uses its rating line's own word for "system" (Russian declines it: система / системой)
  const system: Record<LocaleCode, string> = { en: 'system', es: 'sistema', fr: 'système', de: 'System', 'pt-BR': 'sistema', it: 'sistema', ja: 'システム', 'zh-CN': '系统', ar: 'النظام', tr: 'sistem', ru: 'систем', ko: '시스템', hi: 'सिस्टम' };
  assert.deepEqual(Object.keys(system).sort(), LOCALES.map(locale => locale.code).sort());
  for (const { code } of LOCALES) {
    await setLocale(code);
    assert.ok(t('usage.sent.rating').includes(system[code]), `${code} rating line`);
    assert.ok(t('usage.sent.uninstall').includes(system[code]), `${code} uninstall line names the system`);
  }
  await setLocale('en');
});

test('the group is translated (Arabic, Japanese, German)', async () => {
  for (const code of ['ar', 'ja', 'de'] as const) {
    await setLocale(code);
    const html = renderToStaticMarkup(createElement(UsageSent, { status: status(windows) }));
    assert.ok(html.includes(escape(t('usage.sent.groupUninstall'))), code);
    assert.notEqual(t('usage.sent.uninstall'), 'Only if this is on when you remove Acira from this PC: one last message with the same random number, Acira version, processor type and date. Never when Acira updates itself.', code);
  }
  await setLocale('en');
});
