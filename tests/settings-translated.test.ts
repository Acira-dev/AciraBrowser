// Settings reads in the interface language, all of it. On 2 Nov every language still showed about 170 English lines there (row details
// written as detail="…", section introductions, status lines, search breadcrumbs): the catalog guard did not look at those props.
// Three checks keep it that way:
//  1. no Settings source file has a literal a person would read (row props, and any sentence anywhere: a Record of messages, an Error);
//  2. every message id Settings uses exists in every language, and a long one is not left in English;
//  3. every Settings section, drawn in each of the thirteen languages, shows no English line that the catalog does not keep in English.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// @ts-ignore the scanner is a plain .mjs script
import { scanFiles, convertedFiles } from '../scripts/i18n-scan.mjs';
import { LOCALES } from '../src/i18n/locales';
import { platformCatalogText } from '../src/i18n/platform';
import { format } from '../src/i18n/format';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = (code: string) => JSON.parse(fs.readFileSync(path.join(root, 'src/i18n', code + '.json'), 'utf8')) as Record<string, string>;
const en = catalog('en');
const others = LOCALES.map(locale => locale.code).filter(code => code !== 'en');

const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(dir + '/' + entry.name) : /\.tsx?$/.test(entry.name) ? [dir + '/' + entry.name] : []);
/** Everything the Settings page draws: its own folder, and the components its sections are built from. */
const settingsFiles = [
  'src/features/BrowserSettings.tsx', ...walk('src/features/settings'),
  'src/features/NativeNetworkSettings.tsx', 'src/features/NewTabSettings.tsx', 'src/features/BrowserData.tsx', 'src/features/ContentFilters.tsx',
  'src/features/FilterListSettings.tsx', 'src/features/accounts/ProfileManager.tsx', 'src/features/profile-privacy/ProfileCleanupSettings.tsx',
  'src/features/connection/VpnPanel.tsx', 'src/features/metrics/UsageOffNotice.tsx', 'src/features/metrics/UsageSent.tsx',
  'src/features/tor/TorLevel.tsx', 'src/features/tor/TorOnion.tsx', 'src/features/workspaces/SecuredSettings.tsx',
  'src/features/import-export/ImportPanel.tsx', 'src/features/import-export/ExtensionReinstall.tsx',
  'src/components/AppearanceControls.tsx', 'src/components/MenuCustomizer.tsx', 'src/components/PageZoomControls.tsx', 'src/components/ExtensionManager.tsx',
  'src/components/WorkspaceCoverPicker.tsx', 'src/components/SettingInfo.tsx',
  'src/ui/toolbarMenu.ts', 'src/ui/windowViewText.ts', 'src/ui/shortcutGroups.ts', 'src/ui/shortcutKeys.ts', 'src/ui/webApps.ts', 'src/ui/releaseVersion.ts',
  'desktop/accounts/default-browser.cjs',
];

