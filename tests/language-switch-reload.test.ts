import assert from 'node:assert/strict';
import test from 'node:test';

// Settings › Languages reloads each view into the chosen language; a guard stops a reload loop (the same language failing to stick).
// Every snapshot reaches applyLanguageSetting (main.tsx subscribes), so several can arrive before the old page unloads: each must not
// count as another reload, and a language that did load must not keep its count, or someone switching back and forth is refused
// and the view later reloads out of the blue. Each "page" below is a fresh copy of the module, as a reload gives.
const store = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, String(value)); }, removeItem: (key: string) => { items.delete(key); }, clear: () => items.clear() }; };
const reloads: string[] = [];
const local = store(), session = store();
Object.assign(globalThis, { localStorage: local, sessionStorage: session, location: { reload: () => { reloads.push(local.getItem('acira-locale') || ''); } } });
type I18n = { initLocale: () => Promise<void>; applyLanguageSetting: (setting: string | undefined) => Promise<void>; currentLocale: () => string };
let loads = 0;
/** A page load: a new module instance, which starts in the cached language (or, `stuck`, fails to and stays English). */
const load = async (stuck = false): Promise<I18n> => {
  if (stuck) local.setItem('acira-locale', 'en');
  const page = await import(new URL('../src/i18n/index.ts', import.meta.url).href + `?load=${++loads}`) as I18n;
  await page.initLocale();
  return page;
};
const reset = () => { reloads.length = 0; session.clear(); local.clear(); };

test('several snapshots before the old page unloads reload it once', async () => {
  reset();
  const page = await load();
  for (let i = 0; i < 5; i++) await page.applyLanguageSetting('de');
  assert.deepEqual(reloads, ['de']);
  const next = await load();
  assert.equal(next.currentLocale(), 'de');
  for (let i = 0; i < 5; i++) await next.applyLanguageSetting('de');
  assert.deepEqual(reloads, ['de'], 'the new page is already in German: nothing more');
});

test('switching back and forth within a minute keeps working', async () => {
  reset();
  let page = await load();
  const order = ['ar', 'en', 'ar', 'en', 'ar', 'en', 'ar', 'en', 'de', 'ru', 'ar', 'fr'];
  for (const language of order) {
    await page.applyLanguageSetting(language); await page.applyLanguageSetting(language);
    page = await load();
    assert.equal(page.currentLocale(), language, `${language} applied`);
  }
  assert.deepEqual(reloads, order);
});

test('the same language that never sticks stops reloading after three tries a minute', async () => {
  reset();
  let page = await load();
  for (let i = 0; i < 5; i++) { await page.applyLanguageSetting('ja'); page = await load(true); }
  assert.deepEqual(reloads, ['ja', 'ja', 'ja']);
});
