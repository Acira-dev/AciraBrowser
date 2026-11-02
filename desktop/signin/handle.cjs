'use strict';
// Main-process glue for the "Sign back in" checklist: gathers what the pure service needs from the window's state, the
// password vault's hosts and Acira's own cookie jar (names only), and runs the four requests.
const path = require('node:path');
const { createSignin } = require('./service.cjs');

let shared = null;
const sharedSignin = (directory) => (shared ??= createSignin({ file: path.join(directory, 'signin.json') }));

const ID = /^(site:[a-z0-9.-]{3,253}|[a-z][a-z0-9-]{1,30})$/;

/** Cookie names and domains of one profile's own session. Values are never read into the result. */
async function ownCookieNames(session, profile) {
  try {
    const jar = session.fromPartition(profile.partition).cookies;
    return (await jar.get({})).map((cookie) => ({ domain: cookie.domain, name: cookie.name }));
  } catch { return []; }
}

/**
 * @param {{type: string, id?: string, status?: string, dismissed?: boolean, refresh?: boolean}} request
 * @param {{service: ReturnType<typeof createSignin>, state: any, dispatch: (action: any) => void, vault: {list: (profileId: string) => Array<{origin: string}>}, session: any}} context
 */
async function handle(request, { service, state, dispatch, vault, session }) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  if (!profile || profile.private || profile.tor) throw new Error('Sign-in help is for ordinary profiles.');
  const profileId = profile.id;
  const origins = () => { try { return vault.list(profileId).map((item) => item.origin); } catch { return []; } };
  const gather = async (extra = {}) => {
    const visits = state.browsingHistory.filter((visit) => visit.browserProfileId === profileId);
    const marks = state.bookmarkNodes.filter((node) => node.browserProfileId === profileId && node.url);
    const passwordOrigins = origins();
    return {
      visits,
      bookmarks: marks.map((node) => node.url),
      passwordOrigins,
      cookies: await ownCookieNames(session, profile),
      tabUrls: state.tabs.filter((tab) => tab.browserProfileId === profileId).map((tab) => tab.url),
      // Offered after something was brought over: imported history or bookmarks, or saved passwords.
      eligible: visits.some((visit) => visit.importBatchId) || marks.some((node) => node.importBatchId) || passwordOrigins.length > 0,
      ...extra,
    };
  };
  const id = () => {
    if (typeof request.id !== 'string' || !ID.test(request.id)) throw new Error('Choose a site from the list.');
    return request.id;
  };
  switch (request.type) {
    case 'signin.plan':
      return { signin: service.plan(profileId, await gather({ refresh: request.refresh === true })) };
    case 'signin.open': {
      const { url } = service.open(profileId, id(), await gather());
      // The official sign-in page, in a new tab of this profile.
      dispatch({ type: 'tab.new', url });
      return { signin: service.plan(profileId, await gather()) };
    }
    case 'signin.mark':
      service.mark(profileId, id(), request.status);
      return { signin: service.plan(profileId, await gather()) };
    case 'signin.dismiss':
      if (typeof request.dismissed !== 'boolean') throw new Error('Choose dismissed or not.');
      service.dismiss(profileId, request.dismissed);
      return { signin: service.plan(profileId, await gather()) };
    default:
      throw new Error('Unknown sign-in request.');
  }
}

module.exports = { handle, sharedSignin, ownCookieNames };