test('Settings source files keep every readable string in the catalog', () => {
  const found = scanFiles(settingsFiles.map(file => path.join(root, file)), { sentences: true }) as { file: string; line: number; text: string }[];
  assert.deepEqual(found.map(item => `${item.file}:${item.line} ${item.text}`), [], 'English in Settings: use t(\'…\') with an id in src/i18n/en.json and every language (or i18n-ignore for a name)');
  const converted = new Set(convertedFiles() as string[]);
  assert.deepEqual(settingsFiles.filter(file => !converted.has(file) && /\b(?:t|tr|tm)\(/.test(fs.readFileSync(path.join(root, file), 'utf8'))), [], 'list Settings files in src/i18n/converted.json so the catalog guard covers them');
});

/** Every catalog id written in a Settings file (t('…') calls and the id maps the panels keep). */
const settingsIds = [...new Set(settingsFiles.flatMap(file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/["'`]([A-Za-z][\w-]*(?:\.[\w-]+)+)["'`]/g)].map(match => match[1])).filter(id => id in en))];
/** Words the catalogs keep as they are (names, units, key names). A message longer than this that reads the same as English was not translated. */
const sameInEveryLanguage = (text: string) => (text.replace(/\{[^{}]*\}/g, '').match(/[A-Za-zÀ-ɏ]{3,}/g) ?? []).length < 3;
/** Messages that read the same as English on purpose, and where. */
const SAME_AS_ENGLISH: Record<string, readonly string[]> = {
  'connection.bridges.placeholder': others, // an example Tor bridge line
  'antiTracking.googleSafeBrowsingOptional': ['de'], // the product's name; German writes "optional" too
};

test('every message Settings uses is translated in every language', () => {
  assert.ok(settingsIds.length > 600, `found ${settingsIds.length} Settings message ids`);
  for (const code of others) {
    const messages = catalog(code);
    assert.deepEqual(settingsIds.filter(id => typeof messages[id] !== 'string' || !messages[id].trim()), [], `${code}: Settings messages missing`);
    assert.deepEqual(settingsIds.filter(id => messages[id] === en[id] && !sameInEveryLanguage(en[id]) && !SAME_AS_ENGLISH[id]?.includes(code)), [], `${code}: Settings messages still in English`);
  }
});

// Names and data that read the same in every language: products, people's profile names and the museum's titles of paintings.
const NAMES = new Set(['Personal', 'Work', 'Google', 'Bing', 'DuckDuckGo', 'Brave', 'Google Search', 'Brave Search', 'Bitwarden', '1Password', 'Proton Pass',
  'Mullvad VPN', 'Proton VPN', 'IVPN', 'Chrome', 'Edge', 'Firefox', 'Arc', 'Zen', 'Safari', 'Opera', 'Vivaldi', 'Snowflake', 'obfs4', 'meek', 'Page Up', 'Page Down', 'Del', 'Tab', 'Win']);
const paintings = (JSON.parse(fs.readFileSync(path.join(root, 'public/artwork/catalog-v2/catalog.json'), 'utf8')).paintings as { name: string; artist?: string; date?: string; alt?: string; provider?: string }[]);
const data = new Set(paintings.flatMap(item => [item.name, item.alt, item.artist, item.provider, item.artist && item.date ? `${item.artist}, ${item.date}` : '', item.artist && item.date ? `${item.name} · ${item.artist}, ${item.date}` : ''].filter(Boolean) as string[]));
const looksLikeData = (text: string) => !/\s/.test(text) && /[./:@%]/.test(text) || /^Acira \d/.test(text) || /^Tor [\d.]+ · /.test(text);

/** What one language's Settings shows (tests/fixtures/settings-text.ts), section by section, and the search registry's words. */
async function settingsText(locale: string): Promise<{ sections: Record<string, string[]>; registry: string[] }> {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'tests/fixtures/settings-text.ts'), locale], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

test('every Settings section, in every language, shows no English the catalog does not keep', async () => {
  const codes = ['en', ...others], results: Record<string, Awaited<ReturnType<typeof settingsText>>> = {};
  const queue = [...codes];
  await Promise.all(Array.from({ length: Math.min(codes.length, Math.max(2, os.availableParallelism?.() ?? 4)) }, async () => {
    for (let code = queue.shift(); code; code = queue.shift()) results[code] = await settingsText(code);
  }));
  const english = new Set([...Object.values(results.en.sections).flat(), ...results.en.registry]);
  assert.ok(Object.keys(results.en.sections).length >= 15, 'every section was drawn');
  assert.ok(english.size > 300, `English Settings has ${english.size} lines`);
  const problems: string[] = [];
  for (const code of others) {
    const messages = catalog(code);
    // A line the catalog itself keeps in English for this language (a product name, "VPN", "Rewind"), as either platform writes it.
    const kept = new Set(Object.keys(en).filter(id => messages[id] === en[id]).flatMap(id => [en[id], platformCatalogText(id, en[id], 'darwin')]));
    // A translated message that happens to read like the English for some number (French "15 minutes").
    for (const id of Object.keys(en).filter(id => en[id].includes('{') && messages[id] !== en[id])) {
      const names = [...new Set([...en[id].matchAll(/\{(\w+)(?:,|\})/g)].map(match => match[1]))];
      for (const n of [1, 2, 3, 5, 8, 15, 19, 30, 60, 120, 220, 240, 320]) {
        const params = Object.fromEntries(names.map(name => [name, n])), text = format(code, messages[id], params);
        if (text === format('en', en[id], params)) kept.add(text);
      }
    }
    const shown = Object.entries(results[code].sections).flatMap(([section, lines]) => lines.map(line => [section, line])).concat(results[code].registry.map(line => ['search', line]));
    for (const [section, line] of shown) {
      if (!english.has(line) || !/[A-Za-z]{3}/.test(line) || kept.has(line) || NAMES.has(line) || data.has(line) || looksLikeData(line)) continue;
      problems.push(`${code} ${section}: ${line}`);
    }
  }
  assert.deepEqual([...new Set(problems)], [], 'Settings shows English in another language');
});
