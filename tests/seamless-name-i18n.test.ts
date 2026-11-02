import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/** Founder, 28 Oct: "Seamless" (a window-view name in the toolbar menu) was English in every language. The name goes through t() in the menu
 *  (browsermenu.seamless), the Settings cards and the setup (windowview.seamless), and every catalog now carries the language's own word, chosen next to
 *  how that language names Full / Compact / Focus. Wherever the name is spoken in a sentence it is the same word. */
const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'ru', 'tr', 'ar', 'hi', 'ja', 'ko', 'zh-CN'];
const catalog = (lang: string) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const NAME_KEYS = ['windowview.seamless', 'browsermenu.seamless'];
const SENTENCE_KEYS = ['windowview.migrated', 'windowview.firstRun', 'shortcutCmd.seamless-mode', 'rating.feature.windowViews', 'usage.sent.featureCounts'];

test('all 13 catalogs have the name under both keys; the 12 translations are the language\'s own word, the same in the menu and in Settings', () => {
  assert.equal(catalog('en')['windowview.seamless'], 'Seamless');
  for (const lang of LANGS) {
    const c = catalog(lang);
    for (const key of NAME_KEYS) assert.equal(typeof c[key], 'string', `${lang} has ${key}`);
    assert.equal(c['browsermenu.seamless'], c['windowview.seamless'], `${lang}: one word in the menu and in Settings`);
    if (lang !== 'en') assert.notEqual(c['windowview.seamless'], 'Seamless', `${lang}: not the English word`);
    assert.ok(c['windowview.seamless'].trim().length > 0 && c['windowview.seamless'].length <= 14, `${lang}: a short label`);
  }
});

test('the sentences that speak the name use it, and none keeps the Latin word', () => {
  for (const lang of LANGS.filter(item => item !== 'en')) {
    const c = catalog(lang), name = c['windowview.seamless'];
    for (const key of SENTENCE_KEYS) assert.ok(!/Seamless/.test(c[key]), `${lang} ${key}: no English "Seamless" left`);
    assert.ok(c['windowview.firstRun'].includes(name) && c['windowview.migrated'].includes(name), `${lang}: the notices use the name (${name})`);
    // Placeholders survive.
    assert.equal(/\{shortcut\}/.test(c['windowview.migrated']), true, `${lang}: migrated keeps {shortcut}`);
    assert.equal(/\{shortcut\}/.test(c['windowview.firstRun']), true, `${lang}: firstRun keeps {shortcut}`);
  }
});

test('the code reaches the name only through t()', () => {
  const read = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.ok(read('src/components/BrowserMenu.tsx').includes('label={t("browsermenu.seamless")}'), 'the toolbar menu toggle');
  assert.ok(read('src/ui/windowViewText.ts').includes("seamless: t('windowview.seamless')"), 'the Settings and setup cards');
  assert.ok(read('src/ui/menuPrefs.ts').includes("seamless:()=>t('browsermenu.seamless')"), 'the menu customizer row');
});
