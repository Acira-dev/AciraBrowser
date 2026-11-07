'use strict';
// A quiet first run. Until first-run setup is finished or skipped, Acira's own scheduled downloads wait here: the ad, tracker, phishing and
// malware lists, the reviewed-sites list, the Widevine install and the update check. Nothing in them is about the person, but setup says
// "no tracking" while it is still on screen, so a network monitor should see nothing from Acira until the person has been asked.
// Only what Acira starts by itself waits. Whatever the person does (a search, "Check for updates", adding an extension, setup's own
// choices) is never held, and neither is the anonymous usage message: that one is the person's own answer on setup's privacy step.
//
// The gate starts OPEN, so every module that uses it behaves as before when nothing holds it (tests, a profile whose setup is long done).
// main.cjs holds it at start-up when setup is still to come (setupDue) and releases it when setup's own progress says it is complete
// (accounts/onboarding-flag.cjs path in main.cjs), or when that progress cannot be read at all, so a damaged setup file can never leave
// the lists and updates off for good.
const fs = require('node:fs'), path = require('node:path');

/**
 * True while a first-run setup is still to come: no browser data yet, or setup's own file says it is neither finished, skipped nor an
 * upgrade of an older install. The same test the start-up splash uses. Read it BEFORE the browser database is created (a first run is
 * "no database yet"), which is why main.cjs calls it as the very first thing once Electron is ready.
 */
function setupDue(userData, io = fs) {
  if (!['browser.sqlite', 'browser-state.json'].some((file) => io.existsSync(path.join(userData, file)))) return true;
  try {
    const installation = JSON.parse(io.readFileSync(path.join(userData, 'setup', 'onboarding.json'), 'utf8')).installation;
    return !!installation && !installation.complete && !installation.skipped && !installation.upgraded;
  } catch { return false; }
}

/** `after(job)` runs the job now when the gate is open and as soon as it opens otherwise; each job runs once. */
function createSetupGate({ open = true } = {}) {
  let isOpen = open;
  let waiting = [];
  const run = (job) => { try { job(); } catch { /* one job's failure must not stop the others */ } };
  return {
    get isOpen() { return isOpen; },
    /** Close the gate (only before anything has been released). */
    hold() { isOpen = false; },
    /** Open it and start everything that waited, in the order it was queued. Safe to call again. */
    release() {
      if (isOpen) return;
      isOpen = true;
      const jobs = waiting; waiting = [];
      for (const job of jobs) run(job);
    },
    after(job) { if (isOpen) run(job); else waiting.push(job); },
    get waiting() { return waiting.length; },
  };
}

/** The one gate of this app. */
const setupGate = createSetupGate();

/** Does this answer of the setup service say that setup is finished or skipped? (The same shape accounts/onboarding-flag.cjs reads.) */
const setupFinished = (response) => !!(response && response.ok && response.progress && response.progress.complete === true);

module.exports = { setupDue, createSetupGate, setupGate, setupFinished };
