'use strict';
// chrome.sidePanel (P9), main side. The panel itself (docked right of the page area, options per tab, openPanelOnActionClick, onOpened/onClosed)
// is Acira's older code in extension-apis.cjs (createSidePanel) and extension-side-panel.cjs; this package makes chrome.sidePanel.open() answer
// the way Chrome does (side_panel_api.cc / side_panel_service.cc, Chromium 152):
//   - from an extension page it needs a user gesture: "`sidePanel.open()` may only be called in response to a user gesture."
//   - neither tabId nor windowId: "At least one of `tabId` and `windowId` must be provided"
//   - unknown tab / window: "No tab with id: N." / "No window with id: N."; a tab of another window: "The specified tab does not belong to the specified window."
//   - nothing to show: "No active side panel for tabId: N" / "No active side panel for windowId: N"
// From a service worker the gesture is not checked: Chrome carries a click in a page or content script across runtime messages into the worker's
// handler, which happens inside Chromium here where Acira cannot see it; refusing would break the common "button in the page opens the panel" case.
const MESSAGES = {
  gesture: '`sidePanel.open()` may only be called in response to a user gesture.',
  noTarget: 'At least one of `tabId` and `windowId` must be provided',
  tabMissing: id => `No tab with id: ${id}.`,
  windowMissing: id => `No window with id: ${id}.`,
  mismatch: 'The specified tab does not belong to the specified window.',
  noPanelForTab: id => `No active side panel for tabId: ${id}`,
  noPanelForWindow: id => `No active side panel for windowId: ${id}`
};

/** The error Chrome answers for open(), or null when the panel may open. `world` = {isWorker, gesture, tab(id), tabWindowId(tab), windows(), options(tabId?)}. */
function openError(input, world) {
  const options = input && typeof input === 'object' ? input : {};
  if (!world.isWorker && !world.gesture) return MESSAGES.gesture;
  const hasTab = Number.isInteger(options.tabId), hasWindow = Number.isInteger(options.windowId);
  if (!hasTab && !hasWindow) return MESSAGES.noTarget;
  if (hasTab) {
    const tab = world.tab(options.tabId);
    if (!tab) return MESSAGES.tabMissing(options.tabId);
    const owner = world.tabWindowId(tab);
    if (hasWindow && Number.isInteger(owner) && owner !== options.windowId) return MESSAGES.mismatch;
    const found = world.options(options.tabId);
    if (!found || !found.path || !found.enabled) return MESSAGES.noPanelForTab(options.tabId);
    return null;
  }
  const known = world.windows();
  if (known.length && !known.includes(options.windowId)) return MESSAGES.windowMissing(options.windowId);
  const found = world.options(undefined);
  if (!found || !found.path || !found.enabled) return MESSAGES.noPanelForWindow(options.windowId);
  return null;
}

module.exports = {
  namespaces: ['sidePanel'],
  MESSAGES,
  openError,
  install(api) {
    api.wrap('sidePanel.open', original => async (event, input, gesture) => {
      const store = api.store(), getOptions = api.handler('sidePanel.getOptions');
      const error = openError(input, {
        isWorker: event.type === 'service-worker',
        gesture: gesture === true,
        tab: id => { try { const tab = store && store.getTabById && store.getTabById(id); return tab && !tab.isDestroyed?.() ? tab : null; } catch { return null; } },
        tabWindowId: tab => { try { const win = store && store.tabToWindow && store.tabToWindow.get(tab); return win && !win.isDestroyed?.() ? win.id : undefined; } catch { return undefined; } },
        windows: () => { try { return [...(store && store.windows ? store.windows : [])].filter(win => !win.isDestroyed?.()).map(win => win.id); } catch { return []; } },
        options: tabId => { try { return getOptions ? getOptions(event, tabId === undefined ? {} : {tabId}) : null; } catch { return null; } }
      });
      if (error) throw new Error(error);
      if (!original) throw new Error('The side panel is not available.');
      return original(event, input);
    });
  }
};
