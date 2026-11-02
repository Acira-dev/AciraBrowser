'use strict';
// Record native API references before the production preload, without making a
// WebAuthn request or opening a credential/security prompt.
const {webFrame}=require('electron');
void webFrame.executeJavaScript(`(() => {
  const key = window.PublicKeyCredential;
  window.__nativePasskeyBaseline = {
    platform: ${JSON.stringify(process.platform)},
    sandboxed: ${JSON.stringify(process.sandboxed)},
    get: CredentialsContainer.prototype.get,
    create: CredentialsContainer.prototype.create,
    conditional: key.isConditionalMediationAvailable,
    capabilities: key.getClientCapabilities,
    conditionalBefore: key.isConditionalMediationAvailable()
  };
})()`);
