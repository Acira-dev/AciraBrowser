'use strict';
// Automatic extension updates (13.8), ported from Chromium's updater. Until 13.7 Acira updated a Web Store extension only when the person pressed
// "Check for update"; Chrome checks by itself.
//
// Ported from Chromium 152 (BSD-3-Clause, Copyright The Chromium Authors); the logic and its order:
//  - chrome/browser/extensions/updater/extension_updater.cc
//      Start(): "Check soon, and set up the first delayed check": CheckSoon() posts one task (the first check runs as soon as the updater starts, not after a
//      wait) and ScheduleNextCheck() arms the next one.
//      ScheduleNextCheck(): delay = frequency x (RandDouble() x 0.4 + 0.8), "Jitter the frequency by +/- 20%"; NextCheck() checks and schedules again.
//      The frequency is clamped to 30 s .. 7 days (the 30 s floor is enforced in release builds only); the default is 5 hours (kDefaultUpdateFrequency,
//      extension_service.cc passes it to ExtensionUpdater::InitAndEnable).
//      CheckNow(): every installed extension is a candidate; EraseUnupdatableIds() drops blocked extensions and any that is not in an auto-updatable location
//      (Manifest::IsAutoUpdateableLocation: an unpacked / loaded-from-folder extension never is).
//  - extensions/browser/delayed_install_manager.cc (DelayedInstallManager, with its install gates)
//      An update for an extension that is in use is not installed under it: it is held (delayed) and installed when the extension is idle, or at the next start
//      (FinishInstallationsDelayedByShutdown). The extension is told with runtime.onUpdateAvailable; Acira does not deliver that event yet (see the report).
//  - Permission increase: Chromium does not apply an update that asks for more access silently; the new version is held disabled until the person approves.
//    Here the update is not applied at all (the running version stays), a log line says why, and the manual "Check for update" row asks as it always did.
//
// This file is the scheduler only (no Electron, no network, no files): the manager (extension-manager.cjs) supplies what is installed and what an update does.

/** kDefaultUpdateFrequency: 5 hours. */
const DEFAULT_FREQUENCY_MS = 5 * 60 * 60 * 1000;
/** kMinUpdateFrequency / kMaxUpdateFrequency. */
const MIN_FREQUENCY_MS = 30 * 1000;
const MAX_FREQUENCY_MS = 7 * 24 * 60 * 60 * 1000;
/** How soon an update held because its extension is in use (or because another change was being reviewed) is looked at again. */
const RETRY_MS = 5 * 60 * 1000;

const clampFrequency = ms => Math.min(Math.max(Number.isFinite(ms) ? ms : DEFAULT_FREQUENCY_MS, MIN_FREQUENCY_MS), MAX_FREQUENCY_MS);
/** ScheduleNextCheck: the frequency jittered by +/- 20%. */
const nextDelay = (frequencyMs, random = Math.random) => Math.round(clampFrequency(frequencyMs) * (random() * 0.4 + 0.8));

/**
 * The saved extensions that may be updated by themselves: a Web Store extension (a verified store source; a local folder never) of an ordinary profile
 * (a private session has no updater of its own, as in Chromium: it runs the same installed extension), that is turned on.
 * `profileOrdinary(profileId)` says whether the profile is an ordinary, persistent one.
 */
function updatableEntries(saved, profileOrdinary) {
  return (Array.isArray(saved) ? saved : []).filter(entry => entry && entry.source === 'Chrome Web Store' && /^[a-p]{32}$/.test(String(entry.id)) && entry.enabled !== false && !!profileOrdinary(entry.profileId));
}

/**
 * deps:
 *   targets()        -> [{profileId, id}]   what to check now (updatableEntries of the manager's saved list)
 *   update(target, {signal}) -> Promise<result>   what the manager's update does; result is {upToDate}, {delayed, version}, {skipped, version, added?}, {error}, or the new list.
 *                                           `signal` is aborted when the updater is stopped or interrupted: the update's own request must end then.
 *   allowed()        -> boolean             a check may start now: false while the app is quitting or first-run setup is on screen (checked before EVERY check, retries included)
 *   alive()          -> boolean             false once the window that owns this updater is gone: the updater ends itself at its next tick and calls onStopped()
 *   onStopped()                             called after alive() turned false
 *   log(text) -> void
 *   frequencyMs, retryMs, random, setTimer, clearTimer   (tests)
 * Chromium's updater never holds up or races shutdown: it is destroyed with its browser process (ExtensionUpdater::Stop, a KeyedService), its fetchers go with it, and nothing is
 * started once shutdown has begun. Here that is allowed() before every check, interrupt() (abort what is in flight, drop the retries) when a quit begins, and stop() at the end.
 */
