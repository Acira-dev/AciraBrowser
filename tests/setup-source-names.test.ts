import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { importedProfileName } = createRequire(import.meta.url)('../desktop/accounts/setup.cjs') as { importedProfileName: (source: { browser: string; name: string }, taken: string[]) => string };
// steps.tsx pulls in CSS, so the setup rule is read from its source (like the other setup source tests).
const setupRule = new RegExp(/const ownName = \(source: ImportSource\) => \(\/(.+)\/i\.test\(/.exec(fs.readFileSync('src/features/onboarding/steps.tsx', 'utf8'))![1], 'i');

// Zen names its own profile "Default (release)" (alpha and twilight channels likewise). That is a placeholder like Chrome's "Default",
// not something the person typed: the profile made from it is "Zen", and setup's first source never renames "Personal" to it.
test("a browser's placeholder profile name is not used as the Acira profile name, in setup and in the profile made from a source", () => {
  for (const [browser, name] of [['Zen', 'Default (release)'], ['Zen', 'Default (alpha)'], ['Zen', 'default (twilight)'], ['Firefox', 'Default'], ['Edge', 'Person 1'], ['Chrome', 'Profile 2']]) {
    assert.equal(importedProfileName({ browser, name }, ['Personal']), browser, `${browser} / ${name}`);
    assert.ok(setupRule.test(name), `setup treats ${name} as a placeholder`);
  }
  for (const name of ['Work', 'Default projects', 'Defaults']) {
    assert.equal(importedProfileName({ browser: 'Zen', name }, ['Personal']), name, name);
    assert.ok(!setupRule.test(name), `setup keeps ${name}`);
  }
});
