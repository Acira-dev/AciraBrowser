'use strict';
// Main-process glue for the live pull requests folder: which source a profile gets, and the seven requests the interface may make.
// Everything else (settings, timers, rules) lives in service.cjs, model.cjs and refresh.cjs, which know nothing of Electron.
const fs = require('node:fs');
const path = require('node:path');
const { createGithubSessionSource, sessionRequest } = require('./github-session.cjs');
const { mockSourceFor } = require('./mock.cjs');
const { sharedLivePrs } = require('./service.cjs');

/** `ACIRA_TEST_LIVE_PRS_TRACE=<file inside the test profile>`: one JSON line per GitHub answer (status, how it was read, counts, field names; never titles). A test hook, for the first signed-in check. */
function traceTo(env) {
  const file = env.ACIRA_BROWSER_TEST_DATA && env.ACIRA_TEST_LIVE_PRS_TRACE ? path.resolve(env.ACIRA_TEST_LIVE_PRS_TRACE) : '';
  const root = env.ACIRA_BROWSER_TEST_DATA ? path.resolve(env.ACIRA_BROWSER_TEST_DATA) + path.sep : '';
  if (!file || !file.startsWith(root)) return undefined;
  return (line) => fs.appendFileSync(file, JSON.stringify(line) + '\n');
}

let shared = null;
const SIGN_IN_COOKIE = 'logged_in';
const watchedProfiles = new Set();

/**
 * The one service of this process. `ACIRA_TEST_LIVE_PRS` (mock, mock:empty, mock:signed-out ...) swaps the source for fake data; it is a
 * test hook (desktop/test-hooks.cjs drops it in a real run on the person's own profile).
 * @param {{directory: string, session: any, env?: Record<string, string|undefined>}} options
 */
function livePrsService({ directory, session, env = process.env }) {
  return (shared ??= sharedLivePrs({
    file: path.join(directory, 'live-prs.json'),
    sourceFor: (profile) => {
      if (env.ACIRA_BROWSER_TEST_DATA && /^mock(:[a-z-]+)?$/.test(env.ACIRA_TEST_LIVE_PRS || '')) return mockSourceFor(env.ACIRA_TEST_LIVE_PRS);
      const ses = session.fromPartition(profile.partition);
      // Signing in to github.com in this profile starts a folder that was waiting signed out (the cookie's name, never its value).
      if (!watchedProfiles.has(profile.id)) {
        watchedProfiles.add(profile.id);
        try { ses.cookies.on('changed', (_event, cookie, _cause, removed) => { if (!removed && cookie.name === SIGN_IN_COOKIE && /(^|\.)github\.com$/.test(cookie.domain || '')) shared?.noteSignedIn(profile.id); }); } catch { /* no cookie events: "Check again" still works */ }
      }
      return createGithubSessionSource({ request: sessionRequest(ses), trace: traceTo(env) });
    },
    warn: (message) => console.warn(message),
  }));
}

/** The folder is for ordinary windows of ordinary profiles: not private, not Tor, not a secured workspace. */
function supportedHere({ state, privateMode, torMode }) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  if (!profile || profile.private || profile.tor || privateMode || torMode) return null;
  const workspace = state.workspaces?.find((item) => item.id === state.activeWorkspaceId);
  if (workspace?.secured) return null;
  return profile;
}

/**
 * @param {{type: string, patch?: object, name?: string, id?: string}} request
 * @param {{service: ReturnType<typeof sharedLivePrs>, state: any, privateMode: boolean, torMode: boolean, listener: {emit: Function, alive: () => boolean, visible: () => boolean}}} context
 */
function handle(request, { service, state, privateMode, torMode, listener }) {
  const profile = supportedHere({ state, privateMode, torMode });
  const own = profile && { id: profile.id, name: profile.name, partition: profile.partition };
  switch (request.type) {
    case 'live-prs.status':
      return { livePrs: own ? service.watch(own, listener) : { supported: false, folder: null } };
    case 'live-prs.add':
      if (!own) throw new Error('Live pull requests are for ordinary windows.');
      return { livePrs: service.add(own, listener) };
    case 'live-prs.remove':
      return { livePrs: own ? service.remove(own) : { supported: false, folder: null } };
    case 'live-prs.filters':
      if (!own) throw new Error('Live pull requests are for ordinary windows.');
      return { livePrs: service.setFilters(own, request.patch) };
    case 'live-prs.rename':
      if (!own) throw new Error('Live pull requests are for ordinary windows.');
      return { livePrs: service.rename(own, request.name) };
    case 'live-prs.hide':
      if (!own) throw new Error('Live pull requests are for ordinary windows.');
      return { livePrs: service.hide(own, request.id) };
    case 'live-prs.refresh':
      if (!own) throw new Error('Live pull requests are for ordinary windows.');
      return { livePrs: service.refresh(own) };
    default:
      throw new Error('Unknown live pull requests request.');
  }
}

/** The service if this process already made one (a window that never asked has none; nothing is made just to be told about a page). */
const peek = () => shared;

module.exports = { handle, livePrsService, supportedHere, peek };
