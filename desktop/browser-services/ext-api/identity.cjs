'use strict';
// chrome.identity (P9), main side. Acira has no Google account in the browser, so the Google-account members answer what Chrome answers
// while signed out (identity_get_auth_token_function.cc, identity_constants.cc), in Chrome's order:
//   getAuthToken: a manifest without oauth2.client_id -> "Invalid OAuth2 Client ID."; without scopes -> "Invalid OAuth2 scopes.";
//                 otherwise "The user is not signed in." (interactive or not: there is no sign-in to offer)
//   getProfileUserInfo -> {email: '', id: ''};  removeCachedAuthToken / clearAllCachedAuthTokens -> nothing to remove;  getAccounts -> [].
// launchWebAuthFlow (the flow non-Google sign-ins use: GitHub, Auth0, Microsoft ...) is answered by the older handler in extension-apis.cjs
// (createIdentity: Acira's sign-in window, interception of https://<id>.chromiumapp.org/…); this package keeps it and adds nothing to it.
const MESSAGES = {
  clientId: 'Invalid OAuth2 Client ID.',
  scopes: 'Invalid OAuth2 scopes.',
  notSignedIn: 'The user is not signed in.'
};

/** The error getAuthToken answers for this extension while no account is signed in. */
function authTokenError(manifest, details) {
  const oauth2 = manifest && typeof manifest.oauth2 === 'object' && manifest.oauth2 ? manifest.oauth2 : {};
  if (typeof oauth2.client_id !== 'string' || !oauth2.client_id) return MESSAGES.clientId;
  const asked = details && Array.isArray(details.scopes) && details.scopes.length ? details.scopes : oauth2.scopes;
  if (!Array.isArray(asked) || !asked.some(scope => typeof scope === 'string' && scope)) return MESSAGES.scopes;
  return MESSAGES.notSignedIn;
}

module.exports = {
  namespaces: ['identity'],
  MESSAGES,
  authTokenError,
  install(api) {
    api.handle('identity.getAuthToken', (event, details) => { throw new Error(authTokenError(event.extension && event.extension.manifest, details)); });
    api.handle('identity.getProfileUserInfo', () => ({email: '', id: ''}));
    api.handle('identity.removeCachedAuthToken', () => undefined);
    api.handle('identity.clearAllCachedAuthTokens', () => undefined);
    api.handle('identity.getAccounts', () => []);
    // identity.launchWebAuthFlow stays with extension-apis.cjs (its handler is already on the router); the permission check runs there.
  }
};
