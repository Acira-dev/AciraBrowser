import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { normalizeBrowserProfiles } from '../src/runtime/browserProfiles';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// beta.10, first run in another language. The first profile is made as "Personal" before the setup knows its language, so a German, Japanese or
// Arabic setup opened on a name field that said "Personal" (and Skip setup kept it): the profile chip, the spaces and the summary all said
// "Personal". The profile now remembers the name Acira gave it (defaultName); while nobody has named it, the first setup gives it its language's
// word, silently. When that setup ends the name is the person's: a later language or "Run setup again" never renames it, nor a profile from
// before this (no defaultName), nor one the person named "Personal" themselves.
const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');
const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const ID = 'profile-personal';
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce((s, action) => { validateAction(action, s); return reduceBrowser(s, action); }, state);
const own = (state: BrowserSnapshot) => state.browserProfiles.find(profile => profile.id === ID)!;
const localize = (name: string): BrowserAction => ({ type: 'browser.profile.rename', id: ID, name, defaultName: true });
const settle: BrowserAction = { type: 'browser.profile.update', id: ID, defaultName: null };

test('a fresh profile takes the setup language\'s word silently, again on a language change, and never once setup has ended', () => {
  const fresh = createInitialState();
  assert.deepEqual([own(fresh).name, own(fresh).defaultName], ['Personal', 'Personal'], 'the runtime records that it chose the name');
  const german = run(fresh, localize('Persönlich'));
  assert.deepEqual([own(german).name, own(german).defaultName], ['Persönlich', 'Persönlich']);
  assert.equal(german.toast, fresh.toast, 'no toast: nobody renamed anything');
  const french = run(german, localize('Personnel'));
  assert.equal(own(french).name, 'Personnel', 'the language changed before setup ended: still the default, so it follows');
  const ended = run(french, settle);
  assert.equal(own(ended).defaultName, undefined, 'setup is over: the name is the person\'s');
  assert.equal(own(run(ended, localize('個人用'))).name, 'Personnel', '"Run setup again" in Japanese leaves it');
});

test('a name the person gave, or a profile from before this, is never renamed by the setup', () => {
  const named = run(createInitialState(), { type: 'browser.profile.rename', id: ID, name: 'Personal' });
  assert.equal(own(named).defaultName, undefined, 'typing "Personal" on purpose makes it theirs');
  assert.equal(own(run(named, localize('Persönlich'))).name, 'Personal');
  const older = createInitialState(); delete own(older).defaultName;
  assert.equal(own(run(older, localize('Persönlich'))).name, 'Personal', 'an existing user\'s profile has no default name');
  const imported = createInitialState(); own(imported).name = 'Chrome · Work';
  assert.equal(own(run(imported, localize('Persönlich'))).name, 'Chrome · Work', 'renamed some other way: no longer the default');
});

test('the person\'s own rename says so in their language (a message id, not English text)', () => {
  const renamed = run(createInitialState(), { type: 'browser.profile.rename', id: ID, name: 'Studio' });
  assert.deepEqual(renamed.toast?.i18n, { id: 'runtime.profileRenamed', params: { name: 'Studio' } });
  for (const file of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const text = JSON.parse(read(`src/i18n/${file}.json`))['runtime.profileRenamed'];
    assert.ok(typeof text === 'string' && text.includes('{name}'), file);
  }
  const tooLong = run(createInitialState(), { type: 'browser.profile.rename', id: ID, name: 'x'.repeat(40) });
  assert.equal(own(tooLong).name, 'x'.repeat(40));
});

test('main accepts only the two default-name forms, and a restart keeps the record', () => {
  const s = createInitialState();
  assert.throws(() => validateAction({ type: 'browser.profile.rename', id: ID, name: 'Persönlich', defaultName: false }, s));
  assert.throws(() => validateAction({ type: 'browser.profile.update', id: ID, defaultName: 'Persönlich' }, s));
  assert.doesNotThrow(() => validateAction(settle, s));
  const [kept] = normalizeBrowserProfiles([{ ...own(s), defaultName: 'Persönlich', name: 'Persönlich' }], []);
  assert.equal(kept.defaultName, 'Persönlich', 'a setup resumed after a restart still knows');
  const [dropped] = normalizeBrowserProfiles([{ ...own(s), defaultName: 'x'.repeat(41) }], []);
  assert.equal(dropped.defaultName, undefined);
});

test('the setup does it: named on the way in and on a language change, settled on the way out; a new profile\'s short setup never', () => {
  const onboarding = read('src/features/onboarding/Onboarding.tsx');
  assert.match(onboarding, /if \(!quick && ownProfile && hasDefaultName\(ownProfile\) && ownProfile\.name !== localDefaultName\) nameDefaultProfile\(dispatch, ownProfile\.id, localDefaultName\);\s*\}, \[quick, ownProfile\?\.id, ownProfile\?\.name, ownProfile\?\.defaultName, localDefaultName, dispatch\]\);/);
  assert.match(onboarding, /localDefaultName = t\("setup\.personal"\)/);
  const leave = onboarding.slice(onboarding.indexOf('const leave = async'), onboarding.indexOf('void client.request({ type: "finish" })'));
  assert.ok(leave.indexOf('if (quick) {') < leave.indexOf('if (ownProfile?.defaultName) settleProfileName(dispatch, ownProfile.id);'), 'skip, defaults and finish settle it; quick returns first');
  assert.ok(leave.indexOf('settleProfileName') < leave.indexOf('if (skip) {'));
  assert.match(read('src/features/onboarding/steps.tsx'), /const \[name, setName\] = useState\(profile\?\.name \|\| ""\);/, 'the field shows the profile\'s own name');
});

// beta.10, first run in Arabic: Get started, Continue and Start browsing kept their arrow pointing right, which is back in a right-to-left
// layout (the Connection row's chevron and the cover row's arrow already turn).
test('right to left, the setup\'s forward arrows point left, and their hover nudge goes left too', () => {
  const css = read('src/features/onboarding/onboarding.css');
  assert.match(css, /\.fr-btn:dir\(rtl\) \.fr-arrow,\s*\.fr-go:dir\(rtl\) svg \{\s*scale: -1 1;\s*\}/);
  assert.match(css, /\.fr-btn:hover:not\(:disabled\) \.fr-arrow \{\s*transform: translateX\(2px\);/, 'the nudge is a transform, which `scale` mirrors');
  assert.match(read('src/features/onboarding/Onboarding.tsx'), /<svg className="fr-arrow"/);
  assert.match(read('src/features/onboarding/Welcome.tsx'), /<button className="fr-primary fr-go"[^>]*>\s*\{t\("setup\.welcome\.start"\)\}\s*<ArrowRight size=\{14\} \/>/);
});
