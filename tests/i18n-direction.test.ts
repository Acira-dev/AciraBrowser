import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentLocale, interfaceDirection } from '../src/i18n/direction';
import { format } from '../src/i18n/format';

test('Arabic regional tags use RTL; other requested interfaces use LTR', () => {
  for (const locale of ['ar', 'ar-LB', 'AR_sa']) assert.equal(interfaceDirection(locale), 'rtl');
  for (const locale of ['en', 'tr', 'ru', 'ko', 'hi']) assert.equal(interfaceDirection(locale), 'ltr');
});

test('changing from Arabic restores document direction together with language', () => {
  const root = { lang: '', dir: '' };
  applyDocumentLocale(root, 'ar');
  assert.deepEqual(root, { lang: 'ar', dir: 'rtl' });
  applyDocumentLocale(root, 'en');
  assert.deepEqual(root, { lang: 'en', dir: 'ltr' });
});

test('RTL interpolation isolates names and addresses while retaining numeric formatting', () => {
  const number = new Intl.NumberFormat('ar').format(1234);
  assert.equal(format('ar', 'الموقع {host}: {count}', { host: 'example.com/path?x=1', count: 1234 }), `الموقع \u2068example.com/path?x=1\u2069: ${number}`);
  assert.equal(format('ar-LB', 'الملف {name}', { name: 'Report (2026).pdf' }), 'الملف \u2068Report (2026).pdf\u2069');
  assert.equal(format('ar', 'الاسم {name}', { name: 'اسم عربي' }), 'الاسم \u2068اسم عربي\u2069');
  assert.equal(format('ar', 'فارغ:{name}', { name: '' }), 'فارغ:');
});

test('RTL string isolation preserves plural choice and leaves other languages unchanged', () => {
  const message = '{count, plural, one {{name}: one} two {{name}: two} few {{name}: # few} other {{name}: # other}}';
  assert.equal(format('ar', message, { count: 2, name: 'Work' }), '\u2068Work\u2069: two');
  assert.equal(format('ar', message, { count: 3, name: 'Work' }), `\u2068Work\u2069: ${new Intl.NumberFormat('ar').format(3)} few`);
  for (const locale of ['en', 'tr', 'ru', 'ko', 'hi']) {
    assert.equal(format(locale, 'Host {host}, count {count}', { host: 'example.com', count: 2 }), `Host example.com, count ${new Intl.NumberFormat(locale).format(2)}`);
  }
  assert.equal(format('ar', 'النص دون معاملات'), 'النص دون معاملات');
  assert.equal(format('ar', 'لم يُحدّد {missing}'), 'لم يُحدّد {missing}');
});
