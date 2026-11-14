'use strict';
// chrome://extensions from an extension: Acira's Extensions settings.
//
// Chrome's page for an extension's own switches ("Allow access to file URLs", Allow in Incognito, Details) is chrome://extensions[/?id=<id>]. An extension reaches it through
// chrome.tabs.create / chrome.tabs.update (PDF.js: its viewer asks the worker to open chrome://extensions/?id=<its id> for "Allow access to file URLs"). Acira's counterpart is
// Settings > Extensions (acira://settings, section Extensions), where the same switches are. A link in an extension page to chrome:// is not followed in Chrome either (its
// renderer refuses chrome: from other pages), so only the tabs API asks for it.
//
// Settings opens on the section named in a pending "target" that the interface keeps in its own storage under a key made of the window and the Settings tab
// (ui/settingsView.ts requestSettingsTarget / takeSettingsTarget: dropped after eight seconds, taken once by the Settings tab that shows). This writes the same record.
const crypto = require('node:crypto');

/** chrome://extensions, chrome://extensions/, chrome://extensions/?id=..., chrome://extensions/shortcuts ... (Chrome's own sub-pages all live in this one section here). */
const EXTENSIONS_PAGE = /^chrome:\/\/extensions(?:[/?#]|$)/i;
const isExtensionsPage = text => typeof text === 'string' && EXTENSIONS_PAGE.test(text.trim());

/** The key the interface reads a pending Settings target under (ui/settingsView.ts targetKey): the window's own interface identity (its snapshot's windowId, `<id>:main`) and the tab. */
const targetKey = (windowId, tabId) => `acira-settings-target:${encodeURIComponent(windowId)}:${encodeURIComponent(tabId)}`;

/** The interface page (the browser's own, not its popup layer) of an Acira window, or null. */
function interfaceOf(windowId, electron = require('electron')) {
  try {
    const win = electron.BaseWindow.fromId(windowId);
    if (!win || win.isDestroyed()) return null;
    const view = win.contentView.children.find(child => child.webContents && !child.webContents.isDestroyed() && /^acira-browser-ui:\/\/ui\/index\.html(?:\?(?!.*view=overlay).*)?$/.test(child.webContents.getURL()));
    return view ? view.webContents : null;
  } catch { return null; }
}

/**
 * Leaves the pending target for (this window, this tab): Settings opens on `section` when that tab shows. The window's identity is the interface page's own (the main process
 * keeps another id for the window: the page names itself, as ui/settingsView.ts settingsDestination does). Never throws: opening Settings still works without the section.
 */
async function aimSettings({ nativeWindowId, tabId, section, interfaceFor = interfaceOf }) {
  try {
    if (typeof tabId !== 'string' || !tabId) return false;
    const page = interfaceFor(nativeWindowId);
    if (!page) return false;
    const record = JSON.stringify({ section, at: Date.now() });
    return !!(await page.executeJavaScript(`(()=>{try{const id=window.acira&&window.acira.initialSnapshot&&window.acira.initialSnapshot.windowId;if(typeof id!=='string'||!id)return false;localStorage.setItem('acira-settings-target:'+encodeURIComponent(id)+':'+encodeURIComponent(${JSON.stringify(tabId)}),${JSON.stringify(record)});return true;}catch(error){return false;}})()`));
  } catch { return false; }
}

/** The Settings tab of this profile that is already open in the window, if any (Settings is one tab per profile: openSettings in ui/settingsView.ts). */
const existingSettingsTab = (tabs, profileId) => (Array.isArray(tabs) ? tabs : []).find(tab => tab && tab.url === 'acira://settings' && (!profileId || tab.browserProfileId === profileId)) || null;
const newSettingsTabId = () => 'tab-' + crypto.randomUUID();

module.exports = { isExtensionsPage, targetKey, interfaceOf, aimSettings, existingSettingsTab, newSettingsTabId, EXTENSIONS_PAGE };
