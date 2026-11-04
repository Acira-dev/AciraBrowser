import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Settings › Passwords at 150% in a 900×600 window: the search field was squeezed to "Passw…" beside "Add password" (10 of 13 languages,
// English too), and the Settings search placeholder was cut ("Einstellungen durchsuche"). Measured in the app on 4 Nov, 13 languages at
// 100% and 150% interface size and at 200% page zoom, 900×600: nothing cut now. How:
// - the Passwords search asks for its whole placeholder's width; the button goes under it only where both don't fit on one line;
// - the Settings search's "/" hint gives way in the narrowest field (the 200% case);
// - three placeholders that could not fit at 200% even with the whole line say the same in fewer words.
const read = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const catalog = (code: string) => JSON.parse(read(`src/i18n/${code}.json`)) as Record<string, string>;

test('the Passwords search keeps room for its whole placeholder, and Add password goes under it when there is none beside it', () => {
  assert.match(read('src/features/settings/panels/passwords.tsx'), /<label className="pw-search" data-placeholder=\{t\('pwp\.search'\)\}>/);
  const css = read('src/features/settings/panels/passwords.css');
  assert.match(css, /\.pw-bar\{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;/, 'the bar wraps');
  assert.match(css, /\.pw-search\{display:grid;grid-template-columns:14px minmax\(0,1fr\);[^}]*flex:1 1 auto;min-width:0;/, 'the field asks for its content width and fills the line');
  assert.match(css, /\.pw-search::after\{content:attr\(data-placeholder\);grid-area:1\/2;height:0;[^}]*visibility:hidden;white-space:pre;font-size:13px\}/, 'its content width is the placeholder (never painted)');
  assert.match(css, /:root:root \.pw-search input\{grid-area:1\/2;width:0;min-width:100%;height:100%;[^}]*font-size:13px;/, 'the input adds no width of its own and fills the field');
});

test('the Settings search hides its "/" hint only in the narrowest field', () => {
  const css = read('src/features/settings/settings.css');
  assert.match(css, /\.st-search-field \{ container: st-search \/ inline-size; \}\n@container st-search \(width < 220px\) \{ \.st-kbd \{ display: none; \} \}/);
});

test('placeholders that could not fit at 200% say the same in fewer words; the others are unchanged', () => {
  assert.equal(catalog('de')['settingssearch.searchSettings'], 'Einstellungen suchen');
  assert.equal(catalog('fr')['settingssearch.searchSettings'], 'Rechercher un réglage');
  assert.equal(catalog('fr')['pwp.search'], 'Chercher un mot de passe');
  assert.equal(catalog('en')['settingssearch.searchSettings'], 'Search settings');
  assert.equal(catalog('de')['pwp.search'], 'Passwörter durchsuchen');
  assert.equal(catalog('pt-BR')['settingssearch.searchSettings'], 'Pesquisar configurações', 'the longest left: fits beside the hint at 150%, without it at 200%');
});
