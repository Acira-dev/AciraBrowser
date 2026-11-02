'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createSetupService } = require('../desktop/accounts/setup.cjs');
const { onboardingPatch } = require('../desktop/accounts/onboarding-flag.cjs');
const { fixture } = require('./accounts-helpers.cjs');

// The rating card could never appear: quietMoment() asks for settings.onboardingComplete, and nothing ever set it (a profile that had
// finished setup still had false). Main now keeps it in step with setup's own progress from every setup answer.
const context = { profileId: 'local-a', privateMode: false };

test('the flag follows setup: finished or skipped is true, running again is false, nothing changes when it already agrees', async (t) => {
  const service = createSetupService(fixture(t)), settings = { onboardingComplete: false };
  const apply = (response) => { const patch = onboardingPatch(response, settings); if (patch) Object.assign(settings, patch); return patch; };
  assert.equal(apply(await service.command({ type: 'status' }, context)), null, 'first run: setup not done, the flag stays false');
  assert.deepEqual(apply(await service.command({ type: 'finish' }, context)), { onboardingComplete: true });
  assert.equal(apply(await service.command({ type: 'status' }, context)), null, 'already true: no second write');
  assert.deepEqual(apply(await service.command({ type: 'restart' }, context)), { onboardingComplete: false }, 'Run setup again: no card while it runs');
  assert.deepEqual(apply(await service.command({ type: 'skip' }, context)), { onboardingComplete: true }, 'skipping setup also ends it');
});

test('a profile that finished setup before this existed gets the flag at its next start', async (t) => {
  // Setup finished on an older build: its progress was saved, the flag stayed false. The next launch's start-up status sets it.
  const f = fixture(t);
  await createSetupService(f).command({ type: 'finish' }, context);
  const nextLaunch = createSetupService(f);
  assert.deepEqual(onboardingPatch(await nextLaunch.command({ type: 'status' }, context), { onboardingComplete: false }), { onboardingComplete: true });
  // An installation older than the setup store (browser data, no progress file) counts as finished too.
  const upgraded = createSetupService({ ...fixture(t), existingInstallation: true });
  assert.deepEqual(onboardingPatch(await upgraded.command({ type: 'status' }, context), { onboardingComplete: false }), { onboardingComplete: true });
});

test('a profile made from another browser keeps the card away until its short setup is done; failures change nothing', () => {
  assert.deepEqual(onboardingPatch({ ok: true, progress: { complete: true, pendingSetup: true } }, { onboardingComplete: true }), { onboardingComplete: false });
  assert.deepEqual(onboardingPatch({ ok: true, progress: { complete: true, pendingSetup: false } }, { onboardingComplete: false }), { onboardingComplete: true });
  assert.equal(onboardingPatch({ ok: false, error: { code: 'PRIVATE_CONTEXT' } }, { onboardingComplete: false }), null);
  assert.equal(onboardingPatch(undefined, {}), null);
  assert.equal(onboardingPatch({ ok: true }, {}), null);
});

test('main applies it to the window start-up status and to every setup command', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /const syncOnboarding=r=>\{const patch=require\('\.\/accounts\/onboarding-flag\.cjs'\)\.onboardingPatch\(r,state\.settings\);if\(patch\)dispatch\(\{type:'settings\.update',patch\}\);return r;\};/);
  assert.match(main, /\.then\(r=>decide\(setupPending\(syncOnboarding\(r\)\)\),\(\)=>decide\(false\)\)/, 'start-up status');
  assert.match(main, /return created\.id;\}\}\)\.then\(syncOnboarding\);\}\);/, 'the acira:setup bridge');
  // The card's own rules are untouched: it still asks for the flag and the quiet moment.
  const moment = fs.readFileSync(path.join(__dirname, '../src/features/metrics/ratingMoment.ts'), 'utf8');
  assert.match(moment, /if \(privateWindow \|\| !state\.settings\.onboardingComplete\) return false;/);
});
