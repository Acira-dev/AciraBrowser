import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../src/i18n/locales';

// 13.5 (hunt-a): the tab tooltip said "· sleeping" in English in every language (a literal in AciraSidebar and BrowserTabsHorizontal).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const catalog = (code: string) => JSON.parse(read(`../src/i18n/${code}.json`)) as Record<string, string>;
const KEY = 'tabsleep.tipSleeping';

test('the "sleeping" word of a tab tooltip is in all 13 catalogs, and the 12 translations are not English', () => {
  assert.equal(LOCALES.length, 13);
  assert.equal(catalog('en')[KEY], 'sleeping');
  for (const { code } of LOCALES) {
    const text = catalog(code)[KEY];
    assert.ok(text && text.trim(), `${code} has the message`);
    if (code !== 'en') assert.notEqual(text, 'sleeping', `${code} is translated`);
  }
});

test('both tab tooltips read the word from the catalog instead of writing English', () => {
  for (const file of ['../src/components/sidebar/AciraSidebar.tsx', '../src/components/BrowserTabsHorizontal.tsx']) {
    const source = read(file);
    assert.ok(!/·\s*sleeping/.test(source), `${file} still writes "· sleeping"`);
    assert.ok(source.includes(KEY), `${file} uses ${KEY}`);
  }
});
