import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format } from '../src/i18n/format';
import { setMainLocale, tm } from '../src/i18n/main';

const read = (code: string) => readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8');
const en = JSON.parse(read('en')) as Record<string, string>;
const parameters = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?:,|\})/g)].map(match => match[1]))].sort();

for (const code of ['ar', 'tr', 'ru', 'ko', 'hi']) {
  test(`${code}: complete catalog, unique keys and preserved parameters`, () => {
    const raw = read(code), messages = JSON.parse(raw) as Record<string, string>;
    const keys = [...raw.matchAll(/^\s*"([^"]+)":/gm)].map(match => match[1]);
    assert.equal(keys.length, new Set(keys).size, 'duplicate JSON keys');
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort());
    for (const [id, text] of Object.entries(messages)) {
      assert.equal(typeof text, 'string', id);
      assert.ok(text.trim(), id);
      assert.ok(!text.includes('\uFFFD'), id);
      assert.deepEqual(parameters(text), parameters(en[id]), id);
      let depth = 0;
      for (const char of text) {
        if (char === '{') depth++;
        if (char === '}') depth--;
        assert.ok(depth >= 0, `${id}: unmatched closing brace`);
      }
      assert.equal(depth, 0, `${id}: unclosed brace`);
      for (const count of [0, 1, 2, 3, 5, 11, 21, 100, 1.5]) {
        const params = Object.fromEntries(parameters(text).map(name => [name, /\{\s*\w+,\s*plural,/.test(text) && new RegExp(`\\{${name},\\s*plural,`).test(text) ? count : `example-${name}`]));
        const rendered = format(code, text, params);
        assert.ok(rendered.trim(), `${id}: empty rendering at ${count}`);
        assert.ok(!/\{\w+(?:,|\})/.test(rendered), `${id}: unresolved parameter at ${count}`);
        assert.ok(!rendered.includes('NaN'), `${id}: invalid number at ${count}`);
      }
    }
  });
}

test('Arabic tab plural distinguishes dual, few and many', () => {
  const ar = JSON.parse(read('ar')) as Record<string, string>;
  assert.equal(format('ar', ar['plural.tabs'], { count: 0 }), 'لا توجد علامات تبويب');
  assert.equal(format('ar', ar['plural.tabs'], { count: 2 }), 'علامتا تبويب');
  const number = new Intl.NumberFormat('ar');
  assert.equal(format('ar', ar['plural.tabs'], { count: 3 }), `${number.format(3)} علامات تبويب`);
  assert.equal(format('ar', ar['plural.tabs'], { count: 11 }), `${number.format(11)} علامة تبويب`);
});

test('Rewind toast and physical split labels use whole localized messages', () => {
  for (const code of ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const catalog = JSON.parse(read(code)) as Record<string, string>;
    for (const count of [1, 2, 3, 11, 21]) {
      const toast = format(code, catalog['rewindpage.openedTabsInWindow'], { count });
      assert.ok(toast.trim(), code);
      assert.ok(!toast.includes('{'), code);
      if (code !== 'en') assert.doesNotMatch(toast, /\btab(s)?\b/, code);
    }
    const left = catalog['routinespage.leftTabLabel'], right = catalog['routinespage.rightTabLabel'];
    assert.ok(left && right && left !== right, code);
    assert.deepEqual(parameters(left), [], code);
    assert.deepEqual(parameters(right), [], code);
  }
});

test('native catalog source selects every new locale and formats the localized Rewind toast', () => {
  try {
    for (const code of ['ar', 'tr', 'ru', 'ko', 'hi']) {
      const catalog = JSON.parse(read(code)) as Record<string, string>;
      assert.equal(setMainLocale(code, 'en-US'), code);
      assert.equal(tm('routinespage.leftTabLabel'), catalog['routinespage.leftTabLabel']);
      assert.equal(tm('rewindpage.openedTabsInWindow', { count: 3 }), format(code, catalog['rewindpage.openedTabsInWindow'], { count: 3 }));
    }
  } finally { setMainLocale('en', 'en-US'); }
});
