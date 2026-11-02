'use strict';

// Google Account pages must read the engine's real identity/fingerprint APIs.
// page-only identity/fingerprint wrappers disagree with unmodified web workers.
// This does not grant permissions, accept certificates or change session storage.
function googleAccountPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com'
      && !url.username && !url.password;
  } catch { return false; }
}

function nativeAuthenticationContext(topUrl, frameUrl = topUrl) {
  return googleAccountPage(topUrl) || googleAccountPage(frameUrl);
}

module.exports = { googleAccountPage, nativeAuthenticationContext };
