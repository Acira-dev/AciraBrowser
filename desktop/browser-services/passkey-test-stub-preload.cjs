'use strict';
// Test only. content-blocking.cjs registers this before the passkey guard, and only when ACIRA_BROWSER_TEST_DATA is set and
// ACIRA_TEST_PASSKEY_STUB=1. It replaces the browser's passkey calls with recorders, so real-app QA (qa/passkey-dialog-guard.mjs) sees
// what the guard lets through without ever reaching Windows' passkey dialog (webauthn.dll). window.__passkeyStubCalls lists them;
// a page that does not find it makes no passkey call at all.
const {webFrame}=require('electron');
const STUB=`(() => {
  try {
    const proto = CredentialsContainer.prototype, calls = [];
    const record = name => function (options) { calls.push(name + (options && options.mediation ? ':' + options.mediation : '')); return Promise.resolve('STUBBED'); };
    Object.defineProperty(proto, 'get', { value: record('get'), writable: true, configurable: true, enumerable: true });
    Object.defineProperty(proto, 'create', { value: record('create'), writable: true, configurable: true, enumerable: true });
    // Only once both calls are stubbed does the page learn it may make passkey requests.
    Object.defineProperty(window, '__passkeyStubCalls', { value: calls });
  } catch (error) { /* No credentials here. */ }
})();`;
if(/^https?:/.test(location.href)||location.href==='about:srcdoc'){
 try{void webFrame.executeJavaScript(STUB);}catch{/* A closing window. */}
}
