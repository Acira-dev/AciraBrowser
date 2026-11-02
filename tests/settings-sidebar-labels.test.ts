import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES } from '../src/i18n/locales';
import { settingsSections } from '../src/features/settings/model';

// The Settings sidebar gives a section name 140px at 13px and cuts what is longer with "…". Japanese "インポートとエクスポート" needed
// 155px; it is now "読み込みと書き出し", macOS's own words, in the sidebar and as the page title (one message, read by both).
const catalog = (code: string) => JSON.parse(fs.readFileSync(`src/i18n/${code}.json`, 'utf8')) as Record<string, string>;
const en = catalog('en');
const read = (file: string) => fs.readFileSync(file, 'utf8');
const panelSections = fs.readdirSync('src/features/settings/panels').filter(name => name.endsWith('.tsx'))
  .map(name => /section: '([^']+)'/.exec(read('src/features/settings/panels/' + name))?.[1]).filter(Boolean) as string[];
const sections = [...new Set([...settingsSections, ...panelSections])];
/** The id translateText() finds for a section's English name (the first message with that text). */
const idOf = (english: string) => Object.keys(en).find(id => en[id] === english);
/** Full-width glyphs (kana, CJK, Hangul) are one em: 13px at the sidebar's size. Only names made of them can be measured here. */
const fullWidth = /[぀-ヿ㐀-鿿가-힯＀-￯]/u;

test('the sidebar and the page title name a section with one message', () => {
  const settings = read('src/features/BrowserSettings.tsx');
  assert.match(settings, /<span>\{translateText\(label\)\}<\/span>/);
  assert.match(settings, /<h1 data-form-item>\{translateText\(section\)\}<\/h1>/);
  for (const section of sections) assert.ok(idOf(section), `${section} has a message`);
  assert.equal(idOf('Import & export'), 'section.importExport');
});

test('Japanese calls Import & export 読み込みと書き出し; the Import page keeps インポート', () => {
  const ja = catalog('ja');
  assert.equal(ja['section.importExport'], '読み込みと書き出し');
  assert.match(ja['import.filesHeading'], /インポート/);
});

test('Japanese, Chinese and Korean section names fit the Settings sidebar', () => {
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    for (const section of sections) {
      const name = messages[idOf(section)!];
      if (!fullWidth.test(name)) continue;
      const width = [...name].reduce((sum, char) => sum + (fullWidth.test(char) ? 13 : char === ' ' ? 4 : 8), 0);
      assert.ok(width <= 140, `${code}: "${name}" is about ${width}px; the sidebar has 140px`);
    }
  }
});
