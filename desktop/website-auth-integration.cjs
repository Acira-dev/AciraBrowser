// Authentication authority comes from native controller membership, never renderer metadata.
function resolveWebsiteOwner(controllers, wc) {
  if (!wc || wc.isDestroyed()) return null;
  for (const controller of controllers) {
    if (controller.closing || !controller.window || controller.window.isDestroyed()) continue;
    for (const [tabId, entry] of controller.pages) {
      if (entry.view.webContents !== wc) continue;
      const tab = controller.state.tabs.find(item => item.id === tabId);
      if (!tab || tab.contentKind !== 'web' || !/^https?:\/\//i.test(tab.url)) return null;
      return { id: controller.windowId, profileId: tab.browserProfileId, tabId,
        session: wc.session, privateMode: controller.privateMode,
        active: controller.state.activeTabId === tabId && controller.profileId === tab.browserProfileId };
    }
  }
  return null;
}
function validAuthEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let bytes; try { bytes = JSON.stringify(value).length; } catch { return false; }
  if (bytes > 20000) return false;
  const keys = Object.keys(value).sort().join(',');
  return value.type === 'snapshot' && keys === 'type' ||
    value.type === 'respond' && keys === 'response,type' && !!value.response && typeof value.response === 'object' && !Array.isArray(value.response);
}
module.exports = { resolveWebsiteOwner, validAuthEnvelope };
