'use strict';
// The feature-rating card (src/features/metrics/ratingMoment.ts quietMoment) never asks while settings.onboardingComplete is false, and nothing
// ever set it: setup keeps its own progress (accounts/onboarding.cjs). Main keeps the setting in step with that progress from every setup answer
// (the window's start-up status and each setup command): true once setup is finished or skipped, which an installation that finished setup
// before this existed already reports, and false again while setup runs anew or a profile made from another browser still has its short setup.
// Setup itself still never writes settings (tests/accounts-onboarding.test.cjs).

/** The settings patch that brings onboardingComplete in line with a setup answer, or null when it already is (or the answer has no progress). */
function onboardingPatch(response, settings) {
  const progress = response && response.ok ? response.progress : null;
  if (!progress || typeof progress.complete !== 'boolean') return null;
  const done = progress.complete === true && progress.pendingSetup !== true;
  return Boolean(settings && settings.onboardingComplete) === done ? null : { onboardingComplete: done };
}

module.exports = { onboardingPatch };
