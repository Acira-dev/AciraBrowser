import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { platformCatalogText } from '../src/i18n/platform';

// Settings › Shortcuts said "Backspace clears it" on a Mac, whose key is labelled delete (round 1 shows it as ⌫ in the key caps under
// the row). On a Mac the sentence names the delete key, in all 13 languages; Windows keeps Backspace. The Routines page's key field
// says the same to screen readers.
const languages = ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi'];
const catalog = (code: string) => JSON.parse(fs.readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const windowsName = /Backspace|Rücktaste|Retour arrière/;

test('on a Mac the shortcut sentences name the delete key; on Windows Backspace, in every language', () => {
  for (const code of languages) for (const id of ['settingslede.shortcuts', 'routinespage.shortcutPressAKeyCombination']) {
    const text = catalog(code)[id];
    assert.match(text, windowsName, `${code} ${id}: the catalog is written for Windows`);
    const mac = platformCatalogText(id, text, 'darwin');
    assert.doesNotMatch(mac, windowsName, `${code} ${id} on a Mac`);
    assert.ok(mac.includes('Delete'), `${code} ${id} on a Mac: ${mac}`);
    assert.equal(mac.replace('Delete', 'X'), text.replace(windowsName, 'X'), `${code} ${id}: only the key's name changes`);
    assert.equal(platformCatalogText(id, text, 'win32'), text, `${code} ${id} on Windows`);
  }
  assert.equal(platformCatalogText('settingslede.shortcuts', catalog('en')['settingslede.shortcuts'], 'darwin'), 'Click a shortcut and press the new keys. Delete clears it, Esc cancels.');
});

test('the hint under a recording row keeps its ⌫ key cap on a Mac (round 1)', () => {
  const panel = fs.readFileSync(new URL('../src/features/settings/panels/shortcuts.tsx', import.meta.url), 'utf8');
  assert.match(panel, /keys=\{\{ clear: mac \? '⌫' : t\("shortcuts\.backspace"\), cancel: t\("app\.esc"\) \}\}/);
});
