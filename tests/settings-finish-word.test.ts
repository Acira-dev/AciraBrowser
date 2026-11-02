import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES } from '../src/i18n/locales';

// Appearance › Finish is the window's material (Silver, Porcelain…). French, Portuguese and Japanese called it the verb "complete"
// (Terminer, Concluir, 完了) while their own Settings sentences said finition, acabamento, 仕上げ. The row's name is the word the
// sentences under it use, in every language (the stem, so Russian "отделки" counts as "Отделка").
const catalog = (code: string) => JSON.parse(fs.readFileSync(`src/i18n/${code}.json`, 'utf8')) as Record<string, string>;
test('the Finish row is named with the word its Settings sentences use', () => {
  for (const { code } of LOCALES) {
    const messages = catalog(code), stem = [...messages['appearancecontrols.finish'].toLocaleLowerCase(code)].slice(0, 5).join('');
    for (const id of ['core.restoreTheDefaultFinishScale', 'browsersettings.followsFinish', 'browsersettings.resetAppearanceDetail'])
      assert.ok(messages[id].toLocaleLowerCase(code).includes(stem), `${code}: "${messages['appearancecontrols.finish']}" is not the word in ${id}: ${messages[id]}`);
  }
});
