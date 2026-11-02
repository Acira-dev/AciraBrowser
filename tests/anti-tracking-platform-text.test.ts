import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES } from '../src/i18n/locales';

// Settings › Privacy › "Warn about scam pages" explained ClickFix with the Windows Run box on every platform. On a Mac the same lure
// asks for a paste into Terminal (page-risk.cjs covers both), so the row names the place the person's computer has, in every language.
const catalog = (code: string) => JSON.parse(fs.readFileSync(`src/i18n/${code}.json`, 'utf8')) as Record<string, string>;
test("the scam-page row names Terminal on a Mac and the Run box elsewhere", () => {
  const panel = fs.readFileSync('src/features/settings/panels/anti-tracking.tsx', 'utf8');
  assert.match(panel, /detail=\{isMac\(\) \? t\('antiTracking\.pageWarningsDetailMac'\) : t\('antiTracking\.pageWarningsDetail'\)\}/);
  assert.doesNotMatch(panel, /detail="[^"]*Run box/, 'no unconditional Windows-only wording');
  const en = catalog('en');
  assert.match(en['antiTracking.pageWarningsDetailMac'], /paste it into Terminal \(ClickFix\)/);
  assert.doesNotMatch(en['antiTracking.pageWarningsDetailMac'], /Run box/);
  assert.match(en['antiTracking.pageWarningsDetail'], /paste it into the Run box \(ClickFix\)/);
  for (const { code } of LOCALES) {
    const messages = catalog(code);
    assert.notEqual(messages['antiTracking.pageWarningsDetailMac'], messages['antiTracking.pageWarningsDetail'], `${code}: the Mac and Windows rows say the same`);
    assert.match(messages['antiTracking.pageWarningsDetailMac'], /ClickFix/, code);
  }
});
