import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macKeys, platformCatalogText } from '../src/i18n/platform';
import { LOCALES } from '../src/i18n/locales';

// Mac text said Alt where the key is Option: "Alt+click or Shift+click … Alt+Enter" (Settings > Tabs, link preview), "Alt+Up or Alt+Down"
// (Appearance > Menu, Customize toolbar). macKeys only turned Alt+letter into ⌥letter.
test('on a Mac the Alt key is Option in a sentence, and Alt+Enter is Option+Return', () => {
  const mac = (text: string) => platformCatalogText('linkpreview.detail', text, 'darwin');
  assert.equal(mac('the Preview button beside search results, Alt+click or Shift+click, press and hold, or Alt+Enter on a focused link.'), 'the Preview button beside search results, Option+click or Shift+click, press and hold, or Option+Return on a focused link.');
  assert.equal(mac('Drag to reorder, or press Alt+Up or Alt+Down.'), 'Drag to reorder, or press Option+Up or Option+Down.');
  assert.equal(mac('Drag to reorder, or use Alt + Up and Down.'), 'Drag to reorder, or use Option + Up and Down.');
  assert.equal(mac('Preview links without opening a tab: Alt-click a link'), 'Preview links without opening a tab: Option-click a link');
  assert.equal(mac('All open tabs (Alt+T)'), 'All open tabs (⌥T)', 'Alt+letter stays the Mac glyph');
  assert.equal(mac('按住 Alt 点击链接'), '按住 Option 点击链接');
  assert.equal(mac('AltGr types text'), 'AltGr types text');
  assert.equal(platformCatalogText('linkpreview.detail', 'Alt+click or Alt+Enter', 'win32'), 'Alt+click or Alt+Enter', 'Windows keeps Alt');
  assert.equal(macKeys('Alt+click or Shift+click'), 'Option+click or Shift+click', 'Settings rows written in English in the code get the same');
});

test('no catalog says Alt on a Mac (the workspace key reads ⌃1–8 there)', () => {
  for (const { code } of LOCALES) {
    const catalog = JSON.parse(readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;
    const left = Object.entries(catalog).map(([id, text]) => [id, platformCatalogText(id, text, 'darwin')]).filter(([, text]) => /\bAlt\b/.test(text));
    assert.deepEqual(left, [], code);
  }
});
