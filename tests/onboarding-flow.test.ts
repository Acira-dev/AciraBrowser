import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeMoves, nextStep, panelSteps, setupSteps, visibleSteps } from '../src/features/onboarding/flow';

test('setup opens on the welcome, ends on the finish, and the panel holds everything between', () => {
  assert.equal(setupSteps[0], 'welcome');
  assert.equal(setupSteps.at(-1), 'finish');
  assert.deepEqual(panelSteps, ['import', 'profile', 'appearance', 'cover', 'search', 'privacy', 'default']);
});

test('import is skipped only when detection found nothing', () => {
  assert.equal(nextStep('welcome', 1, {}), 'import');
  assert.equal(nextStep('welcome', 1, { sources: [] }), 'profile');
  assert.equal(nextStep('welcome', 1, { sources: [{}] }), 'import');
  assert.equal(nextStep('profile', -1, { sources: [] }), 'welcome');
});

test('default browser is skipped when unsupported or already the default', () => {
  assert.equal(nextStep('privacy', 1, { defaultSupported: true }), 'default');
  assert.equal(nextStep('privacy', 1, { defaultSupported: false }), 'finish');
  assert.equal(nextStep('privacy', 1, { defaultSupported: true, defaultIsDefault: true }), 'finish');
  assert.equal(nextStep('finish', -1, { defaultSupported: false }), 'privacy');
});

test('the flow stays put at both ends and counts native moves', () => {
  assert.equal(nextStep('welcome', -1, {}), 'welcome');
  assert.equal(nextStep('finish', 1, {}), 'finish');
  assert.equal(nativeMoves('welcome', 'profile'), 2);
  assert.equal(nativeMoves('profile', 'welcome'), -2);
  assert.equal(nativeMoves('profile', 'profile'), 0);
});

test('progress shows only steps that can appear', () => {
  assert.equal(visibleSteps({}).length, panelSteps.length);
  assert.deepEqual(visibleSteps({ sources: [], defaultSupported: false }), ['profile', 'appearance', 'cover', 'search', 'privacy']);
});


test('late empty discovery keeps a presented import step in progress, without repeating step one', () => {
  const presented = new Set<typeof setupSteps[number]>(['import']);
  const facts = { sources: [], defaultSupported: false };
  const shown = visibleSteps(facts, presented);
  assert.equal(shown.indexOf('import') + 1, 1);
  assert.equal(shown.indexOf('profile') + 1, 2);
  assert.equal(nextStep('import', 1, facts), 'profile');
  assert.equal(nextStep('welcome', 1, facts), 'profile');
});

test('becoming the default while its step is visible keeps a valid last-step counter', () => {
  const facts = { sources: [], defaultSupported: true, defaultIsDefault: true };
  const presented = new Set<typeof setupSteps[number]>(['default']);
  const shown = visibleSteps(facts, presented);
  assert.equal(shown.indexOf('default') + 1, shown.length);
  assert.equal(nextStep('default', 1, facts), 'finish');
  assert.equal(visibleSteps(facts).includes('default'), false);
});
