import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameTaken, takenName } from '../src/ui/nameTaken';

// Settings > Search accepted a second engine named "Google" (two "Google" rows in the default-engine menu), and Settings > Profiles
// a second "Personal" (or a rename to "PERSONAL"). Both are now refused with a message.
test('a name is taken when another one matches it, ignoring spaces round it and letter case', () => {
  assert.equal(nameTaken('google ', ['Google', 'Bing']), true);
  assert.equal(nameTaken('PERSONAL', ['Personal']), true);
  assert.equal(nameTaken('Work', ['Personal', 'Workshop']), false);
  assert.equal(nameTaken('   ', ['   ']), false, 'an empty name is the other rule (Save stays off)');
  assert.equal(nameTaken('École', ['école']), true);
  assert.equal(takenName('personal ', ['Work', 'Personal']), 'Personal', 'the message names the one that exists, as it is written');
  assert.equal(takenName('Workshop', ['Work']), undefined);
});

test('the search engine form refuses a name already in the list, with a message', () => {
  const source = readFileSync('src/features/settings/panels/search-engines.tsx', 'utf8');
  assert.match(source, /const taken = takenName\(form\.name, providers\.engines\.map\(\(item\) => item\.name\)\);\n    if \(taken\) \{ setError\(t\("searchEngines\.nameTaken", \{ name: taken \}\)\); return; \}/);
});

test('the profile forms refuse another profile\'s name, and keep an old shared name that is left alone', () => {
  const source = readFileSync('src/features/accounts/ProfileManager.tsx', 'utf8');
  assert.match(source, /const taken = name\.trim\(\) !== profile\.name \? takenName\(name, otherNames\) : undefined;/, 'edit: only a changed name is checked');
  assert.match(source, /if \(!dirty \|\| !valid \|\| taken\) return;/);
  assert.match(source, /disabled=\{!dirty \|\| !valid \|\| Boolean\(taken\)\}/);
  assert.match(source, /otherNames=\{profiles\.filter\(\(other\) => other\.id !== profile\.id\)\.map\(\(other\) => other\.name\)\}/);
  assert.match(source, /const taken = takenName\(name, profiles\.map\(\(profile\) => profile\.name\)\);/, 'create');
  assert.match(source, /const valid = name\.trim\(\)\.length > 0 && name\.trim\(\)\.length <= PROFILE_NAME_MAX && !taken;/);
  assert.equal(source.split('className="pm-problem pm-name-taken" role="alert">{t("profiles.nameTaken", { name: taken })}</small>}').length - 1, 2, 'one line under Name in both forms, naming the profile that has it');
  const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
  assert.equal(en['profiles.nameTaken'], 'There is already a profile named {name}.');
  assert.equal(en['searchEngines.nameTaken'], 'There is already an engine named {name}. Choose another name.');
});
