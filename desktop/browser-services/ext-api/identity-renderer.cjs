'use strict';
// chrome.identity (P9), extension pages and workers: Chromium's schema (AccountStatus, argument checks, promise and callback forms) over the
// main side. getRedirectURL is computed here, as in Chrome: https://<extension id>.chromiumapp.org/<path>.
module.exports = {
  namespaces: ['identity'],
  renderer(acira) {
    const root = 'https://' + acira.extensionId + '.chromiumapp.org/';
    return {
      identity: {
        factory: () => acira.build('identity', {
          functions: {
            getRedirectURL: path => { try { return new URL(typeof path === 'string' ? path : '', root).href; } catch (e) { return root; } },
            launchWebAuthFlow: details => acira.call('identity.launchWebAuthFlow')(details),
            getAuthToken: details => acira.call('identity.getAuthToken')(details || {}),
            getProfileUserInfo: details => acira.call('identity.getProfileUserInfo')(details || {}),
            removeCachedAuthToken: details => acira.call('identity.removeCachedAuthToken')(details),
            clearAllCachedAuthTokens: () => acira.call('identity.clearAllCachedAuthTokens')(),
            getAccounts: () => acira.call('identity.getAccounts')()
          },
          events: {onSignInChanged: acira.event('identity.onSignInChanged')}
        })
      }
    };
  }
};
