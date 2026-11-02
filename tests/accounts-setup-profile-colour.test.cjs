'use strict';
// Setup's profile step: a colour picked while the name field is empty used to be dropped (the avatar showed it, Continue
// kept the old colour), because commit() returned early on an empty name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const steps = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'onboarding', 'steps.tsx'), 'utf8');

test('the profile step saves a colour even when the name field is empty, keeping the current name', () => {
  assert.match(steps, /name: \(next\.name \?\? name\)\.trim\(\) \|\| saved\.current\.name, color: next\.color \?\? color/);
  assert.match(steps, /if \(!value\.name \|\| \(value\.name === saved\.current\.name && value\.color === saved\.current\.color\)\) return;/);
});

test('Escape skips setup from a focused radio, checkbox or switch, and stays with fields where text is typed', () => {
  const onboarding = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'onboarding', 'Onboarding.tsx'), 'utf8');
  const guard = /closest\?\.\("([^"]+)"\)\) return;\n\s*event\.preventDefault\(\);\n\s*void leave\(true\);/.exec(onboarding);
  assert.ok(guard, 'the Escape listener is in place');
  assert.match(guard[1], /textarea/);
  assert.match(guard[1], /select/);
  assert.match(guard[1], /input:not\(\[type=radio\],\[type=checkbox\]/, 'only inputs that are not choices keep Escape');
});

test('a profile whose stored name is longer than the form allows can still have its colour or photo saved', () => {
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'accounts', 'ProfileManager.tsx'), 'utf8');
  assert.match(manager, /const nameValid = name\.trim\(\)\.length > 0 && \(name\.trim\(\)\.length <= PROFILE_NAME_MAX \|\| name\.trim\(\) === profile\.name\);/);
  assert.match(manager, /const valid = nameValid && initialValid && emailValid;/);
});
