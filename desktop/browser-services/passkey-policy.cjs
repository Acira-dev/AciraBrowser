'use strict';
// "Passkeys and security keys" (28 Oct), the main process's half. What Electron 44 (Chromium 152) lets an app do about WebAuthn: nothing
// direct. There is no API, event or session permission for it (setPermissionRequestHandler's names have no 'webauthn'; 'hid' and 'usb'
// are the WebHID/WebUSB pickers, a different path), and the engine reaches Windows' passkey dialog (webauthn.dll) from the browser
// process. A process-wide switch (--disable-features / --disable-blink-features) is read once at start-up, so it would need a restart
// and would make "on" impossible while the app runs; a CDP virtual authenticator would need a debugger attached to every tab. What the
// engine does honour, per frame, is the Permissions-Policy of the document: with publickey-credentials-get / -create denied, Blink
// rejects navigator.credentials.get / create with NotAllowedError ("feature is not enabled in this document") in that frame and every
// child frame (a policy only narrows going down). So while the choice is off every web document response carries that header. The
// passkey guard preload (every frame) answers open pages at once and is the first line; this is the backstop for anything that slips
// past a preload (a blob: or script-made frame, a navigation that wins a race). A page loaded while it was off keeps the header until
// its next navigation, so turning the choice on reaches it after a reload (the Settings row says so); turning it off needs no reload
// because the guard reads the choice at every call. qa/passkey-setting-proof.mjs checks document.featurePolicy in real pages.
const DENY = 'publickey-credentials-get=(), publickey-credentials-create=()';

/** A header patch for onHeadersReceived: `{}` when nothing changes, else `{responseHeaders}` with the deny directives appended last (the later member of a repeated Permissions-Policy key wins). */
function passkeyPolicyPatch(details, allowed) {
  if (allowed) return {};
  if (!details || (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame')) return {};
  if (!/^https?:/i.test(String(details.url || '')) || !details.responseHeaders) return {};
  const headers = { ...details.responseHeaders };
  const name = Object.keys(headers).find(key => key.toLowerCase() === 'permissions-policy') || 'Permissions-Policy';
  headers[name] = [...[].concat(headers[name] || []), DENY];
  return { responseHeaders: headers };
}

module.exports = { passkeyPolicyPatch, DENY };
