'use strict';
// "Add to Acira" on Chrome Web Store detail pages. The store's own "Add to Chrome" button needs Chrome's private install API, so it stays disabled here.
// A small bar drawn by store-bar-preload.cjs hands the extension ID from the page to the installer Settings → Extensions already uses
// (download, signature check, the normal permission review, load). This module is the main-process side: it decides whether a page may ask,
// and answers with the profile's own state. Nothing from the page but the ID is trusted; the ID must match the address of the top frame.
const ID = /^[a-p]{32}$/;

/** The extension ID in a Chrome Web Store detail address, or null. Exact hosts only: look-alike domains never match. */
function storeExtensionId(address) {
  let url; try { url = new URL(String(address)); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const modern = url.hostname === 'chromewebstore.google.com' && url.pathname.startsWith('/detail/');
  const legacy = url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore/detail/');
  if (!modern && !legacy) return null;
  const last = url.pathname.split('/').filter(Boolean).at(-1) || '';
  return ID.test(last) ? last : null;
}

/**
 * @param {{manager: {list(profileId: string): any, command(request: object): Promise<any>}, compat?: (id: string) => object | null}} options
 */
function createStoreBar({ manager, compat = () => null }) {
  /** The page may ask only from its top frame, on a detail address that names the same extension. */
  function authorize({ wc, frame, id, privateMode, profileId }) {
    if (!wc || wc.isDestroyed() || !frame || frame !== wc.mainFrame) return 'This request did not come from the store page.';
    if (typeof id !== 'string' || !ID.test(id) || storeExtensionId(frame.url) !== id) return 'This request does not match the store page.';
    if (privateMode) return 'Extensions are off in private windows.';
    if (typeof profileId !== 'string' || !profileId) return 'Open the store in an ordinary browsing profile.';
    return null;
  }
  function status(input) {
    const refusal = authorize(input);
    if (refusal) return { available: false, reason: refusal };
    let entry = null, supported = false;
    try { const listed = manager.list(input.profileId); supported = !!listed.supported; entry = listed.extensions.find(item => item.id === input.id) || null; } catch { return { available: false, retry: true, reason: 'Extensions are still starting.' }; }
    return { available: supported, installed: !!entry, enabled: !!entry && entry.enabled !== false, compat: compat(input.id), reason: supported ? undefined : 'Extensions are not available in this profile.' };
  }
  async function install(input) {
    const refusal = authorize(input);
    if (refusal) return { ok: false, error: refusal };
    try {
      const result = await manager.command({ type: 'install', profileId: input.profileId, extensionId: input.id });
      const entry = (result.extensions || []).find(item => item.id === input.id);
      if (result.cancelled) return { ok: false, cancelled: true };
      if (result.error) return { ok: false, error: String(result.error).slice(0, 300) };
      return entry ? { ok: true, installed: true, upToDate: !!result.upToDate } : { ok: false, error: 'The extension was not added.' };
    } catch (error) { return { ok: false, error: String(error && error.message || error).slice(0, 300) }; }
  }
  return { status, install, authorize };
}
module.exports = { storeExtensionId, createStoreBar };