function createAutoUpdater({targets, update, log = () => {}, allowed = () => true, alive = () => true, onStopped = () => {}, frequencyMs = DEFAULT_FREQUENCY_MS, retryMs = RETRY_MS, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let started = false, timer = null, running = null, controller = new AbortController();
  const retries = new Map();      // `${profileId}|${id}` -> timer: an update held until the extension is idle
  const told = new Set();         // `${profileId}|${id}|${version}`: a skipped update is logged once, not every 5 hours
  const unref = handle => { try { handle && handle.unref && handle.unref(); } catch { /* a fake timer */ } return handle; };
  const keyOf = target => `${target.profileId}|${target.id}`;
  const permitted = () => { try { return started && alive() !== false && allowed() !== false; } catch { return false; } };
  const clearRetries = () => { for (const handle of retries.values()) clearTimer(handle); retries.clear(); };

  function say(target, result) {
    if (!result || typeof result !== 'object') return;
    if (result.skipped) {
      const mark = `${keyOf(target)}|${result.version || ''}|${result.skipped}`;
      if (told.has(mark)) return;
      told.add(mark);
      if (result.skipped === 'permissions') log(`Extension ${target.id} ${result.version || ''}: an update asks for new access (${(result.added || []).join(', ')}), so it was not installed automatically. The running version stays; use Check for update to review it.`);
      else log(`Extension ${target.id}: update skipped (${result.skipped}).`);
    } else if (result.delayed) log(`Extension ${target.id} ${result.version || ''}: an update is ready, but the extension is in use; it will be installed when it is idle or at the next start.`);
    else if (result.error) log(`Extension ${target.id}: automatic update failed: ${String(result.error).slice(0, 200)}`);
    else if (!result.upToDate) log(`Extension ${target.id}: updated automatically.`);
  }

  async function checkOne(target) {
    const {signal} = controller;
    let result;
    try { result = await update(target, {signal}); } catch (error) { result = {error: String((error && error.message) || error)}; }
    // Stopped or interrupted while it ran (a quit began): nothing is said, nothing is retried; what was in flight has already been aborted.
    if (signal.aborted) return result;
    say(target, result);
    // Held until the extension is idle (DelayedInstallManager) or until the person finishes what they were reviewing: look again soon, this one only.
    const hold = result && (result.delayed || (result.error && /being reviewed/i.test(String(result.error))));
    const key = keyOf(target);
    if (hold && permitted()) {
      if (!retries.has(key)) retries.set(key, unref(setTimer(() => { retries.delete(key); if (permitted()) void checkOne(target); }, retryMs)));
    }
    return result;
  }

  /** CheckNow(): one pass over everything that may be updated, one extension at a time (the manager makes one change at a time). Nothing starts when it is not permitted (quit, setup, window gone). */
  function checkNow() {
    if (running) return running;
    if (!permitted()) return Promise.resolve([]);
    running = (async () => {
      const results = [];
      let list = [];
      try { list = targets() || []; } catch { list = []; }
      for (const target of list) { if (!permitted()) break; results.push([target, await checkOne(target)]); }
      return results;
    })().finally(() => { running = null; });
    return running;
  }

  function scheduleNext() {
    timer = unref(setTimer(() => {
      timer = null;
      if (!started) return;
      if (alive() === false) { stop(); try { onStopped(); } catch { /* the owner's own bookkeeping */ } return; }
      void checkNow();
      scheduleNext();
    }, nextDelay(frequencyMs, random)));
  }

  /** What is in flight ends now and the held retries are dropped; the schedule stays (a quit that is called off resumes at the next tick). The signal each check was given is aborted. */
  function interrupt() {
    const old = controller;
    controller = new AbortController();
    clearRetries();
    try { old.abort(); } catch { /* nothing was listening */ }
  }
  function stop() {
    started = false;
    if (timer) clearTimer(timer);
    timer = null;
    clearRetries();
    try { controller.abort(); } catch { /* nothing was listening */ }
  }

  return {
    /** Start(): CheckSoon() (the first check, as soon as possible, unless a quit or the setup says no; `soon: false` arms only the delayed one) and the first delayed check. Once. */
    start({soon = true} = {}) {
      if (started) return false;
      started = true;
      controller = new AbortController();
      if (soon) unref(setTimer(() => { if (permitted()) void checkNow(); }, 0));
      scheduleNext();
      return true;
    },
    stop,
    interrupt,
    checkNow,
    get started() { return started; },
    pendingRetries: () => retries.size
  };
}

module.exports = {DEFAULT_FREQUENCY_MS, MIN_FREQUENCY_MS, MAX_FREQUENCY_MS, RETRY_MS, clampFrequency, nextDelay, updatableEntries, createAutoUpdater};
